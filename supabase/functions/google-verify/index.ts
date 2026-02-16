// Supabase Edge Function: google-verify
// Live verification using Google Places (official website) + website scraping (emails).
//
// Secrets required:
// - GOOGLE_PLACES_API_KEY
//
// Notes:
// - This runs in Edge; do not attempt raw SMTP socket checks here.
// - Use downstream email verification (RevenueBase, etc.) for deliverability.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Clinic = {
  name?: string;
  address?: { city?: string; state?: string; street?: string };
  phone?: string;
  website?: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safeStr(v: unknown, max = 1024): string {
  return String(v || '').slice(0, max);
}

function cleanWebsite(url: string): string | null {
  const raw = safeStr(url, 2048).trim();
  if (!raw) return null;
  const withProto = raw.startsWith('http') ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'yelp.com',
  'healthgrades.com',
  'zocdoc.com',
  'vitals.com',
  'webmd.com',
  'google.com',
  'goo.gl',
  'maps.google.com',
  'yellowpages.com',
  'bbb.org',
];

function isSocialHost(host: string): boolean {
  const h = String(host || '').toLowerCase();
  return SOCIAL_HOSTS.some(s => h === s || h.endsWith(`.${s}`) || h.includes(s));
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function extractEmails(text: string): string[] {
  const s = String(text || '');
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
  const found = s.match(re) || [];
  return uniq(found.map(e => e.toLowerCase().trim()))
    .filter(e => e.length <= 254);
}

function pickConfirmedEmail(found: string[], leadEmail: string | null, officialHost: string): string | null {
  const lead = (leadEmail || '').toLowerCase().trim();
  if (lead && found.includes(lead)) return lead;
  const domain = officialHost || (lead ? lead.split('@')[1] : '');
  if (!domain) return null;
  const domainMatches = found.filter(e => e.split('@')[1] === domain);
  if (domainMatches.length === 0) return null;
  // Prefer non-generic local parts.
  const generic = new Set(['info', 'contact', 'office', 'admin', 'hello', 'support', 'sales', 'marketing', 'billing', 'appointments', 'reception', 'frontdesk']);
  const nonGeneric = domainMatches.find(e => !generic.has(e.split('@')[0]));
  return nonGeneric || domainMatches[0] || null;
}

async function fetchTextViaJina(url: string, timeoutMs = 9000): Promise<string> {
  // r.jina.ai works well for CORS-free fetch and returns rendered-ish HTML/plain.
  const u = url.startsWith('http') ? url : `https://${url}`;
  const target = `https://r.jina.ai/${u}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(target, { signal: controller.signal });
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

async function googleFindPlace(apiKey: string, query: string): Promise<string | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  url.searchParams.set('input', query);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set('fields', 'place_id');
  url.searchParams.set('key', apiKey);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(() => null);
  const pid = data?.candidates?.[0]?.place_id;
  return pid ? String(pid) : null;
}

async function googlePlaceDetails(apiKey: string, placeId: string): Promise<{ website: string | null }> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'website');
  url.searchParams.set('key', apiKey);
  const resp = await fetch(url.toString());
  const data = await resp.json().catch(() => null);
  const website = data?.result?.website ? cleanWebsite(String(data.result.website)) : null;
  return { website };
}

async function verifyClinic(apiKey: string, clinic: Clinic, leadEmail: string | null) {
  const name = safeStr(clinic?.name, 256).trim();
  const city = safeStr(clinic?.address?.city, 128).trim();
  const state = safeStr(clinic?.address?.state, 64).trim();
  const query = [name, city && state ? `${city}, ${state}` : (city || state)].filter(Boolean).join(' ');

  const placeId = query ? await googleFindPlace(apiKey, query) : null;
  let officialWebsite: string | null = null;

  if (placeId) {
    const det = await googlePlaceDetails(apiKey, placeId);
    officialWebsite = det.website;
  }

  // Fallback: accept existing clinic.website if not social.
  if (!officialWebsite) {
    const w = clinic?.website ? cleanWebsite(String(clinic.website)) : null;
    if (w && !isSocialHost(hostOf(w))) officialWebsite = w;
  }

  if (!officialWebsite) {
    return {
      ok: true,
      status: 'Not Found',
      officialWebsite: null,
      officialPlaceId: placeId,
      foundEmails: [],
      confirmedEmail: null,
      checkedAt: new Date().toISOString(),
    };
  }

  const host = hostOf(officialWebsite);
  const pages = uniq([
    officialWebsite,
    `${officialWebsite.replace(/\/$/, '')}/contact`,
    `${officialWebsite.replace(/\/$/, '')}/about`,
    `${officialWebsite.replace(/\/$/, '')}/contact-us`,
    `${officialWebsite.replace(/\/$/, '')}/team`,
  ]);

  const texts = await Promise.all(pages.map(p => fetchTextViaJina(p)));
  const foundEmails = uniq(texts.flatMap(extractEmails))
    .filter(e => {
      const d = e.split('@')[1];
      return d && d.length > 1;
    });

  const confirmedEmail = pickConfirmedEmail(foundEmails, leadEmail, host);
  const status =
    confirmedEmail
      ? 'Verified'
      : (leadEmail && foundEmails.length > 0 ? 'Mismatch' : 'Not Found');

  return {
    ok: true,
    status,
    officialWebsite,
    officialPlaceId: placeId,
    foundEmails,
    confirmedEmail,
    checkedAt: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (body?.action === 'health') {
    return json({ ok: true, placesConfigured: Boolean(Deno.env.get('GOOGLE_PLACES_API_KEY')) });
  }

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';
  if (!apiKey) return json({ ok: false, error: 'GOOGLE_PLACES_API_KEY is not configured' }, 500);

  const action = safeStr(body?.action, 64).toLowerCase();
  if (action === 'verify_clinic') {
    const clinic = (body?.clinic || {}) as Clinic;
    const leadEmail = body?.leadEmail ? safeStr(body.leadEmail, 320) : null;
    const result = await verifyClinic(apiKey, clinic, leadEmail);
    return json(result);
  }

  if (action === 'verify_email') {
    // Edge-safe stub. Use RevenueBase (client) or server-side verifier elsewhere for deliverability.
    const email = safeStr(body?.email, 320).trim().toLowerCase();
    const looksValid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
    return json({
      ok: true,
      action: 'verify_email',
      email,
      result: { status: looksValid ? 'unknown' : 'invalid', verified: false, reason: looksValid ? 'edge_stub' : 'bad_format' },
      checkedAt: new Date().toISOString(),
    });
  }

  return json({ ok: false, error: 'Unknown action. Use verify_clinic or verify_email.' }, 400);
});
