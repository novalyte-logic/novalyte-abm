import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function str(v: unknown) {
  return typeof v === 'string' ? v : '';
}

function getCallPayload(payload: any) {
  return payload?.data?.call || payload?.call || payload?.message?.call || payload?.data || payload;
}

function getEventType(payload: any) {
  return str(payload?.type || payload?.event || payload?.message?.type || payload?.data?.type).toLowerCase();
}

function isPositiveResult(call: any): boolean {
  const status = str(call?.status).toLowerCase();
  const duration = Number(call?.durationSeconds || call?.duration || 0);

  const summaryBlob = [
    str(call?.summary),
    str(call?.analysis?.summary),
    str(call?.analysis?.successEvaluation),
    str(call?.analysis?.structuredData?.interest_level),
  ].join(' ').toLowerCase();

  const negativeSignals = /(no answer|voicemail|busy|failed|unanswered|machine|not interested|wrong number|blocked)/.test(summaryBlob)
    || ['failed', 'busy', 'no-answer', 'no_answer', 'voicemail'].includes(status);

  const positiveSignals = /(interested|positive|qualified|send info|send information|follow up|accepting referrals|success|connected)/.test(summaryBlob);

  const connected = duration > 0 || ['ended', 'completed', 'in-progress', 'in_progress'].includes(status);
  return connected && positiveSignals && !negativeSignals;
}

async function enqueueFallback(supabase: ReturnType<typeof createClient>, job: any, reason: string) {
  const { data: clinicRow } = await supabase
    .from('clinics')
    .select('email,manager_email,owner_email')
    .eq('id', job.clinic_id)
    .single();

  const { data: contactRow } = job.contact_id
    ? await supabase
        .from('contacts')
        .select('decision_maker_id')
        .eq('id', job.contact_id)
        .single()
    : { data: null };

  const { data: dmRow } = contactRow?.decision_maker_id
    ? await supabase
        .from('decision_makers')
        .select('email')
        .eq('id', contactRow.decision_maker_id)
        .single()
    : { data: null };

  const email = dmRow?.email || clinicRow?.manager_email || clinicRow?.owner_email || clinicRow?.email || null;

  await supabase.from('verification_sequence_enrollments').insert({
    job_id: job.id,
    clinic_id: job.clinic_id,
    contact_id: job.contact_id,
    campaign: 'onboarding_drip',
    email,
    status: 'queued',
  });

  await supabase
    .from('clinics')
    .update({ verification_status: 'Sequence_Active', verification_updated_at: new Date().toISOString() })
    .eq('id', job.clinic_id);

  if (job.contact_id) {
    await supabase
      .from('contacts')
      .update({ status: 'follow_up', updated_at: new Date().toISOString() })
      .eq('id', job.contact_id);
  }

  await supabase
    .from('verification_jobs')
    .update({
      status: 'completed_fallback',
      outcome_reason: reason,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json();
    const eventType = getEventType(payload);
    const call = getCallPayload(payload);
    const callId = str(call?.id || payload?.callId || payload?.data?.id);

    if (!callId) {
      return new Response(JSON.stringify({ error: 'Missing call id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Supabase service role is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: job } = await supabase
      .from('verification_jobs')
      .select('*')
      .eq('call_id', callId)
      .in('status', ['awaiting_webhook', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase.from('webhook_events').insert({
      source: 'vapi',
      event_type: eventType || 'call.webhook',
      payload,
      processed_at: new Date().toISOString(),
    }).catch(() => {});

    if (!job) {
      return new Response(JSON.stringify({ ok: true, skipped: 'No active verification job for call id', callId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const positive = isPositiveResult(call);

    if (positive) {
      await supabase
        .from('clinics')
        .update({ verification_status: 'Verified_Active', verification_updated_at: new Date().toISOString() })
        .eq('id', job.clinic_id);

      if (job.contact_id) {
        await supabase
          .from('contacts')
          .update({ status: 'qualified', updated_at: new Date().toISOString() })
          .eq('id', job.contact_id);
      }

      await supabase
        .from('verification_jobs')
        .update({
          status: 'completed_success',
          call_status: str(call?.status) || 'completed',
          call_result: call || payload,
          outcome_reason: 'Connected and positive',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    } else {
      await enqueueFallback(supabase, job, 'No answer, busy, voicemail, or non-positive call outcome');
    }

    return new Response(JSON.stringify({ ok: true, callId, jobId: job.id, positive }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('vapi-call-webhook error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
