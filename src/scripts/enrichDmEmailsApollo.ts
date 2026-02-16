import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

type VerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown';

type ClinicRow = {
  id: string;
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  type: string | null;
};

type ApolloPerson = {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  phone_numbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
  }>;
};

const APOLLO_BASE = 'https://api.apollo.io';

const PERSON_TITLES = [
  'Owner', 'Founder', 'CEO', 'President', 'Principal',
  'Medical Director', 'Chief Medical Officer',
  'Clinic Manager', 'Office Manager', 'Practice Manager',
  'Practice Administrator',
  'Director of Operations', 'Operations Manager',
  'Marketing Director', 'Marketing Manager',
  'Partner',
];

const ROLE_PRIORITY: Record<string, number> = {
  owner: 0,
  medical_director: 1,
  clinic_manager: 2,
  practice_administrator: 3,
  marketing_director: 4,
  operations_manager: 5,
};

const SKIP_DOMAINS = [
  'facebook.com',
  'yelp.com',
  'google.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'healthgrades.com',
  'zocdoc.com',
  'vitals.com',
  'webmd.com',
  'yellowpages.com',
  'bbb.org',
];

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i++;
  }

  const limitRaw = args.get('limit');
  const limit = limitRaw === true ? 100 : Number(limitRaw ?? 100);

  const concurrencyRaw = args.get('concurrency');
  const concurrency = concurrencyRaw === true ? 2 : Number(concurrencyRaw ?? 2);

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(2000, limit)) : 100,
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(6, concurrency)) : 2,
    dryRun: Boolean(args.get('dry-run')),
  };
}

function loadDotenv(dotenvPath: string) {
  if (!fs.existsSync(dotenvPath)) return;
  const raw = fs.readFileSync(dotenvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

function extractDomain(website: string): string | null {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    const domain = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!domain) return null;
    if (SKIP_DOMAINS.some(d => domain.includes(d))) return null;
    return domain;
  } catch {
    return null;
  }
}

function inferRole(title: string): string {
  const t = String(title || '').toLowerCase();
  if (t.includes('owner') || t.includes('founder') || t.includes('ceo') || t.includes('president') || t.includes('principal')) return 'owner';
  if (t.includes('medical director') || t.includes('chief medical') || t.includes('physician') || t.includes('doctor')) return 'medical_director';
  if (t.includes('clinic manager') || t.includes('office manager') || t.includes('practice manager')) return 'clinic_manager';
  if (t.includes('administrator') || t.includes('practice admin')) return 'practice_administrator';
  if (t.includes('marketing')) return 'marketing_director';
  if (t.includes('operations') || t.includes('ops')) return 'operations_manager';
  return 'clinic_manager';
}

function normalizeApolloEmailStatus(status: unknown): VerificationStatus {
  const s = String(status || '').toLowerCase();
  if (s === 'verified') return 'valid';
  return 'unknown';
}

function parseApolloKeys(): string[] {
  const keysStr = (process.env.VITE_APOLLO_API_KEYS || '').trim();
  const singleKey = (process.env.VITE_APOLLO_API_KEY || '').trim();
  const all = [singleKey, ...keysStr.split(',').map(s => s.trim())].filter(Boolean);
  return Array.from(new Set(all));
}

async function searchApolloPeople(
  apiKey: string,
  clinic: ClinicRow,
): Promise<ApolloPerson[]> {
  const searchBody: any = {
    person_titles: PERSON_TITLES,
    per_page: 10,
  };

  const domain = clinic.website ? extractDomain(clinic.website) : null;
  if (domain) searchBody.q_organization_domains = domain;
  else searchBody.q_organization_name = clinic.name;

  if (clinic.city && clinic.state) {
    searchBody.person_locations = [`${clinic.city}, ${clinic.state}`];
  }

  const response = await axios.post(
    `${APOLLO_BASE}/v1/mixed_people/search`,
    searchBody,
    {
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      timeout: 20_000,
    },
  );

  const people = response.data?.people || [];
  return Array.isArray(people) ? (people as ApolloPerson[]) : [];
}

async function run() {
  const { limit, concurrency, dryRun } = parseArgs(process.argv.slice(2));
  loadDotenv(path.resolve(process.cwd(), '.env'));

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const apolloKeys = parseApolloKeys();

  if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL (or SUPABASE_URL).');
  if (!supabaseServiceKey) throw new Error('Missing VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  if (!apolloKeys.length) throw new Error('Missing VITE_APOLLO_API_KEY(S).');

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const fetchAllRows = async <T,>(table: string, select: string): Promise<T[]> => {
    const rows: T[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const chunk = (data || []) as T[];
      if (!chunk.length) break;
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  const clinics = await fetchAllRows<ClinicRow>('clinics', 'id,name,website,city,state,phone,type');

  const { data: validClinicRows, error: validClinicsErr } = await supabase
    .from('decision_makers')
    .select('clinic_id')
    .eq('email_verification_status', 'valid');
  if (validClinicsErr) throw new Error(validClinicsErr.message);
  const clinicsWithValid = new Set((validClinicRows || []).map((r: any) => String(r.clinic_id)));

  const eligible = clinics
    .filter(c => !clinicsWithValid.has(c.id))
    .filter(c => Boolean(c.website && extractDomain(c.website)))
    .slice(0, limit);

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'write',
    clinicsTotal: clinics.length,
    clinicsWithValid: clinicsWithValid.size,
    clinicsEligible: eligible.length,
    concurrency,
    apolloKeys: apolloKeys.length,
  }));

  const queue = [...eligible];
  let processed = 0;
  let apolloHits = 0;
  let verifiedFound = 0;
  let emailsFound = 0;
  let keyIndex = 0;
  const exhausted = new Set<number>();

  const nextKey = () => {
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

  const markExhausted = () => {
    exhausted.add(keyIndex);
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const clinic = queue.shift();
      if (!clinic) return;

      const apiKey = nextKey();
      if (!apiKey) return;

      processed += 1;
      let people: ApolloPerson[] = [];

      try {
        people = await searchApolloPeople(apiKey, clinic);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 403 || status === 429) {
          markExhausted();
          continue;
        }
        continue;
      }

      if (people.length) apolloHits += 1;

      // Choose best: verified email first, then role priority + confidence.
      const mapped = people
        .filter(p => p.first_name && p.last_name)
        .map(p => {
          const directDial =
            p.phone_numbers?.find(pn => pn.type === 'mobile' || pn.type === 'direct') ||
            p.phone_numbers?.[0];

          const email = p.email ? String(p.email).trim().toLowerCase() : null;
          const status = email ? normalizeApolloEmailStatus(p.email_status) : 'unknown';
          const role = inferRole(p.title || '');

          const confidence = email
            ? (String(p.email_status || '').toLowerCase() === 'verified' ? 95 : String(p.email_status || '').toLowerCase() === 'guessed' ? 70 : 65)
            : 60;

          return {
            apolloId: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            title: p.title || '',
            role,
            email,
            phone: directDial?.sanitized_number || directDial?.raw_number || null,
            linkedin_url: p.linkedin_url || null,
            confidence,
            email_verification_status: status,
            email_verified: status === 'valid',
          };
        })
        .sort((a, b) => {
          const aVerified = a.email_verified ? 1 : 0;
          const bVerified = b.email_verified ? 1 : 0;
          if (aVerified !== bVerified) return bVerified - aVerified;
          const prioDiff = (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9);
          if (prioDiff !== 0) return prioDiff;
          return (b.confidence || 0) - (a.confidence || 0);
        });

      const best = mapped[0];
      if (!best || !best.email) continue;

      emailsFound += 1;
      if (best.email_verified) verifiedFound += 1;

      if (!dryRun) {
        const dmId = `apollo-${clinic.id}-${best.apolloId}`;
        await supabase
          .from('decision_makers')
          .upsert({
            id: dmId,
            clinic_id: clinic.id,
            first_name: best.first_name,
            last_name: best.last_name,
            title: best.title,
            role: best.role,
            email: best.email,
            phone: best.phone,
            linkedin_url: best.linkedin_url,
            confidence: best.confidence,
            enriched_at: new Date().toISOString(),
            source: 'apollo',
            email_verified: best.email_verified,
            email_verification_status: best.email_verification_status,
          }, { onConflict: 'id' });
      }

      if (processed % 25 === 0) {
        console.log(JSON.stringify({ processed, apolloHits, emailsFound, verifiedFound, exhaustedKeys: exhausted.size }));
      }
    }
  });

  await Promise.all(workers);

  console.log(JSON.stringify({
    done: true,
    processed,
    apolloHits,
    emailsFound,
    verifiedFound,
    exhaustedKeys: exhausted.size,
  }));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

