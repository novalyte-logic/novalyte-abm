import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPI_BASE = 'https://api.vapi.ai';

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 11 ? `+${digits}` : null;
}

function firstMessage(clinicName: string, dmName?: string | null) {
  if (dmName) {
    return `Hi ${dmName}, this is Novalyte verification calling for ${clinicName}. Are you currently accepting new patient referrals?`;
  }
  return `Hi, this is Novalyte verification calling for ${clinicName}. Are you currently accepting new patient referrals?`;
}

async function enqueueFallback(
  supabase: ReturnType<typeof createClient>,
  job: any,
  email: string | null,
  reason: string,
) {
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
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(20, Number(body?.batchSize || 5)));

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const vapiApiKey = Deno.env.get('VAPI_API_KEY') || '';
    const vapiPhoneNumberId = Deno.env.get('VAPI_PHONE_NUMBER_ID') || '';
    const vapiAssistantId = Deno.env.get('VAPI_ASSISTANT_ID') || '';

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Supabase service role is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: control } = await supabase
      .from('verification_queue_control')
      .select('is_paused')
      .eq('id', 'global')
      .single();

    if (control?.is_paused) {
      return new Response(JSON.stringify({ ok: true, paused: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workerId = `edge-${crypto.randomUUID().slice(0, 8)}`;
    const { data: jobs, error: claimError } = await supabase.rpc('claim_verification_jobs', {
      p_worker: workerId,
      p_batch: batchSize,
    });

    if (claimError) {
      return new Response(JSON.stringify({ error: claimError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!jobs?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let fallbackCount = 0;
    let dispatched = 0;

    for (const job of jobs) {
      processed += 1;

      const { data: clinicRow } = await supabase
        .from('clinics')
        .select('id,name,phone,email,manager_email,owner_email')
        .eq('id', job.clinic_id)
        .single();

      const { data: contactRow } = job.contact_id
        ? await supabase
            .from('contacts')
            .select('id,decision_maker_id')
            .eq('id', job.contact_id)
            .single()
        : { data: null };

      const { data: dmRow } = contactRow?.decision_maker_id
        ? await supabase
            .from('decision_makers')
            .select('first_name,last_name,email')
            .eq('id', contactRow.decision_maker_id)
            .single()
        : { data: null };

      const phone = normalizePhone(clinicRow?.phone || null);
      const email = dmRow?.email || clinicRow?.manager_email || clinicRow?.owner_email || clinicRow?.email || null;
      const dmName = dmRow ? `${dmRow.first_name || ''} ${dmRow.last_name || ''}`.trim() : null;
      const clinicName = clinicRow?.name || (job.payload?.clinicName as string) || 'clinic';

      if (!phone || !vapiApiKey || !vapiPhoneNumberId || !vapiAssistantId) {
        fallbackCount += 1;
        await enqueueFallback(
          supabase,
          job,
          email,
          !phone ? 'No valid phone number for call attempt' : 'Vapi is not configured on backend worker',
        );
        continue;
      }

      try {
        const response = await fetch(`${VAPI_BASE}/call/phone`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            assistantId: vapiAssistantId,
            phoneNumberId: vapiPhoneNumberId,
            customer: {
              number: phone,
              name: dmName || clinicName,
            },
            assistantOverrides: {
              firstMessage: firstMessage(clinicName, dmName),
              variableValues: {
                clinic_name: clinicName,
                decision_maker: dmName || 'practice manager',
              },
            },
          }),
        });

        if (!response.ok) {
          const msg = await response.text();
          fallbackCount += 1;
          await enqueueFallback(supabase, job, email, `Call dispatch failed: ${msg}`);
          continue;
        }

        const callData = await response.json();
        dispatched += 1;

        await supabase
          .from('verification_jobs')
          .update({
            status: 'awaiting_webhook',
            call_id: callData?.id || null,
            call_status: callData?.status || 'queued',
            dispatched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      } catch (err) {
        fallbackCount += 1;
        await enqueueFallback(
          supabase,
          job,
          email,
          `Call dispatch exception: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processed,
      dispatched,
      fallbackCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('verification-dispatch error', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
