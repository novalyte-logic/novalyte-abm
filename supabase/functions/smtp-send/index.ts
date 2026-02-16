import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Supabase Edge Function: smtp-send
// Sends email via SMTP using server-side env vars (do not put SMTP creds in the browser).
//
// Required secrets/env:
// - SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// Deploy:
//   supabase functions deploy smtp-send --no-verify-jwt
//   supabase secrets set SMTP_HOST=... SMTP_PORT=... SMTP_SECURE=true SMTP_USER=... SMTP_PASS=... SMTP_FROM=...

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type SendBody = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  contactId?: string;
  clinicName?: string;
  market?: string;
  tags?: { name: string; value: string }[];
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function safeStr(v: unknown, max = 512): string {
  return String(v || '').slice(0, max);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') {
    // Lightweight health probe (no email send).
    const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
    const SMTP_USER = Deno.env.get('SMTP_USER') || '';
    const SMTP_FROM = Deno.env.get('SMTP_FROM') || '';
    const hasPass = Boolean(Deno.env.get('SMTP_PASS'));
    return new Response(JSON.stringify({
      ok: true,
      mode: 'health',
      smtpConfigured: Boolean(SMTP_HOST && SMTP_USER && SMTP_FROM && hasPass),
      from: SMTP_FROM || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Partial<SendBody>;
    const action = safeStr((body as any).action, 32).toLowerCase();
    if (action === 'health') {
      const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
      const SMTP_USER = Deno.env.get('SMTP_USER') || '';
      const SMTP_FROM = Deno.env.get('SMTP_FROM') || '';
      const hasPass = Boolean(Deno.env.get('SMTP_PASS'));
      return new Response(JSON.stringify({
        ok: true,
        mode: 'health',
        smtpConfigured: Boolean(SMTP_HOST && SMTP_USER && SMTP_FROM && hasPass),
        from: SMTP_FROM || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const to = safeStr(body.to, 320).trim().toLowerCase();
    const subject = safeStr(body.subject, 512).trim();
    const html = String(body.html || '').trim();
    const text = body.text ? String(body.text) : undefined;

    if (!isValidEmail(to)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid to email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!subject) {
      return new Response(JSON.stringify({ ok: false, error: 'Subject required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!html) {
      return new Response(JSON.stringify({ ok: false, error: 'HTML required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SMTP_HOST = Deno.env.get('SMTP_HOST') || '';
    const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '587');
    const SMTP_SECURE = String(Deno.env.get('SMTP_SECURE') || '').toLowerCase() === 'true';
    const SMTP_USER = Deno.env.get('SMTP_USER') || '';
    const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
    const SMTP_FROM = Deno.env.get('SMTP_FROM') || '';

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
      return new Response(JSON.stringify({ ok: false, error: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM)' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use Node compatibility in Deno Edge Runtime.
    // If nodemailer ever fails in Edge, swap to a pure SMTP implementation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = await import('npm:nodemailer@6.9.13');
    const transporter = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const headers: Record<string, string> = {
      'X-Novalyte-Contact-Id': safeStr(body.contactId, 128),
      'X-Novalyte-Clinic': safeStr(body.clinicName, 256),
      'X-Novalyte-Market': safeStr(body.market, 256),
    };
    if (Array.isArray(body.tags)) {
      for (const t of body.tags.slice(0, 10)) {
        if (!t?.name || !t?.value) continue;
        const key = `X-Novalyte-Tag-${safeStr(t.name, 32)}`.replace(/[^A-Za-z0-9_-]/g, '_');
        headers[key] = safeStr(t.value, 128);
      }
    }

    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
      text,
      headers,
    });

    const messageId = String(info?.messageId || `smtp-${Date.now()}`);

    // Best-effort: persist to sent_emails for CRM attribution consistency.
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey);
        const now = new Date().toISOString();
        await supabase.from('sent_emails').upsert({
          id: messageId,
          contact_id: safeStr(body.contactId, 128) || null,
          to_email: to,
          from_email: SMTP_FROM,
          subject,
          clinic_name: safeStr(body.clinicName, 256) || null,
          market: safeStr(body.market, 256) || null,
          sent_at: now,
          last_event: 'sent',
          last_event_at: now,
          open_count: 0,
          click_count: 0,
          sequence_step: safeStr(body.tags?.find(t => t?.name === 'template')?.value, 64) || null,
          ai_generated: String(body.tags?.find(t => t?.name === 'ai_generated')?.value || '').toLowerCase() === 'true',
          provider: 'smtp',
        }, { onConflict: 'id' });
      }
    } catch {
      // non-fatal
    }

    return new Response(JSON.stringify({ ok: true, id: messageId, from: SMTP_FROM }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
