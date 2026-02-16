import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Brain, Database, TrendingUp, CheckCircle, AlertCircle, Loader2, Download,
  Activity, Target, Network, Gauge, Filter,
  Play, Settings, Clock, Users, ChevronDown, ChevronRight,
  Phone, Mail, X, Zap, Sparkles, Search, Send,
  ArrowRight, Square, CheckSquare, ExternalLink, Copy
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useAppStore } from '../stores/appStore';
import { supabase } from '../lib/supabase';
import { googleVerifyService } from '../services/googleVerifyService';
import toast from 'react-hot-toast';

type PipelineStep = 'idle' | 'syncing' | 'enriching' | 'verifying' | 'training' | 'scoring' | 'complete' | 'error';

interface PipelineStatus {
  step: PipelineStep;
  message: string;
  progress: number;
  clinicsSynced?: number;
  leadsSynced?: number;
  modelAccuracy?: number;
  hotProspects?: number;
  warmProspects?: number;
  coldProspects?: number;
}

interface PipelineConfig {
  autoRetrain: boolean;
  minAccuracy: number;
  scoreThreshold: number;
  excludeRecentlyContacted: boolean;
  daysSinceContact: number;
}

interface LiveNumbers {
  clinics: number;
  leads: number;
  accuracy: number;
  hot: number;
  warm: number;
  cold: number;
  enriched: number;
  verifiedDmEmails: number;
  riskyDmEmails: number;
  invalidDmEmails: number;
  missingDmEmails: number;
}

type ProspectViewMode = 'table' | 'cards' | 'priority';

interface AdSignals {
  google: boolean;
  meta: boolean;
  linkedin: boolean;
  reddit: boolean;
}

const EMPTY_AD_SIGNALS: AdSignals = {
  google: false,
  meta: false,
  linkedin: false,
  reddit: false,
};

const EMPTY_LIVE_NUMBERS: LiveNumbers = {
  clinics: 0,
  leads: 0,
  accuracy: 0,
  hot: 0,
  warm: 0,
  cold: 0,
  enriched: 0,
  verifiedDmEmails: 0,
  riskyDmEmails: 0,
  invalidDmEmails: 0,
  missingDmEmails: 0,
};

const GENERIC_EMAIL_PREFIXES = ['info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help', 'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply'];
function isGenericEmail(email?: string | null): boolean {
  const clean = String(email || '').trim();
  if (!clean || !clean.includes('@')) return false;
  const prefix = clean.split('@')[0].toLowerCase();
  return GENERIC_EMAIL_PREFIXES.includes(prefix);
}

function splitFullName(fullName?: string | null): { firstName: string; lastName: string } {
  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: 'Team', lastName: '' };
  const [firstName, ...rest] = clean.split(/\s+/);
  return { firstName: firstName || 'Team', lastName: rest.join(' ') || '' };
}

function getAdSignalCount(signals?: Partial<AdSignals>): number {
  if (!signals) return 0;
  return Number(Boolean(signals.google)) + Number(Boolean(signals.meta)) + Number(Boolean(signals.linkedin)) + Number(Boolean(signals.reddit));
}

function computeIntentScore(prospect: any): number {
  const propensity = Math.round((Number(prospect?.propensity_score || 0)) * 100);
  const adSignalCount = getAdSignalCount(prospect?.ad_signals);
  const verifiedBoost = prospect?.email_verification_status === 'valid' || prospect?.email_verified ? 10 : 0;
  const dmBoost = prospect?.dm_email ? 6 : 0;
  const adBoost = adSignalCount * 12;
  return Math.min(100, Math.max(0, propensity + adBoost + verifiedBoost + dmBoost));
}

function getRecommendedAction(prospect: any): 'call_immediately' | 'email_sequence' | 'research_first' {
  const intent = Number(prospect?.intent_score ?? computeIntentScore(prospect));
  if (intent >= 80 || (prospect?.propensity_tier === 'hot' && getAdSignalCount(prospect?.ad_signals) > 0)) return 'call_immediately';
  if (intent >= 55) return 'email_sequence';
  return 'research_first';
}

// ─── Saved state key ───
const STORAGE_KEY = 'novalyte_ai_engine_state';

interface SavedState {
  topProspects: any[];
  liveNumbers: LiveNumbers;
  pipelineHistory: any[];
  lastRun: string | null;
  expandedNodes: Record<string, boolean>;
}

function loadState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(state: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function normalizeLiveNumbers(raw: any): LiveNumbers {
  return {
    ...EMPTY_LIVE_NUMBERS,
    ...(raw || {}),
  };
}

// ─── Gas Pump Analog Rolling Digit ───
function PumpDigit({ digit, rolling }: { digit: string; rolling: boolean }) {
  const [displayDigit, setDisplayDigit] = useState(0);
  const intervalRef = useRef<any>(null);
  const rollRef = useRef(0);

  useEffect(() => {
    if (rolling) {
      rollRef.current = 0;
      intervalRef.current = setInterval(() => {
        rollRef.current = (rollRef.current + 1) % 10;
        setDisplayDigit(rollRef.current);
      }, 80);
      return () => clearInterval(intervalRef.current);
    } else {
      clearInterval(intervalRef.current);
      setDisplayDigit(parseInt(digit) || 0);
    }
  }, [rolling, digit]);

  if (digit === ',' || digit === '.' || digit === '%') {
    return <span className="text-white/60 text-lg mx-px">{digit}</span>;
  }

  return (
    <span className="inline-block relative overflow-hidden bg-[#111] border border-white/10 rounded-sm mx-px"
      style={{ width: '1.1em', height: '1.7em' }}>
      <span className={cn(
        'absolute inset-0 flex items-center justify-center text-white font-mono font-bold text-lg',
        rolling ? 'transition-transform duration-75' : 'transition-transform duration-500 ease-out'
      )} style={{
        transform: rolling ? `translateY(${(displayDigit % 3 - 1) * 3}px)` : 'translateY(0)',
      }}>
        {rolling ? displayDigit : digit}
      </span>
      <div className="absolute left-0 right-0 top-1/2 h-px bg-white/5" />
    </span>
  );
}

function GasPumpNumber({ value, rolling = false, suffix = '' }: { value: number; rolling?: boolean; suffix?: string }) {
  const formatted = value < 1 && value > 0
    ? (value * 100).toFixed(1) + '%'
    : Math.round(value).toLocaleString() + suffix;

  return (
    <span className="inline-flex items-center tabular-nums">
      {formatted.split('').map((char, i) => (
        <PumpDigit key={i} digit={char} rolling={rolling} />
      ))}
    </span>
  );
}

// ─── Animated Counter ───
function AnimatedNumber({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const start = ref.current;
    const diff = value - start;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * eased;
      setDisplay(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value, duration]);

  return <>{value < 1 && value > 0 ? (display * 100).toFixed(1) + '%' : Math.round(display).toLocaleString()}</>;
}

// ─── Data Particle ───
function DataParticle({ active, delay, color }: { active: boolean; delay: number; color: string }) {
  if (!active) return null;
  return (
    <div className="absolute w-2 h-2 rounded-full animate-data-flow"
      style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}`, animationDelay: `${delay}ms`, top: '50%', left: '0%' }} />
  );
}

// ─── Flow Connector ───
function FlowConnector({ active, step, targetStep }: { active: boolean; step: PipelineStep; targetStep: PipelineStep }) {
  const stepOrder: PipelineStep[] = ['syncing', 'enriching', 'verifying', 'training', 'scoring', 'complete'];
  const stepIdx = stepOrder.indexOf(step);
  const targetIdx = stepOrder.indexOf(targetStep);
  const isActive = active && stepIdx >= targetIdx;
  const isDone = stepIdx > targetIdx + 1 || (stepIdx === targetIdx + 1 && step !== 'error');

  return (
    <div className="relative hidden md:flex items-center justify-center w-8 lg:w-10 shrink-0 py-4">
      <div className={cn(
        'h-[2px] w-full rounded-full transition-all duration-700',
        isDone ? 'bg-[#06B6D4]/90 shadow-[0_0_14px_rgba(6,182,212,0.6)]' :
        isActive ? 'bg-[#06B6D4]/55' : 'bg-white/10'
      )} />
      {isActive && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.35),transparent)] animate-electric-stream" />
          {[0, 240, 480, 720].map(d => <DataParticle key={d} active delay={d} color="#22D3EE" />)}
        </div>
      )}
    </div>
  );
}

// ─── Score Gauge ───
function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const circumference = 2 * Math.PI * (size / 2 - 8);
  useEffect(() => { const t = setTimeout(() => setAnimatedScore(score), 200); return () => clearTimeout(t); }, [score]);
  const offset = circumference - (animatedScore * circumference);
  const color = score >= 0.7 ? '#ef4444' : score >= 0.4 ? '#f59e0b' : '#64748b';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={size/2 - 8} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
        <circle cx={size/2} cy={size/2} r={size/2 - 8} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold text-white tabular-nums">{(animatedScore * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function waitUntil(startTime: number, targetMs: number): Promise<void> {
  const remaining = Math.max(0, targetMs - (Date.now() - startTime));
  return new Promise(r => setTimeout(r, remaining));
}

// ─── Expandable Pipeline Node ───
function PipelineNode({
  icon: Icon, label, sublabel, active, done, expanded, onToggle, stats, children, stepNo,
}: {
  icon: any; label: string; sublabel: string; active: boolean; done: boolean;
  expanded?: boolean; onToggle?: () => void;
  stats?: { label: string; value: string }[];
  children?: React.ReactNode;
  stepNo?: number;
}) {
  return (
    <div className={cn(
      'relative flex-1 min-w-[220px] md:min-w-0 md:basis-0 rounded-2xl border transition-all duration-500 cursor-pointer overflow-hidden',
      active ? 'border-[#22D3EE]/60 bg-gradient-to-b from-[#062533] to-[#04121a] shadow-[0_0_30px_rgba(34,211,238,0.2)]' :
      done ? 'border-[#06B6D4]/35 bg-[#06131b]/95' : 'border-white/10 bg-[#060b11]/95'
    )} onClick={onToggle}>
      {active && (
        <>
          <div className="absolute inset-0 rounded-2xl bg-[#06B6D4]/8 animate-pulse" />
          <div className="absolute inset-0 rounded-2xl border border-[#22D3EE]/35 animate-electric-outline pointer-events-none" />
        </>
      )}
      <div className="relative p-4">
        <div className="flex items-center gap-2.5 mb-3 min-w-0">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-all border',
            active ? 'bg-[#06B6D4]/20 border-[#22D3EE]/50 shadow-[0_0_14px_rgba(34,211,238,0.45)]' :
            done ? 'bg-[#06B6D4]/15 border-[#06B6D4]/30' : 'bg-white/5 border-white/10')}>
            {active ? <Loader2 className="w-4 h-4 text-[#22D3EE] animate-spin" /> :
             done ? <CheckCircle className="w-4 h-4 text-[#06B6D4]" /> : <Icon className="w-4 h-4 text-slate-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {typeof stepNo === 'number' && (
                <span className="inline-flex items-center justify-center h-4 min-w-4 rounded-full px-1 text-[10px] font-semibold bg-white/5 border border-white/10 text-slate-400">
                  {stepNo}
                </span>
              )}
              <h4 className={cn('text-xs font-semibold truncate', active || done ? 'text-white' : 'text-slate-300')}>{label}</h4>
            </div>
            <p className="text-[10px] text-slate-500 truncate mt-0.5">{sublabel}</p>
          </div>
          {onToggle && (expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />)}
        </div>
        {stats && stats.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-white/[0.08]">
            {stats.map((s, i) => (
              <div key={i} className="flex justify-between text-[11px] gap-2">
                <span className="text-slate-500 truncate">{s.label}</span>
                <span className="text-[#22D3EE] font-semibold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {expanded && children && (
        <div className="px-4 pb-4 pt-0 border-t border-white/[0.08] text-xs text-slate-400 space-y-2 animate-fade-in bg-black/20" onClick={e => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Metric Drill-Down Modal ───
function MetricDrillDown({
  title, subtitle, data, columns, onClose,
}: {
  title: string; subtitle: string; data: any[]; columns: { key: string; label: string; render?: (row: any) => React.ReactNode }[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = data.filter(row => {
    if (!search) return true;
    const q = search.toLowerCase();
    return Object.values(row).some(v => String(v || '').toLowerCase().includes(q));
  });

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r: any) => r.clinic_id || r.id || String(Math.random()))));
  };

  const pushToCRM = () => {
    if (selected.size === 0) { toast.error('Select items first'); return; }
    const sel = data.filter(r => selected.has(r.clinic_id || r.id));
    const { addContacts, contacts: existingContacts, markets } = useAppStore.getState();
    const existingClinicIds = new Set(existingContacts.map(c => c.clinic.id));
    const newContacts: any[] = [];
    for (const p of sel) {
      const cid = p.clinic_id || p.id;
      if (existingClinicIds.has(cid)) continue;
      const market = markets.find(m => m.city.toLowerCase() === (p.city || '').toLowerCase()) || markets[0];
      newContacts.push({
        id: `contact-${cid}-${Date.now()}`, clinic: {
          id: cid, name: p.name, type: 'mens_health_clinic' as const,
          address: { street: '', city: p.city || '', state: p.state || '', zip: '', country: 'USA' },
          phone: p.phone || '', email: p.email || undefined, managerEmail: p.email || undefined,
          services: p.services || [], marketZone: market, discoveredAt: new Date(), lastUpdated: new Date(),
        },
        decisionMaker: undefined, status: p.email ? 'ready_to_call' : 'researching',
        priority: (p.propensity_tier === 'hot' ? 'high' : 'medium') as any,
        score: Math.round((p.propensity_score || 0) * 100), tags: p.services || [],
        notes: '', keywordMatches: [], activities: [], createdAt: new Date(), updatedAt: new Date(),
      });
    }
    if (newContacts.length > 0) { addContacts(newContacts); toast.success(`${newContacts.length} pushed to Pipeline CRM`); }
    else toast('All selected already in CRM');
    setSelected(new Set());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/[0.06] bg-[#06B6D4]/5 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle} · {filtered.length} results</p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <button onClick={pushToCRM} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 border border-emerald-500/30">
                <ExternalLink className="w-3.5 h-3.5" /> Push {selected.size} to CRM
              </button>
            )}
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs placeholder-slate-500 w-48 ml-auto" />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.06] bg-white/[0.02] sticky top-0 z-10">
                <th className="py-2.5 px-3 w-10"><button onClick={selectAll} className="text-slate-500 hover:text-[#06B6D4]">
                  {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                </button></th>
                {columns.map(col => (
                  <th key={col.key} className="text-left py-2.5 px-3 font-medium text-xs">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.clinic_id || row.id || i} className={cn('border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors',
                  selected.has(row.clinic_id || row.id) && 'bg-[#06B6D4]/5')}>
                  <td className="py-2.5 px-3">
                    <button onClick={() => toggle(row.clinic_id || row.id)} className="text-slate-500 hover:text-[#06B6D4]">
                      {selected.has(row.clinic_id || row.id) ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  {columns.map(col => (
                    <td key={col.key} className="py-2.5 px-3 text-sm text-slate-300">
                      {col.render ? col.render(row) : row[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="py-8 text-center text-xs text-slate-500">No results</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AIEngine() {
  const saved = useRef(loadState());
  const runTokenRef = useRef(0);
  const [status, setStatus] = useState<PipelineStatus>({ step: 'idle', message: 'Ready to run intelligence pipeline', progress: 0 });
  const [lastRun, setLastRun] = useState<Date | null>(saved.current?.lastRun ? new Date(saved.current.lastRun) : null);
  const [topProspects, setTopProspects] = useState<any[]>(saved.current?.topProspects || []);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<PipelineConfig>({
    autoRetrain: true, minAccuracy: 0.70, scoreThreshold: 0.40,
    excludeRecentlyContacted: true, daysSinceContact: 30,
  });
  const [pipelineHistory, setPipelineHistory] = useState<any[]>(saved.current?.pipelineHistory || []);
  const [selectedProspect, setSelectedProspect] = useState<any>(null);
  const [liveNumbers, setLiveNumbers] = useState<LiveNumbers>(normalizeLiveNumbers(saved.current?.liveNumbers));
  const [pumpRolling, setPumpRolling] = useState(false);
  const [pumpScore, setPumpScore] = useState<number>(0);
  const [addingToSequence] = useState(false);
  const [sequenceProgress] = useState({ sent: 0, total: 0, model: '' });
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(saved.current?.expandedNodes || {});
  const [selectedClinics, setSelectedClinics] = useState<Set<string>>(new Set());
  const [googleVerifying, setGoogleVerifying] = useState(false);
  const [googleVerifyProgress, setGoogleVerifyProgress] = useState({ done: 0, total: 0 });
  const [filterTier, setFilterTier] = useState<'all' | 'hot' | 'warm' | 'cold'>('all');
  const [filterEmail, setFilterEmail] = useState<'all' | 'with_email' | 'no_email'>('all');
  const [prospectView, setProspectView] = useState<ProspectViewMode>('priority');
  const [searchQuery, setSearchQuery] = useState('');
  const [pushingToCRM, setPushingToCRM] = useState(false);
  const [metricDrill, setMetricDrill] = useState<{ title: string; subtitle: string; data: any[]; columns: any[] } | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [holdStartProgress, setHoldStartProgress] = useState(0);
  const [isHoldingStart, setIsHoldingStart] = useState(false);
  const [dmEnrichmentRunning, setDmEnrichmentRunning] = useState(false);
  const [loadingVerifiedDmProspects, setLoadingVerifiedDmProspects] = useState(false);
  const holdStartTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartAtRef = useRef<number | null>(null);
  const callFirstAlertedRef = useRef<Set<string>>(new Set());
  const [dripSequences, setDripSequences] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('novalyte_drip_sequences') || '[]'); } catch { return []; }
  });
  const getProspectEmail = (p: any) => p.email || p.dm_email || '';

  // ─── Import clinics from Clinic Discovery ───
  const importFromDiscovery = () => {
    try {
      const raw = localStorage.getItem('novalyte_ai_engine_clinics');
      if (!raw) { toast.error('No clinics pushed from Clinic Discovery yet. Go to Clinic Discovery and click "Push to AI Engine".'); return; }
      const imported: any[] = JSON.parse(raw);
      if (imported.length === 0) { toast.error('No clinics in the import queue'); return; }

      // Merge with existing topProspects — dedup by clinic_id AND name+city
      const existingIds = new Set(topProspects.map(p => p.clinic_id));
      const existingKeys = new Set(topProspects.map(p => `${(p.name || '').toLowerCase().trim()}|${(p.city || '').toLowerCase().trim()}`));
      let dupCount = 0;
      const newOnes = imported.filter(p => {
        const key = `${(p.name || '').toLowerCase().trim()}|${(p.city || '').toLowerCase().trim()}`;
        if (existingIds.has(p.clinic_id) || existingKeys.has(key)) { dupCount++; return false; }
        return true;
      });

      if (dupCount > 0 && newOnes.length === 0) {
        toast((t) => (
          <div>
            <p className="font-semibold">All {dupCount} clinics are duplicates</p>
            <p className="text-sm text-slate-400 mt-1">Already in AI Engine results</p>
          </div>
        ), { icon: '⚠️', duration: 4000 });
        return;
      }

      if (dupCount > 0) {
        toast((t) => (
          <div>
            <p className="font-semibold">{dupCount} duplicate{dupCount > 1 ? 's' : ''} skipped</p>
            <p className="text-sm text-slate-400 mt-1">{newOnes.length} new clinics imported</p>
          </div>
        ), { icon: '⚠️', duration: 4000 });
      }

      const merged = [...topProspects, ...newOnes];
      setTopProspects(merged);

      // Update live numbers
      setLiveNumbers(prev => ({
        ...prev,
        clinics: merged.length,
        hot: merged.filter(p => p.propensity_tier === 'hot').length,
        warm: merged.filter(p => p.propensity_tier === 'warm').length,
        cold: merged.filter(p => p.propensity_tier === 'cold').length,
        enriched: merged.filter(p => p.email || p.dm_email).length,
      }));

      if (newOnes.length > 0 && dupCount === 0) {
        toast.success(`Imported ${newOnes.length} clinics from Clinic Discovery (${merged.length} total)`);
      }
    } catch { toast.error('Failed to import clinics'); }
  };

  // ─── Detect & remove duplicates ───
  const detectDuplicates = (): number => {
    const seen = new Map<string, number>();
    let dupCount = 0;
    for (const p of topProspects) {
      const key = `${(p.name || '').toLowerCase().trim()}|${(p.city || '').toLowerCase().trim()}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const count of seen.values()) {
      if (count > 1) dupCount += count - 1;
    }
    return dupCount;
  };

  const removeDuplicates = () => {
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const p of topProspects) {
      const key = `${(p.name || '').toLowerCase().trim()}|${(p.city || '').toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(p);
      }
    }
    const removed = topProspects.length - deduped.length;
    if (removed === 0) { toast.success('No duplicates found'); return; }
    setTopProspects(deduped);
    setLiveNumbers(prev => ({
      ...prev,
      clinics: deduped.length,
      hot: deduped.filter(p => p.propensity_tier === 'hot').length,
      warm: deduped.filter(p => p.propensity_tier === 'warm').length,
      cold: deduped.filter(p => p.propensity_tier === 'cold').length,
      enriched: deduped.filter(p => p.email || p.dm_email).length,
    }));
    setSelectedClinics(new Set());
    toast.success(`Removed ${removed} duplicate${removed > 1 ? 's' : ''} — ${deduped.length} clinics remaining`);
  };

  // ─── Clear all results ───
  const clearAllResults = () => {
    setTopProspects([]);
    setLiveNumbers(EMPTY_LIVE_NUMBERS);
    setSelectedClinics(new Set());
    setStatus({ step: 'idle', message: 'Ready to run intelligence pipeline', progress: 0 });
    setPumpScore(0);
    setLastRun(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('novalyte_ai_engine_clinics');
    localStorage.removeItem('novalyte_drip_sequences');
    setDripSequences([]);
    toast.success('All AI Engine data cleared');
  };

  const stopPipeline = () => {
    runTokenRef.current += 1;
    setPumpRolling(false);
    setIsHoldingStart(false);
    setHoldStartProgress(0);
    setStatus({ step: 'idle', message: 'Engine stopped. Click Clear again to clear data.', progress: 0 });
    toast('Engine stopped', { icon: '■' });
  };

  const discoveryClinicCount = (() => {
    try {
      const raw = localStorage.getItem('novalyte_ai_engine_clinics');
      return raw ? JSON.parse(raw).length : 0;
    } catch { return 0; }
  })();

  // Persist state
  const persistState = useCallback(() => {
    saveState({
      topProspects, liveNumbers, pipelineHistory,
      lastRun: lastRun?.toISOString() || null, expandedNodes,
    });
  }, [topProspects, liveNumbers, pipelineHistory, lastRun, expandedNodes]);

  useEffect(() => { persistState(); }, [persistState]);

  const refreshDmCoverageFromSupabase = useCallback(async () => {
    if (!supabase) return;

    const [{ count: clinicsCount, error: clinicsErr }, { data: dmRows, error: dmErr }] = await Promise.all([
      supabase.from('clinics').select('id', { count: 'exact', head: true }),
      supabase
        .from('decision_makers')
        .select('clinic_id,email_verification_status')
        .not('clinic_id', 'is', null)
        .not('email_verification_status', 'is', null)
        .limit(6000),
    ]);

    if (clinicsErr) throw new Error(clinicsErr.message);
    if (dmErr) throw new Error(dmErr.message);

    const verified = new Set<string>();
    const risky = new Set<string>();
    const invalid = new Set<string>();

    for (const row of dmRows || []) {
      const clinicId = String(row.clinic_id || '').trim();
      if (!clinicId) continue;
      const verification = String(row.email_verification_status || '').toLowerCase();
      if (verification === 'valid') verified.add(clinicId);
      else if (verification === 'risky' || verification === 'catch-all' || verification === 'catch_all' || verification === 'accept_all') risky.add(clinicId);
      else if (verification === 'invalid') invalid.add(clinicId);
    }

    const uniqueWithEmail = new Set([...verified, ...risky, ...invalid]).size;
    const clinicsInScope = Number(clinicsCount || 0);
    const missing = Math.max(0, clinicsInScope - verified.size);

    setLiveNumbers(prev => ({
      ...prev,
      clinics: clinicsInScope || prev.clinics,
      enriched: Math.max(prev.enriched, uniqueWithEmail),
      verifiedDmEmails: verified.size,
      riskyDmEmails: risky.size,
      invalidDmEmails: invalid.size,
      missingDmEmails: missing,
    }));
  }, []);

  useEffect(() => {
    refreshDmCoverageFromSupabase().catch(() => {});
  }, [refreshDmCoverageFromSupabase]);

  const loadVerifiedDmProspectsFromSupabase = async () => {
    if (loadingVerifiedDmProspects) return;
    if (!supabase) {
      toast.error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (isRunning) {
      toast.error('Stop the active engine run before loading verified DMs.');
      return;
    }

    setLoadingVerifiedDmProspects(true);
    const loadingToast = toast.loading('Loading verified DM emails from Supabase...');

    try {
      const { data: dmRows, error: dmErr } = await supabase
        .from('decision_makers')
        .select('clinic_id,first_name,last_name,title,role,email,confidence,source,email_verified,email_verification_status,enriched_at')
        .eq('email_verification_status', 'valid')
        .not('clinic_id', 'is', null)
        .not('email', 'is', null)
        .limit(6000);

      if (dmErr) throw new Error(dmErr.message);

      if (!dmRows?.length) {
        await refreshDmCoverageFromSupabase().catch(() => {});
        toast('No verified decision-maker emails found in Supabase yet.', { id: loadingToast, icon: '⚠️', duration: 6000 });
        return;
      }

      const pickBetterDm = (candidate: any, current: any) => {
        const candEmail = String(candidate?.email || '').trim();
        const currEmail = String(current?.email || '').trim();
        const candGeneric = isGenericEmail(candEmail);
        const currGeneric = isGenericEmail(currEmail);
        if (candGeneric !== currGeneric) return !candGeneric; // Prefer non-generic.
        const candConf = Number(candidate?.confidence || 0);
        const currConf = Number(current?.confidence || 0);
        if (candConf !== currConf) return candConf > currConf;
        const candAt = candidate?.enriched_at ? new Date(candidate.enriched_at).getTime() : 0;
        const currAt = current?.enriched_at ? new Date(current.enriched_at).getTime() : 0;
        if (candAt !== currAt) return candAt > currAt;
        return candEmail.length > currEmail.length;
      };

      const bestDmByClinic = new Map<string, any>();
      for (const row of dmRows) {
        const clinicId = String((row as any)?.clinic_id || '').trim();
        if (!clinicId) continue;
        const current = bestDmByClinic.get(clinicId);
        if (!current) {
          bestDmByClinic.set(clinicId, row);
          continue;
        }
        if (pickBetterDm(row, current)) bestDmByClinic.set(clinicId, row);
      }

      const clinicIds = Array.from(bestDmByClinic.keys());
      const clinicsById = new Map<string, any>();
      const chunkSize = 180;
      for (let i = 0; i < clinicIds.length; i += chunkSize) {
        const chunk = clinicIds.slice(i, i + chunkSize);
        const { data: clinicRows, error: clinicsErr } = await supabase
          .from('clinics')
          .select('id,name,city,state,phone,website,rating,review_count,services')
          .in('id', chunk);
        if (clinicsErr) throw new Error(clinicsErr.message);
        for (const c of clinicRows || []) {
          const id = String((c as any)?.id || '').trim();
          if (id) clinicsById.set(id, c);
        }
      }

      const toVerificationStatus = (raw: any): 'valid' | 'invalid' | 'risky' | 'unknown' | undefined => {
        const v = String(raw || '').toLowerCase().trim();
        if (v === 'valid' || v === 'invalid' || v === 'risky' || v === 'unknown') return v;
        if (v === 'catch-all' || v === 'catch_all' || v === 'accept_all') return 'risky';
        return undefined;
      };

      const prospects: any[] = [];
      let missingClinics = 0;
      for (const clinicId of clinicIds) {
        const clinic = clinicsById.get(clinicId);
        const dm = bestDmByClinic.get(clinicId);
        if (!clinic) { missingClinics += 1; continue; }

        const dmEmail = String(dm?.email || '').trim();
        if (!dmEmail) continue;
        const dmName = [String(dm?.first_name || '').trim(), String(dm?.last_name || '').trim()].filter(Boolean).join(' ').trim();
        const verificationStatus = toVerificationStatus(dm?.email_verification_status) || 'valid';
        const emailVerified = Boolean(dm?.email_verified) || verificationStatus === 'valid';

        // Default tier/score: this path is about outreach enablement, not ML ranking.
        const propensityScore = 0.45;
        const propensityTier: 'hot' | 'warm' | 'cold' = propensityScore >= 0.7 ? 'hot' : propensityScore >= 0.4 ? 'warm' : 'cold';

        const baseProspect: any = {
          clinic_id: String(clinic.id),
          name: clinic.name,
          city: clinic.city,
          state: clinic.state,
          phone: clinic.phone || '',
          website: clinic.website || '',
          rating: clinic.rating ?? undefined,
          review_count: clinic.review_count ?? 0,
          services: clinic.services || [],
          // Keep the field stable so existing UI renders without NaNs.
          affluence_score: 0,
          propensity_score: propensityScore,
          propensity_tier: propensityTier,
          dm_name: dmName || undefined,
          dm_email: dmEmail,
          // Keep `email` for legacy exports; `dm_email` is what intent scoring boosts.
          email: dmEmail,
          dm_title: dm?.title || undefined,
          dm_role: dm?.role || undefined,
          dm_confidence: Number(dm?.confidence || 0),
          dm_source: dm?.source || undefined,
          email_verified: emailVerified,
          email_verification_status: verificationStatus,
          ad_signals: { ...EMPTY_AD_SIGNALS },
          ad_active: false,
        };

        const intentScore = computeIntentScore(baseProspect);
        prospects.push({
          ...baseProspect,
          intent_score: intentScore,
          recommended_action: getRecommendedAction({ ...baseProspect, intent_score: intentScore }),
          _source: 'supabase_verified_dm',
        });
      }

      if (prospects.length === 0) {
        await refreshDmCoverageFromSupabase().catch(() => {});
        toast('Verified DMs exist in Supabase, but none could be mapped to clinics.', { id: loadingToast, icon: '⚠️', duration: 7000 });
        return;
      }

      const existingIds = new Set(topProspects.map(p => String(p?.clinic_id || '').trim()).filter(Boolean));
      const existingKeys = new Set(topProspects.map(p => `${String(p?.name || '').toLowerCase().trim()}|${String(p?.city || '').toLowerCase().trim()}`));
      const newOnes = prospects.filter(p => {
        const id = String(p?.clinic_id || '').trim();
        if (id && existingIds.has(id)) return false;
        const key = `${String(p?.name || '').toLowerCase().trim()}|${String(p?.city || '').toLowerCase().trim()}`;
        if (existingKeys.has(key)) return false;
        return true;
      });

      const merged = rankProspectsByIntent([...topProspects, ...newOnes]);
      setTopProspects(merged);
      setSelectedClinics(new Set());

      await refreshDmCoverageFromSupabase().catch(() => {});

      const loaded = newOnes.length;
      const alreadyPresent = prospects.length - loaded;
      toast.success(`Loaded ${loaded} verified DM prospects from Supabase${alreadyPresent > 0 ? ` (${alreadyPresent} already in AI Engine)` : ''}.`, { id: loadingToast, duration: 5000 });
      if (missingClinics > 0) {
        toast(`${missingClinics} verified DM rows had no matching clinic record (skipped).`, { icon: '⚠️', duration: 6000 });
      }
    } catch (err: any) {
      toast.error(`Load failed: ${err?.message || 'Unknown error'}`, { id: loadingToast });
    } finally {
      setLoadingVerifiedDmProspects(false);
    }
  };

  useEffect(() => {
    if (!clearArmed) return;
    const reset = window.setTimeout(() => setClearArmed(false), 7000);
    return () => window.clearTimeout(reset);
  }, [clearArmed]);

  const toggleNode = (key: string) => setExpandedNodes(prev => ({ ...prev, [key]: !prev[key] }));

  // ─── Filtered prospects ───
  const filteredProspects = topProspects.filter(p => {
    if (filterTier !== 'all' && p.propensity_tier !== filterTier) return false;
    const hasEmail = Boolean(getProspectEmail(p));
    if (filterEmail === 'with_email' && !hasEmail) return false;
    if (filterEmail === 'no_email' && hasEmail) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.name || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q) || (p.state || '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    const aIntent = Number(a.intent_score ?? computeIntentScore(a));
    const bIntent = Number(b.intent_score ?? computeIntentScore(b));
    if (bIntent !== aIntent) return bIntent - aIntent;
    const aScore = Number(a.propensity_score || 0);
    const bScore = Number(b.propensity_score || 0);
    return bScore - aScore;
  });

  const detectAdSignalsForWebsite = async (prospect: any): Promise<AdSignals> => {
    const signals: AdSignals = { ...EMPTY_AD_SIGNALS };
    const website = String(prospect?.website || '').trim();
    const clinicName = String(prospect?.name || '').trim();
    const city = String(prospect?.city || '').trim();
    const state = String(prospect?.state || '').trim();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 11000);
    const safeFetchText = async (url: string) => {
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) return '';
        return (await resp.text()).toLowerCase();
      } catch {
        return '';
      }
    };

    try {
      if (website) {
        const cleaned = website.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        if (cleaned) {
          const html = await safeFetchText(`https://r.jina.ai/http://${cleaned}`);
          if (html) {
            signals.google = /(googletagmanager|gtag\(|googleadservices|doubleclick|adservice\.google)/.test(html);
            signals.meta = /(facebook\.net\/en_us\/fbevents|fbq\(|meta pixel|connect\.facebook\.net)/.test(html);
            signals.linkedin = /(snap\.licdn\.com|linkedin insight|lintrk\()/.test(html);
            signals.reddit = /(pixel\.redditmedia\.com|rdt\('track'|reddit pixel)/.test(html);
          }
        }
      }

      // Fallback: query public ad/library pages via jina proxy for market intent signals.
      // This is heuristic but useful when site pixels are missing.
      if (!signals.google && clinicName) {
        const googleQuery = encodeURIComponent(`"${clinicName}" ${city} ${state} ads`);
        const googleHtml = await safeFetchText(`https://r.jina.ai/http://www.google.com/search?q=${googleQuery}`);
        signals.google = /(sponsored|ads|google ads|adwords|ad service)/.test(googleHtml) && googleHtml.includes(clinicName.toLowerCase().slice(0, 8));
      }

      if (!signals.meta && clinicName) {
        const metaQuery = encodeURIComponent(`${clinicName} ${city}`);
        const metaHtml = await safeFetchText(`https://r.jina.ai/http://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${metaQuery}`);
        signals.meta = /(ad library|results|sponsored|meta)/.test(metaHtml) && metaHtml.includes(clinicName.toLowerCase().slice(0, 8));
      }
    } finally {
      window.clearTimeout(timeout);
    }

    return signals;
  };

  const openClinicIntel = (prospect: any) => {
    const intent = Number(prospect.intent_score ?? computeIntentScore(prospect));
    const action = getRecommendedAction(prospect);
    setSelectedProspect({ ...prospect, intent_score: intent, recommended_action: action });
    if (action === 'call_immediately') {
      const key = String(prospect.clinic_id || prospect.name || '');
      if (callFirstAlertedRef.current.has(key)) return;
      callFirstAlertedRef.current.add(key);
      toast('Call first: this clinic shows high buying intent. Prioritize phone outreach before sequence.', {
        icon: '!',
        duration: 4500,
      });
    }
  };

  const rankProspectsByIntent = (prospects: any[]) => {
    return [...prospects].sort((a, b) => {
      const aIntent = Number(a.intent_score ?? computeIntentScore(a));
      const bIntent = Number(b.intent_score ?? computeIntentScore(b));
      if (bIntent !== aIntent) return bIntent - aIntent;
      return Number(b.propensity_score || 0) - Number(a.propensity_score || 0);
    });
  };

  const toggleClinic = (id: string) => {
    setSelectedClinics(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedClinics.size === filteredProspects.length) {
      setSelectedClinics(new Set());
    } else {
      setSelectedClinics(new Set(filteredProspects.map(p => p.clinic_id)));
    }
  };

  const selectFilteredClinics = () => {
    setSelectedClinics(new Set(filteredProspects.map(p => p.clinic_id)));
  };

  // ─── Metric card click handlers ───
  const defaultColumns = [
    { key: 'name', label: 'Clinic', render: (r: any) => <span className="font-medium text-slate-200">{r.name}</span> },
    { key: 'location', label: 'Location', render: (r: any) => <span className="text-slate-400 text-xs">{r.city}, {r.state}</span> },
    { key: 'contact', label: 'Contact', render: (r: any) => (
      <div>
        {r.phone && <div className="text-slate-300 text-[10px] flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</div>}
        {r.email && <div className="text-[#06B6D4] text-[10px] truncate max-w-[160px] flex items-center gap-1"><Mail className="w-3 h-3" />{r.email}</div>}
        {!r.phone && !r.email && <span className="text-slate-600 text-[10px]">—</span>}
      </div>
    )},
    { key: 'score', label: 'Lead Score', render: (r: any) => (
      <div className="flex items-center gap-2">
        <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', r.propensity_score >= 0.7 ? 'bg-red-500' : r.propensity_score >= 0.4 ? 'bg-amber-500' : 'bg-slate-500')}
            style={{ width: `${(r.propensity_score || 0) * 100}%` }} />
        </div>
        <span className="text-xs font-bold text-slate-300 tabular-nums">{((r.propensity_score || 0) * 100).toFixed(0)}%</span>
      </div>
    )},
    { key: 'tier', label: 'Tier', render: (r: any) => (
      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold',
        r.propensity_tier === 'hot' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
        r.propensity_tier === 'warm' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
        'bg-slate-500/20 text-slate-400 border border-slate-500/30')}>{r.propensity_tier}</span>
    )},
  ];

  const openMetricDrill = (metric: string) => {
    if (topProspects.length === 0) { toast.error('Run the pipeline first'); return; }
    switch (metric) {
      case 'clinics':
        setMetricDrill({ title: `Clinics Synced — ${liveNumbers.clinics.toLocaleString()}`, subtitle: 'All clinics synced from Supabase → BigQuery', data: topProspects, columns: defaultColumns });
        break;
      case 'leads':
        setMetricDrill({ title: `Leads Synced — ${liveNumbers.leads.toLocaleString()}`, subtitle: 'Patient leads synced to BigQuery', data: topProspects, columns: defaultColumns });
        break;
      case 'enriched':
        setMetricDrill({ title: `DMs Enriched — ${liveNumbers.enriched.toLocaleString()}`, subtitle: 'Decision makers with verified emails via Apollo + Exa + Vertex AI',
          data: topProspects.filter(p => getProspectEmail(p)), columns: defaultColumns });
        break;
      case 'accuracy':
        setMetricDrill({ title: `Model Accuracy — ${(liveNumbers.accuracy * 100).toFixed(1)}%`, subtitle: 'Dynamic accuracy computed from BigQuery score distribution, data completeness, and dataset size',
          data: pipelineHistory.filter(h => h.status === 'success'),
          columns: [
            { key: 'timestamp', label: 'Run Time', render: (r: any) => <span className="text-slate-300 text-xs">{new Date(r.timestamp).toLocaleString()}</span> },
            { key: 'accuracy', label: 'Accuracy', render: (r: any) => <span className="text-[#06B6D4] font-bold text-sm">{(r.accuracy * 100).toFixed(1)}%</span> },
            { key: 'clinics', label: 'Clinics', render: (r: any) => <span className="text-slate-300 text-xs">{r.clinics?.toLocaleString()}</span> },
            { key: 'hotProspects', label: 'Hot Leads', render: (r: any) => <span className="text-red-400 text-xs font-semibold">{r.hotProspects}</span> },
            { key: 'duration', label: 'Duration', render: (r: any) => <span className="text-slate-400 text-xs">{r.duration}s</span> },
          ] });
        break;
      case 'hot':
        setMetricDrill({ title: `Hot Leads — ${liveNumbers.hot.toLocaleString()}`, subtitle: 'Lead score ≥ 70% — Priority outreach targets',
          data: topProspects.filter(p => p.propensity_tier === 'hot'), columns: defaultColumns });
        break;
      case 'warm':
        setMetricDrill({ title: `Warm Leads — ${liveNumbers.warm.toLocaleString()}`, subtitle: 'Lead score 40-69% — Nurture sequence candidates',
          data: topProspects.filter(p => p.propensity_tier === 'warm'), columns: defaultColumns });
        break;
    }
  };

  // ═══ TIMED PIPELINE WITH VERIFICATION GATE ═══
  const runPipeline = async () => {
    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    const stillRunning = () => runTokenRef.current === runToken;
    const MIN_VERIFIED_EMAIL_COVERAGE = 0.1;
    const startTime = Date.now();
    setClearArmed(false);
    setLiveNumbers({ ...EMPTY_LIVE_NUMBERS });
    setPumpRolling(true);
    setPumpScore(0);
    setSelectedClinics(new Set());
    setStatus({ step: 'syncing', message: 'Syncing Supabase → BigQuery...', progress: 5 });

    try {
      // Step 1: SYNC (0s → 3s)
      const syncRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-sync', { method: 'POST' });
      if (!stillRunning()) return;
      if (!syncRes.ok) throw new Error('Sync failed: ' + (await syncRes.text()));
      const syncData = await syncRes.json();
      if (!stillRunning()) return;
      if (!syncData.success) throw new Error(syncData.error || 'Sync failed');
      const enrichmentData = syncData?.enrichment || {};
      if (!syncData?.enrichment) {
        console.warn('Sync API missing enrichment payload; continuing with safe defaults.');
      }
      await waitUntil(startTime, 3000);
      if (!stillRunning()) return;
      setLiveNumbers(prev => ({
        ...prev,
        clinics: syncData.clinicsSynced,
        leads: syncData.leadsSynced,
        enriched: Number(enrichmentData.clinicsWithDM || 0),
      }));
      setStatus({ step: 'enriching', message: 'Enriching DMs via Apollo + Exa + Vertex AI...', progress: 22, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced });

      // Step 2: ENRICHMENT (3s → 5s)
      const enrichedCount = Number(enrichmentData.clinicsWithDM || 0);
      for (let i = 1; i <= 8; i++) {
        await waitUntil(startTime, 3000 + (2000 / 8) * i);
        if (!stillRunning()) return;
        setLiveNumbers(prev => ({ ...prev, enriched: Math.round(enrichedCount * (i / 8)) }));
        setStatus(prev => ({ ...prev, progress: 22 + Math.round(12 * (i / 8)) }));
      }
      await waitUntil(startTime, 5000);
      if (!stillRunning()) return;
      setStatus({ step: 'verifying', message: 'Verifying DM emails + enrichment confidence...', progress: 36, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced });

      // Step 3: VERIFY (5s → 7s)
      const verification = enrichmentData;
      const verifiedCount = Number(verification.clinicsWithVerifiedDMEmail || 0);
      const riskyCount = Number(verification.clinicsWithRiskyDMEmail || 0);
      const invalidCount = Number(verification.clinicsWithInvalidDMEmail || 0);
      const missingCount = Number(verification.clinicsMissingDM || Math.max(0, syncData.clinicsSynced - Number(verification.clinicsWithDM || 0)));
      for (let i = 1; i <= 6; i++) {
        await waitUntil(startTime, 5000 + (2000 / 6) * i);
        if (!stillRunning()) return;
        setLiveNumbers(prev => ({
          ...prev,
          verifiedDmEmails: Math.round(verifiedCount * (i / 6)),
          riskyDmEmails: Math.round(riskyCount * (i / 6)),
          invalidDmEmails: Math.round(invalidCount * (i / 6)),
          missingDmEmails: Math.round(missingCount * (i / 6)),
        }));
        setStatus(prev => ({ ...prev, progress: 36 + Math.round(16 * (i / 6)) }));
      }

      const verifiedCoverage = syncData.clinicsSynced > 0 ? verifiedCount / syncData.clinicsSynced : 0;
      if (verifiedCoverage < MIN_VERIFIED_EMAIL_COVERAGE) {
        throw new Error(`Verification gate blocked scoring: only ${(verifiedCoverage * 100).toFixed(1)}% clinics have verified DM emails`);
      }

      await waitUntil(startTime, 7000);
      if (!stillRunning()) return;
      setStatus({ step: 'training', message: 'Training model with BigQuery ML on verified contacts...', progress: 54, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced });

      // Step 4: TRAIN (7s → 10s)
      const trainRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-train', { method: 'POST' });
      if (!stillRunning()) return;
      if (!trainRes.ok) throw new Error('Training failed: ' + (await trainRes.text()));
      const trainData = await trainRes.json();
      if (!stillRunning()) return;
      if (!trainData.success) throw new Error(trainData.error || 'Training failed');
      for (let i = 1; i <= 6; i++) {
        await waitUntil(startTime, 7000 + (3000 / 6) * i);
        if (!stillRunning()) return;
        setLiveNumbers(prev => ({ ...prev, accuracy: trainData.accuracy * (i / 6) }));
        setStatus(prev => ({ ...prev, progress: 54 + Math.round(16 * (i / 6)) }));
      }
      await waitUntil(startTime, 10000);
      if (!stillRunning()) return;
      setStatus({ step: 'scoring', message: 'Calculating lead scores (verified DM emails only)...', progress: 72, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced, modelAccuracy: trainData.accuracy });

      // Step 5: SCORE (10s → 12.5s)
      const scoreRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-score', { method: 'POST' });
      if (!stillRunning()) return;
      if (!scoreRes.ok) throw new Error('Scoring failed: ' + (await scoreRes.text()));
      const scoreData = await scoreRes.json();
      if (!stillRunning()) return;
      if (!scoreData.success) throw new Error(scoreData.error || 'Scoring failed');
      const scoreVerification = scoreData?.verification || {};
      for (let i = 1; i <= 10; i++) {
        await waitUntil(startTime, 10000 + (2500 / 10) * i);
        if (!stillRunning()) return;
        setLiveNumbers(prev => ({
          ...prev,
          hot: Math.round(scoreData.hotProspects * (i / 10)),
          warm: Math.round(scoreData.warmProspects * (i / 10)),
          cold: Math.round((scoreData.coldProspects || 0) * (i / 10)),
          verifiedDmEmails: Math.max(prev.verifiedDmEmails, Math.round(Number(scoreVerification.verified || 0) * (i / 10))),
          riskyDmEmails: Math.max(prev.riskyDmEmails, Math.round(Number(scoreVerification.risky || 0) * (i / 10))),
          invalidDmEmails: Math.max(prev.invalidDmEmails, Math.round(Number(scoreVerification.invalid || 0) * (i / 10))),
          missingDmEmails: Math.max(prev.missingDmEmails, Math.round(Number(scoreVerification.missing_dm_email || 0) * (i / 10))),
        }));
        setStatus(prev => ({ ...prev, progress: 72 + Math.round(24 * (i / 10)) }));
      }

      // Step 6: REVEAL (12.5s → 13s) — single top score
      await waitUntil(startTime, 12500);
      if (!stillRunning()) return;
      const topScore = (scoreData.topProspects || []).length > 0 ? scoreData.topProspects[0].propensity_score : 0;
      setPumpScore(topScore);
      setPumpRolling(false);
      await waitUntil(startTime, 13000);
      if (!stillRunning()) return;

      setStatus({ step: 'complete', message: 'Pipeline complete', progress: 100, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced, modelAccuracy: trainData.accuracy, hotProspects: scoreData.hotProspects, warmProspects: scoreData.warmProspects, coldProspects: scoreData.coldProspects });
      
      // Merge BigQuery results with any Clinic Discovery imports
      let allProspects = scoreData.topProspects || [];
      try {
        const discoveryRaw = localStorage.getItem('novalyte_ai_engine_clinics');
        if (discoveryRaw) {
          const discoveryImports: any[] = JSON.parse(discoveryRaw);
          const bqIds = new Set(allProspects.map((p: any) => p.clinic_id));
          // Also match by name+city to catch duplicates across sources
          const bqKeys = new Set(allProspects.map((p: any) => `${(p.name || '').toLowerCase()}|${(p.city || '').toLowerCase()}`));
          const newFromDiscovery = discoveryImports.filter(d => {
            if (bqIds.has(d.clinic_id)) return false;
            const key = `${(d.name || '').toLowerCase()}|${(d.city || '').toLowerCase()}`;
            if (bqKeys.has(key)) return false;
            return true;
          });
          if (newFromDiscovery.length > 0) {
            allProspects = [...allProspects, ...newFromDiscovery];
          }
        }
      } catch {}

      // Step 7: Ad Intent Detection (during scan) — checks paid media signals on clinic websites
      setStatus(prev => ({ ...prev, message: 'Detecting ad activity signals (Google / Meta / LinkedIn / Reddit)...', progress: 96 }));
      const candidatesForAdScan = allProspects.slice(0, 180);
      const adSignalMap = new Map<string, AdSignals>();
      let adDone = 0;
      const workers = Array.from({ length: 6 }, async (_w, workerIndex) => {
        for (let i = workerIndex; i < candidatesForAdScan.length; i += 6) {
          if (!stillRunning()) return;
          const prospect = candidatesForAdScan[i];
          const signals = await detectAdSignalsForWebsite(prospect);
          adSignalMap.set(prospect.clinic_id, signals);
          adDone += 1;
          if (adDone % 8 === 0 || adDone === candidatesForAdScan.length) {
            const pct = candidatesForAdScan.length > 0 ? Math.round((adDone / candidatesForAdScan.length) * 100) : 100;
            setStatus(prev => ({ ...prev, message: `Detecting ad activity signals... ${pct}%`, progress: Math.min(99, 96 + Math.round(pct / 33)) }));
          }
        }
      });
      await Promise.all(workers);
      if (!stillRunning()) return;

      allProspects = allProspects.map((p: any) => {
        const adSignals = adSignalMap.get(p.clinic_id) || { ...EMPTY_AD_SIGNALS };
        const intentScore = computeIntentScore({ ...p, ad_signals: adSignals });
        const recommendedAction = getRecommendedAction({ ...p, ad_signals: adSignals, intent_score: intentScore });
        return {
          ...p,
          ad_signals: adSignals,
          ad_active: getAdSignalCount(adSignals) > 0,
          intent_score: intentScore,
          recommended_action: recommendedAction,
        };
      });

      allProspects = rankProspectsByIntent(allProspects);
      setTopProspects(allProspects);
      const runTime = new Date();
      setLastRun(runTime);
      setPipelineHistory(prev => [{ timestamp: runTime.toISOString(), duration: 13, clinics: syncData.clinicsSynced, leads: syncData.leadsSynced, accuracy: trainData.accuracy, hotProspects: scoreData.hotProspects, status: 'success' }, ...prev.slice(0, 9)]);
      toast.success(`Pipeline complete — ${scoreData.hotProspects} hot leads found (${Number(scoreVerification.verified || 0)} verified DM emails)`);
      const topCallFirst = allProspects.filter((p: any) => p.recommended_action === 'call_immediately').length;
      if (topCallFirst > 0) {
        toast(`${topCallFirst} clinics show buy intent. Call these first before sequencing.`, { icon: '!', duration: 5000 });
      }
    } catch (err: any) {
      if (!stillRunning()) return;
      setPumpRolling(false);
      setStatus({ step: 'error', message: err.message || 'Pipeline failed', progress: 0 });
      toast.error('Pipeline failed: ' + err.message);
      setPipelineHistory(prev => [{ timestamp: new Date().toISOString(), duration: Math.round((Date.now() - startTime) / 1000), status: 'error', error: err.message }, ...prev.slice(0, 9)]);
    }
  };

  // ═══ ADD TO 5-DAY DRIP SEQUENCE (STAGE ONLY — NO AUTO-SEND) ═══
  const addToSequenceWithAI = async () => {
    // Use selected clinics if any, otherwise top prospects with email
    const pool = selectedClinics.size > 0
      ? topProspects.filter(p => selectedClinics.has(p.clinic_id) && getProspectEmail(p))
      : filteredProspects.filter(p => getProspectEmail(p));
    const targets = pool;
    if (targets.length === 0) { toast.error('No prospects with emails found. Select clinics with emails or run the pipeline.'); return; }

    // Split into 5 days (~20 per day)
    const perDay = Math.ceil(targets.length / 5);
    const days: any[][] = [];
    for (let d = 0; d < 5; d++) {
      days.push(targets.slice(d * perDay, (d + 1) * perDay));
    }

    // Save sequence schedule to localStorage — ALL staged as "intro_email", nothing sent
    const sequenceId = `seq_${Date.now()}`;
    const schedule = days.map((batch, dayIdx) => ({
      day: dayIdx + 1,
      sendDate: new Date(Date.now() + dayIdx * 86400000).toISOString().slice(0, 10),
      clinics: batch.map(p => ({
        clinic_id: p.clinic_id, name: p.name, email: getProspectEmail(p),
        city: p.city, state: p.state, tier: p.propensity_tier,
        score: p.propensity_score, services: p.services,
      })),
      status: 'staged', // NOT sent — staged for Intro Email
      sent: 0,
      phase: 'intro_email',
    }));

    // Store the full sequence
    const sequences = JSON.parse(localStorage.getItem('novalyte_drip_sequences') || '[]');
    sequences.unshift({
      id: sequenceId,
      createdAt: new Date().toISOString(),
      totalClinics: targets.length,
      schedule,
      pipeline: 'intro_email', // Current pipeline phase
    });
    localStorage.setItem('novalyte_drip_sequences', JSON.stringify(sequences.slice(0, 10)));
    setDripSequences(JSON.parse(localStorage.getItem('novalyte_drip_sequences') || '[]'));

    // Also push these clinics to CRM as "ready_to_call" so they appear in Email Outreach sequences
    const { addContacts, contacts: existingContacts, markets } = useAppStore.getState();
    const existingClinicIds = new Set(existingContacts.map(c => c.clinic.id));
    const newContacts: any[] = [];

    for (const p of targets) {
      if (existingClinicIds.has(p.clinic_id)) continue;
      const market = markets.find(m =>
        m.city.toLowerCase() === (p.city || '').toLowerCase() &&
        m.state.toLowerCase() === (p.state || '').toLowerCase()
      ) || markets[0];

      const dmEmail = getProspectEmail(p);
      const dmName = String(p.dm_name || '').trim();
      const { firstName: dmFirstName, lastName: dmLastName } = splitFullName(dmName);
      const rawStatus = String(p.email_verification_status || p.emailVerificationStatus || '').toLowerCase().trim();
      const emailVerificationStatus = (rawStatus === 'valid' || rawStatus === 'invalid' || rawStatus === 'risky' || rawStatus === 'unknown')
        ? (rawStatus as any)
        : undefined;
      const emailVerified = Boolean(p.email_verified || p.emailVerified) || emailVerificationStatus === 'valid';
      const rawRole = String(p.dm_role || '').toLowerCase().trim();
      const role = (rawRole === 'owner' || rawRole === 'medical_director' || rawRole === 'clinic_manager' || rawRole === 'practice_administrator' || rawRole === 'marketing_director' || rawRole === 'operations_manager')
        ? rawRole
        : 'clinic_manager';
      const rawSource = String(p.dm_source || p.source || 'ai-engine').toLowerCase().trim();
      const source = (rawSource === 'apollo' || rawSource === 'clearbit' || rawSource === 'npi' || rawSource === 'linkedin' || rawSource === 'manual' || rawSource === 'website_scrape' || rawSource === 'ai-engine')
        ? rawSource
        : 'ai-engine';

      newContacts.push({
        id: `contact-${p.clinic_id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        clinic: {
          id: p.clinic_id, name: p.name, type: 'mens_health_clinic' as const,
          address: { street: '', city: p.city || '', state: p.state || '', zip: '', country: 'USA' },
          phone: p.phone || '', email: dmEmail || undefined,
          website: p.website || undefined,
          managerName: dmName || undefined,
          managerEmail: dmEmail || undefined,
          services: p.services || [], marketZone: market,
          rating: p.rating || undefined,
          reviewCount: p.review_count || 0,
          discoveredAt: new Date(), lastUpdated: new Date(),
        },
        decisionMaker: dmEmail ? {
          id: `dm-${p.clinic_id}`, clinicId: p.clinic_id,
          firstName: dmFirstName || 'Team',
          lastName: dmLastName || '',
          email: dmEmail,
          title: p.dm_title || 'Decision Maker',
          role: role as any,
          confidence: Number(p.dm_confidence || 60),
          source: source as any,
          emailVerified,
          emailVerificationStatus,
        } : undefined,
        status: 'ready_to_call',
        priority: p.propensity_tier === 'hot' ? 'high' : 'medium',
        score: Math.round((p.propensity_score || 0) * 100),
        tags: [...(p.services || []), 'drip-sequence'],
        notes: `Staged for drip sequence · Intro Email phase · Score: ${((p.propensity_score || 0) * 100).toFixed(0)}%`,
        keywordMatches: [],
        activities: [{
          id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'note',
          description: `Staged in drip sequence (${p.propensity_tier} tier) — awaiting Vertex AI personalization`,
          timestamp: new Date(),
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (newContacts.length > 0) addContacts(newContacts);

    toast.success(`${targets.length} clinics staged in Intro Email phase → Go to Email Outreach to personalize with Vertex AI & send`);
    // Jump user into Email Outreach right away.
    useAppStore.getState().setCurrentView('email');
    setSelectedClinics(new Set());
  };

  // ═══ BULK GOOGLE VERIFY (IMPROVE OFFICIAL WEBSITE + CONFIRMED EMAIL) ═══
  const verifyWithGoogleBeforeOutreach = async () => {
    if (googleVerifying) return;
    if (!googleVerifyService.isConfigured) {
      toast.error('Google verify is not configured');
      return;
    }

    const pool = selectedClinics.size > 0
      ? topProspects.filter(p => selectedClinics.has(p.clinic_id))
      : filteredProspects;

    if (pool.length === 0) { toast.error('No prospects to verify'); return; }

    // Keep this sane; the function does live fetch + scrape.
    const CAP = 200;
    if (pool.length > CAP) {
      const ok = confirm(`Google verify is heavy. Verify first ${CAP} of ${pool.length}?`);
      if (!ok) return;
    }
    const targets = pool.slice(0, CAP);

    setGoogleVerifying(true);
    setGoogleVerifyProgress({ done: 0, total: targets.length });
    toast.loading(`Google verifying ${targets.length} clinics...`, { id: 'ai-gverify' });

    try {
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        const market = useAppStore.getState().markets.find(m =>
          m.city.toLowerCase() === String(p.city || '').toLowerCase() &&
          m.state.toLowerCase() === String(p.state || '').toLowerCase()
        ) || useAppStore.getState().markets[0];

        const clinic = {
          id: String(p.clinic_id),
          name: String(p.name || ''),
          type: 'mens_health_clinic',
          address: { street: '', city: String(p.city || ''), state: String(p.state || ''), zip: '', country: 'USA' },
          phone: String(p.phone || ''),
          email: String(p.email || p.dm_email || '') || undefined,
          website: String(p.website || '') || undefined,
          googlePlaceId: undefined,
          yelpId: undefined,
          rating: p.rating ?? undefined,
          reviewCount: p.review_count ?? undefined,
          managerName: p.dm_name || undefined,
          managerEmail: p.dm_email || p.email || undefined,
          ownerName: undefined,
          ownerEmail: undefined,
          services: Array.isArray(p.services) ? p.services : [],
          marketZone: market,
          discoveredAt: new Date(),
          lastUpdated: new Date(),
        } as any;

        const leadEmail = String(p.email || p.dm_email || '').trim() || null;

        try {
          const result = await googleVerifyService.verifyClinic(clinic, leadEmail);
          const confirmed = String(result.confirmedEmail || '').trim();
          const official = String(result.officialWebsite || '').trim();

          // Update AI Engine prospect row so "Push to Email Outreach" uses improved data.
          setTopProspects(prev => prev.map(x => {
            if (String(x.clinic_id) !== String(p.clinic_id)) return x;
            return {
              ...x,
              website: official || x.website,
              dm_email: confirmed || x.dm_email,
              email: confirmed || x.email,
              google_verify_status: result.status,
              google_verify_official_website: official || null,
              google_verify_confirmed_email: confirmed || null,
              google_verify_checked_at: result.checkedAt,
            };
          }));
        } catch {
          // ignore per-item failure
        }

        setGoogleVerifyProgress({ done: i + 1, total: targets.length });
        await new Promise(r => setTimeout(r, 250));
      }

      toast.success('Google verify complete', { id: 'ai-gverify' });
    } catch (err: any) {
      toast.error(`Google verify failed: ${err?.message || 'Unknown error'}`, { id: 'ai-gverify' });
    } finally {
      setGoogleVerifying(false);
    }
  };

  // ═══ PUSH SELECTED TO CRM ═══
  const pushToCRM = (clinicIds?: Set<string>) => {
    const idsToPush = clinicIds || selectedClinics;
    if (idsToPush.size === 0) { toast.error('Select clinics first'); return; }
    setPushingToCRM(true);
    const selected = topProspects.filter(p => idsToPush.has(p.clinic_id));

    // Build CRM contacts directly and push to Zustand store — instant, no API calls
    const { addContacts, contacts, markets } = useAppStore.getState();
    const existingClinicIds = new Set(contacts.map(c => c.clinic.id));
    const newContacts: any[] = [];

    for (const p of selected) {
      if (existingClinicIds.has(p.clinic_id)) continue;

      // Find matching market zone
      const market = markets.find(m =>
        m.city.toLowerCase() === (p.city || '').toLowerCase() &&
        m.state.toLowerCase() === (p.state || '').toLowerCase()
      ) || markets[0];

      const clinic = {
        id: p.clinic_id,
        name: p.name,
        type: 'mens_health_clinic' as const,
        address: { street: '', city: p.city || '', state: p.state || '', zip: '', country: 'USA' },
        phone: p.phone || '',
        email: getProspectEmail(p) || undefined,
        website: p.website || undefined,
        managerName: p.dm_name || undefined,
        managerEmail: p.dm_email || getProspectEmail(p) || undefined,
        services: p.services || [],
        marketZone: market,
        rating: p.rating || undefined,
        reviewCount: p.review_count || 0,
        discoveredAt: new Date(),
        lastUpdated: new Date(),
      };

      const dmEmail = getProspectEmail(p);
      const dmName = String(p.dm_name || '').trim();
      const { firstName: dmFirstName, lastName: dmLastName } = splitFullName(dmName);
      const rawStatus = String(p.email_verification_status || p.emailVerificationStatus || '').toLowerCase().trim();
      const emailVerificationStatus = (rawStatus === 'valid' || rawStatus === 'invalid' || rawStatus === 'risky' || rawStatus === 'unknown')
        ? (rawStatus as any)
        : undefined;
      const emailVerified = Boolean(p.email_verified || p.emailVerified) || emailVerificationStatus === 'valid';
      const rawRole = String(p.dm_role || '').toLowerCase().trim();
      const role = (rawRole === 'owner' || rawRole === 'medical_director' || rawRole === 'clinic_manager' || rawRole === 'practice_administrator' || rawRole === 'marketing_director' || rawRole === 'operations_manager')
        ? rawRole
        : 'clinic_manager';
      const rawSource = String(p.dm_source || p.source || 'ai-engine').toLowerCase().trim();
      const source = (rawSource === 'apollo' || rawSource === 'clearbit' || rawSource === 'npi' || rawSource === 'linkedin' || rawSource === 'manual' || rawSource === 'website_scrape' || rawSource === 'ai-engine')
        ? rawSource
        : 'ai-engine';

      const dm = dmEmail ? {
        id: `dm-${p.clinic_id}`,
        clinicId: p.clinic_id,
        firstName: dmFirstName || 'Team',
        lastName: dmLastName || '',
        email: dmEmail,
        title: p.dm_title || 'Decision Maker',
        role: role as any,
        confidence: Number(p.dm_confidence || 70),
        source: source as any,
        emailVerified,
        emailVerificationStatus,
      } : undefined;

      newContacts.push({
        id: `contact-${p.clinic_id}-${Date.now()}`,
        clinic,
        decisionMaker: dm,
        status: dm?.email || getProspectEmail(p) ? 'ready_to_call' : 'researching',
        priority: p.propensity_tier === 'hot' ? 'high' : p.propensity_tier === 'warm' ? 'medium' : 'low',
        score: Math.round((p.propensity_score || 0) * 100),
        tags: p.services || [],
        notes: `Imported from AI Engine · Lead Score: ${((p.propensity_score || 0) * 100).toFixed(0)}% · Tier: ${p.propensity_tier}`,
        keywordMatches: [],
        activities: [{
          id: `act-${Date.now()}`,
          type: 'note',
          description: `Added to CRM from AI Engine (${p.propensity_tier} tier, ${((p.propensity_score || 0) * 100).toFixed(0)}% score)`,
          timestamp: new Date(),
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (newContacts.length > 0) {
      addContacts(newContacts);
      const skipped = selected.length - newContacts.length;
      if (skipped > 0) {
        toast((t) => (
          <div>
            <p className="font-semibold">{newContacts.length} added to CRM</p>
            <p className="text-sm text-slate-400 mt-1">{skipped} duplicate{skipped > 1 ? 's' : ''} already in CRM — skipped</p>
          </div>
        ), { icon: '⚠️', duration: 4000 });
      } else {
        toast.success(`${newContacts.length} clinics added to Pipeline CRM`);
      }
    } else {
      toast('All selected clinics are already in CRM', { icon: '⚠️' });
    }
    setSelectedClinics(new Set());
    setPushingToCRM(false);
  };

  const pushFilteredToCRM = () => {
    const filteredIds = new Set(filteredProspects.map(p => p.clinic_id).filter(Boolean));
    if (filteredIds.size === 0) {
      toast.error('No filtered clinics to push');
      return;
    }
    pushToCRM(filteredIds);
  };

  // ═══ EXPORT FOR GOOGLE ADS (AI STUDIO) ═══
  const [adsExporting, setAdsExporting] = useState(false);
  const exportForGoogleAds = async (format: 'json' | 'csv' = 'json') => {
    setAdsExporting(true);
    try {
      const res = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-ads-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, tier: filterTier, limit: 500 }),
      });
      if (!res.ok) throw new Error(await res.text());

      if (format === 'csv') {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `novalyte-google-ads-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        URL.revokeObjectURL(url);
        toast.success('Google Ads CSV downloaded — import into Google Ads Editor');
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `novalyte-ai-studio-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${data.total_clinics} clinics for AI Studio`);
      }
    } catch (err: any) {
      toast.error('Export failed: ' + (err.message || 'Unknown error'));
    }
    setAdsExporting(false);
  };

  const [showAdsMenu, setShowAdsMenu] = useState(false);

  const exportProspects = () => {
    if (!filteredProspects.length) { toast.error('No prospects to export.'); return; }
    // Check for duplicates before export
    const seen = new Set<string>();
    let dupCount = 0;
    for (const p of filteredProspects) {
      const key = `${(p.name || '').toLowerCase().trim()}|${(p.city || '').toLowerCase().trim()}`;
      if (seen.has(key)) dupCount++;
      else seen.add(key);
    }
    if (dupCount > 0) {
      toast((t) => (
        <div>
          <p className="font-semibold">{dupCount} duplicate{dupCount > 1 ? 's' : ''} detected in export</p>
          <p className="text-sm text-slate-400 mt-1">Use "Remove Duplicates" to clean up first</p>
          <button onClick={() => { removeDuplicates(); toast.dismiss(t.id); }}
            className="mt-2 px-3 py-1 rounded bg-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/30">
            Remove Duplicates Now
          </button>
        </div>
      ), { icon: '⚠️', duration: 6000 });
    }
    const csv = ['name,city,state,phone,email,lead_score,tier,affluence,services,is_duplicate',
      ...filteredProspects.map(p => [p.name, p.city, p.state, p.phone || '', p.email || '', p.propensity_score, p.propensity_tier, p.affluence_score, (p.services || []).join('; '), p.is_duplicate ? 'YES' : ''].map(v => String(v).includes(',') ? `"${v}"` : v).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `novalyte-prospects-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    toast.success(`Exported ${filteredProspects.length} prospects`);
  };

  const isRunning = !['idle', 'complete', 'error'].includes(status.step);
  const emailProspectCount = topProspects.filter(p => getProspectEmail(p)).length;
  const filteredEmailProspectCount = filteredProspects.filter(p => getProspectEmail(p)).length;
  const HOLD_TO_START_MS = 5000;

  const resetHoldStart = useCallback(() => {
    if (holdStartTimerRef.current) {
      clearInterval(holdStartTimerRef.current);
      holdStartTimerRef.current = null;
    }
    holdStartAtRef.current = null;
    setIsHoldingStart(false);
    setHoldStartProgress(0);
  }, []);

  const beginHoldStart = () => {
    if (isRunning || holdStartTimerRef.current) return;
    setIsHoldingStart(true);
    holdStartAtRef.current = Date.now();
    holdStartTimerRef.current = setInterval(() => {
      const startedAt = holdStartAtRef.current;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min(100, (elapsed / HOLD_TO_START_MS) * 100);
      setHoldStartProgress(nextProgress);
      if (elapsed >= HOLD_TO_START_MS) {
        resetHoldStart();
        runPipeline();
      }
    }, 50);
  };

  const cancelHoldStart = () => {
    if (!isHoldingStart) return;
    if (holdStartProgress > 0 && holdStartProgress < 100) {
      toast('Hold cancelled before 5 seconds', { icon: '■' });
    }
    resetHoldStart();
  };

  useEffect(() => () => resetHoldStart(), [resetHoldStart]);

  const handleClearClick = () => {
    if (!clearArmed) {
      if (isRunning) {
        stopPipeline();
      }
      setClearArmed(true);
      toast('Click Clear again to remove all AI Engine data', { icon: '⚠️' });
      return;
    }
    clearAllResults();
    setClearArmed(false);
  };

  const runDmEnrichmentBatch = async () => {
    if (dmEnrichmentRunning) return;
    if (!supabase) {
      toast.error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (isRunning) {
      toast.error('Stop the active engine run before launching standalone DM enrichment.');
      return;
    }

    setDmEnrichmentRunning(true);
    const loadingToast = toast.loading('Running DM enrichment batch...');

    try {
      const metaEnv: any =
        (typeof import.meta !== 'undefined' && (import.meta as any).env)
          ? (import.meta as any).env
          : {};
      const apolloApiKeys = String(metaEnv.VITE_APOLLO_API_KEYS || metaEnv.VITE_APOLLO_API_KEY || '').trim();
      const revenueBaseKey = String(metaEnv.VITE_REVENUEBASE_API_KEY || '').trim();
      const leadMagicKey = String(metaEnv.VITE_LEADMAGIC_API_KEY || '').trim();

      if (!apolloApiKeys && !leadMagicKey) {
        throw new Error('Missing enrichment provider keys: set VITE_APOLLO_API_KEYS (or VITE_APOLLO_API_KEY) or VITE_LEADMAGIC_API_KEY.');
      }

      const { data, error } = await supabase.functions.invoke('dm-enrichment-batch', {
        body: {
          limit: 60,
          verifyLimit: 50,
          verifyUnknown: false,
          apolloApiKeys,
          revenueBaseKey,
          leadMagicKey,
        },
      });

      if (error) {
        let detail = error.message || 'Edge function request failed';
        const context = (error as any)?.context;
        if (context instanceof Response) {
          try {
            const payload = await context.clone().json();
            if (payload?.error) detail = String(payload.error);
            else if (payload?.message) detail = String(payload.message);
          } catch {
            try {
              const text = await context.clone().text();
              if (text) detail = text;
            } catch {
              // Keep default detail.
            }
          }
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(String(data.error));

      await refreshDmCoverageFromSupabase().catch((err: any) => {
        console.warn('DM coverage refresh failed:', err?.message || err);
      });

      const processed = Number(data?.processedClinics || 0);
      const emailsFound = Number(data?.emailsFound || 0);
      const validFound = Number(data?.validFound || 0);
      const verifiedUnknown = Number(data?.verifiedUnknownEmails || 0);
      const exhaustedKeys = Number(data?.exhaustedApolloKeys || 0);
      const leadMagicHits = Number(data?.leadMagicHits || 0);
      const apolloRestricted = Number(data?.apolloRestricted || 0);
      const leadMagicInsufficientCredits = Number(data?.leadMagicInsufficientCredits || 0);

      const headline = `DM enrichment complete: processed ${processed} clinics, found ${emailsFound} emails (${leadMagicHits} via LeadMagic), ${validFound} valid, ${verifiedUnknown} unknowns verified.`;
      if (emailsFound === 0) toast(headline, { id: loadingToast, duration: 7000, icon: '⚠️' });
      else toast.success(headline, { id: loadingToast, duration: 6000 });

      if (apolloRestricted > 0) {
        toast.error('Apollo people search is blocked on the current Apollo plan (API_INACCESSIBLE). Upgrade Apollo or switch providers.');
      } else if (exhaustedKeys > 0) {
        toast.error(`Apollo keys exhausted/limited: ${exhaustedKeys}. Add more keys or reset credits before next batch.`);
      }

      if (leadMagicInsufficientCredits > 0) {
        toast.error('LeadMagic has insufficient credits (0). Add credits to enable LeadMagic enrichment.');
      }
    } catch (err: any) {
      toast.error(`DM enrichment failed: ${err?.message || 'Unknown error'}`, { id: loadingToast });
    } finally {
      setDmEnrichmentRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 space-y-5">
      <style>{`
        @keyframes dataFlow { 0% { left: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        .animate-data-flow { animation: dataFlow 1.5s ease-in-out infinite; }
        @keyframes electricStream { 0% { transform: translateX(-120%); opacity: 0.1; } 15% { opacity: 0.65; } 85% { opacity: 0.65; } 100% { transform: translateX(120%); opacity: 0.1; } }
        .animate-electric-stream { animation: electricStream 1.35s linear infinite; }
        @keyframes electricOutline { 0%, 100% { box-shadow: inset 0 0 18px rgba(34,211,238,0.12), 0 0 14px rgba(34,211,238,0.18); } 50% { box-shadow: inset 0 0 26px rgba(34,211,238,0.22), 0 0 22px rgba(34,211,238,0.32); } }
        .animate-electric-outline { animation: electricOutline 1.6s ease-in-out infinite; }
        @keyframes scanLine { 0% { top: 0%; } 100% { top: 100%; } }
        .animate-scan { animation: scanLine 2s linear infinite; }
        @keyframes orbFloat { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(10px, -15px) scale(1.1); } 66% { transform: translate(-8px, 10px) scale(0.95); } }
        .animate-orb { animation: orbFloat 6s ease-in-out infinite; }
        @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 5px rgba(6,182,212,0.3); } 50% { box-shadow: 0 0 25px rgba(6,182,212,0.6); } }
        .animate-glow { animation: glowPulse 1.5s ease-in-out infinite; }
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Metric Drill-Down Modal */}
      {metricDrill && <MetricDrillDown {...metricDrill} onClose={() => setMetricDrill(null)} />}

      {/* ═══ Hero Header / Ops Console ═══ */}
      <div className="relative overflow-hidden rounded-2xl border border-[#06B6D4]/20 bg-gradient-to-br from-[#041117] via-black to-[#071820] p-6 md:p-7">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.12) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="absolute -top-6 right-8 h-40 w-40 rounded-full bg-[#06B6D4]/20 blur-3xl" />
        <div className="absolute -bottom-10 left-10 h-44 w-44 rounded-full bg-[#0891B2]/15 blur-3xl" />

        <div className="relative z-10 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={cn('h-14 w-14 rounded-xl bg-[#06B6D4] flex items-center justify-center shadow-[0_12px_40px_rgba(6,182,212,0.35)]', isRunning && 'animate-glow')}>
                  <Brain className="w-7 h-7 text-black" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-white">AI Intelligence Engine</h1>
                  <p className="text-sm text-slate-400">Vertex AI enrichment + verification gate + BigQuery ML scoring</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn('rounded-full border px-2.5 py-1 font-medium', isRunning ? 'border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#67E8F9]' : 'border-white/10 bg-white/[0.03] text-slate-400')}>
                  {isRunning ? `Live Stage: ${status.step.toUpperCase()}` : 'Idle'}
                </span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                  Verified DM Emails: {Number(liveNumbers.verifiedDmEmails).toLocaleString()}
                </span>
                <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2.5 py-1 text-slate-300">
                  Missing DM Emails: {Number(liveNumbers.missingDmEmails).toLocaleString()}
                </span>
              </div>
              {lastRun && <div className="flex items-center gap-2 text-xs text-slate-500"><Clock className="w-3.5 h-3.5" /> Last run: {lastRun.toLocaleString()}</div>}
            </div>

            <div className="w-full max-w-[560px] rounded-xl border border-white/[0.08] bg-black/45 p-3 backdrop-blur-md">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Engine Controls</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isRunning}
                  onMouseDown={beginHoldStart}
                  onMouseUp={cancelHoldStart}
                  onMouseLeave={cancelHoldStart}
                  onTouchStart={beginHoldStart}
                  onTouchEnd={cancelHoldStart}
                  className={cn(
                    'relative overflow-hidden flex-1 min-w-[220px] rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                    isRunning
                      ? 'cursor-not-allowed border-white/10 bg-white/[0.04] text-slate-500'
                      : 'border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#67E8F9] hover:bg-[#06B6D4]/25'
                  )}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 bg-[#06B6D4]/35 transition-[width] duration-75"
                    style={{ width: `${holdStartProgress}%` }}
                  />
                  <span className="relative flex items-center justify-center gap-2">
                    {isHoldingStart ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {isHoldingStart ? `Hold ${Math.max(0, ((HOLD_TO_START_MS * (1 - holdStartProgress / 100)) / 1000)).toFixed(1)}s...` : 'Hold 5s to Start Engine'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={stopPipeline}
                  disabled={!isRunning}
                  className={cn(
                    'rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                    isRunning
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                      : 'cursor-not-allowed border-white/10 bg-white/[0.04] text-slate-500'
                  )}
                >
                  <span className="flex items-center gap-2"><Square className="h-4 w-4" /> Stop Engine</span>
                </button>
                <button
                  type="button"
                  onClick={runDmEnrichmentBatch}
                  disabled={isRunning || dmEnrichmentRunning || !supabase}
                  className={cn(
                    'rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                    isRunning || dmEnrichmentRunning || !supabase
                      ? 'cursor-not-allowed border-white/10 bg-white/[0.04] text-slate-500'
                      : 'border-[#06B6D4]/45 bg-[#06B6D4]/12 text-[#67E8F9] hover:bg-[#06B6D4]/22'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {dmEnrichmentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    {dmEnrichmentRunning ? 'Running DM Enrichment...' : 'Run DM Enrichment'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={loadVerifiedDmProspectsFromSupabase}
                  disabled={isRunning || dmEnrichmentRunning || loadingVerifiedDmProspects || !supabase}
                  className={cn(
                    'rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all',
                    isRunning || dmEnrichmentRunning || loadingVerifiedDmProspects || !supabase
                      ? 'cursor-not-allowed border-white/10 bg-white/[0.04] text-slate-500'
                      : 'border-emerald-500/45 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {loadingVerifiedDmProspects ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {loadingVerifiedDmProspects ? 'Loading Verified DMs...' : 'Load Verified DMs'}
                  </span>
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Safety lock enabled: engine only starts after a continuous 5-second hold. DM enrichment can run independently via edge function.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowConfig(!showConfig)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.08]">
              <Settings className="w-4 h-4" /> Configure
            </button>
            {discoveryClinicCount > 0 && (
              <button onClick={importFromDiscovery}
                className="flex items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/12 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">
                <Database className="w-4 h-4" /> Import Discovery ({discoveryClinicCount})
              </button>
            )}
            {topProspects.length > 0 && detectDuplicates() > 0 && (
              <button onClick={removeDuplicates}
                className="flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/12 px-3.5 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20">
                <Copy className="w-4 h-4" /> Remove {detectDuplicates()} Duplicate{detectDuplicates() > 1 ? 's' : ''}
              </button>
            )}
            {topProspects.length > 0 && (
              <button onClick={handleClearClick}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-all',
                  clearArmed
                    ? 'border-red-500/55 bg-red-500/25 text-red-200 hover:bg-red-500/35'
                    : 'border-red-500/35 bg-red-500/12 text-red-300 hover:bg-red-500/20'
                )}>
                <X className="w-4 h-4" /> {clearArmed ? 'Click Again to Clear' : 'Clear'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Config Panel ═══ */}
      {showConfig && (
        <div className="glass-card p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2"><Settings className="w-5 h-5 text-[#06B6D4]" /> Pipeline Configuration</h3>
            <button onClick={() => setShowConfig(false)} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2"><Target className="w-4 h-4 text-[#06B6D4]" /> Score Threshold</label>
                <input type="range" min="0" max="100" value={config.scoreThreshold * 100} onChange={e => setConfig({ ...config, scoreThreshold: parseInt(e.target.value) / 100 })} className="w-full accent-[#06B6D4]" />
                <div className="flex justify-between text-xs text-slate-500 mt-1"><span>0%</span><span className="text-[#06B6D4] font-semibold">{(config.scoreThreshold * 100).toFixed(0)}%</span><span>100%</span></div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2"><Gauge className="w-4 h-4 text-emerald-400" /> Min Accuracy</label>
                <input type="range" min="50" max="95" value={config.minAccuracy * 100} onChange={e => setConfig({ ...config, minAccuracy: parseInt(e.target.value) / 100 })} className="w-full accent-emerald-400" />
                <div className="flex justify-between text-xs text-slate-500 mt-1"><span>50%</span><span className="text-emerald-400 font-semibold">{(config.minAccuracy * 100).toFixed(0)}%</span><span>95%</span></div>
              </div>
            </div>
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={config.excludeRecentlyContacted} onChange={e => setConfig({ ...config, excludeRecentlyContacted: e.target.checked })} className="w-4 h-4 rounded accent-[#06B6D4]" />
                <span className="text-sm text-slate-300">Exclude recently contacted</span>
              </label>
              {config.excludeRecentlyContacted && (
                <div className="ml-7"><label className="text-xs text-slate-500 mb-1 block">Days since contact</label>
                  <input type="number" value={config.daysSinceContact} onChange={e => setConfig({ ...config, daysSinceContact: parseInt(e.target.value) })} className="w-24 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-sm" />
                </div>
              )}
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={config.autoRetrain} onChange={e => setConfig({ ...config, autoRetrain: e.target.checked })} className="w-4 h-4 rounded accent-[#06B6D4]" />
                <span className="text-sm text-slate-300">Auto-retrain if accuracy drops</span>
              </label>
            </div>
            <div className="space-y-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">LLM Stack</h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">DM Enrichment</span><span className="text-[#06B6D4]">Vertex AI Gemini</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Email Personalization</span><span className="text-[#06B6D4]">Vertex AI Gemini</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Scoring Model</span><span className="text-emerald-400">BigQuery ML</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Fallback</span><span className="text-amber-400">Rules + heuristics</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DATA FLOW — EXPANDABLE NODES ═══ */}
      <div className="glass-card p-6 relative overflow-hidden border border-[#0f2432] bg-gradient-to-b from-[#050d14] via-[#040910] to-[#04070c]">
        {isRunning && <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#22D3EE]/80 to-transparent animate-scan z-10" />}
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Network className="w-5 h-5 text-[#22D3EE]" /> Data Flow
              {isRunning && <span className="text-[10px] tracking-wider uppercase rounded-full border border-[#22D3EE]/45 bg-[#22D3EE]/12 px-2 py-0.5 text-[#67E8F9] animate-pulse ml-1">Live Transfer</span>}
            </h3>
            <p className="text-xs text-slate-500 mt-1">Enterprise pipeline visibility for sync, enrichment, verification, training, and scoring.</p>
          </div>
          {status.step === 'complete' && <span className="text-xs text-emerald-400 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Complete</span>}
        </div>

        <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-lg border border-[#22D3EE]/20 bg-[#22D3EE]/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Current Stage</p>
            <p className="text-sm font-semibold text-[#67E8F9]">{status.step.toUpperCase()}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Clinics In Scope</p>
            <p className="text-sm font-semibold text-white">{Number(liveNumbers.clinics).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Verified DM</p>
            <p className="text-sm font-semibold text-emerald-300">{Number(liveNumbers.verifiedDmEmails).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Missing DM</p>
            <p className="text-sm font-semibold text-amber-300">{Number(liveNumbers.missingDmEmails).toLocaleString()}</p>
          </div>
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-[1160px] items-start gap-0">
          <PipelineNode icon={Database} label="Data Sync" sublabel="Supabase → BigQuery"
            active={status.step === 'syncing'} done={['enriching','verifying','training','scoring','complete'].includes(status.step)}
            stepNo={1}
            expanded={expandedNodes['sync']} onToggle={() => toggleNode('sync')}
            stats={liveNumbers.clinics > 0 ? [{ label: 'Clinics', value: liveNumbers.clinics.toLocaleString() }, { label: 'Leads', value: liveNumbers.leads.toLocaleString() }] : undefined}>
            <p>Paginated sync of clinics, leads, DM records, and engagement into <code className="text-[#22D3EE]">novalyte_intelligence</code>.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Tables</span><p className="text-white text-xs">clinics, patient_leads</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Batch Size</span><p className="text-white text-xs">500 rows/batch</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Includes</span><p className="text-white text-xs">DM emails, engagement</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Project</span><p className="text-white text-xs">warp-486714</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="syncing" />

          <PipelineNode icon={Search} label="DM Enrichment" sublabel="Apollo + Exa + Vertex AI"
            active={status.step === 'enriching' || dmEnrichmentRunning} done={['verifying','training','scoring','complete'].includes(status.step)}
            stepNo={2}
            expanded={expandedNodes['enrich']} onToggle={() => toggleNode('enrich')}
            stats={liveNumbers.enriched > 0 ? [{ label: 'DMs Found', value: liveNumbers.enriched.toLocaleString() }] : undefined}>
            <p>Multi-source enrichment finds owners/directors/managers and builds candidate DM contacts.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Apollo.io</span><p className="text-white text-xs">People search + email</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Exa AI</span><p className="text-white text-xs">Web scraping + LinkedIn</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Vertex AI</span><p className="text-white text-xs">Name/title extraction</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">RevenueBase</span><p className="text-white text-xs">Email verification</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="enriching" />

          <PipelineNode icon={CheckCircle} label="Verification Gate" sublabel="DM email quality checks"
            active={status.step === 'verifying'} done={['training','scoring','complete'].includes(status.step)}
            stepNo={3}
            expanded={expandedNodes['verify']} onToggle={() => toggleNode('verify')}
            stats={Number(liveNumbers.verifiedDmEmails) > 0 ? [
              { label: 'Verified', value: Number(liveNumbers.verifiedDmEmails).toLocaleString() },
              { label: 'Missing', value: Number(liveNumbers.missingDmEmails).toLocaleString() },
            ] : undefined}>
            <p>Scoring is blocked unless verified decision-maker email coverage passes the minimum quality threshold.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20"><span className="text-emerald-400 text-[10px] font-semibold">Verified</span><p className="text-white text-xs">{Number(liveNumbers.verifiedDmEmails).toLocaleString()}</p></div>
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20"><span className="text-amber-400 text-[10px] font-semibold">Risky</span><p className="text-white text-xs">{Number(liveNumbers.riskyDmEmails).toLocaleString()}</p></div>
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20"><span className="text-red-400 text-[10px] font-semibold">Invalid</span><p className="text-white text-xs">{Number(liveNumbers.invalidDmEmails).toLocaleString()}</p></div>
              <div className="p-2 rounded bg-slate-500/10 border border-slate-500/20"><span className="text-slate-400 text-[10px] font-semibold">Missing DM Email</span><p className="text-white text-xs">{Number(liveNumbers.missingDmEmails).toLocaleString()}</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="verifying" />

          <PipelineNode icon={Brain} label="ML Training" sublabel="BigQuery ML"
            active={status.step === 'training'} done={['scoring','complete'].includes(status.step)}
            stepNo={4}
            expanded={expandedNodes['train']} onToggle={() => toggleNode('train')}
            stats={liveNumbers.accuracy > 0 ? [{ label: 'Accuracy', value: `${(liveNumbers.accuracy * 100).toFixed(1)}%` }] : undefined}>
            <p>Logistic regression model trained on clinic conversion patterns. Falls back to heuristic scoring when training data is limited (&lt;10 conversions).</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Model Type</span><p className="text-white text-xs">LOGISTIC_REG</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Features</span><p className="text-white text-xs">Rating, reviews, affluence, engagement</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Heuristic Weights</span><p className="text-white text-xs">Affluence 35%, Rating 25%, Reviews 20%</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Auto-upgrade</span><p className="text-white text-xs">ML activates at 10+ conversions</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="scoring" />

          <PipelineNode icon={Target} label="Lead Scoring" sublabel="Hot / Warm / Cold"
            active={status.step === 'scoring'} done={status.step === 'complete'}
            stepNo={5}
            expanded={expandedNodes['score']} onToggle={() => toggleNode('score')}
            stats={liveNumbers.hot > 0 ? [{ label: 'Hot', value: liveNumbers.hot.toLocaleString() }, { label: 'Warm', value: liveNumbers.warm.toLocaleString() }] : undefined}>
            <p>Every clinic gets a 0-100% lead score based on conversion likelihood. Higher score = more likely to become a paying client.</p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20"><span className="text-red-400 text-[10px] font-semibold">HOT ≥70%</span><p className="text-white text-xs">Priority outreach</p></div>
              <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20"><span className="text-amber-400 text-[10px] font-semibold">WARM 40-69%</span><p className="text-white text-xs">Nurture sequence</p></div>
              <div className="p-2 rounded bg-slate-500/10 border border-slate-500/20"><span className="text-slate-400 text-[10px] font-semibold">COLD &lt;40%</span><p className="text-white text-xs">Low priority</p></div>
            </div>
          </PipelineNode>
          </div>
        </div>

        {/* ═══ SINGLE GAS PUMP LEAD SCORE ═══ */}
        {(pumpRolling || pumpScore > 0) && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#06B6D4]" />
              <span className="text-sm font-medium text-slate-300">Top Lead Score</span>
              {pumpRolling && <span className="text-xs text-[#06B6D4] animate-pulse">CALCULATING...</span>}
            </div>
            <div className="flex gap-3 items-center">
              <div className={cn('relative px-5 py-4 rounded-xl border text-center min-w-[120px] transition-all duration-500 bg-black',
                pumpRolling ? 'border-[#06B6D4]/40' :
                pumpScore >= 0.7 ? 'border-red-500/40' : pumpScore >= 0.4 ? 'border-amber-500/40' : 'border-slate-500/40')}>
                <div className="text-2xl"><GasPumpNumber value={pumpScore * 100} rolling={pumpRolling} suffix="%" /></div>
                {!pumpRolling && (
                  <div className={cn('text-[10px] font-semibold mt-1',
                    pumpScore >= 0.7 ? 'text-red-400' : pumpScore >= 0.4 ? 'text-amber-400' : 'text-slate-400')}>
                    {pumpScore >= 0.7 ? 'HOT' : pumpScore >= 0.4 ? 'WARM' : 'COLD'}
                  </div>
                )}
              </div>
              {!pumpRolling && pumpScore > 0 && (
                <p className="text-xs text-slate-500">Highest scoring prospect in this pipeline run</p>
              )}
            </div>
          </div>
        )}

        {/* Progress bar */}
        {status.step !== 'idle' && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 mb-2">
              {status.step === 'error' ? <AlertCircle className="w-4 h-4 text-red-400" /> :
               status.step === 'complete' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> :
               <Loader2 className="w-4 h-4 text-[#06B6D4] animate-spin" />}
              <span className={cn('text-sm font-medium', status.step === 'error' ? 'text-red-400' : 'text-slate-300')}>{status.message}</span>
            </div>
            {status.step !== 'error' && (
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#06B6D4] to-[#22D3EE] rounded-full transition-all duration-700 ease-out" style={{ width: `${status.progress}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ LIVE METRICS — CLICKABLE ═══ */}
      {status.step !== 'idle' && (
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
          {[
            { icon: Database, label: 'Clinics Synced', value: liveNumbers.clinics, color: '#06B6D4', metric: 'clinics' },
            { icon: Zap, label: 'Leads Synced', value: liveNumbers.leads, color: '#06B6D4', metric: 'leads' },
            { icon: Users, label: 'DMs Enriched', value: liveNumbers.enriched, color: '#10B981', metric: 'enriched' },
            { icon: CheckCircle, label: 'Verified DM Email', value: liveNumbers.verifiedDmEmails, color: '#10B981', metric: 'enriched' },
            { icon: AlertCircle, label: 'Missing DM Email', value: liveNumbers.missingDmEmails, color: '#64748b', metric: 'enriched' },
            { icon: Gauge, label: 'Accuracy', value: liveNumbers.accuracy, color: '#06B6D4', metric: 'accuracy' },
            { icon: Target, label: 'Hot Leads', value: liveNumbers.hot, color: '#EF4444', metric: 'hot' },
            { icon: Activity, label: 'Warm Leads', value: liveNumbers.warm, color: '#F59E0B', metric: 'warm' },
          ].map((m, i) => (
            <div key={i} onClick={() => openMetricDrill(m.metric)}
              className="glass-card p-4 relative overflow-hidden group cursor-pointer hover:border-[#06B6D4]/30 hover:bg-white/[0.03] transition-all">
              <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl transition-all group-hover:scale-125" style={{ backgroundColor: `${m.color}15` }} />
              <div className="relative">
                <div className="flex items-center gap-2 mb-1"><m.icon className="w-3.5 h-3.5" style={{ color: m.color }} /><span className="text-[10px] text-slate-500 uppercase tracking-wider">{m.label}</span></div>
                <p className="text-2xl font-bold text-white tabular-nums"><AnimatedNumber value={m.value} /></p>
                <p className="text-[9px] text-slate-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to drill down →</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ PROSPECTS TABLE WITH FILTERS + ACTIONS + DUPLICATE BADGES ═══ */}
      {topProspects.length > 0 && (
        <div className="glass-card overflow-hidden">
          {/* Header with actions */}
          <div className="px-6 py-4 border-b border-white/[0.06] bg-[#06B6D4]/5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#06B6D4]" /> Top Prospects
                <span className="text-xs text-slate-500 font-normal ml-2">{filteredProspects.length} of {topProspects.length}</span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={selectFilteredClinics} disabled={filteredProspects.length === 0}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                    filteredProspects.length > 0
                      ? 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                      : 'bg-white/5 text-slate-500 border-white/10 cursor-not-allowed')}>
                  <CheckSquare className="w-3.5 h-3.5" /> Select Filtered ({filteredProspects.length})
                </button>
                <button onClick={pushFilteredToCRM} disabled={pushingToCRM || filteredProspects.length === 0}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                    filteredProspects.length > 0
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-white/5 text-slate-500 border-white/10 cursor-not-allowed')}>
                  {pushingToCRM ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                  Push Filtered ({filteredProspects.length}) to CRM
                </button>
                {selectedClinics.size > 0 && (
                  <>
                    <button onClick={pushToCRM} disabled={pushingToCRM}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-all border border-emerald-500/30">
                      {pushingToCRM ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                      Push {selectedClinics.size} to CRM
                    </button>
                    <span className="text-xs text-slate-500">|</span>
                  </>
                )}
                <button onClick={verifyWithGoogleBeforeOutreach} disabled={googleVerifying || filteredProspects.length === 0}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                    googleVerifying ? 'bg-white/5 text-slate-500 border-white/10' :
                    'bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border-sky-500/30')}>
                  {googleVerifying
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Google {googleVerifyProgress.done}/{googleVerifyProgress.total}</>
                    : <><CheckCircle className="w-3.5 h-3.5" /> Verify w/ Google</>}
                </button>
                <button onClick={addToSequenceWithAI} disabled={addingToSequence || emailProspectCount === 0}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    addingToSequence ? 'bg-white/5 text-slate-500' :
                    emailProspectCount > 0 ? 'bg-[#06B6D4] text-black hover:bg-[#22D3EE]' : 'bg-white/5 text-slate-500 cursor-not-allowed')}>
                  {addingToSequence ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {sequenceProgress.sent}/{sequenceProgress.total} ({sequenceProgress.model})</> :
                    <><Send className="w-3.5 h-3.5" /> {selectedClinics.size > 0 ? `Push ${selectedClinics.size} to Email Outreach` : `Push ${filteredEmailProspectCount} to Email Outreach`}</>}
                </button>
                <button onClick={exportProspects} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-medium transition-all">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
                <div className="relative" style={{ zIndex: showAdsMenu ? 60 : 'auto' }}>
                  <button onClick={(e) => { e.stopPropagation(); setShowAdsMenu(!showAdsMenu); }} disabled={adsExporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#06B6D4]/10 hover:bg-[#06B6D4]/20 border border-[#06B6D4]/30 text-[#06B6D4] text-xs font-semibold transition-all">
                    {adsExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Google Ads Export
                  </button>
                  {showAdsMenu && (
                    <>
                      <div className="fixed inset-0" onClick={() => setShowAdsMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 bg-black border border-white/10 rounded-lg shadow-2xl py-1 min-w-[220px] animate-fade-in" style={{ zIndex: 61 }}>
                        <button onClick={() => { exportForGoogleAds('json'); setShowAdsMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 transition-colors">
                          <Brain className="w-3.5 h-3.5 text-[#06B6D4]" />
                          <div className="text-left"><p className="font-medium">JSON for AI Studio</p><p className="text-[10px] text-slate-500">Full data + market stats for ad builder</p></div>
                        </button>
                        <button onClick={() => { exportForGoogleAds('csv'); setShowAdsMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 transition-colors">
                          <Download className="w-3.5 h-3.5 text-emerald-400" />
                          <div className="text-left"><p className="font-medium">CSV for Ads Editor</p><p className="text-[10px] text-slate-500">Pre-formatted campaigns + ad groups</p></div>
                        </button>
                        <div className="border-t border-white/[0.06] my-1" />
                        <button onClick={() => { navigator.clipboard.writeText('https://us-central1-warp-486714.cloudfunctions.net/bigquery-ads-export'); toast.success('API endpoint copied'); setShowAdsMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 transition-colors">
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          <div className="text-left"><p className="font-medium">Copy API Endpoint</p><p className="text-[10px] text-slate-500">For direct AI Studio integration</p></div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5"><Filter className="w-3.5 h-3.5 text-slate-500" /><span className="text-xs text-slate-500">Filters:</span></div>
              <div className="flex gap-1">
                {(['all', 'hot', 'warm', 'cold'] as const).map(tier => (
                  <button key={tier} onClick={() => setFilterTier(tier)}
                    className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                      filterTier === tier ? 'bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30' : 'bg-white/5 text-slate-400 hover:bg-white/10')}>
                    {tier === 'all' ? 'All Tiers' : tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['all', 'with_email', 'no_email'] as const).map(opt => (
                  <button key={opt} onClick={() => setFilterEmail(opt)}
                    className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                      filterEmail === opt ? 'bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30' : 'bg-white/5 text-slate-400 hover:bg-white/10')}>
                    {opt === 'all' ? 'All' : opt === 'with_email' ? 'Has Email' : 'No Email'}
                  </button>
                ))}
              </div>
              <input type="text" placeholder="Search clinics..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs placeholder-slate-500 w-48" />
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-slate-500">View:</span>
                {([
                  { id: 'priority', label: 'Priority Queue' },
                  { id: 'cards', label: 'Cards' },
                  { id: 'table', label: 'Table' },
                ] as const).map(v => (
                  <button
                    key={v.id}
                    onClick={() => setProspectView(v.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                      prospectView === v.id
                        ? 'bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30'
                        : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sequence progress */}
            {addingToSequence && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#06B6D4] to-[#22D3EE] rounded-full transition-all duration-300"
                    style={{ width: `${sequenceProgress.total > 0 ? (sequenceProgress.sent / sequenceProgress.total) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-[#06B6D4] font-mono">{sequenceProgress.sent}/{sequenceProgress.total} via {sequenceProgress.model}</span>
              </div>
            )}
          </div>

          {/* Table */}
          <div className={cn('overflow-x-auto', prospectView !== 'table' && 'hidden')}>
            <table className="w-full">
              <thead>
                <tr className="text-slate-500 border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="py-3 px-3 w-10"><button onClick={selectAll} className="text-slate-500 hover:text-[#06B6D4]">
                    {selectedClinics.size === filteredProspects.length && filteredProspects.length > 0 ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                  </button></th>
                  <th className="text-left py-3 px-3 font-medium text-xs">#</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Clinic</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Location</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Contact</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Lead Score</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Tier</th>
                  <th className="text-left py-3 px-3 font-medium text-xs">Affluence</th>
                  <th className="text-left py-3 px-3 font-medium text-xs"></th>
                </tr>
              </thead>
              <tbody>
                {filteredProspects.map((p, i) => (
                  <tr key={`${p.clinic_id}-${i}`} className={cn('border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group',
                    selectedClinics.has(p.clinic_id) && 'bg-[#06B6D4]/5')}
                    onClick={() => openClinicIntel(p)}>
                    <td className="py-3 px-3">
                      <button onClick={() => toggleClinic(p.clinic_id)} className="text-slate-500 hover:text-[#06B6D4]">
                        {selectedClinics.has(p.clinic_id) ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="py-3 px-3">
                      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                        i < 3 ? 'bg-[#06B6D4] text-black' : i < 10 ? 'bg-[#06B6D4]/20 text-[#06B6D4]' : 'bg-white/5 text-slate-500')}>{i + 1}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="text-slate-200 font-medium text-sm">{p.name}</div>
                        {p.is_duplicate && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-semibold border border-amber-500/30 flex items-center gap-0.5">
                            <Copy className="w-2.5 h-2.5" /> DUP
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(p.services || []).slice(0, 2).map((s: string, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-300 text-sm">{p.city}, {p.state}</td>
                    <td className="py-3 px-3">
                      {p.phone && <div className="text-slate-300 text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> {p.phone}</div>}
                      {getProspectEmail(p) && <div className="text-slate-500 text-xs flex items-center gap-1 truncate max-w-[180px]"><Mail className="w-3 h-3" /> {getProspectEmail(p)}</div>}
                      {!p.phone && !getProspectEmail(p) && <span className="text-slate-600 text-xs">No contact</span>}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden w-16">
                          <div className={cn('h-full rounded-full transition-all duration-1000',
                            p.propensity_score >= 0.7 ? 'bg-gradient-to-r from-red-500 to-red-400' :
                            p.propensity_score >= 0.4 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
                            'bg-gradient-to-r from-slate-500 to-slate-400'
                          )} style={{ width: `${p.propensity_score * 100}%` }} />
                        </div>
                        <span className="text-[#06B6D4] font-bold text-xs tabular-nums min-w-[36px]">{(p.propensity_score * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold',
                        p.propensity_tier === 'hot' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        p.propensity_tier === 'warm' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                        'bg-slate-500/20 text-slate-400 border border-slate-500/30')}>{p.propensity_tier}</span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1"><Gauge className="w-3 h-3 text-[#06B6D4]" /><span className="text-slate-300 text-xs">{p.affluence_score}/10</span></div>
                    </td>
                    <td className="py-3 px-3">
                      <button onClick={(e) => { e.stopPropagation(); openClinicIntel(p); }} className="px-2.5 py-1 rounded-lg bg-[#06B6D4]/20 text-[#06B6D4] text-xs font-medium hover:bg-[#06B6D4]/30 transition-colors opacity-0 group-hover:opacity-100">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards View */}
          {prospectView === 'cards' && (
            <div className="p-4 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredProspects.map((p, i) => {
                const action = getRecommendedAction(p);
                const adCount = getAdSignalCount(p.ad_signals);
                return (
                  <button
                    key={`card-${p.clinic_id}-${i}`}
                    onClick={() => openClinicIntel(p)}
                    className="text-left rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] p-4 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.city}, {p.state}</p>
                      </div>
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold',
                        action === 'call_immediately' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                        action === 'email_sequence' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                        'bg-slate-500/20 text-slate-300 border border-slate-500/30')}>
                        {action === 'call_immediately' ? 'Call First' : action === 'email_sequence' ? 'Sequence' : 'Research'}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-[#06B6D4] font-bold">Intent {(Number(p.intent_score ?? computeIntentScore(p))).toFixed(0)}</span>
                      <span className="text-slate-400">Lead {(Number(p.propensity_score || 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>Ads: {adCount > 0 ? `${adCount} channels` : 'none detected'}</span>
                      <span>•</span>
                      <span>{p.propensity_tier}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Priority Queue View */}
          {prospectView === 'priority' && (
            <div className="p-4 space-y-2">
              {filteredProspects.map((p, i) => {
                const action = getRecommendedAction(p);
                return (
                  <button
                    key={`priority-${p.clinic_id}-${i}`}
                    onClick={() => openClinicIntel(p)}
                    className="w-full text-left rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] px-4 py-3 transition-all flex items-center gap-3"
                  >
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                      i < 3 ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-white/5 text-slate-400')}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-100 truncate">{p.name}</p>
                        <span className="text-[10px] text-slate-500">{p.city}, {p.state}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Intent {Number(p.intent_score ?? computeIntentScore(p)).toFixed(0)} • Lead {(Number(p.propensity_score || 0) * 100).toFixed(0)}% • Ads {getAdSignalCount(p.ad_signals)}
                      </p>
                    </div>
                    <span className={cn('text-[10px] px-2 py-1 rounded-full font-semibold',
                      action === 'call_immediately' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                      action === 'email_sequence' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                      'bg-slate-500/20 text-slate-300 border border-slate-500/30')}>
                      {action === 'call_immediately' ? 'Call Immediately' : action === 'email_sequence' ? 'Sequence Next' : 'Research First'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ 5-Day Drip Sequence Schedule ═══ */}
      {dripSequences.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-[#06B6D4]" /> Drip Sequences
            <span className="text-xs text-slate-500 font-normal">{dripSequences.length} sequence{dripSequences.length > 1 ? 's' : ''}</span>
          </h3>
          {dripSequences.slice(0, 3).map((seq: any, si: number) => (
            <div key={seq.id || si} className="mb-4 last:mb-0 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-slate-300">{seq.totalClinics} clinics · 5-day drip</p>
                  <p className="text-[10px] text-slate-500">Created {new Date(seq.createdAt).toLocaleString()}
                    {seq.pipeline && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">Phase: {(seq.pipeline || '').replace(/_/g, ' ')}</span>}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {(seq.schedule || []).map((day: any, di: number) => (
                  <div key={di} className={cn('p-2.5 rounded-lg border text-center transition-all',
                    day.status === 'sent' ? 'bg-emerald-500/10 border-emerald-500/30' :
                    day.status === 'sending' ? 'bg-[#06B6D4]/10 border-[#06B6D4]/30 animate-pulse' :
                    day.status === 'staged' ? 'bg-amber-500/10 border-amber-500/30' :
                    'bg-white/[0.02] border-white/[0.06]')}>
                    <p className="text-[10px] text-slate-500 mb-1">Day {day.day}</p>
                    <p className="text-sm font-bold text-slate-200">{day.clinics?.length || 0}</p>
                    <p className="text-[9px] mt-1">{day.sendDate}</p>
                    <span className={cn('text-[9px] font-semibold mt-1 inline-block',
                      day.status === 'sent' ? 'text-emerald-400' :
                      day.status === 'sending' ? 'text-[#06B6D4]' :
                      day.status === 'staged' ? 'text-amber-400' : 'text-slate-500')}>
                      {day.status === 'sent' ? `✓ ${day.sent} sent` : day.status === 'sending' ? 'Sending...' : day.status === 'staged' ? '⏳ Staged' : 'Scheduled'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Pipeline History ═══ */}
      {pipelineHistory.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4"><Clock className="w-5 h-5 text-slate-400" /> Pipeline History</h3>
          <div className="space-y-2">
            {pipelineHistory.map((run, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-3">
                  {run.status === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-red-400" />}
                  <div>
                    <p className="text-sm text-slate-300">{new Date(run.timestamp).toLocaleString()}</p>
                    {run.status === 'success' ? <p className="text-xs text-slate-500">{run.clinics} clinics · {run.leads} leads · {(run.accuracy * 100).toFixed(1)}% accuracy · {run.hotProspects} hot</p> : <p className="text-xs text-red-400">{run.error}</p>}
                  </div>
                </div>
                <span className="text-xs text-slate-500">{run.duration}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Prospect Detail Modal ═══ */}
      {selectedProspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedProspect(null)}>
          <div className="glass-card p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white">{selectedProspect.name}</h3>
                  {selectedProspect.is_duplicate && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-semibold border border-amber-500/30 flex items-center gap-0.5">
                      <Copy className="w-3 h-3" /> DUPLICATE
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400 mt-1">{selectedProspect.city}, {selectedProspect.state}</p>
              </div>
              <button onClick={() => setSelectedProspect(null)} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-8 mb-6">
              <ScoreGauge score={selectedProspect.propensity_score} />
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-500">Lead Score Tier</p>
                  <span className={cn('px-3 py-1 rounded-full text-sm font-semibold inline-block mt-1',
                    selectedProspect.propensity_tier === 'hot' ? 'bg-red-500/20 text-red-400' :
                    selectedProspect.propensity_tier === 'warm' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'
                  )}>{selectedProspect.propensity_tier}</span>
                </div>
                <div><p className="text-xs text-slate-500">Affluence Score</p><p className="text-lg font-bold text-[#06B6D4]">{selectedProspect.affluence_score}/10</p></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                  <p className="text-xs text-slate-500 mb-2">Contact Intel</p>
                  {selectedProspect.phone && <p className="text-sm text-slate-200 mb-1"><span className="text-slate-500">Phone:</span> {selectedProspect.phone}</p>}
                  {getProspectEmail(selectedProspect) && <p className="text-sm text-slate-200 mb-1"><span className="text-slate-500">Email:</span> {getProspectEmail(selectedProspect)}</p>}
                  {selectedProspect.dm_name && <p className="text-sm text-slate-200"><span className="text-slate-500">Decision Maker:</span> {selectedProspect.dm_name}</p>}
                  {!selectedProspect.phone && !getProspectEmail(selectedProspect) && !selectedProspect.dm_name && <p className="text-xs text-slate-500">No direct contact intel available</p>}
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
                  <p className="text-xs text-slate-500 mb-2">Business Intel</p>
                  <p className="text-sm text-slate-200 mb-1"><span className="text-slate-500">Website:</span> {selectedProspect.website || 'N/A'}</p>
                  <p className="text-sm text-slate-200 mb-1"><span className="text-slate-500">Rating:</span> {selectedProspect.rating ? `${selectedProspect.rating}/5` : 'N/A'}</p>
                  <p className="text-sm text-slate-200"><span className="text-slate-500">Reviews:</span> {selectedProspect.review_count || 0}</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#06B6D4]/5 border border-[#06B6D4]/20">
                <p className="text-xs text-slate-500 mb-2">Outreach Intel</p>
                <div className="grid md:grid-cols-3 gap-2 text-xs">
                  <p className="text-slate-300"><span className="text-slate-500">Tier:</span> {selectedProspect.propensity_tier || 'unknown'}</p>
                  <p className="text-slate-300"><span className="text-slate-500">Lead Score:</span> {((selectedProspect.propensity_score || 0) * 100).toFixed(0)}%</p>
                  <p className="text-slate-300"><span className="text-slate-500">Intent Score:</span> {Number(selectedProspect.intent_score ?? computeIntentScore(selectedProspect)).toFixed(0)}</p>
                </div>
                <div className="mt-2 text-xs text-slate-300">
                  <span className="text-slate-500">Ad Channels:</span>{' '}
                  {getAdSignalCount(selectedProspect.ad_signals) > 0
                    ? [
                        selectedProspect.ad_signals?.google ? 'Google' : null,
                        selectedProspect.ad_signals?.meta ? 'Meta' : null,
                        selectedProspect.ad_signals?.linkedin ? 'LinkedIn' : null,
                        selectedProspect.ad_signals?.reddit ? 'Reddit' : null,
                      ].filter(Boolean).join(', ')
                    : 'No paid channels detected'}
                </div>
                <div className="mt-2 text-xs">
                  <span className="text-slate-500">Best Course:</span>{' '}
                  <span className={cn(
                    'font-semibold',
                    getRecommendedAction(selectedProspect) === 'call_immediately' ? 'text-red-300' :
                    getRecommendedAction(selectedProspect) === 'email_sequence' ? 'text-amber-300' :
                    'text-slate-300'
                  )}>
                    {getRecommendedAction(selectedProspect) === 'call_immediately'
                      ? 'Call immediately before adding to sequence'
                      : getRecommendedAction(selectedProspect) === 'email_sequence'
                        ? 'Add to sequence with personalized opening'
                        : 'Research first, then outreach'}
                  </span>
                </div>
              </div>
              {selectedProspect.services?.length > 0 && (
                <div><p className="text-xs text-slate-500 mb-2">Services</p>
                  <div className="flex flex-wrap gap-2">{selectedProspect.services.map((s: string, i: number) => (
                    <span key={i} className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-slate-300">{s}</span>
                  ))}</div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-white/[0.06]">
              <button onClick={() => { toggleClinic(selectedProspect.clinic_id); setSelectedProspect(null); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/30 transition-all border border-emerald-500/30">
                <ArrowRight className="w-4 h-4" /> {selectedClinics.has(selectedProspect.clinic_id) ? 'Deselect' : 'Select for CRM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
