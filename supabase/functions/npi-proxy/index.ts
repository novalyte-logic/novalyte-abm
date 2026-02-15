import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NPI_BASE = 'https://npiregistry.cms.hhs.gov/api/';

function pickParams(req: Request): Promise<Record<string, any>> | Record<string, any> {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const params: Record<string, any> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }
  return req.json()
    .catch(() => ({}))
    .then((body: any) => {
      if (body && typeof body === 'object' && body.params && typeof body.params === 'object') return body.params;
      return body && typeof body === 'object' ? body : {};
    });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const raw = await pickParams(req);
    const params = (raw && typeof raw === 'object') ? raw : {};

    // Defaults to keep client calls minimal.
    if (!params.version) params.version = '2.1';
    if (!params.limit) params.limit = 10;

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      qs.set(k, s);
    }

    const target = `${NPI_BASE}?${qs.toString()}`;
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json' },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

