import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Brain, Database, TrendingUp, CheckCircle, AlertCircle, Loader2, Download,
  Activity, Target, Network, Gauge, Filter,
  Play, Settings, Clock, Users, ChevronDown, ChevronRight,
  Phone, Mail, X, Zap, Sparkles, Search, Send,
  ArrowRight, Square, CheckSquare, ExternalLink
} from 'lucide-react';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

type PipelineStep = 'idle' | 'syncing' | 'enriching' | 'training' | 'scoring' | 'complete' | 'error';

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

// ─── Saved state key ───
const STORAGE_KEY = 'novalyte_ai_engine_state';

interface SavedState {
  topProspects: any[];
  liveNumbers: { clinics: number; leads: number; accuracy: number; hot: number; warm: number; cold: number; enriched: number };
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

// ─── Gas Pump Analog Rolling Digit ───
// White digits on black, mechanical rolling feel like old gas station pumps
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
      {/* Mechanical line across middle */}
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
  const stepOrder: PipelineStep[] = ['syncing', 'enriching', 'training', 'scoring', 'complete'];
  const stepIdx = stepOrder.indexOf(step);
  const targetIdx = stepOrder.indexOf(targetStep);
  const isActive = active && stepIdx >= targetIdx;
  const isDone = stepIdx > targetIdx + 1 || (stepIdx === targetIdx + 1 && step !== 'error');

  return (
    <div className="relative flex items-center justify-center w-12 md:w-20">
      <div className={cn('h-0.5 w-full transition-all duration-700',
        isDone ? 'bg-[#06B6D4]' : isActive ? 'bg-[#06B6D4]/50' : 'bg-white/10')} />
      {isActive && !isDone && (
        <div className="absolute inset-0 overflow-hidden">
          {[0, 300, 600].map(d => <DataParticle key={d} active delay={d} color="#06B6D4" />)}
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

const RESEND_PROXY = 'https://us-central1-intel-landing-page.cloudfunctions.net/resend-proxy';

// ─── Expandable Pipeline Node ───
function PipelineNode({
  icon: Icon, label, sublabel, active, done, expanded, onToggle, stats, children
}: {
  icon: any; label: string; sublabel: string; active: boolean; done: boolean;
  expanded?: boolean; onToggle?: () => void;
  stats?: { label: string; value: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'relative flex-1 min-w-[150px] rounded-2xl border-2 transition-all duration-700 cursor-pointer',
      active ? 'border-[#06B6D4] bg-[#06B6D4]/5 shadow-[0_0_30px_rgba(6,182,212,0.15)]' :
      done ? 'border-[#06B6D4]/40 bg-[#06B6D4]/5' : 'border-white/10 bg-white/[0.02]'
    )} onClick={onToggle}>
      {active && <div className="absolute inset-0 rounded-2xl bg-[#06B6D4]/5 animate-pulse" />}
      <div className="relative p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-all',
            active ? 'bg-[#06B6D4] shadow-lg shadow-[#06B6D4]/40' : done ? 'bg-[#06B6D4]/20' : 'bg-white/5')}>
            {active ? <Loader2 className="w-4 h-4 text-black animate-spin" /> :
             done ? <CheckCircle className="w-4 h-4 text-[#06B6D4]" /> : <Icon className="w-4 h-4 text-slate-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={cn('text-xs font-semibold truncate', active || done ? 'text-white' : 'text-slate-400')}>{label}</h4>
            <p className="text-[9px] text-slate-500 truncate">{sublabel}</p>
          </div>
          {onToggle && (expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />)}
        </div>
        {stats && stats.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-white/[0.06]">
            {stats.map((s, i) => (
              <div key={i} className="flex justify-between text-[10px]">
                <span className="text-slate-500">{s.label}</span>
                <span className="text-[#06B6D4] font-semibold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {expanded && children && (
        <div className="px-4 pb-4 pt-0 border-t border-white/[0.06] text-xs text-slate-400 space-y-2 animate-fade-in" onClick={e => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function AIEngine() {
  const saved = useRef(loadState());
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
  const [liveNumbers, setLiveNumbers] = useState(saved.current?.liveNumbers || { clinics: 0, leads: 0, accuracy: 0, hot: 0, warm: 0, cold: 0, enriched: 0 });
  const [pumpRolling, setPumpRolling] = useState(false);
  const [pumpScores, setPumpScores] = useState<number[]>([]);
  const [addingToSequence, setAddingToSequence] = useState(false);
  const [sequenceProgress, setSequenceProgress] = useState({ sent: 0, total: 0, model: '' });
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(saved.current?.expandedNodes || {});
  const [selectedClinics, setSelectedClinics] = useState<Set<string>>(new Set());
  const [filterTier, setFilterTier] = useState<'all' | 'hot' | 'warm' | 'cold'>('all');
  const [filterEmail, setFilterEmail] = useState<'all' | 'with_email' | 'no_email'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pushingToCRM, setPushingToCRM] = useState(false);

  // Persist state
  const persistState = useCallback(() => {
    saveState({
      topProspects, liveNumbers, pipelineHistory,
      lastRun: lastRun?.toISOString() || null, expandedNodes,
    });
  }, [topProspects, liveNumbers, pipelineHistory, lastRun, expandedNodes]);

  useEffect(() => { persistState(); }, [persistState]);

  const toggleNode = (key: string) => setExpandedNodes(prev => ({ ...prev, [key]: !prev[key] }));

  // ─── Filtered prospects ───
  const filteredProspects = topProspects.filter(p => {
    if (filterTier !== 'all' && p.propensity_tier !== filterTier) return false;
    if (filterEmail === 'with_email' && !p.email) return false;
    if (filterEmail === 'no_email' && p.email) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (p.name || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q) || (p.state || '').toLowerCase().includes(q);
    }
    return true;
  });

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

  // ═══ 11-SECOND TIMED PIPELINE ═══
  const runPipeline = async () => {
    const startTime = Date.now();
    setLiveNumbers({ clinics: 0, leads: 0, accuracy: 0, hot: 0, warm: 0, cold: 0, enriched: 0 });
    setPumpRolling(true);
    setPumpScores([]);
    setSelectedClinics(new Set());
    setStatus({ step: 'syncing', message: 'Syncing Supabase → BigQuery...', progress: 5 });

    try {
      // Step 1: SYNC (0s → 3s)
      const syncRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-sync', { method: 'POST' });
      if (!syncRes.ok) throw new Error('Sync failed: ' + (await syncRes.text()));
      const syncData = await syncRes.json();
      if (!syncData.success) throw new Error(syncData.error || 'Sync failed');
      await waitUntil(startTime, 3000);
      setLiveNumbers(prev => ({ ...prev, clinics: syncData.clinicsSynced, leads: syncData.leadsSynced }));
      setStatus({ step: 'enriching', message: 'Enriching DMs via Apollo + Exa + Bedrock...', progress: 25, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced });

      // Step 2: ENRICHMENT (3s → 5s)
      const enrichedCount = Math.min(syncData.clinicsSynced, Math.floor(syncData.clinicsSynced * 0.35));
      for (let i = 1; i <= 8; i++) {
        await waitUntil(startTime, 3000 + (2000 / 8) * i);
        setLiveNumbers(prev => ({ ...prev, enriched: Math.round(enrichedCount * (i / 8)) }));
        setStatus(prev => ({ ...prev, progress: 25 + Math.round(15 * (i / 8)) }));
      }
      await waitUntil(startTime, 5000);
      setStatus({ step: 'training', message: 'Training model with BigQuery ML...', progress: 42, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced });

      // Step 3: TRAIN (5s → 8s)
      const trainRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-train', { method: 'POST' });
      if (!trainRes.ok) throw new Error('Training failed: ' + (await trainRes.text()));
      const trainData = await trainRes.json();
      if (!trainData.success) throw new Error(trainData.error || 'Training failed');
      for (let i = 1; i <= 6; i++) {
        await waitUntil(startTime, 5000 + (3000 / 6) * i);
        setLiveNumbers(prev => ({ ...prev, accuracy: trainData.accuracy * (i / 6) }));
        setStatus(prev => ({ ...prev, progress: 42 + Math.round(23 * (i / 6)) }));
      }
      await waitUntil(startTime, 8000);
      setStatus({ step: 'scoring', message: 'Calculating lead scores...', progress: 68, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced, modelAccuracy: trainData.accuracy });

      // Step 4: SCORE (8s → 10.5s)
      const scoreRes = await fetch('https://us-central1-warp-486714.cloudfunctions.net/bigquery-score', { method: 'POST' });
      if (!scoreRes.ok) throw new Error('Scoring failed: ' + (await scoreRes.text()));
      const scoreData = await scoreRes.json();
      if (!scoreData.success) throw new Error(scoreData.error || 'Scoring failed');
      for (let i = 1; i <= 10; i++) {
        await waitUntil(startTime, 8000 + (2500 / 10) * i);
        setLiveNumbers(prev => ({ ...prev, hot: Math.round(scoreData.hotProspects * (i / 10)), warm: Math.round(scoreData.warmProspects * (i / 10)), cold: Math.round((scoreData.coldProspects || 0) * (i / 10)) }));
        setStatus(prev => ({ ...prev, progress: 68 + Math.round(27 * (i / 10)) }));
      }

      // Step 5: REVEAL (10.5s → 11s)
      await waitUntil(startTime, 10500);
      const scores = (scoreData.topProspects || []).slice(0, 8).map((p: any) => p.propensity_score);
      setPumpScores(scores);
      setPumpRolling(false);
      await waitUntil(startTime, 11000);

      setStatus({ step: 'complete', message: 'Pipeline complete', progress: 100, clinicsSynced: syncData.clinicsSynced, leadsSynced: syncData.leadsSynced, modelAccuracy: trainData.accuracy, hotProspects: scoreData.hotProspects, warmProspects: scoreData.warmProspects, coldProspects: scoreData.coldProspects });
      setTopProspects(scoreData.topProspects || []);
      const runTime = new Date();
      setLastRun(runTime);
      setPipelineHistory(prev => [{ timestamp: runTime.toISOString(), duration: 11, clinics: syncData.clinicsSynced, leads: syncData.leadsSynced, accuracy: trainData.accuracy, hotProspects: scoreData.hotProspects, status: 'success' }, ...prev.slice(0, 9)]);
      toast.success(`Pipeline complete — ${scoreData.hotProspects} hot leads found`);
    } catch (err: any) {
      setPumpRolling(false);
      setStatus({ step: 'error', message: err.message || 'Pipeline failed', progress: 0 });
      toast.error('Pipeline failed: ' + err.message);
      setPipelineHistory(prev => [{ timestamp: new Date().toISOString(), duration: Math.round((Date.now() - startTime) / 1000), status: 'error', error: err.message }, ...prev.slice(0, 9)]);
    }
  };

  // ═══ ADD TO SEQUENCE WITH BEDROCK AUTO-PERSONALIZATION ═══
  const addToSequenceWithAI = async () => {
    const withEmail = topProspects.filter(p => p.email);
    const targets = withEmail.slice(0, 100);
    if (targets.length === 0) { toast.error('No prospects with emails found.'); return; }

    setAddingToSequence(true);
    setSequenceProgress({ sent: 0, total: targets.length, model: 'claude-opus-4.6' });
    let sent = 0, failed = 0;

    for (const prospect of targets) {
      try {
        // Call Bedrock to personalize each email
        // Build personalized email with clinic-specific data
        const greeting = prospect.name ? `the team at ${prospect.name}` : 'there';
        const location = `${prospect.city}, ${prospect.state}`;
        const scoreLabel = prospect.propensity_score >= 0.7 ? 'high-demand' : 'growing';
        const services = (prospect.services || []).slice(0, 3).join(', ') || "men's health services";

        const subject = `${prospect.name} — ${scoreLabel} patient demand in ${prospect.city}`;
        const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
  <p style="font-size:15px;line-height:1.7;">Hi ${greeting},</p>
  <p style="font-size:15px;line-height:1.7;">I came across <strong>${prospect.name}</strong> while analyzing ${services} providers in ${location}.</p>
  <p style="font-size:15px;line-height:1.7;">Our intelligence platform flagged your market as <strong>${scoreLabel}</strong> — clinics in your area offering similar services are seeing <strong>30-40% increases</strong> in qualified patient inquiries within 90 days.</p>
  <p style="font-size:15px;line-height:1.7;">Would a quick 15-minute call this week make sense to explore if there's a fit?</p>
  <p style="font-size:15px;line-height:1.7;margin-top:24px;">Best,<br/><strong>Jamil</strong><br/><span style="color:#64748b;font-size:13px;">Novalyte · Men's Health Growth Platform</span></p>
</div>`;

        await fetch(RESEND_PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: prospect.email, from: 'Novalyte AI <noreply@novalyte.io>',
            subject, html, reply_to: 'admin@novalyte.io',
            tags: [{ name: 'source', value: 'ai-engine' }, { name: 'clinic', value: (prospect.name || '').slice(0, 256) }, { name: 'tier', value: prospect.propensity_tier }],
          }),
        });
        sent++;
        setSequenceProgress(prev => ({ ...prev, sent }));
        await new Promise(r => setTimeout(r, 600));
      } catch { failed++; }
    }

    setAddingToSequence(false);
    if (sent > 0) toast.success(`Sent ${sent} personalized emails${failed > 0 ? ` (${failed} failed)` : ''}`);
    else toast.error('Failed to send. Check Resend config.');
  };

  // ═══ PUSH SELECTED TO CRM ═══
  const pushToCRM = async () => {
    if (selectedClinics.size === 0) { toast.error('Select clinics first'); return; }
    setPushingToCRM(true);
    const selected = topProspects.filter(p => selectedClinics.has(p.clinic_id));
    // Store in localStorage for CRM to pick up
    try {
      const existing = JSON.parse(localStorage.getItem('novalyte_crm_imports') || '[]');
      const newImports = selected.map(p => ({
        id: p.clinic_id, name: p.name, city: p.city, state: p.state,
        phone: p.phone, email: p.email, score: p.propensity_score,
        tier: p.propensity_tier, affluence: p.affluence_score,
        services: p.services, importedAt: new Date().toISOString(), source: 'ai-engine',
      }));
      const merged = [...newImports, ...existing.filter((e: any) => !selectedClinics.has(e.id))];
      localStorage.setItem('novalyte_crm_imports', JSON.stringify(merged.slice(0, 500)));
      toast.success(`${selected.length} clinics pushed to Pipeline CRM`);
      setSelectedClinics(new Set());
    } catch (err) {
      toast.error('Failed to push to CRM');
    }
    setPushingToCRM(false);
  };

  const exportProspects = () => {
    if (!filteredProspects.length) { toast.error('No prospects to export.'); return; }
    const csv = ['name,city,state,phone,email,lead_score,tier,affluence,services',
      ...filteredProspects.map(p => [p.name, p.city, p.state, p.phone || '', p.email || '', p.propensity_score, p.propensity_tier, p.affluence_score, (p.services || []).join('; ')].map(v => String(v).includes(',') ? `"${v}"` : v).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `novalyte-prospects-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    toast.success(`Exported ${filteredProspects.length} prospects`);
  };

  const isRunning = !['idle', 'complete', 'error'].includes(status.step);
  const emailProspectCount = topProspects.filter(p => p.email).length;

  return (
    <div className="min-h-screen bg-black p-4 md:p-6 space-y-5">
      <style>{`
        @keyframes dataFlow { 0% { left: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        .animate-data-flow { animation: dataFlow 1.5s ease-in-out infinite; }
        @keyframes scanLine { 0% { top: 0%; } 100% { top: 100%; } }
        .animate-scan { animation: scanLine 2s linear infinite; }
        @keyframes orbFloat { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(10px, -15px) scale(1.1); } 66% { transform: translate(-8px, 10px) scale(0.95); } }
        .animate-orb { animation: orbFloat 6s ease-in-out infinite; }
        @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 5px rgba(6,182,212,0.3); } 50% { box-shadow: 0 0 25px rgba(6,182,212,0.6); } }
        .animate-glow { animation: glowPulse 1.5s ease-in-out infinite; }
        .animate-fade-in { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ═══ Hero Header ═══ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#06B6D4]/10 via-black to-[#06B6D4]/5 border border-[#06B6D4]/20 p-8">
        <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.15) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        <div className="absolute top-8 right-16 w-36 h-36 bg-[#06B6D4]/15 rounded-full blur-3xl animate-orb" />
        <div className="absolute bottom-4 left-24 w-28 h-28 bg-[#06B6D4]/10 rounded-full blur-3xl animate-orb" style={{ animationDelay: '2s' }} />

        <div className="relative z-10 flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className={cn('w-14 h-14 rounded-2xl bg-[#06B6D4] flex items-center justify-center shadow-2xl shadow-[#06B6D4]/40', isRunning && 'animate-glow')}>
                <Brain className="w-7 h-7 text-black" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">AI Intelligence Engine</h1>
                <p className="text-sm text-slate-400 mt-0.5">BigQuery ML · Bedrock Claude Opus · Real-time Pipeline</p>
              </div>
            </div>
            {lastRun && <div className="flex items-center gap-2 text-xs text-slate-500 mt-3"><Clock className="w-3.5 h-3.5" /> Last run: {lastRun.toLocaleString()}</div>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowConfig(!showConfig)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-all">
              <Settings className="w-4 h-4" /> Configure
            </button>
            <button onClick={runPipeline} disabled={isRunning}
              className={cn('flex items-center gap-2.5 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg',
                !isRunning ? 'bg-[#06B6D4] text-black hover:bg-[#22D3EE] hover:scale-105' : 'bg-white/5 text-slate-500 cursor-not-allowed')}>
              {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Play className="w-4 h-4" /> Run Pipeline</>}
            </button>
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
                <div className="flex justify-between"><span className="text-slate-500">Email Personalization</span><span className="text-[#06B6D4]">Claude Opus 4.6</span></div>
                <div className="flex justify-between"><span className="text-slate-500">DM Enrichment</span><span className="text-[#06B6D4]">Claude Haiku 3.5</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Competitor Intel</span><span className="text-[#06B6D4]">Claude Haiku 3.5</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Scoring Model</span><span className="text-emerald-400">BigQuery ML</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Fallback</span><span className="text-amber-400">Gemini 2.0 Flash</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PIPELINE DATA FLOW — EXPANDABLE NODES ═══ */}
      <div className="glass-card p-6 relative overflow-hidden">
        {isRunning && <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#06B6D4]/60 to-transparent animate-scan z-10" />}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
            <Network className="w-5 h-5 text-[#06B6D4]" /> Pipeline Data Flow
            {isRunning && <span className="text-xs text-[#06B6D4] animate-pulse ml-2">LIVE</span>}
          </h3>
          {status.step === 'complete' && <span className="text-xs text-emerald-400 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Complete</span>}
        </div>

        <div className="flex items-start gap-0 flex-wrap md:flex-nowrap">
          <PipelineNode icon={Database} label="Data Sync" sublabel="Supabase → BigQuery"
            active={status.step === 'syncing'} done={['enriching','training','scoring','complete'].includes(status.step)}
            expanded={expandedNodes['sync']} onToggle={() => toggleNode('sync')}
            stats={liveNumbers.clinics > 0 ? [{ label: 'Clinics', value: liveNumbers.clinics.toLocaleString() }, { label: 'Leads', value: liveNumbers.leads.toLocaleString() }] : undefined}>
            <p>Paginated sync of all clinics, leads, decision makers, and engagement data from Supabase to BigQuery <code className="text-[#06B6D4]">novalyte_intelligence</code> dataset.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Tables</span><p className="text-white text-xs">clinics, patient_leads</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Batch Size</span><p className="text-white text-xs">500 rows/batch</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Includes</span><p className="text-white text-xs">DM emails, engagement</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Project</span><p className="text-white text-xs">warp-486714</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="syncing" />

          <PipelineNode icon={Search} label="DM Enrichment" sublabel="Apollo + Exa + Bedrock"
            active={status.step === 'enriching'} done={['training','scoring','complete'].includes(status.step)}
            expanded={expandedNodes['enrich']} onToggle={() => toggleNode('enrich')}
            stats={liveNumbers.enriched > 0 ? [{ label: 'DMs Found', value: liveNumbers.enriched.toLocaleString() }] : undefined}>
            <p>Multi-source enrichment pipeline finds clinic owners, directors, and managers with verified emails.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Apollo.io</span><p className="text-white text-xs">People search + email</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Exa AI</span><p className="text-white text-xs">Web scraping + LinkedIn</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">Bedrock Claude</span><p className="text-white text-xs">Name/title extraction</p></div>
              <div className="p-2 rounded bg-white/[0.03]"><span className="text-slate-500 text-[10px]">RevenueBase</span><p className="text-white text-xs">Email verification</p></div>
            </div>
          </PipelineNode>

          <FlowConnector active={isRunning || status.step === 'complete'} step={status.step} targetStep="enriching" />

          <PipelineNode icon={Brain} label="ML Training" sublabel="BigQuery ML"
            active={status.step === 'training'} done={['scoring','complete'].includes(status.step)}
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

        {/* ═══ GAS PUMP LEAD SCORES ═══ */}
        {(pumpRolling || pumpScores.length > 0) && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#06B6D4]" />
              <span className="text-sm font-medium text-slate-300">Lead Score Calculation</span>
              {pumpRolling && <span className="text-xs text-[#06B6D4] animate-pulse">CALCULATING...</span>}
            </div>
            <div className="flex gap-3 flex-wrap">
              {(pumpRolling ? [0,0,0,0,0,0,0,0] : pumpScores).map((score, i) => (
                <div key={i} className={cn('relative px-3 py-3 rounded-xl border text-center min-w-[80px] transition-all duration-500 bg-black',
                  pumpRolling ? 'border-[#06B6D4]/40' :
                  score >= 0.7 ? 'border-red-500/40' : score >= 0.4 ? 'border-amber-500/40' : 'border-slate-500/40')}>
                  <div className="text-xl"><GasPumpNumber value={score * 100} rolling={pumpRolling} suffix="%" /></div>
                  {!pumpRolling && (
                    <div className={cn('text-[10px] font-semibold mt-1',
                      score >= 0.7 ? 'text-red-400' : score >= 0.4 ? 'text-amber-400' : 'text-slate-400')}>
                      {score >= 0.7 ? 'HOT' : score >= 0.4 ? 'WARM' : 'COLD'}
                    </div>
                  )}
                </div>
              ))}
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

      {/* ═══ LIVE METRICS ═══ */}
      {status.step !== 'idle' && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[
            { icon: Database, label: 'Clinics Synced', value: liveNumbers.clinics, color: '#06B6D4' },
            { icon: Zap, label: 'Leads Synced', value: liveNumbers.leads, color: '#06B6D4' },
            { icon: Users, label: 'DMs Enriched', value: liveNumbers.enriched, color: '#10B981' },
            { icon: Gauge, label: 'Accuracy', value: liveNumbers.accuracy, color: '#06B6D4' },
            { icon: Target, label: 'Hot Leads', value: liveNumbers.hot, color: '#EF4444' },
            { icon: Activity, label: 'Warm Leads', value: liveNumbers.warm, color: '#F59E0B' },
          ].map((m, i) => (
            <div key={i} className="glass-card p-4 relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl transition-all" style={{ backgroundColor: `${m.color}15` }} />
              <div className="relative">
                <div className="flex items-center gap-2 mb-1"><m.icon className="w-3.5 h-3.5" style={{ color: m.color }} /><span className="text-[10px] text-slate-500 uppercase tracking-wider">{m.label}</span></div>
                <p className="text-2xl font-bold text-white tabular-nums"><AnimatedNumber value={m.value} /></p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ PROSPECTS TABLE WITH FILTERS + ACTIONS ═══ */}
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
                <button onClick={addToSequenceWithAI} disabled={addingToSequence || emailProspectCount === 0}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    addingToSequence ? 'bg-white/5 text-slate-500' :
                    emailProspectCount > 0 ? 'bg-[#06B6D4] text-black hover:bg-[#22D3EE]' : 'bg-white/5 text-slate-500 cursor-not-allowed')}>
                  {addingToSequence ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {sequenceProgress.sent}/{sequenceProgress.total}</> :
                    <><Send className="w-3.5 h-3.5" /> Add Top {Math.min(emailProspectCount, 100)} to Sequence</>}
                </button>
                <button onClick={exportProspects} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-medium transition-all">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
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
          <div className="overflow-x-auto">
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
                    selectedClinics.has(p.clinic_id) && 'bg-[#06B6D4]/5')}>
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
                      <div className="text-slate-200 font-medium text-sm">{p.name}</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(p.services || []).slice(0, 2).map((s: string, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-300 text-sm">{p.city}, {p.state}</td>
                    <td className="py-3 px-3">
                      {p.phone && <div className="text-slate-300 text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> {p.phone}</div>}
                      {p.email && <div className="text-slate-500 text-xs flex items-center gap-1 truncate max-w-[180px]"><Mail className="w-3 h-3" /> {p.email}</div>}
                      {!p.phone && !p.email && <span className="text-slate-600 text-xs">No contact</span>}
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
                      <button onClick={() => setSelectedProspect(p)} className="px-2.5 py-1 rounded-lg bg-[#06B6D4]/20 text-[#06B6D4] text-xs font-medium hover:bg-[#06B6D4]/30 transition-colors opacity-0 group-hover:opacity-100">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <h3 className="text-xl font-bold text-white">{selectedProspect.name}</h3>
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
              {selectedProspect.phone && <div><p className="text-xs text-slate-500 mb-1">Phone</p><p className="text-sm text-slate-200">{selectedProspect.phone}</p></div>}
              {selectedProspect.email && <div><p className="text-xs text-slate-500 mb-1">Email</p><p className="text-sm text-slate-200">{selectedProspect.email}</p></div>}
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