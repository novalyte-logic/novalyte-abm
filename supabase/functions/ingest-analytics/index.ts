import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AnalyticsPayload = {
  session_id: string;
  event_type: string;
  event_data?: Record<string, unknown>;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  referrer?: string | null;
  landing_page?: string | null;
  geo_city?: string | null;
  geo_state?: string | null;
  geo_zip?: string | null;
  geo_country?: string | null;
  geo_lat?: number | null;
  geo_lng?: number | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  screen_width?: number | null;
  screen_height?: number | null;
  time_on_page?: number | null;
};

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function detectDevice(userAgent: string): string {
  if (/tablet|ipad/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function parseGeoFromHeaders(req: Request): Partial<AnalyticsPayload> {
  return {
    geo_city: strOrNull(req.headers.get('x-vercel-ip-city')),
    geo_state: strOrNull(req.headers.get('x-vercel-ip-country-region')),
    geo_country: strOrNull(req.headers.get('x-vercel-ip-country')),
    geo_lat: numOrNull(req.headers.get('x-vercel-ip-latitude')),
    geo_lng: numOrNull(req.headers.get('x-vercel-ip-longitude')),
  };
}

async function sendSlackAlertIfConversion(payload: AnalyticsPayload) {
  const hook = Deno.env.get('ANALYTICS_SLACK_WEBHOOK_URL') || '';
  if (!hook) return;
  if (payload.event_type !== 'conversion' && payload.event_type !== 'lead_capture') return;

  const city = payload.geo_city || 'Unknown city';
  const state = payload.geo_state || '';
  const section = String(payload.event_data?.section || payload.event_data?.label || 'landing');
  const campaign = payload.utm_campaign || 'unknown-campaign';

  await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Conversion detected: ${city}${state ? `, ${state}` : ''} · ${campaign} · ${section}`,
    }),
  }).catch(() => {});
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Supabase service role credentials missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as Partial<AnalyticsPayload>;
    const userAgent = req.headers.get('user-agent') || '';
    const headerGeo = parseGeoFromHeaders(req);

    const payload: AnalyticsPayload = {
      session_id: strOrNull(body.session_id) || crypto.randomUUID(),
      event_type: strOrNull(body.event_type) || 'page_view',
      event_data: body.event_data || {},
      utm_source: strOrNull(body.utm_source),
      utm_medium: strOrNull(body.utm_medium),
      utm_campaign: strOrNull(body.utm_campaign),
      utm_term: strOrNull(body.utm_term),
      utm_content: strOrNull(body.utm_content),
      gclid: strOrNull(body.gclid),
      referrer: strOrNull(body.referrer),
      landing_page: strOrNull(body.landing_page),
      geo_city: strOrNull(body.geo_city) || headerGeo.geo_city || null,
      geo_state: strOrNull(body.geo_state) || headerGeo.geo_state || null,
      geo_zip: strOrNull(body.geo_zip),
      geo_country: strOrNull(body.geo_country) || headerGeo.geo_country || null,
      geo_lat: numOrNull(body.geo_lat) ?? headerGeo.geo_lat ?? null,
      geo_lng: numOrNull(body.geo_lng) ?? headerGeo.geo_lng ?? null,
      device_type: strOrNull(body.device_type) || detectDevice(userAgent),
      browser: strOrNull(body.browser),
      os: strOrNull(body.os),
      screen_width: numOrNull(body.screen_width),
      screen_height: numOrNull(body.screen_height),
      time_on_page: numOrNull(body.time_on_page),
    };

    const supabase = createClient(supabaseUrl, serviceKey);

    const row = {
      session_id: payload.session_id,
      event_type: payload.event_type,
      event_data: payload.event_data || {},
      utm_source: payload.utm_source,
      utm_medium: payload.utm_medium,
      utm_campaign: payload.utm_campaign,
      utm_term: payload.utm_term,
      utm_content: payload.utm_content,
      gclid: payload.gclid,
      referrer: payload.referrer,
      landing_page: payload.landing_page,
      geo_city: payload.geo_city,
      geo_state: payload.geo_state,
      geo_zip: payload.geo_zip,
      geo_country: payload.geo_country,
      geo_lat: payload.geo_lat,
      geo_lng: payload.geo_lng,
      device_type: payload.device_type,
      browser: payload.browser,
      os: payload.os,
      screen_width: payload.screen_width,
      screen_height: payload.screen_height,
      time_on_page: payload.time_on_page,
    };

    const insertPromise = supabase.from('page_events').insert(row);

    const trafficChannel = supabase.channel('live-traffic');
    await new Promise<void>((resolve) => {
      trafficChannel.subscribe((_status: string) => resolve());
    });

    const broadcastPromise = trafficChannel.send({
      type: 'broadcast',
      event: 'traffic',
      payload: {
        ...payload,
        created_at: new Date().toISOString(),
      },
    });

    const [{ error: insertError }] = await Promise.all([insertPromise, broadcastPromise]);
    await supabase.removeChannel(trafficChannel);

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await sendSlackAlertIfConversion(payload);

    return new Response(JSON.stringify({ ok: true, session_id: payload.session_id, event_type: payload.event_type }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
