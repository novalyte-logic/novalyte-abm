// Supabase Edge Function: resend-send
// Sends email via Resend server-side to avoid exposing API keys in the client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ResendTag = { name: string; value: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Allow browser client to call via Supabase Functions endpoint.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (body?.action === "health") {
    return json({
      ok: true,
      resendConfigured: Boolean(Deno.env.get("RESEND_API_KEY")),
    });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) return json({ error: "RESEND_API_KEY is not configured" }, 500);

  const to = String(body?.to || "").trim();
  const from = String(body?.from || "").trim();
  const subject = String(body?.subject || "").trim();
  const html = String(body?.html || "").trim();
  const tags = (Array.isArray(body?.tags) ? body.tags : []) as ResendTag[];

  if (!to || !from || !subject || !html) {
    return json({ error: "Missing required fields: to, from, subject, html" }, 400);
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, from, subject, html, tags }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    return json(
      {
        error: "Resend request failed",
        status: resp.status,
        body: text.slice(0, 2000),
      },
      502,
    );
  }

  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ error: "Resend returned invalid JSON" }, 502);
  }

  const emailId = String(data?.id || '');
  if (!emailId) return json({ error: 'Resend returned missing id' }, 502);

  // Best-effort: persist to sent_emails for event tracking + CRM attribution.
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const now = new Date().toISOString();

      const tagMap = new Map<string, string>();
      for (const t of tags) {
        if (!t?.name || !t?.value) continue;
        tagMap.set(String(t.name), String(t.value));
      }

      const contactId =
        String((body?.contactId ?? body?.contact_id ?? tagMap.get('contact_id') ?? '') || '').trim() || null;

      const clinicName = String(body?.clinicName ?? tagMap.get('clinic') ?? '').slice(0, 256) || null;
      const market = String(body?.market ?? tagMap.get('market') ?? '').slice(0, 256) || null;

      const template = String(tagMap.get('template') || '').slice(0, 64);
      const aiGenerated = String(tagMap.get('ai_generated') || '').toLowerCase() === 'true' || template.startsWith('ai-');

      await supabase.from('sent_emails').upsert({
        id: emailId,
        contact_id: contactId,
        to_email: to,
        from_email: from,
        subject,
        clinic_name: clinicName,
        market,
        sent_at: now,
        last_event: 'sent',
        last_event_at: now,
        open_count: 0,
        click_count: 0,
        sequence_step: template || null,
        ai_generated: aiGenerated,
        provider: 'resend',
      }, { onConflict: 'id' });
    }
  } catch {
    // Do not fail the send if tracking persistence fails.
  }

  return json({ id: emailId });
});
