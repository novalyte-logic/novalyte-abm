import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '../utils/cn';

export interface FunnelEvent {
  session_id: string;
  event_type: string;
  created_at: string;
  event_data: Record<string, any>;
}

interface Stage {
  key: 'hero' | 'engaged' | 'assessment' | 'conversion';
  label: string;
  subtitle: string;
  color: string;
}

const stages: Stage[] = [
  { key: 'hero', label: 'Reading Hero', subtitle: '0-25% scroll', color: 'from-slate-500/70 to-slate-300/70' },
  { key: 'engaged', label: 'Engaged', subtitle: '50% + video click', color: 'from-cyan-600/80 to-cyan-400/80' },
  { key: 'assessment', label: 'Assessment Started', subtitle: 'Form focus / quiz start', color: 'from-blue-600/80 to-blue-400/80' },
  { key: 'conversion', label: 'Conversion', subtitle: 'Thank-you / lead capture', color: 'from-emerald-600/80 to-emerald-400/80' },
];

function inferStage(events: FunnelEvent[]): Stage['key'] {
  let maxScroll = 0;
  let hasVideoClick = false;
  let hasAssessment = false;
  let hasConversion = false;

  for (const e of events) {
    const label = String(e.event_data?.label || '').toLowerCase();
    const section = String(e.event_data?.section || '').toLowerCase();
    const path = String(e.event_data?.path || '').toLowerCase();

    if (e.event_type === 'scroll_depth') {
      const p = Number(e.event_data?.percent || 0);
      if (Number.isFinite(p)) maxScroll = Math.max(maxScroll, p);
    }

    if (e.event_type === 'interaction' && (label.includes('video') || section.includes('video') || label.includes('watch'))) {
      hasVideoClick = true;
    }

    if (e.event_type === 'quiz_start' || e.event_type === 'form_focus' || (e.event_type === 'interaction' && (label.includes('assessment') || label.includes('form')))) {
      hasAssessment = true;
    }

    if (
      e.event_type === 'conversion' ||
      e.event_type === 'lead_capture' ||
      path.includes('thank') ||
      section.includes('thank') ||
      label.includes('thank you')
    ) {
      hasConversion = true;
    }
  }

  if (hasConversion) return 'conversion';
  if (hasAssessment) return 'assessment';
  if (maxScroll >= 50 && hasVideoClick) return 'engaged';
  return 'hero';
}

export default function FunnelChart({ events }: { events: FunnelEvent[] }) {
  const [animateFlow, setAnimateFlow] = useState(false);
  const prevConversion = useRef(0);

  const sessionStage = useMemo(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    const bySession = new Map<string, FunnelEvent[]>();

    for (const e of events) {
      if (new Date(e.created_at).getTime() < cutoff) continue;
      if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
      bySession.get(e.session_id)!.push(e);
    }

    const map = new Map<string, Stage['key']>();
    for (const [sessionId, sessEvents] of bySession.entries()) {
      map.set(sessionId, inferStage(sessEvents));
    }
    return map;
  }, [events]);

  const counts = useMemo(() => {
    const c = { hero: 0, engaged: 0, assessment: 0, conversion: 0 };
    sessionStage.forEach(stage => { c[stage] += 1; });
    return c;
  }, [sessionStage]);

  const liveUsers = sessionStage.size;

  useEffect(() => {
    if (counts.conversion > prevConversion.current) {
      setAnimateFlow(true);
      const t = setTimeout(() => setAnimateFlow(false), 1200);
      prevConversion.current = counts.conversion;
      return () => clearTimeout(t);
    }
    prevConversion.current = counts.conversion;
  }, [counts.conversion]);

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-novalyte-400" />
          Landing Page Funnel
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          </span>
          Live Users: <span className="text-emerald-300 font-semibold">{liveUsers}</span>
        </div>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
        {stages.map((stage, idx) => {
          const count = counts[stage.key];
          return (
            <div key={stage.key} className="relative">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{stage.label}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{stage.subtitle}</p>
                <p className="text-2xl font-bold text-slate-100 mt-2">{count}</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', stage.color)}
                    style={{ width: `${Math.min(100, count * 12)}%` }}
                  />
                </div>
              </div>

              {idx < stages.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-2 w-4 h-0.5 bg-white/[0.18]">
                  {animateFlow && (
                    <span className="absolute -top-1 left-0 w-2 h-2 rounded-full bg-cyan-300 animate-[ping_1.2s_linear]" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
