import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { CRMContact } from '../types';

export type VerificationJobStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_webhook'
  | 'completed_success'
  | 'completed_fallback'
  | 'failed'
  | 'cancelled';

export interface VerificationJob {
  id: string;
  clinic_id: string;
  contact_id: string | null;
  status: VerificationJobStatus;
  call_id: string | null;
  outcome_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface VerificationQueueStats {
  pending: number;
  processing: number;
  awaitingWebhook: number;
  completedSuccess: number;
  completedFallback: number;
  failed: number;
  cancelled: number;
}

export interface VerificationQueueControl {
  is_paused: boolean;
  emergency_stop: boolean;
  updated_at: string;
}

const ACTIVE_STATUSES: VerificationJobStatus[] = ['pending', 'processing', 'awaiting_webhook'];

function isMissingVerificationStatusError(message?: string | null): boolean {
  const text = (message || '').toLowerCase();
  return text.includes('verification_status') && text.includes('schema cache');
}

function randomId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function countByStatus(status: VerificationJobStatus): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase
    .from('verification_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  return count || 0;
}

class VerificationQueueService {
  get isConfigured() {
    return isSupabaseConfigured && !!supabase;
  }

  async createJobs(contacts: CRMContact[]): Promise<{ created: number; skipped: number }> {
    if (!this.isConfigured || !supabase) return { created: 0, skipped: contacts.length };

    const ready = contacts.filter(c => c.status === 'ready_to_call');
    if (!ready.length) return { created: 0, skipped: contacts.length };

    const clinicIds = ready.map(c => c.clinic.id);
    const { data: existing, error: existingErr } = await supabase
      .from('verification_jobs')
      .select('clinic_id,status')
      .in('clinic_id', clinicIds)
      .in('status', ACTIVE_STATUSES as string[]);

    if (existingErr) throw new Error(existingErr.message);

    const activeClinics = new Set((existing || []).map((r: any) => r.clinic_id));
    const rows = ready
      .filter(c => !activeClinics.has(c.clinic.id))
      .map(c => ({
        id: randomId(),
        clinic_id: c.clinic.id,
        contact_id: c.id,
        status: 'pending',
        payload: {
          clinicName: c.clinic.name,
          phone: c.clinic.phone,
          email: c.decisionMaker?.email || c.clinic.managerEmail || c.clinic.ownerEmail || c.clinic.email || null,
          decisionMaker: c.decisionMaker
            ? `${c.decisionMaker.firstName || ''} ${c.decisionMaker.lastName || ''}`.trim()
            : c.clinic.managerName || c.clinic.ownerName || null,
        },
      }));

    if (!rows.length) return { created: 0, skipped: contacts.length };

    const { error } = await supabase.from('verification_jobs').insert(rows);
    if (error) throw new Error(error.message);

    const { error: clinicUpdateError } = await supabase
      .from('clinics')
      .update({ verification_status: 'Ready', verification_updated_at: new Date().toISOString() })
      .in('id', rows.map(r => r.clinic_id));
    if (clinicUpdateError && !isMissingVerificationStatusError(clinicUpdateError.message)) {
      throw new Error(clinicUpdateError.message);
    }

    return { created: rows.length, skipped: contacts.length - rows.length };
  }

  async fetchQueueControl(): Promise<VerificationQueueControl> {
    if (!this.isConfigured || !supabase) {
      return { is_paused: true, emergency_stop: false, updated_at: new Date().toISOString() };
    }
    const { data } = await supabase
      .from('verification_queue_control')
      .select('is_paused, emergency_stop, updated_at')
      .eq('id', 'global')
      .single();

    return data || { is_paused: false, emergency_stop: false, updated_at: new Date().toISOString() };
  }

  async setQueuePaused(paused: boolean): Promise<void> {
    if (!this.isConfigured || !supabase) return;
    const { error } = await supabase
      .from('verification_queue_control')
      .upsert({
        id: 'global',
        is_paused: paused,
        emergency_stop: paused,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) throw new Error(error.message);
  }

  async clearQueue(clinicIds?: string[]): Promise<number> {
    if (!this.isConfigured || !supabase) return 0;
    const { data, error } = await supabase.rpc('clear_pending_verification_jobs', {
      p_clinic_ids: clinicIds && clinicIds.length ? clinicIds : null,
    });
    if (error) throw new Error(error.message);
    return Number(data || 0);
  }

  async runDispatcher(batchSize = 5): Promise<{ processed: number; paused?: boolean }> {
    if (!this.isConfigured || !supabase) return { processed: 0 };

    const { data, error } = await supabase.functions.invoke('verification-dispatch', {
      body: { batchSize },
    });

    if (error) throw new Error(error.message || 'Dispatcher failed');
    return {
      processed: Number(data?.processed || 0),
      paused: Boolean(data?.paused),
    };
  }

  async fetchRecentJobs(limit = 50): Promise<VerificationJob[]> {
    if (!this.isConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from('verification_jobs')
      .select('id,clinic_id,contact_id,status,call_id,outcome_reason,created_at,updated_at,completed_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data || []) as VerificationJob[];
  }

  async fetchClinicStatuses(clinicIds: string[]): Promise<Record<string, string>> {
    if (!this.isConfigured || !supabase || clinicIds.length === 0) return {};
    const { data, error } = await supabase
      .from('clinics')
      .select('id,verification_status')
      .in('id', clinicIds);

    if (error && !isMissingVerificationStatusError(error.message)) throw new Error(error.message);
    if (error && isMissingVerificationStatusError(error.message)) {
      const fallback = await supabase.from('clinics').select('id').in('id', clinicIds);
      if (fallback.error) throw new Error(fallback.error.message);
      return Object.fromEntries((fallback.data || []).map((r: any) => [r.id, 'Ready']));
    }
    return Object.fromEntries((data || []).map((r: any) => [r.id, r.verification_status || 'Ready']));
  }

  async fetchStats(): Promise<VerificationQueueStats> {
    if (!this.isConfigured) {
      return {
        pending: 0,
        processing: 0,
        awaitingWebhook: 0,
        completedSuccess: 0,
        completedFallback: 0,
        failed: 0,
        cancelled: 0,
      };
    }

    const [pending, processing, awaitingWebhook, completedSuccess, completedFallback, failed, cancelled] = await Promise.all([
      countByStatus('pending'),
      countByStatus('processing'),
      countByStatus('awaiting_webhook'),
      countByStatus('completed_success'),
      countByStatus('completed_fallback'),
      countByStatus('failed'),
      countByStatus('cancelled'),
    ]);

    return { pending, processing, awaitingWebhook, completedSuccess, completedFallback, failed, cancelled };
  }
}

export const verificationQueueService = new VerificationQueueService();
