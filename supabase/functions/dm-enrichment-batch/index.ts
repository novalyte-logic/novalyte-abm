import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APOLLO_BASE = 'https://api.apollo.io';
const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help',
  'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply', 'webmaster', 'mail',
]);

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    const domain = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!domain) return null;
    const blocked = ['facebook.com', 'yelp.com', 'google.com', 'instagram.com', 'linkedin.com', 'twitter.com'];
    if (blocked.some(d => domain.includes(d))) return null;
    return domain;
  } catch {
    return null;
  }
}

function inferRole(title: string): string {
  const t = String(title || '').toLowerCase();
  if (t.includes('owner') || t.includes('founder') || t.includes('ceo') || t.includes('president') || t.includes('principal')) return 'owner';
  if (t.includes('medical director') || t.includes('chief medical') || t.includes('physician') || t.includes('doctor')) return 'medical_director';
  if (t.includes('administrator') || t.includes('practice admin')) return 'practice_administrator';
  if (t.includes('marketing')) return 'marketing_director';
  if (t.includes('operations') || t.includes('ops')) return 'operations_manager';
  return 'clinic_manager';
}

function isGenericEmail(email: string | null | undefined): boolean {
  const local = String(email || '').split('@')[0]?.toLowerCase() || '';
  return GENERIC_PREFIXES.has(local);
}

function normalizeApolloStatus(raw: unknown): 'valid' | 'unknown' {
  return String(raw || '').toLowerCase() === 'verified' ? 'valid' : 'unknown';
}

function normalizeRevenueBaseStatus(raw: unknown): 'valid' | 'invalid' | 'risky' | 'unknown' {
  const s = String(raw || '').toLowerCase();
  if (s === 'valid' || s === 'deliverable' || s === 'safe' || s === 'verified') return 'valid';
  if (s === 'invalid' || s === 'undeliverable' || s === 'bounce') return 'invalid';
  if (s === 'risky' || s === 'catch-all' || s === 'catch_all' || s === 'accept_all') return 'risky';
  return 'unknown';
}

function normalizeLeadMagicStatus(raw: unknown): 'valid' | 'invalid' | 'risky' | 'unknown' {
  const s = String(raw || '').toLowerCase();
  if (s === 'valid') return 'valid';
  if (s === 'valid_catch_all' || s === 'catch_all' || s === 'catch-all' || s === 'accept_all') return 'risky';
  if (s === 'invalid') return 'invalid';
  return 'unknown';
}

function titleScore(title: string): number {
  const t = String(title || '').toLowerCase();
  if (t.includes('owner') || t.includes('founder') || t.includes('ceo') || t.includes('president') || t.includes('principal')) return 100;
  if (t.includes('medical director') || t.includes('chief medical')) return 90;
  if (t.includes('director') || t.includes('vp') || t.includes('head')) return 80;
  if (t.includes('manager') || t.includes('administrator')) return 70;
  return 0;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: 'Unknown', lastName: 'Contact' };
  const [firstName, ...rest] = clean.split(/\s+/);
  return { firstName: firstName || 'Unknown', lastName: rest.join(' ') || 'Contact' };
}

function cleanNameToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function generateEmailCandidates(firstName: string, lastName: string, domain: string): string[] {
  const f = cleanNameToken(firstName);
  const l = cleanNameToken(lastName);
  const d = String(domain || '').trim().toLowerCase();
  if (!f || !l || !d) return [];
  const fi = f.slice(0, 1);
  const li = l.slice(0, 1);
  const patterns = [
    `${f}.${l}`,
    `${f}${l}`,
    `${fi}${l}`,
    `${f}${li}`,
    `${f}_${l}`,
    `${f}-${l}`,
    `${l}.${f}`,
    `${l}${fi}`,
  ];
  return Array.from(new Set(patterns.map(p => `${p}@${d}`)));
}

function rolePriority(role: string): number {
  const map: Record<string, number> = {
    owner: 0,
    medical_director: 1,
    clinic_manager: 2,
    practice_administrator: 3,
    marketing_director: 4,
    operations_manager: 5,
  };
  return map[role] ?? 9;
}

function parseKeyList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(v => String(v || '').trim()).filter(Boolean)));
  }
  if (typeof raw !== 'string') return [];
  return Array.from(new Set(raw.split(',').map(v => v.trim()).filter(Boolean)));
}

function getApolloKeys(body: any): string[] {
  const singleEnv = (Deno.env.get('APOLLO_API_KEY') || Deno.env.get('VITE_APOLLO_API_KEY') || '').trim();
  const multiEnv = parseKeyList(Deno.env.get('APOLLO_API_KEYS') || Deno.env.get('VITE_APOLLO_API_KEYS') || '');
  const singleBody = String(body?.apolloApiKey || '').trim();
  const multiBody = parseKeyList(body?.apolloApiKeys);
  const keys = [singleEnv, ...multiEnv, singleBody, ...multiBody].filter(Boolean);
  return Array.from(new Set(keys));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchApollo(clinic: any, apiKey: string): Promise<any[]> {
  const searchBody: any = {
    person_titles: [
      'Owner', 'Founder', 'CEO', 'President', 'Principal',
      'Medical Director', 'Chief Medical Officer',
      'Clinic Manager', 'Office Manager', 'Practice Manager',
      'Practice Administrator',
      'Director of Operations', 'Operations Manager',
      'Marketing Director', 'Marketing Manager',
      'Partner',
    ],
    per_page: 10,
  };

  const domain = extractDomain(clinic.website);
  if (domain) searchBody.q_organization_domains = domain;
  else searchBody.q_organization_name = clinic.name;

  if (clinic.city && clinic.state) {
    searchBody.person_locations = [`${clinic.city}, ${clinic.state}`];
  }

  const response = await fetchWithTimeout(`${APOLLO_BASE}/v1/mixed_people/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(searchBody),
  }, 10000);

  if (!response.ok) {
    const text = await response.text();
    const err: any = new Error(text || `Apollo request failed: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return Array.isArray(data?.people) ? data.people : [];
}

async function verifyWithRevenueBase(email: string, revenueBaseKey: string): Promise<'valid' | 'invalid' | 'risky' | 'unknown'> {
  try {
    const response = await fetchWithTimeout('https://api.revenuebase.ai/v1/process-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-key': revenueBaseKey,
      },
      body: JSON.stringify({ email }),
    }, 8000);

    if (!response.ok) {
      if (response.status === 400 || response.status === 422) return 'invalid';
      return 'unknown';
    }

    const data = await response.json();
    return normalizeRevenueBaseStatus(data?.status || data?.result || data?.verification_status);
  } catch {
    return 'unknown';
  }
}

async function lookupNpiAuthorizedOfficial(clinic: any): Promise<{ firstName: string; lastName: string; title: string; phone: string | null; npi: string | null } | null> {
  const organization = String(clinic?.name || '').trim();
  if (!organization) return null;

  const qs = new URLSearchParams();
  qs.set('version', '2.1');
  qs.set('limit', '10');
  qs.set('enumeration_type', 'NPI-2');
  qs.set('organization_name', organization);
  if (clinic?.city) qs.set('city', String(clinic.city));
  if (clinic?.state) qs.set('state', String(clinic.state));

  const url = `https://npiregistry.cms.hhs.gov/api/?${qs.toString()}`;
  const resp = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 9000);
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  const results = Array.isArray(data?.results) ? data.results : [];
  for (const r of results) {
    const basic = r?.basic || {};
    const first = String(basic?.authorized_official_first_name || '').trim();
    const last = String(basic?.authorized_official_last_name || '').trim();
    if (!first || !last) continue;
    return {
      firstName: first,
      lastName: last,
      title: String(basic?.authorized_official_title_or_position || 'Authorized Official'),
      phone: basic?.authorized_official_telephone_number ? String(basic.authorized_official_telephone_number) : null,
      npi: r?.number ? String(r.number) : null,
    };
  }
  return null;
}

async function leadMagicEmployeeFinder(
  leadMagicKey: string,
  domain: string,
  companyName: string,
  limit = 12,
): Promise<{ employees: Array<{ name: string; title: string; profileUrl: string | null }>; insufficientCredits: boolean }> {
  try {
    const response = await fetchWithTimeout('https://api.leadmagic.io/v1/people/employee-finder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': leadMagicKey,
      },
      body: JSON.stringify({
        company_domain: domain,
        company_name: companyName,
        limit,
      }),
    }, 10000);

    if (!response.ok) {
      if (response.status === 402) return { employees: [], insufficientCredits: true };
      if (response.status === 404 || response.status === 422) return { employees: [], insufficientCredits: false };
      throw new Error(`LeadMagic employee finder failed: ${response.status}`);
    }

    const payload = await response.json();
    const employees = (payload?.data || payload?.employees || []) as any[];
    return {
      employees: employees
        .map((e: any) => ({
          name: String(e?.full_name || `${e?.first_name || ''} ${e?.last_name || ''}`.trim()),
          title: String(e?.title || e?.job_title || ''),
          profileUrl: e?.profile_url ? String(e.profile_url) : null,
        }))
        .filter((e: any) => e.name.length > 2),
      insufficientCredits: false,
    };
  } catch {
    return { employees: [], insufficientCredits: false };
  }
}

async function leadMagicEmailFinder(
  leadMagicKey: string,
  firstName: string,
  lastName: string,
  domain: string,
  companyName: string,
): Promise<{ result: { email: string; status: 'valid' | 'invalid' | 'risky' | 'unknown' } | null; insufficientCredits: boolean }> {
  try {
    const response = await fetchWithTimeout('https://api.leadmagic.io/v1/people/email-finder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': leadMagicKey,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        domain,
        company_name: companyName,
      }),
    }, 10000);

    if (!response.ok) {
      if (response.status === 402) return { result: null, insufficientCredits: true };
      if (response.status === 404 || response.status === 422) return { result: null, insufficientCredits: false };
      throw new Error(`LeadMagic email finder failed: ${response.status}`);
    }

    const payload = await response.json();
    const email = String(payload?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return { result: null, insufficientCredits: false };
    const status = normalizeLeadMagicStatus(payload?.status);
    if (status === 'invalid') return { result: null, insufficientCredits: false };
    return { result: { email, status }, insufficientCredits: false };
  } catch {
    return { result: null, insufficientCredits: false };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = clamp(Number(body?.limit || 150), 1, 500);
    const verifyUnknown = Boolean(body?.verifyUnknown ?? true);
    const verifyLimit = clamp(Number(body?.verifyLimit || 200), 1, 1000);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const revenueBaseKey = (
      Deno.env.get('REVENUEBASE_API_KEY')
      || Deno.env.get('VITE_REVENUEBASE_API_KEY')
      || String(body?.revenueBaseKey || '')
    ).trim();
    const leadMagicKey = (
      Deno.env.get('LEADMAGIC_API_KEY')
      || Deno.env.get('VITE_LEADMAGIC_API_KEY')
      || String(body?.leadMagicKey || '')
    ).trim();
    const apolloKeys = getApolloKeys(body);

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Supabase service role is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!apolloKeys.length && !leadMagicKey && !revenueBaseKey) {
      return new Response(JSON.stringify({ error: 'No enrichment provider keys configured (Apollo, LeadMagic, or RevenueBase).' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: validRows, error: validErr } = await supabase
      .from('decision_makers')
      .select('clinic_id')
      .eq('email_verification_status', 'valid');
    if (validErr) throw new Error(validErr.message);
    const clinicsWithValid = new Set((validRows || []).map((r: any) => String(r.clinic_id)));

    const { data: clinicsData, error: clinicsErr } = await supabase
      .from('clinics')
      .select('id,name,website,city,state,phone,last_updated')
      .not('website', 'is', null)
      .order('last_updated', { ascending: false })
      .limit(2000);
    if (clinicsErr) throw new Error(clinicsErr.message);

    const targets = (clinicsData || [])
      .filter((c: any) => !clinicsWithValid.has(c.id))
      .filter((c: any) => Boolean(extractDomain(c.website)))
      .slice(0, limit);

    let keyIndex = 0;
    const exhausted = new Set<number>();
    const nextApolloKey = () => {
      if (exhausted.size >= apolloKeys.length) return '';
      for (let i = 0; i < apolloKeys.length; i++) {
        const idx = (keyIndex + i) % apolloKeys.length;
        if (!exhausted.has(idx)) {
          keyIndex = idx;
          return apolloKeys[idx];
        }
      }
      return '';
    };

    const summary = {
      processedClinics: 0,
      apolloHits: 0,
      leadMagicHits: 0,
      npiHits: 0,
      npiGuessAttempts: 0,
      emailsFound: 0,
      validFound: 0,
      riskyFound: 0,
      invalidFound: 0,
      unknownFound: 0,
      exhaustedApolloKeys: 0,
      apolloRestricted: 0,
      leadMagicInsufficientCredits: 0,
      verifiedUnknownEmails: 0,
    };

    let leadMagicBlocked = false;
    const verifyCache = new Map<string, 'valid' | 'invalid' | 'risky' | 'unknown'>();

    for (const clinic of targets) {
      const apiKey = nextApolloKey();
      if (!apiKey && !leadMagicKey && !revenueBaseKey) break;
      summary.processedClinics += 1;

      const domain = extractDomain(clinic.website);
      if (!domain) continue;

      let best: any = null;
      let source: 'apollo' | 'leadmagic' | 'npi_guess' = 'apollo';

      if (apiKey) {
        let people: any[] = [];
        try {
          people = await searchApollo(clinic, apiKey);
        } catch (err: any) {
          if (err?.status === 403 || err?.status === 429) {
            exhausted.add(keyIndex);
            summary.exhaustedApolloKeys = exhausted.size;
          }
          if (err?.status === 403) {
            const msg = String(err?.message || '').toUpperCase();
            if (msg.includes('API_INACCESSIBLE') || msg.includes('NOT ACCESSIBLE')) {
              summary.apolloRestricted += 1;
            }
          }
        }

        if (people.length) {
          summary.apolloHits += 1;
          const mapped = people
            .filter((p: any) => p.first_name && p.last_name && p.email)
            .map((p: any) => {
              const email = String(p.email || '').trim().toLowerCase();
              const role = inferRole(String(p.title || ''));
              const apolloStatus = normalizeApolloStatus(p.email_status);
              const confidence = apolloStatus === 'valid' ? 95 : String(p.email_status || '').toLowerCase() === 'guessed' ? 70 : 65;
              return {
                sourceId: String(p.id || ''),
                firstName: String(p.first_name || ''),
                lastName: String(p.last_name || ''),
                title: String(p.title || ''),
                role,
                email,
                phone: p.phone_numbers?.[0]?.sanitized_number || p.phone_numbers?.[0]?.raw_number || null,
                linkedInUrl: p.linkedin_url || null,
                confidence,
                status: apolloStatus as 'valid' | 'unknown',
              };
            })
            .sort((a: any, b: any) => {
              const aVerified = a.status === 'valid' ? 1 : 0;
              const bVerified = b.status === 'valid' ? 1 : 0;
              if (aVerified !== bVerified) return bVerified - aVerified;
              const p = rolePriority(a.role) - rolePriority(b.role);
              if (p !== 0) return p;
              return b.confidence - a.confidence;
            });
          best = mapped[0] || null;
        }
      }

      if (!best && leadMagicKey && !leadMagicBlocked) {
        const employeesRes = await leadMagicEmployeeFinder(leadMagicKey, domain, clinic.name, 12);
        if (employeesRes.insufficientCredits) {
          leadMagicBlocked = true;
          summary.leadMagicInsufficientCredits = 1;
        }
        const employees = employeesRes.employees;

        if (employees.length) {
          const dmTitlePattern = /owner|founder|director|ceo|manager|administrator|partner|president|chief|vp|head|medical director|practice/i;
          const prioritized = employees.filter((e) => dmTitlePattern.test(e.title || ''));
          const candidates = (prioritized.length ? prioritized : employees)
            .sort((a, b) => titleScore(b.title) - titleScore(a.title))
            .slice(0, 3);

          for (const person of candidates) {
            const { firstName, lastName } = splitName(person.name);
            if (!firstName || !lastName) continue;
            const emailRes = await leadMagicEmailFinder(leadMagicKey, firstName, lastName, domain, clinic.name);
            if (emailRes.insufficientCredits) {
              leadMagicBlocked = true;
              summary.leadMagicInsufficientCredits = 1;
              break;
            }
            const emailResult = emailRes.result;
            if (!emailResult?.email) continue;
            const role = inferRole(person.title || '');
            const confidence = emailResult.status === 'valid' ? 92 : emailResult.status === 'risky' ? 75 : 66;
            best = {
              sourceId: `${firstName.toLowerCase()}-${lastName.toLowerCase()}-${domain}`,
              firstName,
              lastName,
              title: person.title || 'Decision Maker',
              role,
              email: emailResult.email,
              phone: null,
              linkedInUrl: person.profileUrl || null,
              confidence,
              status: emailResult.status,
            };
            source = 'leadmagic';
            summary.leadMagicHits += 1;
            break;
          }
        }
      }

      if (!best && revenueBaseKey) {
        // NPI registry: find an authorized official name, then guess likely email patterns
        // and verify them via RevenueBase. This works even when Apollo/LeadMagic are blocked.
        try {
          const official = await lookupNpiAuthorizedOfficial(clinic);
          if (official?.firstName && official?.lastName) {
            summary.npiHits += 1;
            const candidates = generateEmailCandidates(official.firstName, official.lastName, domain)
              .filter((e) => !isGenericEmail(e));

            let guessed: { email: string; status: 'valid' | 'invalid' | 'risky' | 'unknown' } | null = null;
            for (const email of candidates.slice(0, 8)) {
              const cached = verifyCache.get(email);
              const status = cached ?? await verifyWithRevenueBase(email, revenueBaseKey);
              verifyCache.set(email, status);
              summary.npiGuessAttempts += 1;
              if (status === 'invalid') continue;
              guessed = { email, status };
              if (status === 'valid') break;
            }

            if (guessed?.email) {
              const confidence = guessed.status === 'valid' ? 88 : guessed.status === 'risky' ? 74 : 66;
              best = {
                sourceId: `${official.npi || 'npi'}-${guessed.email.replace(/[^a-z0-9]/g, '-')}`,
                firstName: official.firstName,
                lastName: official.lastName,
                title: official.title,
                role: inferRole(official.title || ''),
                email: guessed.email,
                phone: official.phone || null,
                linkedInUrl: null,
                confidence,
                status: guessed.status,
              };
              source = 'npi_guess';
            }
          }
        } catch {
          // Ignore NPI errors; continue.
        }
      }

      if (!best?.email || isGenericEmail(best.email)) continue;

      let finalStatus: 'valid' | 'invalid' | 'risky' | 'unknown' = best.status;
      if (finalStatus !== 'valid' && revenueBaseKey) {
        finalStatus = await verifyWithRevenueBase(best.email, revenueBaseKey);
      }
      const emailVerified = finalStatus === 'valid';

      summary.emailsFound += 1;
      if (finalStatus === 'valid') summary.validFound += 1;
      else if (finalStatus === 'risky') summary.riskyFound += 1;
      else if (finalStatus === 'invalid') summary.invalidFound += 1;
      else summary.unknownFound += 1;

      const dmId = `${source}-${clinic.id}-${best.sourceId || best.email.replace(/[^a-z0-9]/g, '-')}`;

      const { error: upsertErr } = await supabase
        .from('decision_makers')
        .upsert({
          id: dmId,
          clinic_id: clinic.id,
          first_name: best.firstName,
          last_name: best.lastName,
          title: best.title,
          role: best.role,
          email: best.email,
          phone: best.phone,
          linkedin_url: best.linkedInUrl,
          confidence: best.confidence,
          enriched_at: new Date().toISOString(),
          source,
          email_verified: emailVerified,
          email_verification_status: finalStatus,
        }, { onConflict: 'id' });

      if (upsertErr) {
        console.warn(`upsert failed for clinic ${clinic.id}: ${upsertErr.message}`);
      }
    }

    if (verifyUnknown && revenueBaseKey) {
      const { data: unknownRows, error: unknownErr } = await supabase
        .from('decision_makers')
        .select('email')
        .not('email', 'is', null)
        .eq('email_verified', false)
        .or('email_verification_status.is.null,email_verification_status.eq.unknown')
        .limit(verifyLimit);
      if (!unknownErr && unknownRows?.length) {
        const uniqueEmails = Array.from(new Set(
          unknownRows
            .map((r: any) => String(r.email || '').trim().toLowerCase())
            .filter(Boolean)
            .filter(e => !isGenericEmail(e)),
        ));

        for (const email of uniqueEmails) {
          const status = await verifyWithRevenueBase(email, revenueBaseKey);
          if (status === 'unknown') continue;

          const patch = {
            email_verified: status === 'valid',
            email_verification_status: status,
          };

          const q1 = await supabase
            .from('decision_makers')
            .update(patch)
            .eq('email', email)
            .eq('email_verified', false)
            .is('email_verification_status', null);
          if (!q1.error) summary.verifiedUnknownEmails += 1;

          const q2 = await supabase
            .from('decision_makers')
            .update(patch)
            .eq('email', email)
            .eq('email_verified', false)
            .eq('email_verification_status', 'unknown');
          if (!q2.error) summary.verifiedUnknownEmails += 1;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      limit,
      verifyUnknown,
      verifyLimit,
      ...summary,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
