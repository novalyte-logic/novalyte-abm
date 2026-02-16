import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

type VerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown';

const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help',
  'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply', 'webmaster', 'mail',
]);

function isGenericEmail(email: string): boolean {
  const local = String(email || '').split('@')[0]?.toLowerCase() || '';
  return GENERIC_PREFIXES.has(local);
}

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
  const concurrency = concurrencyRaw === true ? 3 : Number(concurrencyRaw ?? 3);

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(5000, limit)) : 50,
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.min(10, concurrency)) : 3,
    includeGeneric: Boolean(args.get('include-generic')),
    dryRun: Boolean(args.get('dry-run')),
    all: Boolean(args.get('all')),
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

function normalizeRevenueBaseStatus(raw: unknown): VerificationStatus {
  const s = String(raw || '').toLowerCase();
  if (s === 'valid' || s === 'deliverable' || s === 'safe' || s === 'verified') return 'valid';
  if (s === 'invalid' || s === 'undeliverable' || s === 'bounce') return 'invalid';
  if (s === 'risky' || s === 'catch-all' || s === 'catch_all' || s === 'accept_all') return 'risky';
  return 'unknown';
}

async function verifyWithRevenueBase(revenueBaseKey: string, email: string): Promise<VerificationStatus> {
  try {
    const response = await axios.post(
      'https://api.revenuebase.ai/v1/process-email',
      { email },
      {
        headers: { 'x-key': revenueBaseKey, 'Content-Type': 'application/json' },
        timeout: 12_000,
      },
    );
    const data = response.data;
    return normalizeRevenueBaseStatus(data?.status || data?.result || data?.verification_status);
  } catch (err: any) {
    if (err?.response?.status === 422 || err?.response?.status === 400) return 'invalid';
    return 'unknown';
  }
}

async function run() {
  const { limit, concurrency, includeGeneric, dryRun, all } = parseArgs(process.argv.slice(2));

  loadDotenv(path.resolve(process.cwd(), '.env'));

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const revenueBaseKey = process.env.VITE_REVENUEBASE_API_KEY || process.env.REVENUEBASE_API_KEY || '';

  if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL (or SUPABASE_URL).');
  if (!supabaseServiceKey) throw new Error('Missing VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  if (!revenueBaseKey) throw new Error('Missing VITE_REVENUEBASE_API_KEY (or REVENUEBASE_API_KEY).');

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Backfill: if email_verified is already true but status is unknown/null, treat as valid (legacy shape).
  if (!dryRun) {
    await supabase
      .from('decision_makers')
      .update({ email_verification_status: 'valid' })
      .eq('email_verified', true)
      .or('email_verification_status.is.null,email_verification_status.eq.unknown');
  }

  // Pull unknown emails for verification.
  const pageSize = 1000;
  const targets: Array<{ email: string }> = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('decision_makers')
      .select('email,email_verified,email_verification_status')
      .not('email', 'is', null)
      .eq('email_verified', false)
      .or('email_verification_status.is.null,email_verification_status.eq.unknown')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data || []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      const email = String(r.email || '').trim().toLowerCase();
      if (!email) continue;
      if (!includeGeneric && isGenericEmail(email)) continue;
      targets.push({ email });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Dedupe by email to avoid spending credits twice.
  const uniqueEmails = Array.from(new Set(targets.map(t => t.email)));
  const toProcess = all ? uniqueEmails : uniqueEmails.slice(0, limit);

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'write',
    includeGeneric,
    concurrency,
    emailsTotalUnknown: uniqueEmails.length,
    emailsToVerify: toProcess.length,
  }));

  let processed = 0;
  const counts: Record<VerificationStatus, number> = { valid: 0, risky: 0, invalid: 0, unknown: 0 };

  const queue = [...toProcess];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const email = queue.shift();
      if (!email) return;

      const status = await verifyWithRevenueBase(revenueBaseKey, email);
      processed += 1;
      counts[status] += 1;

      if (!dryRun) {
        await supabase
          .from('decision_makers')
          .update({
            email_verified: status === 'valid',
            email_verification_status: status,
          })
          .eq('email', email)
          .eq('email_verified', false)
          .or('email_verification_status.is.null,email_verification_status.eq.unknown');
      }

      if (processed % 25 === 0) {
        console.log(JSON.stringify({ processed, ...counts }));
      }
    }
  });

  await Promise.all(workers);

  console.log(JSON.stringify({
    done: true,
    processed,
    ...counts,
  }));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
