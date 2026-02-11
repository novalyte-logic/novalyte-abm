import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, BarChart3, Zap,
  ArrowUpRight, Building2, MapPin, Activity, Sparkles,
  ChevronRight, Heart, Syringe, Pill, Scissors, Droplets,
  ShieldCheck, CircleDot, X, Phone, Mail,
  Send, ExternalLink, Loader2, Square, CheckSquare,
  Calculator, SlidersHorizontal,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { generateRevenueForecast, RevenueForecast } from '../services/intelligenceService';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

const RESEND_PROXY = 'https://us-central1-intel-landing-page.cloudfunctions.net/resend-proxy';

/* ─── Service icons ─── */
const svcIcons: Record<string, typeof Heart> = {
  'TRT': Syringe, 'Testosterone': Syringe, 'Hormone': Syringe,
  'ED': Heart, 'Erectile': Heart, 'Sexual': Heart,
  'Peptide': Zap, 'GLP-1': Pill, 'Semaglutide': Pill, 'Tirzepatide': Pill,
  'Weight': Pill, 'Hair': Scissors, 'PRP': Droplets,
  'IV': Droplets, 'Anti-Aging': ShieldCheck, 'Aesthetics': ShieldCheck,
  'HGH': Syringe, 'Bioidentical': Syringe,
};
function getServiceIcon(name: string) {
  for (const [key, Icon] of Object.entries(svcIcons)) {
    if (name.includes(key)) return Icon;
  }
  return Activity;
}

/* ─── Color palette ─── */
const CHART_COLORS = [
  'from-emerald-500 to-emerald-600', 'from-blue-500 to-blue-600',
  'from-violet-500 to-violet-600', 'from-amber-500 to-amber-600',
  'from-rose-500 to-rose-600', 'from-cyan-500 to-cyan-600',
  'from-orange-500 to-orange-600', 'from-pink-500 to-pink-600',
];
const TEXT_COLORS = [
  'text-emerald-400', 'text-blue-400', 'text-violet-400', 'text-amber-400',
  'text-rose-400', 'text-cyan-400', 'text-orange-400', 'text-pink-400',
];
const BG_COLORS = [
  'bg-emerald-500/10', 'bg-blue-500/10', 'bg-violet-500/10', 'bg-amber-500/10',
  'bg-rose-500/10', 'bg-cyan-500/10', 'bg-orange-500/10', 'bg-pink-500/10',
];

/* ─── Drill-down Modal for clinics ─── */
function ClinicDrillDown({
  title, subtitle, clinics, onClose,
}: {
  title: string; subtitle: string; clinics: any[]; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [filterTier, setFilterTier] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  const filtered = clinics.filter(c => {
    if (search) {
      const q = search.toLowerCase();
      if (!(c.name || '').toLowerCase().includes(q) && !(c.city || '').toLowerCase().includes(q)) return false;
    }
    if (filterTier !== 'all') {
      const score = c.score || 0;
      if (filterTier === 'high' && score < 70) return false;
      if (filterTier === 'medium' && (score < 40 || score >= 70)) return false;
      if (filterTier === 'low' && score >= 40) return false;
    }
    return true;
  });

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  };

  const pushToCRM = () => {
    if (selected.size === 0) { toast.error('Select clinics first'); return; }
    const sel = clinics.filter(c => selected.has(c.id));
    try {
      const existing = JSON.parse(localStorage.getItem('novalyte_crm_imports') || '[]');
      const newImports = sel.map(c => ({
        id: c.id, name: c.name, city: c.city, state: c.state,
        phone: c.phone, email: c.email, score: (c.score || 0) / 100,
        tier: c.score >= 70 ? 'hot' : c.score >= 40 ? 'warm' : 'cold',
        affluence: c.affluence, services: c.services,
        importedAt: new Date().toISOString(), source: 'revenue-forecast',
      }));
      const merged = [...newImports, ...existing.filter((e: any) => !selected.has(e.id))];
      localStorage.setItem('novalyte_crm_imports', JSON.stringify(merged.slice(0, 500)));
      toast.success(`${sel.length} clinics pushed to Pipeline CRM`);
      setSelected(new Set());
    } catch { toast.error('Failed to push to CRM'); }
  };

  const addToSequence = async () => {
    const withEmail = clinics.filter(c => c.email);
    const targets = withEmail.slice(0, 100);
    if (targets.length === 0) { toast.error('No clinics with emails'); return; }
    setSending(true);
    setSendProgress({ sent: 0, total: targets.length });
    let sent = 0;
    for (const clinic of targets) {
      try {
        const subject = `${clinic.name} — patient demand growing in ${clinic.city}`;
        const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
  <p style="font-size:15px;line-height:1.7;">Hi ${clinic.name ? `the team at ${clinic.name}` : 'there'},</p>
  <p style="font-size:15px;line-height:1.7;">I came across your clinic while analyzing men's health providers in ${clinic.city}, ${clinic.state}.</p>
  <p style="font-size:15px;line-height:1.7;">Our intelligence platform shows strong patient demand in your area — clinics offering similar services are seeing <strong>30-40% increases</strong> in qualified patient inquiries within 90 days.</p>
  <p style="font-size:15px;line-height:1.7;">Would a quick 15-minute call this week make sense?</p>
  <p style="font-size:15px;line-height:1.7;margin-top:24px;">Best,<br/><strong>Jamil</strong><br/><span style="color:#64748b;font-size:13px;">Novalyte · Men's Health Growth Platform</span></p>
</div>`;
        await fetch(RESEND_PROXY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: clinic.email, from: 'Novalyte AI <noreply@novalyte.io>', subject, html, reply_to: 'admin@novalyte.io',
            tags: [{ name: 'source', value: 'revenue-forecast' }, { name: 'clinic', value: (clinic.name || '').slice(0, 256) }] }),
        });
        sent++;
        setSendProgress(p => ({ ...p, sent }));
        await new Promise(r => setTimeout(r, 600));
      } catch {}
    }
    setSending(false);
    if (sent > 0) toast.success(`Sent ${sent} personalized emails`);
    else toast.error('Failed to send');
  };

  const emailCount = clinics.filter(c => c.email).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] bg-[#06B6D4]/5 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <button onClick={pushToCRM} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 border border-emerald-500/30">
                <ExternalLink className="w-3.5 h-3.5" /> Push {selected.size} to CRM
              </button>
            )}
            <button onClick={addToSequence} disabled={sending || emailCount === 0}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                sending ? 'bg-white/5 text-slate-500' : emailCount > 0 ? 'bg-[#06B6D4] text-black hover:bg-[#22D3EE]' : 'bg-white/5 text-slate-500 cursor-not-allowed')}>
              {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {sendProgress.sent}/{sendProgress.total}</> :
                <><Send className="w-3.5 h-3.5" /> Sequence {Math.min(emailCount, 100)} w/ Email</>}
            </button>
            <div className="flex gap-1 ml-2">
              {(['all', 'high', 'medium', 'low'] as const).map(t => (
                <button key={t} onClick={() => setFilterTier(t)}
                  className={cn('px-2 py-1 rounded-lg text-[10px] font-medium',
                    filterTier === t ? 'bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30' : 'bg-white/5 text-slate-400 hover:bg-white/10')}>
                  {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs placeholder-slate-500 w-40 ml-auto" />
          </div>
        </div>
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.06] bg-white/[0.02] sticky top-0 z-10">
                <th className="py-2.5 px-3 w-10"><button onClick={selectAll} className="text-slate-500 hover:text-[#06B6D4]">
                  {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                </button></th>
                <th className="text-left py-2.5 px-3 font-medium text-xs">Clinic</th>
                <th className="text-left py-2.5 px-3 font-medium text-xs">Location</th>
                <th className="text-left py-2.5 px-3 font-medium text-xs">Contact</th>
                <th className="text-left py-2.5 px-3 font-medium text-xs">Score</th>
                <th className="text-left py-2.5 px-3 font-medium text-xs">Services</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id || i} className={cn('border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors',
                  selected.has(c.id) && 'bg-[#06B6D4]/5')}>
                  <td className="py-2.5 px-3">
                    <button onClick={() => toggle(c.id)} className="text-slate-500 hover:text-[#06B6D4]">
                      {selected.has(c.id) ? <CheckSquare className="w-4 h-4 text-[#06B6D4]" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="py-2.5 px-3"><p className="text-slate-200 font-medium text-sm">{c.name}</p></td>
                  <td className="py-2.5 px-3 text-slate-400 text-xs">{c.city}, {c.state}</td>
                  <td className="py-2.5 px-3">
                    {c.phone && <p className="text-slate-300 text-[10px] flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</p>}
                    {c.email && <p className="text-[#06B6D4] text-[10px] truncate max-w-[160px] flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</p>}
                    {!c.phone && !c.email && <span className="text-slate-600 text-[10px]">—</span>}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', c.score >= 70 ? 'bg-emerald-500' : c.score >= 40 ? 'bg-amber-500' : 'bg-slate-500')}
                          style={{ width: `${c.score}%` }} />
                      </div>
                      <span className="text-xs font-bold text-slate-300 tabular-nums">{c.score}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex gap-1 flex-wrap">{(c.services || []).slice(0, 2).map((s: string, idx: number) => (
                      <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-slate-400">{s}</span>
                    ))}</div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-500">No clinics match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Animated counter ─── */
function AnimatedNum({ value, prefix = '', suffix = '', decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const start = display;
    const diff = value - start;
    const startTime = Date.now();
    const duration = 1200;
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);
  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString();
  return <>{prefix}{formatted}{suffix}</>;
}

/* ─── Pulsing confidence ring ─── */
function ConfidenceRing({ confidence }: { confidence: number }) {
  const [anim, setAnim] = useState(0);
  useEffect(() => { const t = setTimeout(() => setAnim(confidence), 300); return () => clearTimeout(t); }, [confidence]);
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (anim / 100) * circumference;
  const color = confidence >= 60 ? '#10B981' : confidence >= 40 ? '#F59E0B' : '#64748B';
  return (
    <div className="relative w-16 h-16">
      <svg width={64} height={64} className="-rotate-90">
        <circle cx={32} cy={32} r={28} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
        <circle cx={32} cy={32} r={28} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-white tabular-nums">{Math.round(anim)}%</span>
      </div>
    </div>
  );
}

export default function RevenueForecastPage() {
  const { contacts, sentEmails, callHistory, setCurrentView } = useAppStore();
  const [drillDown, setDrillDown] = useState<{ title: string; subtitle: string; clinics: any[] } | null>(null);
  const [selectedVertical, setSelectedVertical] = useState<string | null>(null);
  const [customLeadPrice, setCustomLeadPrice] = useState<number | null>(null);
  const [customLeadsPerClinic, setCustomLeadsPerClinic] = useState<number>(20);
  const [customCloseRate, setCustomCloseRate] = useState<number | null>(null);

  const forecast = useMemo<RevenueForecast | null>(() => {
    if (contacts.length === 0) return null;
    const callData = callHistory.map(c => ({ contactId: c.contactId, outcome: c.outcome }));
    return generateRevenueForecast(contacts, sentEmails, callData);
  }, [contacts, sentEmails, callHistory]);

  // Build clinic lookup by service vertical — uses same label normalization as forecast
  const clinicsByService = useMemo(() => {
    const map = new Map<string, any[]>();
    // Build a mapping from raw service keywords to normalized forecast labels
    const SERVICE_LABEL_MAP: Record<string, string> = {
      trt: 'TRT / Hormone Therapy', testosterone: 'Testosterone Therapy', hormone: 'Hormone Optimization',
      ed: 'ED Treatment', erectile: 'Erectile Dysfunction', sexual: 'Sexual Health',
      peptide: 'Peptide Therapy', 'glp-1': 'GLP-1 / Weight Loss', semaglutide: 'Semaglutide',
      tirzepatide: 'Tirzepatide', weight: 'Weight Management', hair: 'Hair Restoration',
      prp: 'PRP Therapy', iv: 'IV Therapy', 'anti-aging': 'Anti-Aging', aesthetic: 'Aesthetics',
      hgh: 'HGH Therapy', bioidentical: 'Bioidentical Hormones',
    };

    for (const c of contacts) {
      const labelsAdded = new Set<string>();
      for (const svc of c.clinic.services || []) {
        const lower = svc.toLowerCase();
        // Match to normalized labels (same logic as matchServiceEconomics)
        for (const [key, label] of Object.entries(SERVICE_LABEL_MAP)) {
          if (lower.includes(key) && !labelsAdded.has(label)) {
            labelsAdded.add(label);
            if (!map.has(label)) map.set(label, []);
            map.get(label)!.push({
              id: c.id, name: c.clinic.name,
              city: c.clinic.address.city, state: c.clinic.address.state,
              phone: c.clinic.phone, email: c.decisionMaker?.email || c.clinic.managerEmail || c.clinic.email,
              score: c.score, services: c.clinic.services,
              affluence: c.clinic.marketZone.affluenceScore,
            });
          }
        }
        // If no match, add under general label
        if (labelsAdded.size === 0) {
          const genLabel = "Men's Health (General)";
          if (!map.has(genLabel)) map.set(genLabel, []);
          map.get(genLabel)!.push({
            id: c.id, name: c.clinic.name,
            city: c.clinic.address.city, state: c.clinic.address.state,
            phone: c.clinic.phone, email: c.decisionMaker?.email || c.clinic.managerEmail || c.clinic.email,
            score: c.score, services: c.clinic.services,
            affluence: c.clinic.marketZone.affluenceScore,
          });
        }
      }
    }
    return map;
  }, [contacts]);

  // Build clinic lookup by market
  const clinicsByMarket = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const c of contacts) {
      const key = `${c.clinic.marketZone.city}, ${c.clinic.marketZone.state}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({
        id: c.id, name: c.clinic.name,
        city: c.clinic.address.city, state: c.clinic.address.state,
        phone: c.clinic.phone, email: c.decisionMaker?.email || c.clinic.managerEmail || c.clinic.email,
        score: c.score, services: c.clinic.services,
        affluence: c.clinic.marketZone.affluenceScore,
      });
    }
    return map;
  }, [contacts]);

  // Find clinics for a service vertical — exact match on normalized labels, deduped
  const getClinicsForService = useCallback((serviceLabel: string) => {
    // Exact match first (labels now match between forecast and our map)
    const exact = clinicsByService.get(serviceLabel);
    if (exact && exact.length > 0) {
      // Deduplicate by clinic id
      const seen = new Set<string>();
      return exact.filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      }).sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Fuzzy fallback — check all keys for partial match
    const results: any[] = [];
    const seen = new Set<string>();
    for (const [key, clinics] of clinicsByService) {
      if (key.toLowerCase().includes(serviceLabel.toLowerCase()) || serviceLabel.toLowerCase().includes(key.toLowerCase())) {
        for (const c of clinics) {
          if (!seen.has(c.id)) { seen.add(c.id); results.push(c); }
        }
      }
    }
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [clinicsByService]);

  const openServiceDrill = (svc: { service: string; clinics: number; avgCPL: number }) => {
    const clinics = getClinicsForService(svc.service);
    setDrillDown({
      title: svc.service,
      subtitle: `${clinics.length} clinics · $${svc.avgCPL}/lead avg · Likely buyers sorted by score`,
      clinics,
    });
  };

  const openMarketDrill = (mkt: { market: string; clinics: number; avgAffluence: number }) => {
    const clinics = clinicsByMarket.get(mkt.market) || [];
    setDrillDown({
      title: mkt.market,
      subtitle: `${clinics.length} clinics · Affluence ${mkt.avgAffluence}/10`,
      clinics: clinics.sort((a, b) => (b.score || 0) - (a.score || 0)),
    });
  };

  if (!forecast) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center mb-6">
          <DollarSign className="w-10 h-10 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Revenue Forecast</h2>
        <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
          Add clinics to your pipeline to see lead pricing, revenue projections, and ROI analysis.
        </p>
        <button onClick={() => setCurrentView('clinics')} className="btn btn-primary gap-2">
          <Building2 className="w-4 h-4" /> Discover Clinics
        </button>
      </div>
    );
  }

  const maxSvcRevenue = Math.max(...forecast.serviceBreakdown.map(s => s.monthlyRevenue), 1);
  const maxMarketRevenue = Math.max(...forecast.topMarkets.map(m => m.projected), 1);

  // Dynamic confidence based on selected vertical
  const activeConfidence = useMemo(() => {
    if (!selectedVertical) return forecast.confidence;
    const svc = forecast.serviceBreakdown.find(v => v.service === selectedVertical);
    if (!svc) return forecast.confidence;
    const clinics = getClinicsForService(svc.service);
    const withEmail = clinics.filter(c => c.email).length;
    const highScore = clinics.filter(c => c.score >= 70).length;
    let conf = 20;
    if (clinics.length >= 5) conf += 10;
    if (clinics.length >= 20) conf += 10;
    if (clinics.length >= 50) conf += 10;
    if (withEmail >= 5) conf += 10;
    if (withEmail >= 20) conf += 10;
    if (highScore >= 3) conf += 10;
    if (highScore >= 10) conf += 10;
    if (svc.avgCPL > 0) conf += 5;
    return Math.min(95, conf);
  }, [selectedVertical, forecast, getClinicsForService]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto animate-fade-in">
      {drillDown && <ClinicDrillDown {...drillDown} onClose={() => setDrillDown(null)} />}

      {/* ═══ Header ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Revenue Forecast</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-3 h-3" /> Live
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Real-time projections from {forecast.totalClinics} clinics across {forecast.topMarkets.length} markets · Updates as pipeline changes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceRing confidence={activeConfidence} />
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Confidence</p>
            <p className={cn('text-sm font-semibold',
              activeConfidence >= 60 ? 'text-emerald-400' : activeConfidence >= 40 ? 'text-amber-400' : 'text-slate-400'
            )}>{activeConfidence >= 60 ? 'High' : activeConfidence >= 40 ? 'Moderate' : 'Low'}</p>
            <p className="text-[9px] text-slate-600 mt-0.5">
              {selectedVertical ? `${selectedVertical}` : `${forecast.qualifiedClinics > 0 ? `${forecast.qualifiedClinics} qualified` : `${forecast.clinicsWithEmail} w/ email`}`} · {sentEmails.length} emails sent
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Hero Numbers ═══ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Monthly Revenue — animated */}
        <div className="col-span-12 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-emerald-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Projected Monthly</p>
              <p className="text-3xl font-bold text-emerald-400 tabular-nums leading-none mt-0.5">
                $<AnimatedNum value={forecast.monthlyRevenue >= 1000 ? forecast.monthlyRevenue / 1000 : forecast.monthlyRevenue} decimals={forecast.monthlyRevenue >= 1000 ? 1 : 0} suffix={forecast.monthlyRevenue >= 1000 ? 'k' : ''} />
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Quarterly</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">$<AnimatedNum value={forecast.quarterlyRevenue / 1000} decimals={1} suffix="k" /></p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Annual</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">$<AnimatedNum value={forecast.annualRevenue / 1000} decimals={0} suffix="k" /></p>
            </div>
          </div>
          <p className="text-[9px] text-slate-600 mt-3 text-center">
            Adjusts in real-time as clinics qualify, emails open, and calls convert
          </p>
        </div>

        {/* Lead Pricing Card */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-novalyte-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-novalyte-500 to-novalyte-600 flex items-center justify-center shadow-lg shadow-novalyte-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Lead Price</p>
              <p className="text-3xl font-bold text-novalyte-400 tabular-nums leading-none mt-0.5">$<AnimatedNum value={forecast.avgLeadPrice} /></p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span>${forecast.leadPriceRange.low}</span><span>Price Range</span><span>${forecast.leadPriceRange.high}</span>
            </div>
            <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 bg-gradient-to-r from-emerald-500/40 via-novalyte-500/60 to-orange-500/40 rounded-full" style={{ left: '0%', right: '0%' }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-novalyte-400"
                style={{ left: `${Math.min(95, Math.max(5, ((forecast.avgLeadPrice - forecast.leadPriceRange.low) / (forecast.leadPriceRange.high - forecast.leadPriceRange.low)) * 100))}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Leads/Client/Mo</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">{forecast.estimatedLeadsPerClinic}</p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Rev/Client/Mo</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">${(forecast.estimatedLeadsPerClinic * forecast.avgLeadPrice).toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Clinic ROI Card */}
        <div className="col-span-12 sm:col-span-6 lg:col-span-4 glass-card p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-violet-500/8 to-transparent rounded-bl-full pointer-events-none" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Clinic ROI</p>
              <p className="text-3xl font-bold text-violet-400 tabular-nums leading-none mt-0.5"><AnimatedNum value={forecast.roiForClinic} decimals={1} suffix="x" /></p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
            For every $1 a clinic spends on leads, they generate ${forecast.roiForClinic.toFixed(2)} in patient lifetime value
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Patient LTV</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums">$<AnimatedNum value={forecast.avgPatientLTV / 1000} decimals={1} suffix="k" /></p>
            </div>
            <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.04]">
              <p className="text-[10px] text-slate-500">Close Rate</p>
              <p className="text-lg font-bold text-slate-200 tabular-nums"><AnimatedNum value={forecast.avgCloseRate} suffix="%" /></p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Vertical Revenue Calculator ═══ */}
      {forecast.serviceBreakdown.length > 0 && (() => {
        const verticals = forecast.serviceBreakdown;
        const active = selectedVertical ? verticals.find(v => v.service === selectedVertical) || verticals[0] : verticals[0];
        const activeClinics = getClinicsForService(active.service);
        const totalInVertical = activeClinics.length;
        const withEmail = activeClinics.filter(c => c.email).length;
        const leadPrice = customLeadPrice ?? active.avgCPL;
        const leadsPerClinic = customLeadsPerClinic;
        const closeRate = customCloseRate ?? forecast.avgCloseRate;
        const projectedMonthly = totalInVertical * leadPrice * leadsPerClinic;
        const projectedQuarterly = projectedMonthly * 3;
        const projectedAnnual = projectedMonthly * 12;
        const activeIdx = verticals.indexOf(active);
        const textColor = TEXT_COLORS[activeIdx >= 0 ? activeIdx % TEXT_COLORS.length : 0];
        const bgColor = BG_COLORS[activeIdx >= 0 ? activeIdx % BG_COLORS.length : 0];
        const Icon = getServiceIcon(active.service);

        return (
          <div className="glass-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#06B6D4] to-[#0891B2] flex items-center justify-center shadow-lg shadow-[#06B6D4]/20">
                  <Calculator className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Vertical Revenue Calculator</h3>
                  <p className="text-[10px] text-slate-600">Select a vertical to see projected monthly earnings if all clinics close</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[10px] text-slate-500">Adjust sliders to model scenarios</span>
              </div>
            </div>
            <div className="p-6">
              {/* Vertical selector pills */}
              <div className="flex flex-wrap gap-2 mb-6">
                {verticals.map((v, i) => {
                  const VIcon = getServiceIcon(v.service);
                  const isActive = v.service === active.service;
                  return (
                    <button key={v.service} onClick={() => { setSelectedVertical(v.service); setCustomLeadPrice(null); setCustomCloseRate(null); }}
                      className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all border',
                        isActive ? 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30 shadow-lg shadow-[#06B6D4]/10' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06] hover:text-slate-200')}>
                      <VIcon className="w-3.5 h-3.5" />
                      {v.service}
                      <span className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-bold',
                        isActive ? 'bg-[#06B6D4]/20 text-[#06B6D4]' : 'bg-white/5 text-slate-500')}>
                        {getClinicsForService(v.service).length}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-12 gap-6">
                {/* Left: Controls */}
                <div className="col-span-12 lg:col-span-5 space-y-5">
                  {/* Active vertical info */}
                  <div className="flex items-center gap-3 p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
                    <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', bgColor)}>
                      <Icon className={cn('w-6 h-6', textColor)} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{active.service}</p>
                      <p className="text-[10px] text-slate-500">{totalInVertical} clinics · {withEmail} with email · LTV ${(active.patientLTV / 1000).toFixed(1)}k</p>
                    </div>
                  </div>

                  {/* Lead Price slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-slate-400">Lead Price</label>
                      <span className="text-sm font-bold text-[#06B6D4] tabular-nums">${leadPrice}</span>
                    </div>
                    <input type="range" min={50} max={800} step={10} value={leadPrice}
                      onChange={e => setCustomLeadPrice(Number(e.target.value))}
                      className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-[#06B6D4] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06B6D4] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#06B6D4]/30" />
                    <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>$50</span><span>$800</span></div>
                  </div>

                  {/* Leads per clinic slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-slate-400">Leads / Clinic / Month</label>
                      <span className="text-sm font-bold text-[#06B6D4] tabular-nums">{leadsPerClinic}</span>
                    </div>
                    <input type="range" min={5} max={60} step={1} value={leadsPerClinic}
                      onChange={e => setCustomLeadsPerClinic(Number(e.target.value))}
                      className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-[#06B6D4] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06B6D4] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#06B6D4]/30" />
                    <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>5</span><span>60</span></div>
                  </div>

                  {/* Close rate slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-slate-400">Close Rate</label>
                      <span className="text-sm font-bold text-[#06B6D4] tabular-nums">{closeRate}%</span>
                    </div>
                    <input type="range" min={5} max={80} step={1} value={closeRate}
                      onChange={e => setCustomCloseRate(Number(e.target.value))}
                      className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-[#06B6D4] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#06B6D4] [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-[#06B6D4]/30" />
                    <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>5%</span><span>80%</span></div>
                  </div>

                  {/* Reset button */}
                  {(customLeadPrice !== null || customCloseRate !== null || customLeadsPerClinic !== 20) && (
                    <button onClick={() => { setCustomLeadPrice(null); setCustomCloseRate(null); setCustomLeadsPerClinic(20); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
                      ↺ Reset to defaults
                    </button>
                  )}
                </div>

                {/* Right: Projected numbers */}
                <div className="col-span-12 lg:col-span-7 space-y-4">
                  {/* Big projected monthly */}
                  <div className="p-6 bg-gradient-to-br from-[#06B6D4]/10 to-emerald-500/5 rounded-2xl border border-[#06B6D4]/20 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Projected Monthly Revenue</p>
                    <p className="text-4xl font-bold text-[#06B6D4] tabular-nums">
                      $<AnimatedNum value={projectedMonthly >= 1000000 ? projectedMonthly / 1000000 : projectedMonthly / 1000}
                        decimals={projectedMonthly >= 1000000 ? 2 : 1} suffix={projectedMonthly >= 1000000 ? 'M' : 'k'} />
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      If all {totalInVertical} {active.service} clinics close at ${leadPrice}/lead × {leadsPerClinic} leads/mo
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04] text-center">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider">Quarterly</p>
                      <p className="text-lg font-bold text-slate-200 tabular-nums">
                        $<AnimatedNum value={projectedQuarterly / 1000} decimals={1} suffix="k" />
                      </p>
                    </div>
                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04] text-center">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider">Annual</p>
                      <p className="text-lg font-bold text-emerald-400 tabular-nums">
                        $<AnimatedNum value={projectedAnnual >= 1000000 ? projectedAnnual / 1000000 : projectedAnnual / 1000}
                          decimals={projectedAnnual >= 1000000 ? 2 : 1} suffix={projectedAnnual >= 1000000 ? 'M' : 'k'} />
                      </p>
                    </div>
                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.04] text-center">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider">Per Clinic/Mo</p>
                      <p className="text-lg font-bold text-slate-200 tabular-nums">
                        $<AnimatedNum value={leadPrice * leadsPerClinic} />
                      </p>
                    </div>
                  </div>

                  {/* Breakdown math */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.04]">
                    <p className="text-[10px] text-slate-500 mb-3 font-medium">Revenue Math</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{totalInVertical} clinics × ${leadPrice}/lead × {leadsPerClinic} leads</span>
                        <span className="text-xs font-bold text-[#06B6D4] tabular-nums">${projectedMonthly.toLocaleString()}/mo</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Patient LTV at {closeRate}% close rate</span>
                        <span className="text-xs font-bold text-emerald-400 tabular-nums">
                          ${Math.round(active.patientLTV * (closeRate / 100)).toLocaleString()}/patient
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Clinic ROI</span>
                        <span className="text-xs font-bold text-violet-400 tabular-nums">
                          {(((closeRate / 100) * active.patientLTV) / leadPrice).toFixed(1)}x
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Conversion Funnel ═══ */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Activity className="w-4 h-4 text-novalyte-400" />
          <h3 className="text-sm font-semibold text-slate-200">Conversion Funnel</h3>
          <span className="text-[9px] text-slate-600 ml-2">Live pipeline metrics</span>
        </div>
        <div className="flex items-center gap-2">
          {[
            { label: 'Total Clinics', value: forecast.totalClinics, color: 'from-slate-500 to-slate-600', width: 100 },
            { label: 'With Email', value: forecast.clinicsWithEmail, color: 'from-blue-500 to-blue-600', width: forecast.totalClinics ? (forecast.clinicsWithEmail / forecast.totalClinics) * 100 : 0 },
            { label: 'Qualified', value: forecast.qualifiedClinics, color: 'from-amber-500 to-amber-600', width: forecast.totalClinics ? (forecast.qualifiedClinics / forecast.totalClinics) * 100 : 0 },
            { label: 'Projected Clients', value: forecast.projectedClients, color: 'from-emerald-500 to-emerald-600', width: forecast.totalClinics ? (forecast.projectedClients / forecast.totalClinics) * 100 : 0 },
          ].map((step, i, arr) => (
            <div key={step.label} className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-slate-500">{step.label}</span>
                  <span className="text-sm font-bold text-slate-200 tabular-nums"><AnimatedNum value={step.value} /></span>
                </div>
                <div className="h-10 bg-white/5 rounded-lg overflow-hidden relative">
                  <div className={cn('h-full rounded-lg bg-gradient-to-r transition-all duration-700', step.color)}
                    style={{ width: `${Math.max(step.width, 8)}%` }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] font-bold text-white/80 tabular-nums drop-shadow">{step.value}</span>
                  </div>
                </div>
                {i < arr.length - 1 && step.value > 0 && arr[i + 1].value > 0 && (
                  <p className="text-[9px] text-slate-600 mt-1 text-center">{Math.round((arr[i + 1].value / step.value) * 100)}% →</p>
                )}
              </div>
              {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-slate-700 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Service Breakdown + Market Breakdown ═══ */}
      <div className="grid grid-cols-12 gap-4">

        {/* Service Lead Pricing — CLICKABLE bars */}
        <div className="col-span-12 lg:col-span-7 glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-novalyte-500 to-novalyte-600 flex items-center justify-center shadow-lg shadow-novalyte-500/20">
                <BarChart3 className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Lead Pricing by Service</h3>
                <p className="text-[10px] text-slate-600">{forecast.serviceBreakdown.length} verticals · Click to see clinics</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {forecast.serviceBreakdown.map((svc, i) => {
              const Icon = getServiceIcon(svc.service);
              const barWidth = (svc.monthlyRevenue / maxSvcRevenue) * 100;
              const color = CHART_COLORS[i % CHART_COLORS.length];
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              return (
                <div key={svc.service} className="cursor-pointer group" onClick={() => openServiceDrill(svc)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center transition-all group-hover:scale-110', bgColor)}>
                        <Icon className={cn('w-4 h-4', textColor)} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{svc.service}</p>
                        <p className="text-[10px] text-slate-500">{svc.clinics} clinic{svc.clinics !== 1 ? 's' : ''} · LTV ${(svc.patientLTV / 1000).toFixed(1)}k</p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <p className={cn('text-lg font-bold tabular-nums', textColor)}>${svc.avgCPL}</p>
                        <p className="text-[10px] text-slate-500">per lead</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="relative h-7 bg-white/[0.03] rounded-lg overflow-hidden group-hover:bg-white/[0.05] transition-colors">
                    <div className={cn('h-full rounded-lg bg-gradient-to-r transition-all duration-700', color)}
                      style={{ width: `${Math.max(barWidth, 4)}%` }} />
                    <div className="absolute inset-0 flex items-center px-3">
                      <span className="text-[10px] font-semibold text-white/90 drop-shadow tabular-nums">
                        ${svc.monthlyRevenue.toLocaleString()}/mo × {svc.monthlyLeads} leads
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {forecast.serviceBreakdown.length === 0 && (
              <div className="text-center py-8">
                <BarChart3 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No service data — clinics need services tagged</p>
              </div>
            )}
          </div>
        </div>

        {/* Market Revenue — CLICKABLE rows */}
        <div className="col-span-12 lg:col-span-5 glass-card overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <MapPin className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Revenue by Market</h3>
                <p className="text-[10px] text-slate-600">{forecast.topMarkets.length} markets · Click to drill in</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-3">
            {forecast.topMarkets.map((mkt, i) => {
              const barWidth = (mkt.projected / maxMarketRevenue) * 100;
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              return (
                <div key={mkt.market} className="cursor-pointer group" onClick={() => openMarketDrill(mkt)}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all group-hover:scale-110',
                        i < 3 ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20' : bgColor + ' ' + textColor
                      )}>{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{mkt.market}</p>
                        <p className="text-[10px] text-slate-500">{mkt.clinics} clinics · Affluence {mkt.avgAffluence}/10</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-bold tabular-nums', textColor)}>
                        ${mkt.projected >= 1000 ? (mkt.projected / 1000).toFixed(1) + 'k' : mkt.projected}<span className="text-[10px] text-slate-500 font-normal">/mo</span>
                      </p>
                      <ChevronRight className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="h-2.5 bg-white/[0.03] rounded-full overflow-hidden group-hover:bg-white/[0.05] transition-colors">
                    <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700',
                      i < 3 ? 'from-emerald-500 to-emerald-400' : 'from-slate-600 to-slate-500'
                    )} style={{ width: `${Math.max(barWidth, 4)}%` }} />
                  </div>
                </div>
              );
            })}
            {forecast.topMarkets.length === 0 && (
              <div className="text-center py-8">
                <MapPin className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">No market data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Pipeline Value + Insights ═══ */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-5 glass-card p-6">
          <div className="flex items-center gap-2 mb-5">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Pipeline Value</h3>
          </div>
          <div className="text-center mb-6">
            <p className="text-4xl font-bold text-emerald-400 tabular-nums">
              $<AnimatedNum value={forecast.pipelineValue >= 1000000 ? forecast.pipelineValue / 1000000 : forecast.pipelineValue / 1000}
                decimals={forecast.pipelineValue >= 1000000 ? 2 : 0} suffix={forecast.pipelineValue >= 1000000 ? 'M' : 'k'} />
            </p>
            <p className="text-[11px] text-slate-500 mt-1">Annual pipeline if all qualified clinics convert</p>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Monthly Revenue', value: forecast.monthlyRevenue, color: 'bg-emerald-500', textColor: 'text-emerald-400' },
              { label: 'Quarterly Revenue', value: forecast.quarterlyRevenue, color: 'bg-blue-500', textColor: 'text-blue-400' },
              { label: 'Annual Revenue', value: forecast.annualRevenue, color: 'bg-violet-500', textColor: 'text-violet-400' },
              { label: 'Full Pipeline', value: forecast.pipelineValue, color: 'bg-amber-500', textColor: 'text-amber-400' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={cn('w-3 h-3 rounded-full shrink-0', item.color)} />
                <span className="text-xs text-slate-400 flex-1">{item.label}</span>
                <span className={cn('text-sm font-bold tabular-nums', item.textColor)}>
                  $<AnimatedNum value={item.value >= 1000000 ? item.value / 1000000 : item.value / 1000}
                    decimals={item.value >= 1000000 ? 2 : 1} suffix={item.value >= 1000000 ? 'M' : 'k'} />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-white/[0.03] rounded-xl border border-white/[0.04]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Close Rate</span>
              <span className="text-lg font-bold text-emerald-400 tabular-nums"><AnimatedNum value={forecast.conversionRate} suffix="%" /></span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${forecast.conversionRate}%` }} />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {forecast.projectedClients} of {forecast.qualifiedClinics > 0 ? forecast.qualifiedClinics : forecast.clinicsWithEmail} {forecast.qualifiedClinics > 0 ? 'qualified' : 'reachable'} clinics → paying clients
            </p>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          {/* ROI Visual Card */}
          <div className="glass-card p-6 bg-gradient-to-br from-violet-600/10 to-novalyte-600/5 border-violet-500/10">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-200">Clinic ROI Breakdown</h3>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex-1 flex items-center gap-3">
                {[
                  { value: `$${forecast.avgLeadPrice}`, label: 'Lead Cost', color: 'bg-novalyte-500/15 ring-novalyte-500/20' },
                  { value: `${forecast.avgCloseRate}%`, label: 'Close Rate', color: 'bg-amber-500/15 ring-amber-500/20' },
                  { value: `$${(forecast.avgPatientLTV / 1000).toFixed(1)}k`, label: 'Patient LTV', color: 'bg-emerald-500/15 ring-emerald-500/20' },
                ].map((item, i) => (
                  <div key={item.label} className="flex items-center gap-3 flex-1">
                    <div className="text-center flex-1">
                      <div className={cn('w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-2 ring-1', item.color)}>
                        <span className={cn('text-lg font-bold tabular-nums',
                          i === 0 ? 'text-novalyte-400' : i === 1 ? 'text-amber-400' : 'text-emerald-400')}>{item.value}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">{item.label}</p>
                    </div>
                    {i < 2 && <ArrowUpRight className="w-5 h-5 text-slate-600 shrink-0" />}
                  </div>
                ))}
                <span className="text-2xl font-bold text-slate-600">=</span>
                <div className="text-center flex-1">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 flex items-center justify-center mb-2 ring-1 ring-violet-500/20">
                    <span className="text-lg font-bold text-violet-400 tabular-nums">{forecast.roiForClinic}x</span>
                  </div>
                  <p className="text-[10px] text-slate-500">ROI</p>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-4 leading-relaxed text-center">
              A clinic pays <span className="text-novalyte-400 font-medium">${forecast.avgLeadPrice}</span> per lead →
              <span className="text-amber-400 font-medium"> {forecast.avgCloseRate}%</span> become patients →
              each patient worth <span className="text-emerald-400 font-medium">${(forecast.avgPatientLTV / 1000).toFixed(1)}k</span> LTV →
              <span className="text-violet-400 font-bold"> {forecast.roiForClinic}x return</span>
            </p>
          </div>

          {/* AI Insights */}
          <div className="glass-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-accent-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Revenue Insights</h3>
                <p className="text-[10px] text-slate-600">Live analysis from your pipeline data</p>
              </div>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {forecast.insights.map((insight, i) => (
                <div key={i} className="px-6 py-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors">
                  <CircleDot className={cn('w-4 h-4 mt-0.5 shrink-0', TEXT_COLORS[i % TEXT_COLORS.length])} />
                  <p className="text-xs text-slate-400 leading-relaxed">{insight}</p>
                </div>
              ))}
              {forecast.insights.length === 0 && (
                <div className="px-6 py-8 text-center"><p className="text-xs text-slate-500">Add more clinics to generate insights</p></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Service Vertical Cards — INTERACTIVE with clinic intel ═══ */}
      {forecast.serviceBreakdown.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-novalyte-400" />
            <h3 className="text-sm font-semibold text-slate-200">Service Vertical Cards</h3>
            <span className="text-[10px] text-slate-500">— click any card to see clinics likely to buy</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {forecast.serviceBreakdown.map((svc, i) => {
              const Icon = getServiceIcon(svc.service);
              const textColor = TEXT_COLORS[i % TEXT_COLORS.length];
              const bgColor = BG_COLORS[i % BG_COLORS.length];
              const color = CHART_COLORS[i % CHART_COLORS.length];
              const svcROI = Math.round((svc.patientLTV * (forecast.avgCloseRate / 100)) / svc.avgCPL * 10) / 10;
              const svcClinics = getClinicsForService(svc.service);
              const topBuyers = svcClinics.slice(0, 3);
              const withEmail = svcClinics.filter(c => c.email).length;

              return (
                <div key={svc.service}
                  className="glass-card p-5 relative overflow-hidden group hover:bg-white/[0.04] transition-all cursor-pointer hover:border-white/[0.12]"
                  onClick={() => openServiceDrill(svc)}>
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl opacity-10 rounded-bl-full pointer-events-none" />
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110', bgColor)}>
                      <Icon className={cn('w-5 h-5', textColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{svc.service}</p>
                      <p className="text-[10px] text-slate-500">{svc.clinics} clinic{svc.clinics !== 1 ? 's' : ''} · {withEmail} w/ email</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>

                  <div className="space-y-3">
                    <div className="text-center py-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
                      <p className={cn('text-2xl font-bold tabular-nums', textColor)}>${svc.avgCPL}</p>
                      <p className="text-[10px] text-slate-500">per qualified lead</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Patient LTV</p>
                        <p className="text-xs font-bold text-slate-300 tabular-nums">${(svc.patientLTV / 1000).toFixed(1)}k</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Clinic ROI</p>
                        <p className={cn('text-xs font-bold tabular-nums', svcROI >= 5 ? 'text-emerald-400' : svcROI >= 3 ? 'text-amber-400' : 'text-slate-400')}>{svcROI}x</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Leads/Mo</p>
                        <p className="text-xs font-bold text-slate-300 tabular-nums">{svc.monthlyLeads}</p>
                      </div>
                      <div className="p-2 bg-white/[0.02] rounded-lg">
                        <p className="text-[9px] text-slate-600">Revenue/Mo</p>
                        <p className={cn('text-xs font-bold tabular-nums', textColor)}>${svc.monthlyRevenue.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Top likely buyers */}
                    {topBuyers.length > 0 && (
                      <div className="pt-2 border-t border-white/[0.06]">
                        <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Top Likely Buyers</p>
                        {topBuyers.map((c, idx) => (
                          <div key={c.id || idx} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold',
                                idx === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-500')}>{idx + 1}</div>
                              <span className="text-[10px] text-slate-300 truncate">{c.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {c.email && <Mail className="w-2.5 h-2.5 text-[#06B6D4]" />}
                              <span className={cn('text-[9px] font-bold tabular-nums',
                                c.score >= 70 ? 'text-emerald-400' : c.score >= 40 ? 'text-amber-400' : 'text-slate-500')}>{c.score}</span>
                            </div>
                          </div>
                        ))}
                        {svcClinics.length > 3 && (
                          <p className="text-[9px] text-[#06B6D4] mt-1">+{svcClinics.length - 3} more →</p>
                        )}
                      </div>
                    )}

                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-700', color)}
                        style={{ width: `${(svc.monthlyRevenue / maxSvcRevenue) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
