// Supabase Edge Function — Resend Webhook Receiver
// Receives delivery events (sent, delivered, opened, clicked, bounced, complained)
// and updates the sent_emails table in Supabase.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // Resend sends webhook events as:
    // { type: 'email.delivered', created_at: '...', data: { email_id: '...', to: [...], ... } }
    const { type, data } = payload;
    if (!type || !data?.email_id) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map Resend event types to our EmailEvent type
    const eventMap: Record<string, string> = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'delivery_delayed',
      'email.complained': 'complained',
      'email.bounced': 'bounced',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
    };

    const event = eventMap[type];
    if (!event) {
      return new Response(JSON.stringify({ ok: true, skipped: type }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Connect to Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update the sent_emails record
    const emailId = data.email_id;
    const now = new Date().toISOString();

    const updatePayload: Record<string, any> = {
      last_event: event,
      last_event_at: now,
    };

    if (event === 'opened' || event === 'clicked') {
      // Increment open/click counts via raw SQL or just set
      const { data: existing } = await supabase
        .from('sent_emails')
        .select('open_count, click_count')
        .eq('id', emailId)
        .single();

      if (existing) {
        if (event === 'opened') updatePayload.open_count = (existing.open_count || 0) + 1;
        if (event === 'clicked') {
          updatePayload.click_count = (existing.click_count || 0) + 1;
          updatePayload.open_count = (existing.open_count || 0) + 1;
        }
      }
    }

    const { error } = await supabase
      .from('sent_emails')
      .update(updatePayload)
      .eq('id', emailId);

    if (error) {
      console.error('Failed to update sent_emails:', error);
      // Still return 200 so Resend doesn't retry
    }

    // Also log the raw event for audit
    await supabase.from('webhook_events').insert({
      id: crypto.randomUUID(),
      source: 'resend',
      event_type: type,
      payload: payload,
      processed_at: now,
    }).catch(() => {}); // best-effort

    return new Response(JSON.stringify({ ok: true, event, emailId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
