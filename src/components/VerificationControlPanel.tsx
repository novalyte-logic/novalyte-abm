import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Mail,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/appStore';
import { cn } from '../utils/cn';
import {
  type VerificationJob,
  type VerificationQueueControl,
  type VerificationQueueStats,
  verificationQueueService,
} from '../services/verificationQueueService';

const EMPTY_STATS: VerificationQueueStats = {
  pending: 0,
  processing: 0,
  awaitingWebhook: 0,
  completedSuccess: 0,
  completedFallback: 0,
  failed: 0,
  cancelled: 0,
};

interface Props {
  selectedClinicIds: Set<string>;
  onStatusesUpdated?: (statuses: Record<string, string>) => void;
}

export default function VerificationControlPanel({ selectedClinicIds, onStatusesUpdated }: Props) {
  const contacts = useAppStore(s => s.contacts);

  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<VerificationQueueStats>(EMPTY_STATS);
  const [control, setControl] = useState<VerificationQueueControl | null>(null);
  const [jobs, setJobs] = useState<VerificationJob[]>([]);

  const selectedReadyContacts = useMemo(
    () => contacts.filter(c => selectedClinicIds.has(c.clinic.id) && c.status === 'ready_to_call'),
    [contacts, selectedClinicIds]
  );

  const selectedClinicList = useMemo(() => Array.from(selectedClinicIds), [selectedClinicIds]);

  const refresh = useCallback(async () => {
    if (!verificationQueueService.isConfigured) return;
    const [nextStats, nextControl, nextJobs, clinicStatuses] = await Promise.all([
      verificationQueueService.fetchStats(),
      verificationQueueService.fetchQueueControl(),
      verificationQueueService.fetchRecentJobs(25),
      selectedClinicList.length > 0
        ? verificationQueueService.fetchClinicStatuses(selectedClinicList)
        : Promise.resolve({}),
    ]);
    setStats(nextStats);
    setControl(nextControl);
    setJobs(nextJobs);
    onStatusesUpdated?.(clinicStatuses);
  }, [selectedClinicList, onStatusesUpdated]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!verificationQueueService.isConfigured) return;
    const id = setInterval(() => {
      refresh().catch(() => {});
      verificationQueueService.runDispatcher(5).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const runVerifyAndEnroll = async () => {
    if (selectedReadyContacts.length === 0) {
      toast.error('Select clinics with status Ready before starting verification');
      return;
    }

    setLoading(true);
    try {
      const { created, skipped } = await verificationQueueService.createJobs(selectedReadyContacts);
      await verificationQueueService.runDispatcher(8);
      await refresh();
      toast.success(`Queued ${created} verification jobs${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
    } catch (err: any) {
      toast.error(`Failed to queue verification jobs: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const emergencyStop = async () => {
    setLoading(true);
    try {
      await verificationQueueService.setQueuePaused(true);
      await refresh();
      toast.success('Emergency stop enabled. New calls are paused.');
    } catch (err: any) {
      toast.error(`Failed to pause queue: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const resumeQueue = async () => {
    setLoading(true);
    try {
      await verificationQueueService.setQueuePaused(false);
      await verificationQueueService.runDispatcher(8);
      await refresh();
      toast.success('Queue resumed.');
    } catch (err: any) {
      toast.error(`Failed to resume queue: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const clearQueue = async () => {
    setLoading(true);
    try {
      const cleared = await verificationQueueService.clearQueue(selectedClinicList.length ? selectedClinicList : undefined);
      await refresh();
      toast.success(`Cleared ${cleared} active verification jobs.`);
    } catch (err: any) {
      toast.error(`Failed to clear queue: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!verificationQueueService.isConfigured) {
    return (
      <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/10">
        <p className="text-xs text-amber-300">Verification queue requires Supabase to be configured (Cloud Offline currently).</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 border border-white/[0.08] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Smart Verification Workflow</h3>
          <p className="text-[11px] text-slate-500">
            Selected Ready: {selectedReadyContacts.length} · Pending: {stats.pending} · Processing: {stats.processing}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cn('px-2 py-0.5 rounded-full border', control?.is_paused ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10')}>
            {control?.is_paused ? 'Paused' : 'Live'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={runVerifyAndEnroll} disabled={loading || selectedReadyContacts.length === 0}
          className="px-3 py-2 rounded-lg bg-[#06B6D4] text-black text-xs font-semibold hover:bg-[#22D3EE] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />} Verify & Enroll
        </button>

        {control?.is_paused ? (
          <button onClick={resumeQueue} disabled={loading}
            className="px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-xs font-semibold hover:bg-emerald-500/25 flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5" /> Resume Queue
          </button>
        ) : (
          <button onClick={emergencyStop} disabled={loading}
            className="px-3 py-2 rounded-lg bg-red-500/15 text-red-300 border border-red-500/40 text-xs font-semibold hover:bg-red-500/25 flex items-center gap-1.5">
            <PauseCircle className="w-3.5 h-3.5" /> Emergency Stop
          </button>
        )}

        <button onClick={clearQueue} disabled={loading}
          className="px-3 py-2 rounded-lg bg-white/5 text-slate-300 border border-white/10 text-xs font-semibold hover:bg-white/10 flex items-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5" /> Clear Queue
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2"><p className="text-slate-500">Awaiting Webhook</p><p className="text-slate-200 font-semibold">{stats.awaitingWebhook}</p></div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2"><p className="text-slate-500">Completed (Voice)</p><p className="text-emerald-300 font-semibold">{stats.completedSuccess}</p></div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2"><p className="text-slate-500">Fallback (Email)</p><p className="text-amber-300 font-semibold">{stats.completedFallback}</p></div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2"><p className="text-slate-500">Failed</p><p className="text-red-300 font-semibold">{stats.failed}</p></div>
      </div>

      <div className="space-y-1 max-h-44 overflow-auto pr-1">
        {jobs.slice(0, 8).map(job => (
          <div key={job.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-2.5 py-2 text-[11px]">
            <div className="text-slate-400 truncate">{job.clinic_id}</div>
            <div className="flex items-center gap-1.5">
              {job.status === 'completed_success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              {job.status === 'completed_fallback' && <Mail className="w-3.5 h-3.5 text-amber-400" />}
              {job.status === 'failed' && <ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
              <span className={cn(
                'px-1.5 py-0.5 rounded border',
                job.status === 'completed_success' && 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
                job.status === 'completed_fallback' && 'text-amber-300 border-amber-500/30 bg-amber-500/10',
                job.status === 'failed' && 'text-red-300 border-red-500/30 bg-red-500/10',
                ['pending', 'processing', 'awaiting_webhook'].includes(job.status) && 'text-sky-300 border-sky-500/30 bg-sky-500/10',
                job.status === 'cancelled' && 'text-slate-400 border-white/10 bg-white/[0.03]'
              )}>{job.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
