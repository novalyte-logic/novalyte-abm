import { createClient } from '@supabase/supabase-js';

const metaEnv: any =
  (typeof import.meta !== 'undefined' && (import.meta as any).env)
    ? (import.meta as any).env
    : {};
const processEnv: any = (typeof process !== 'undefined' && (process as any).env) ? (process as any).env : {};

const supabaseUrl = metaEnv.VITE_SUPABASE_URL || processEnv.VITE_SUPABASE_URL || processEnv.SUPABASE_URL;
const supabaseAnonKey = metaEnv.VITE_SUPABASE_ANON_KEY || processEnv.VITE_SUPABASE_ANON_KEY || processEnv.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Data will only persist locally.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // This app uses public anon access patterns; avoid stale/expired user JWTs
        // from local storage overriding anon requests and causing 401s.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export const isSupabaseConfigured = !!supabase;
