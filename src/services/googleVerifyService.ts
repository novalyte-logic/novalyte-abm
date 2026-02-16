import axios from 'axios';
import type { Clinic } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export type GoogleVerifyStatus = 'Verified' | 'Mismatch' | 'Not Found';

export interface VerifyClinicResult {
  status: GoogleVerifyStatus;
  officialWebsite: string | null;
  officialPlaceId: string | null;
  foundEmails: string[];
  confirmedEmail: string | null;
  deliverability?: any;
  checkedAt: string;
}

export interface VerifyEmailResult {
  status: 'valid' | 'invalid' | 'unknown';
  verified: boolean;
  reason?: string;
  mxHost?: string;
  smtpCode?: number;
}

const getEnv = (key: string): string => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
  return metaEnv?.[key] || '';
};

/**
 * Calls the Google Cloud Function `googleVerifyHandler`.
 *
 * Configure with:
 * - VITE_GOOGLE_VERIFY_FUNCTION_URL=https://REGION-PROJECT.cloudfunctions.net/googleVerifyHandler
 */
export class GoogleVerifyService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getEnv('VITE_GOOGLE_VERIFY_FUNCTION_URL');
  }

  get isConfigured() {
    // Prefer Supabase Edge Function (keeps config centralized); fallback to legacy GCP function URL.
    return (isSupabaseConfigured && !!supabase) || !!this.baseUrl;
  }

  async verifyClinic(clinic: Clinic, leadEmail?: string | null): Promise<VerifyClinicResult> {
    // Primary: Supabase Edge Function
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('google-verify', {
        body: { action: 'verify_clinic', clinic, leadEmail: leadEmail || null },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Verify clinic failed');
      return {
        status: data.status as GoogleVerifyStatus,
        officialWebsite: data.officialWebsite ?? null,
        officialPlaceId: data.officialPlaceId ?? null,
        foundEmails: data.foundEmails || [],
        confirmedEmail: data.confirmedEmail ?? null,
        deliverability: data.deliverability,
        checkedAt: data.checkedAt,
      };
    }

    // Fallback: legacy GCP function URL
    if (!this.baseUrl) throw new Error('Google verify is not configured (Supabase or VITE_GOOGLE_VERIFY_FUNCTION_URL)');
    const resp = await axios.post(this.baseUrl, { action: 'verify_clinic', clinic, leadEmail: leadEmail || null }, { timeout: 30000 });
    if (!resp.data?.ok) throw new Error(resp.data?.error || 'Verify clinic failed');
    return {
      status: resp.data.status as GoogleVerifyStatus,
      officialWebsite: resp.data.officialWebsite ?? null,
      officialPlaceId: resp.data.officialPlaceId ?? null,
      foundEmails: resp.data.foundEmails || [],
      confirmedEmail: resp.data.confirmedEmail ?? null,
      deliverability: resp.data.deliverability,
      checkedAt: resp.data.checkedAt,
    };
  }

  async verifyEmail(email: string): Promise<VerifyEmailResult> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('google-verify', {
        body: { action: 'verify_email', email },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Verify email failed');
      return data.result as VerifyEmailResult;
    }
    if (!this.baseUrl) throw new Error('Google verify is not configured (Supabase or VITE_GOOGLE_VERIFY_FUNCTION_URL)');
    const resp = await axios.post(this.baseUrl, { action: 'verify_email', email }, { timeout: 20000 });
    if (!resp.data?.ok) throw new Error(resp.data?.error || 'Verify email failed');
    return resp.data.result as VerifyEmailResult;
  }
}

export const googleVerifyService = new GoogleVerifyService();
