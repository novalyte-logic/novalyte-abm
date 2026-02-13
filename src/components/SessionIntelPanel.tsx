import { useMemo, useRef } from 'react';
import { cn } from '../utils/cn';

export interface SessionIntelEvent {
  id: string;
  created_at: string;
  event_type: string;
  event_data: Record<string, any>;
  device_type?: string | null;
  os?: string | null;
  browser?: string | null;
  utm_source?: string | null;
  referrer?: string | null;
  time_on_page?: number | null;
}

type FilterKey = 'all' | 'navigation' | 'interactions' | 'quiz' | 'conversion' | 'heartbeat';

const filterMap: Record<FilterKey, (e: SessionIntelEvent) => boolean> = {
  all: () => true,
  navigation: (e) => ['session_start', 'page_view', 'scroll_depth', 'navigation'].includes(e.event_type),
  interactions: (e) => e.event_type === 'interaction',
  quiz: (e) => e.event_type === 'quiz_start' || e.event_type === 'quiz_complete',
  conversion: (e) => e.event_type === 'conversion' || e.event_type === 'lead_capture',
  heartbeat: (e) => e.event_type === 'heartbeat',
};

export default function SessionIntelPanel({
  open,
  onClose,
  sessionId,
  events,
  loading,
  activeFilter,
  onFilterChange,
  describeEvent,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  events: SessionIntelEvent[];
  loading: boolean;
  activeFilter: FilterKey;
  onFilterChange: (key: FilterKey) => void;
  describeEvent: (e: SessionIntelEvent) => string;
}) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const filteredEvents = useMemo(() => {
    const predicate = filterMap[activeFilter] || filterMap.all;
    return events.filter(predicate);
  }, [events, activeFilter]);

  const latest = events[events.length - 1];
  const section = String(latest?.event_data?.section || latest?.event_data?.label || latest?.event_type || 'page');
  const mins = Math.max(1, Math.round((latest?.time_on_page || 0) / 60));

  const jumpTo = (predicate: (e: SessionIntelEvent) => boolean, mode: 'first' | 'last' = 'first') => {
    const target = mode === 'first' ? events.find(predicate) : [...events].reverse().find(predicate);
    if (!target) return;
    const el = itemRefs.current.get(target.id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 flex items-center justify-end" onClick={onClose}>
      <div className="w-full max-w-xl h-[82vh] rounded-2xl border border-[#3b82f6]/30 bg-gradient-to-b from-[#050b14]/95 to-black/95 shadow-[0_0_40px_rgba(59,130,246,0.22)] backdrop-blur-xl p-4 overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 mb-3">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Session Intel</p>
            <h3 className="text-sm font-semibold text-slate-200 mt-0.5">{sessionId || 'Unknown Session'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading session timeline...</div>
        ) : (
          <>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 mb-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider">Current Status</p>
              <p className="text-sm text-slate-200 mt-1">
                {events.length > 0
                  ? `Reading "${section}" (${mins} mins).`
                  : 'No live activity yet.'}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 mb-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Metadata</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-slate-400">Device</div><div className="text-slate-200">{events[0]?.device_type || 'unknown'}</div>
                <div className="text-slate-400">OS</div><div className="text-slate-200">{events[0]?.os || 'unknown'}</div>
                <div className="text-slate-400">Browser</div><div className="text-slate-200">{events[0]?.browser || 'unknown'}</div>
                <div className="text-slate-400">Referral Source</div><div className="text-slate-200 truncate">{events[0]?.utm_source || events[0]?.referrer || 'direct'}</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 mb-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Filters</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(['all', 'navigation', 'interactions', 'quiz', 'conversion', 'heartbeat'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => onFilterChange(key)}
                    className={cn(
                      'px-2 py-1 rounded text-[10px] font-medium border transition-colors',
                      activeFilter === key
                        ? 'text-blue-200 border-blue-500/40 bg-blue-500/15'
                        : 'text-slate-400 border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                    )}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => jumpTo(e => e.event_type === 'quiz_start', 'first')}
                  className="px-2 py-1 rounded text-[10px] border border-white/10 text-slate-300 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  Jump: First Quiz Start
                </button>
                <button
                  onClick={() => jumpTo(e => e.event_type === 'conversion' || e.event_type === 'lead_capture', 'first')}
                  className="px-2 py-1 rounded text-[10px] border border-white/10 text-slate-300 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  Jump: First Conversion
                </button>
                <button
                  onClick={() => jumpTo(e => e.event_type === 'interaction', 'last')}
                  className="px-2 py-1 rounded text-[10px] border border-white/10 text-slate-300 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  Jump: Latest Interaction
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Navigation Path</p>
              <div className="space-y-2">
                {filteredEvents.length === 0 && <p className="text-xs text-slate-500">No events available.</p>}
                {filteredEvents.map((e, idx) => (
                  <div
                    key={`${e.id}-${idx}`}
                    ref={(el) => {
                      if (el) itemRefs.current.set(e.id, el);
                      else itemRefs.current.delete(e.id);
                    }}
                    className="text-xs text-slate-300 border-l-2 border-[#3b82f6]/40 pl-3 py-1"
                  >
                    <p>{idx + 1}. {describeEvent(e)}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{new Date(e.created_at).toLocaleTimeString()}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
