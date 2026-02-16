import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

type VerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown';

type ClinicRow = { id: string; name: string; website: string | null };
type DmRow = {
  id: string;
  clinic_id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  role: string | null;
  confidence: number | null;
  email: string | null;
  email_verified: boolean | null;
  email_verification_status: string | null;
};

type EmployeeRow = { name: string; title: string; profile_url?: string };

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
  const limit = limitRaw === true ? 50 : Number(limitRaw ?? 50);

  const concurrencyRaw = args.get('concurrency');
  const concurrency = concurrencyRaw === true ? 2 : Number(concurrencyRaw ?? 2);

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(2000, limit)) : 50,
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

function normalizeLeadMagicStatus(raw: string | null | undefined): VerificationStatus {
  const s = String(raw || '').toLowerCase();
  if (s === 'valid') return 'valid';
  if (s === 'valid_catch_all' || s === 'catch_all' || s === 'catch-all' || s === 'accept_all') return 'risky';
  if (s === 'invalid') return 'invalid';
  return 'unknown';
}

function slugToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: 'Unknown', lastName: 'Contact' };
  const [firstName, ...rest] = clean.split(/\s+/);
  return { firstName: firstName || 'Unknown', lastName: rest.join(' ') || 'Contact' };
}

function inferRoleFromTitle(title: string): string {
  const t = String(title || '').toLowerCase();
  if (t.includes('owner') || t.includes('founder') || t.includes('ceo') || t.includes('president') || t.includes('principal')) return 'owner';
  if (t.includes('medical director') || t.includes('chief medical') || t.includes('physician') || t.includes('doctor')) return 'medical_director';
  if (t.includes('administrator') || t.includes('practice admin')) return 'practice_administrator';
  if (t.includes('marketing')) return 'marketing_director';
  if (t.includes('operations') || t.includes('ops')) return 'operations_manager';
  return 'clinic_manager';
}

function titleScore(title: string): number {
  const t = String(title || '').toLowerCase();
  if (t.includes('owner') || t.includes('founder') || t.includes('ceo') || t.includes('president') || t.includes('principal')) return 100;
  if (t.includes('medical director') || t.includes('chief medical')) return 90;
  if (t.includes('director') || t.includes('vp') || t.includes('head')) return 80;
  if (t.includes('manager') || t.includes('administrator')) return 70;
  return 0;
}

async function leadMagicEmailFinder(
  apiKey: string,
  firstName: string,
  lastName: string,
  domain: string,
  companyName: string,
): Promise<{ email: string; status: VerificationStatus } | null> {
  try {
    const response = await axios.post(
      'https://api.leadmagic.io/v1/people/email-finder',
      { first_name: firstName, last_name: lastName, domain, company_name: companyName },
      { headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    const data = response.data || {};
    const email = String(data.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return null;
    const status = normalizeLeadMagicStatus(data.status);
    if (status === 'invalid') return null;
    return { email, status };
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.response?.status === 422) return null;
    throw err;
  }
}

async function leadMagicEmployeeFinder(
  apiKey: string,
  domain: string,
  companyName: string,
  limit = 12,
): Promise<EmployeeRow[]> {
  try {
    const response = await axios.post(
      'https://api.leadmagic.io/v1/people/employee-finder',
      { company_domain: domain, company_name: companyName, limit },
      { headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
    const data = response.data || {};
    const employees = (data.data || data.employees || []) as any[];
    return employees
      .map((e) => ({
        name: String(e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim()),
        title: String(e.title || e.job_title || ''),
        profile_url: e.profile_url ? String(e.profile_url) : undefined,
      }))
      .filter((e) => e.name.length > 2);
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.response?.status === 422) return [];
    throw err;
  }
}

async function run() {
  const { limit, concurrency, dryRun } = parseArgs(process.argv.slice(2));
  loadDotenv(path.resolve(process.cwd(), '.env'));

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const leadMagicKey = process.env.VITE_LEADMAGIC_API_KEY || process.env.LEADMAGIC_API_KEY || '';

  if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL (or SUPABASE_URL).');
  if (!supabaseServiceKey) throw new Error('Missing VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  if (!leadMagicKey) throw new Error('Missing VITE_LEADMAGIC_API_KEY (or LEADMAGIC_API_KEY).');

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

  const clinics = await fetchAllRows<ClinicRow>('clinics', 'id,name,website');
  const clinicById = new Map(clinics.map(c => [c.id, c]));

  const dms = await fetchAllRows<DmRow>(
    'decision_makers',
    'id,clinic_id,first_name,last_name,title,role,confidence,email,email_verified,email_verification_status',
  );

  const clinicsWithValid = new Set<string>();
  for (const dm of dms) {
    if (dm.email && String(dm.email_verification_status || '').toLowerCase() === 'valid') {
      clinicsWithValid.add(dm.clinic_id);
    }
  }

  const eligibleClinics = clinics
    .filter((c) => !clinicsWithValid.has(c.id) && c.website && extractDomain(c.website))
    .slice(0, limit);

  const queue = [...eligibleClinics];

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'write',
    clinicsTotal: clinics.length,
    clinicsWithValid: clinicsWithValid.size,
    clinicsEligible: eligibleClinics.length,
    clinicsToProcess: queue.length,
    concurrency,
  }));

  let processed = 0;
  let found = 0;
  const counts: Record<VerificationStatus, number> = { valid: 0, risky: 0, invalid: 0, unknown: 0 };

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const clinic = queue.shift();
      if (!clinic) return;
      if (!clinic.website) continue;

      const domain = extractDomain(clinic.website);
      if (!domain) continue;

      let employees: EmployeeRow[] = [];
      try {
        employees = await leadMagicEmployeeFinder(leadMagicKey, domain, clinic.name, 12);
      } catch {
        employees = [];
      }

      const dmTitles = /owner|founder|director|ceo|manager|administrator|partner|president|chief|vp|head|medical director|practice/i;
      const dmsFromEmployees = employees.filter(e => dmTitles.test(e.title || ''));
      const candidates = (dmsFromEmployees.length ? dmsFromEmployees : employees)
        .sort((a, b) => titleScore(b.title) - titleScore(a.title))
        .slice(0, 3);

      processed += 1;

      let foundForClinic: { email: string; status: VerificationStatus; person: EmployeeRow } | null = null;
      for (const person of candidates) {
        const { firstName, lastName } = splitName(person.name);
        if (!firstName || !lastName) continue;
        let result: { email: string; status: VerificationStatus } | null = null;
        try {
          result = await leadMagicEmailFinder(leadMagicKey, firstName, lastName, domain, clinic.name);
        } catch {
          result = null;
        }
        if (!result) continue;
        foundForClinic = { ...result, person };
        break;
      }

      if (foundForClinic) {
        found += 1;
        counts[foundForClinic.status] += 1;

        if (!dryRun) {
          const { firstName, lastName } = splitName(foundForClinic.person.name);
          const idToken = slugToken(foundForClinic.email || `${firstName}-${lastName}-${domain}`) || `${Date.now()}`;
          const dmId = `lm-${clinic.id}-${idToken}`;
          const confidence = foundForClinic.status === 'valid' ? 95 : foundForClinic.status === 'risky' ? 75 : 60;
          await supabase
            .from('decision_makers')
            .upsert({
              id: dmId,
              clinic_id: clinic.id,
              first_name: firstName,
              last_name: lastName,
              title: foundForClinic.person.title || 'Decision Maker',
              role: inferRoleFromTitle(foundForClinic.person.title || ''),
              email: foundForClinic.email,
              phone: null,
              linkedin_url: foundForClinic.person.profile_url || null,
              confidence,
              enriched_at: new Date().toISOString(),
              source: 'leadmagic',
              email_verified: foundForClinic.status === 'valid',
              email_verification_status: foundForClinic.status,
            }, { onConflict: 'id' });
        }
      }

      if (processed % 25 === 0) {
        console.log(JSON.stringify({ processed, found, ...counts }));
      }
    }
  });

  await Promise.all(workers);

  console.log(JSON.stringify({
    done: true,
    processed,
    found,
    ...counts,
  }));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
