import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Volume2, VolumeX, Users } from 'lucide-react';
import { cn } from '../utils/cn';

interface LeadRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  geo_city: string | null;
  geo_state: string | null;
  device_type: string | null;
  match_score: number | null;
  utm_source: string | null;
  utm_campaign: string | null;
  gclid: string | null;
}

function playLeadTone() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    setTimeout(() => ctx.close().catch(() => {}), 320);
  } catch {}
}

function getIntentBadge(score: number | null) {
  if (typeof score !== 'number') return { label: 'Warm', className: 'bg-slate-500/20 text-slate-300 border border-slate-500/30' };
  if (score > 80) return { label: 'High Intent', className: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 shadow-[0_0_16px_rgba(16,185,129,0.28)]' };
  if (score < 50) return { label: 'Warm', className: 'bg-slate-500/20 text-slate-300 border border-slate-500/30' };
  return { label: 'Active', className: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' };
}

export default function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [flashIds, setFlashIds] = useState<Record<string, boolean>>({});
  const seenIdsRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(false);

  useEffect(() => {
    const currentIds = new Set(leads.map(l => l.id));
    if (!readyRef.current) {
      seenIdsRef.current = currentIds;
      readyRef.current = true;
      return;
    }

    const newIds = leads.filter(l => !seenIdsRef.current.has(l.id)).map(l => l.id);
    if (!newIds.length) return;

    setFlashIds(prev => {
      const next = { ...prev };
      newIds.forEach(id => { next[id] = true; });
      return next;
    });
    const timeout = window.setTimeout(() => {
      setFlashIds(prev => {
        const next = { ...prev };
        newIds.forEach(id => { delete next[id]; });
        return next;
      });
    }, 1300);

    if (soundEnabled) playLeadTone();
    seenIdsRef.current = currentIds;

    return () => window.clearTimeout(timeout);
  }, [leads, soundEnabled]);

  const rows = useMemo(() => leads.slice(0, 40), [leads]);

  return (
    <div className="glass-card p-4 border border-cyan-400/20 shadow-[0_0_36px_rgba(34,211,238,0.08)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-novalyte-400" />
          Live Command Terminal
        </h2>
        <button
          onClick={() => setSoundEnabled(v => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-slate-300 hover:bg-white/[0.06]"
          title="Toggle lead sound"
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-300" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
          {soundEnabled ? 'Sound On' : 'Sound Off'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-black/80 backdrop-blur-md">
            <tr className="border-b border-white/[0.08] font-mono uppercase tracking-[0.16em] text-[10px] text-slate-500">
              <th className="text-left py-2.5 px-2 font-medium">Lead</th>
              <th className="text-left py-2.5 px-2 font-medium">Intent</th>
              <th className="text-left py-2.5 px-2 font-medium">Attribution</th>
              <th className="text-left py-2.5 px-2 font-medium">Location</th>
              <th className="text-left py-2.5 px-2 font-medium">Device</th>
              <th className="text-left py-2.5 px-2 font-medium">Score</th>
              <th className="text-left py-2.5 px-2 font-medium">Time</th>
            </tr>
          </thead>

          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((lead, idx) => {
                const badge = getIntentBadge(lead.match_score);
                const source = lead.gclid ? 'google' : (lead.utm_source || 'direct');
                const campaign = lead.utm_campaign || 'unknown';

                return (
                  <motion.tr
                    key={lead.id}
                    layout
                    initial={{ opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    className={cn(
                      idx % 2 === 0 ? 'bg-white/[0.05]' : 'bg-transparent',
                      'border-b border-white/[0.04] hover:bg-white/[0.07] transition-colors',
                      flashIds[lead.id] && 'animate-pulse bg-emerald-500/20'
                    )}
                  >
                    <td className="py-2 px-2">
                      <div className="text-slate-100 font-medium">{lead.name || 'Unknown'}</div>
                      <div className="text-slate-500 text-[10px]">{lead.email || '—'}</div>
                    </td>
                    <td className="py-2 px-2">
                      <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold', badge.className)}>{badge.label}</span>
                    </td>
                    <td className="py-2 px-2">
                      <span className="inline-flex rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
                        [{source} / {campaign}]
                      </span>
                    </td>
                    <td className="py-2 px-2 text-slate-300 text-[11px]">
                      {[lead.geo_city, lead.geo_state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-2 px-2 text-slate-400 capitalize">{lead.device_type || 'desktop'}</td>
                    <td className="py-2 px-2">
                      <span className="text-slate-200 font-semibold tabular-nums">{lead.match_score != null ? `${lead.match_score}%` : '—'}</span>
                    </td>
                    <td className="py-2 px-2 text-slate-500">{new Date(lead.created_at).toLocaleTimeString()}</td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className="text-center text-slate-500 py-6">No leads yet.</p>}
    </div>
  );
}
