// Supabase Edge Function: inbound-email
// Receives inbound emails (replies) and attaches them to a contact by:
// 1) Explicit contact id header (best case), else
// 2) Matching sender address to sent_emails.to_email (most common case).
//
// This is provider-agnostic. You can point Resend Inbound Parse, SendGrid Inbound,
// Mailgun Routes, or any webhook to this endpoint as long as it posts JSON with
// from/to/subject/text|html (see parsing below).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function safeStr(v: unknown, max = 4096): string {
  return String(v || '').slice(0, max);
}

function normEmail(v: unknown): string {
  return safeStr(v, 320).trim().toLowerCase();
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const s = safeStr(v, 8192).trim();
    if (s) return s;
  }
  return '';
}

function extractFromHeaderMap(headers: Record<string, unknown>, key: string): string {
  const target = key.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (String(k || '').toLowerCase() === target) return safeStr(v, 1024).trim();
  }
  return '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase service role is not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (payload?.action === 'health') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Normalize inbound fields across providers.
  const fromEmail = normEmail(
    payload.fromEmail ??
    payload.from ??
    payload.sender ??
    payload.envelope?.from ??
    payload.mail?.from ??
    payload.data?.from
  );
  const toEmail = normEmail(
    payload.toEmail ??
    payload.to ??
    payload.recipient ??
    payload.envelope?.to ??
    payload.mail?.to ??
    payload.data?.to
  );
  const subject = safeStr(payload.subject ?? payload.mail?.subject ?? payload.data?.subject, 512).trim();
  const text = firstNonEmpty(payload.text, payload.plain, payload.mail?.text, payload.data?.text);
  const html = firstNonEmpty(payload.html, payload.mail?.html, payload.data?.html);
  const receivedAt = safeStr(payload.receivedAt ?? payload.received_at ?? payload.timestamp ?? payload.created_at, 128).trim();

  const headerMap: Record<string, unknown> =
    (payload.headers && typeof payload.headers === 'object') ? payload.headers :
    (payload.mail?.headers && typeof payload.mail.headers === 'object') ? payload.mail.headers :
    (payload.data?.headers && typeof payload.data.headers === 'object') ? payload.data.headers :
    {};

  const explicitContactId =
    safeStr(payload.contactId ?? payload.contact_id, 128).trim() ||
    extractFromHeaderMap(headerMap, 'x-novalyte-contact-id') ||
    extractFromHeaderMap(headerMap, 'X-Novalyte-Contact-Id');

  if (!fromEmail || !toEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing from/to email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Find matching sent email/contact.
  let matched: { sent_email_id: string | null; contact_id: string | null } = { sent_email_id: null, contact_id: null };

  if (explicitContactId) {
    matched.contact_id = explicitContactId;
  } else {
    // Most common: inbound reply sender == our outbound recipient.
    const { data } = await supabase
      .from('sent_emails')
      .select('id, contact_id')
      .eq('to_email', fromEmail)
      .order('sent_at', { ascending: false })
      .limit(1);

    if (Array.isArray(data) && data.length > 0) {
      matched = { sent_email_id: String(data[0].id), contact_id: data[0].contact_id ? String(data[0].contact_id) : null };
    }
  }

  const snippetSource = (text || html || '').replace(/\s+/g, ' ').trim();
  const snippet = safeStr(snippetSource, 600);
  const receivedIso = receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString();

  // Persist reply (even if unmatched).
  const { data: replyRow, error: replyErr } = await supabase
    .from('email_replies')
    .insert({
      contact_id: matched.contact_id,
      sent_email_id: matched.sent_email_id,
      from_email: fromEmail,
      to_email: toEmail,
      subject: subject || null,
      snippet: snippet || null,
      received_at: receivedIso,
      raw: payload,
    })
    .select('id, contact_id')
    .single();

  if (replyErr) {
    return new Response(JSON.stringify({ ok: false, error: replyErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // If matched to a contact, create an activity + tag it as an account.
  if (matched.contact_id) {
    // Add activity
    await supabase.from('activities').insert({
      id: crypto.randomUUID(),
      contact_id: matched.contact_id,
      type: 'email_reply',
      description: `Email reply received from ${fromEmail}${subject ? ` — ${subject}` : ''}${snippet ? `: ${snippet}` : ''}`.slice(0, 1000),
      metadata: { fromEmail, toEmail, subject, snippet, replyId: replyRow?.id, sentEmailId: matched.sent_email_id },
      timestamp: receivedIso,
    }).catch(() => {});

    // Tag as account + move to follow_up if still early in pipeline.
    try {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, tags, status')
        .eq('id', matched.contact_id)
        .single();

      if (contact) {
        const prevTags = Array.isArray((contact as any).tags) ? (contact as any).tags : [];
        const tagSet = new Set<string>(prevTags.map((t: any) => String(t)));
        tagSet.add('account');
        tagSet.add('replied');

        const prevStatus = String((contact as any).status || 'new');
        const nextStatus =
          prevStatus === 'qualified' || prevStatus === 'not_interested'
            ? prevStatus
            : 'follow_up';

        await supabase
          .from('contacts')
          .update({ tags: Array.from(tagSet), status: nextStatus, updated_at: new Date().toISOString() })
          .eq('id', matched.contact_id);
      }
    } catch {
      // non-fatal
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    replyId: replyRow?.id,
    contactId: replyRow?.contact_id || null,
    matched: Boolean(replyRow?.contact_id),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

