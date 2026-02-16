import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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
  const verifyLimitRaw = args.get('verify-limit');

  const limit = limitRaw === true ? 150 : Number(limitRaw ?? 150);
  const verifyLimit = verifyLimitRaw === true ? 200 : Number(verifyLimitRaw ?? 200);
  const verifyUnknown = !Boolean(args.get('skip-verify-unknown'));

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 150,
    verifyLimit: Number.isFinite(verifyLimit) ? Math.max(1, Math.min(1000, verifyLimit)) : 200,
    verifyUnknown,
  };
}

async function run() {
  loadDotenv(path.resolve(process.cwd(), '.env'));
  const { limit, verifyLimit, verifyUnknown } = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey =
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';

  if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL (or SUPABASE_URL).');
  if (!supabaseServiceKey) throw new Error('Missing VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).');

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.functions.invoke('dm-enrichment-batch', {
    body: { limit, verifyUnknown, verifyLimit },
  });

  if (error) throw new Error(error.message || 'Failed to invoke dm-enrichment-batch');
  console.log(JSON.stringify(data, null, 2));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

