import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Search, Phone, Mail, MapPin, Star, X,
  Globe, ExternalLink, RefreshCw, Briefcase, Linkedin,
  TrendingUp, Building2, Shield, UserCheck, Calendar, Clock,
  MessageSquare, PhoneCall, Send, Copy, CheckCircle2, AlertCircle,
  Zap, Target, FileText, ChevronDown, ChevronUp,
  BarChart3, ArrowUpRight, Sparkles, CircleDot, ArrowUpDown,
  ChevronLeft, ChevronRight, MapPinned, Loader2, Radar, Map as MapIcon,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { enrichmentService } from '../services/enrichmentService';
import { analyzeCompetitorIntel, CompetitorIntel, buildAttributionReport, AttributionReport } from '../services/intelligenceService';
import { ContactStatus, Priority, Clinic, CRMContact, Activity } from '../types';
import { computeLeadScore } from '../utils/leadScoring';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

/* ─── Config ─── */

const statusCfg: Record<ContactStatus, { label: string; bg: string; text: string; dot: string }> = {
  new: { label: 'New', bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-500' },
  researching: { label: 'Researching', bg: 'bg-sky-500/10', text: 'text-sky-400', dot: 'bg-sky-400' },
  ready_to_call: { label: 'Ready', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  call_scheduled: { label: 'Scheduled', bg: 'bg-violet-500/10', text: 'text-violet-400', dot: 'bg-violet-400' },
  called: { label: 'Called', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' },
  follow_up: { label: 'Follow Up', bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-500' },
  qualified: { label: 'Qualified', bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-600' },
  not_interested: { label: 'Not Interested', bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  no_answer: { label: 'No Answer', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
  wrong_number: { label: 'Wrong #', bg: 'bg-white/5', text: 'text-slate-500', dot: 'bg-slate-500' },
};

const priorityCfg: Record<Priority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10' },
  high: { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  medium: { label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  low: { label: 'Low', color: 'text-slate-500', bg: 'bg-white/5' },
};

const typeLabels: Record<Clinic['type'], string> = {
  mens_health_clinic: "Men's Health", hormone_clinic: 'Hormone', med_spa: 'Med Spa',
  urology_practice: 'Urology', anti_aging_clinic: 'Anti-Aging', wellness_center: 'Wellness', aesthetic_clinic: 'Aesthetics',
};

const roleLabels: Record<string, string> = {
  owner: 'Owner / Founder', medical_director: 'Medical Director', clinic_manager: 'Clinic Manager',
  practice_administrator: 'Practice Admin', marketing_director: 'Marketing Director', operations_manager: 'Operations Manager',
};

const callOutcomes: { label: string; emoji: string; status: ContactStatus }[] = [
  { label: 'Connected — Interested', emoji: '🟢', status: 'qualified' },
  { label: 'Connected — Send Info', emoji: '📧', status: 'follow_up' },
  { label: 'Connected — Not Interested', emoji: '🔴', status: 'not_interested' },
  { label: 'No Answer', emoji: '📵', status: 'no_answer' },
  { label: 'Voicemail Left', emoji: '📞', status: 'follow_up' },
  { label: 'Gatekeeper — Callback', emoji: '🚪', status: 'follow_up' },
  { label: 'Wrong Number', emoji: '❌', status: 'wrong_number' },
];

/* ─── AI Intel Generators ─── */

function generateCallIntel(contact: CRMContact) {
  const c = contact.clinic, dm = contact.decisionMaker, services = c.services || [], market = c.marketZone;
  const talkingPoints: string[] = [], valueProps: string[] = [], objectionHandlers: string[] = [];
  if (services.some(s => /trt|testosterone/i.test(s))) { talkingPoints.push('They offer TRT — discuss how Novalyte can help scale patient acquisition for hormone therapy'); valueProps.push('Our clients see 40% more TRT patient bookings within 90 days'); }
  if (services.some(s => /peptide/i.test(s))) { talkingPoints.push('Peptide therapy is trending — position as growth opportunity'); valueProps.push('Peptide therapy searches are up 65% YoY in affluent markets'); }
  if (services.some(s => /ed|erectile/i.test(s))) talkingPoints.push('ED treatment is high-margin — emphasize ROI on patient acquisition');
  if (services.some(s => /iv therapy/i.test(s))) talkingPoints.push('IV therapy has high repeat-visit potential — discuss retention marketing');
  if (services.some(s => /glp|semaglutide|weight/i.test(s))) { talkingPoints.push('GLP-1/weight loss is the fastest growing segment'); valueProps.push('GLP-1 search volume has grown 300% in the last 12 months'); }
  if (services.some(s => /hair/i.test(s))) talkingPoints.push('Hair restoration has high patient lifetime value — discuss long-term marketing ROI');
  if (market.affluenceScore >= 9) talkingPoints.push(`${market.city} is a top-tier affluent market (${market.affluenceScore}/10)`);
  if (market.medianIncome > 150000) valueProps.push(`Median income in ${market.city} is $${(market.medianIncome / 1000).toFixed(0)}k`);
  if (contact.keywordMatches.length > 0) { const t = contact.keywordMatches.reduce((a, b) => a.growthRate > b.growthRate ? a : b); talkingPoints.push(`"${t.keyword}" is growing ${t.growthRate}% in their area`); }
  if (c.rating && c.rating >= 4.5) talkingPoints.push(`Strong reputation (${Number(c.rating).toFixed(1)}★) — leverage reviews`);
  else if (c.rating && c.rating < 4.0) talkingPoints.push(`Rating is ${Number(c.rating).toFixed(1)}★ — reputation management could be a value-add`);
  if (!talkingPoints.length) { talkingPoints.push("Discuss how Novalyte helps men's health clinics acquire high-value patients"); talkingPoints.push('Ask about their current patient acquisition channels'); }
  objectionHandlers.push('"We already have a marketing agency" → "We complement agencies with men\'s health-specific demand data they don\'t have"');
  objectionHandlers.push(`"We're not looking right now" → "Can I send a quick market report for ${market.city}? No commitment"`);
  objectionHandlers.push('"What makes you different?" → "We specialize exclusively in men\'s health patient acquisition using real-time keyword demand data"');
  if (market.affluenceScore >= 8) objectionHandlers.push(`"We have enough patients" → "Our data shows untapped demand in ${market.city}"`);
  const opener = dm
    ? `Hi ${dm.firstName}, this is [Your Name] from Novalyte. I noticed ${c.name} offers ${services.slice(0, 2).join(' and ')} in ${market.city} — we help clinics like yours capture more high-intent patients. Do you have 2 minutes?`
    : `Hi, I'm calling from Novalyte. We work with men's health clinics in ${market.city} to capture high-intent patients. Could I speak with the practice manager or owner?`;
  return { talkingPoints, opener, objectionHandlers, valueProps };
}

function generateEmailDraft(contact: CRMContact) {
  const c = contact.clinic, dm = contact.decisionMaker, market = c.marketZone, services = c.services.slice(0, 3).join(', ');
  const subject = `${c.name} — Untapped Patient Demand in ${market.city}`;
  const body = `Hi ${dm ? dm.firstName : 'there'},

I came across ${c.name} while researching ${services ? services + ' providers' : "men's health clinics"} in ${market.city}.

${contact.keywordMatches.length > 0
    ? `Our data shows that "${contact.keywordMatches[0].keyword}" searches are growing ${contact.keywordMatches[0].growthRate}% in your area — there's significant untapped patient demand.`
    : `With a median household income of $${(market.medianIncome / 1000).toFixed(0)}k in ${market.city}, there's strong demand for premium men's health services.`}

We help clinics like yours capture high-intent patients through data-driven marketing. Our clients typically see a 30-40% increase in qualified patient inquiries within 90 days.

Would you be open to a quick 15-minute call this week to see if there's a fit?

Best,
[Your Name]
Novalyte`;
  return { subject, body };
}

/* ─── Region grouping types ─── */

interface RegionGroup {
  key: string; // "City, ST"
  city: string;
  state: string;
  metro: string;
  affluence: number;
  medianIncome: number;
  contacts: CRMContact[];
  avgScore: number;
  withEmail: number;
  qualified: number;
  topGrowthKeyword?: { keyword: string; growth: number };
}

/* ─── Main Component ─── */

function CRM() {
  const { contacts, selectedContact, selectContact, updateContact, updateContactStatus } = useAppStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContactStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('');
  const [regionFilter, setRegionFilter] = useState('');
  const [isEnriching, setIsEnriching] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'intel' | 'details' | 'activity'>('intel');
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ opener: true, talkingPoints: true, valueProps: true, objections: false });
  const [collapsedRegions, setCollapsedRegions] = useState<Record<string, boolean>>({});
  const [outreachAlert, setOutreachAlert] = useState<{ contact: CRMContact; action: 'email' | 'call'; history: Activity[] } | null>(null);
  const [competitorIntel, setCompetitorIntel] = useState<CompetitorIntel | null>(null);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [attribution, setAttribution] = useState<AttributionReport | null>(null);

  /* ── Filtering ── */
  const filtered = useMemo(() => contacts.filter(c => {
    const q = search.toLowerCase();
    if (q && !c.clinic.name.toLowerCase().includes(q) && !c.clinic.address.city.toLowerCase().includes(q) && !(c.decisionMaker?.email || '').toLowerCase().includes(q) && !(c.decisionMaker?.lastName || '').toLowerCase().includes(q)) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (priorityFilter && c.priority !== priorityFilter) return false;
    if (regionFilter) { const rk = `${c.clinic.address.city}, ${c.clinic.address.state}`; if (rk !== regionFilter) return false; }
    return true;
  }), [contacts, search, statusFilter, priorityFilter, regionFilter]);

  /* ── Region groups — sorted by avg score desc (best regions first) ── */
  const regions = useMemo(() => {
    const map = new Map<string, CRMContact[]>();
    for (const c of filtered) {
      const key = `${c.clinic.address.city}, ${c.clinic.address.state}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const groups: RegionGroup[] = [];
    for (const [key, list] of map) {
      // Sort contacts within region: priority order first, then score desc
      const pOrder: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      list.sort((a, b) => pOrder[a.priority] - pOrder[b.priority] || b.score - a.score);
      const first = list[0];
      const avgScore = Math.round(list.reduce((s, c) => s + c.score, 0) / list.length);
      // Find top growth keyword across all contacts in region
      let topKw: { keyword: string; growth: number } | undefined;
      for (const c of list) {
        for (const km of c.keywordMatches) {
          if (!topKw || km.growthRate > topKw.growth) topKw = { keyword: km.keyword, growth: km.growthRate };
        }
      }
      groups.push({
        key, city: first.clinic.address.city, state: first.clinic.address.state,
        metro: first.clinic.marketZone.metropolitanArea, affluence: first.clinic.marketZone.affluenceScore,
        medianIncome: first.clinic.marketZone.medianIncome, contacts: list, avgScore,
        withEmail: list.filter(c => c.decisionMaker?.email).length,
        qualified: list.filter(c => c.status === 'qualified').length,
        topGrowthKeyword: topKw,
      });
    }
    // Sort regions: highest avg score first
    groups.sort((a, b) => b.avgScore - a.avgScore);
    return groups;
  }, [filtered]);

  /* ── All region keys for filter dropdown ── */
  const allRegionKeys = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach(c => set.add(`${c.clinic.address.city}, ${c.clinic.address.state}`));
    return Array.from(set).sort();
  }, [contacts]);

  /* ── Global stats ── */
  const stats = useMemo(() => ({
    total: contacts.length,
    regions: allRegionKeys.length,
    withEmail: contacts.filter(c => c.decisionMaker?.email).length,
    qualified: contacts.filter(c => c.status === 'qualified').length,
    needsAction: contacts.filter(c => c.status === 'new' || c.status === 'ready_to_call').length,
    overdue: contacts.filter(c => c.nextFollowUp && new Date(c.nextFollowUp) < new Date()).length,
  }), [contacts, allRegionKeys]);

  /* ── Callbacks ── */
  const addActivity = useCallback((contactId: string, type: Activity['type'], description: string, metadata?: Record<string, any>) => {
    const contact = useAppStore.getState().contacts.find(c => c.id === contactId);
    if (!contact) return;
    const activity: Activity = { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, description, timestamp: new Date(), metadata };
    updateContact(contactId, { activities: [...(contact.activities || []), activity] } as any);
  }, [updateContact]);

  const handleEnrichContact = useCallback(async (contact: CRMContact) => {
    setIsEnriching(true);
    toast.loading('Searching NPI Registry & enriching...', { id: 'enrich-crm' });
    try {
      const dms = await enrichmentService.findDecisionMakers(contact.clinic);
      if (!dms.length) { toast('No decision makers found', { id: 'enrich-crm' }); setIsEnriching(false); return; }
      const rolePriority = ['owner', 'medical_director', 'clinic_manager', 'practice_administrator', 'operations_manager', 'marketing_director'];
      const withEmail = dms.filter(d => !!d.email);
      const best = withEmail.length > 0
        ? (rolePriority.reduce<typeof dms[number] | null>((f, r) => f || withEmail.find(d => d.role === r) || null, null) || withEmail.reduce((a, b) => a.confidence > b.confidence ? a : b))
        : dms.reduce((a, b) => a.confidence > b.confidence ? a : b);
      const clinicUpdates: Partial<Clinic> = { managerName: `${best.firstName} ${best.lastName}`.trim(), managerEmail: best.email };
      if (best.role === 'owner' || best.role === 'medical_director') { clinicUpdates.ownerName = `${best.firstName} ${best.lastName}`.trim(); clinicUpdates.ownerEmail = best.email; }

      // Re-score after enrichment
      const updatedContact: CRMContact = { ...contact, decisionMaker: best, clinic: { ...contact.clinic, ...clinicUpdates } };
      const { score, priority } = computeLeadScore(updatedContact);

      updateContact(contact.id, { decisionMaker: best, clinic: { ...contact.clinic, ...clinicUpdates }, status: best.email ? 'ready_to_call' : contact.status, score, priority } as any);
      addActivity(contact.id, 'enriched', `Found decision maker: ${best.firstName} ${best.lastName} (${best.source})`);
      const updated = useAppStore.getState().contacts.find(c => c.id === contact.id);
      if (updated) selectContact(updated);
      toast.success(`Found: ${best.firstName} ${best.lastName}${best.email ? ` — ${best.email}` : ''}`, { id: 'enrich-crm' });
    } catch (err) { console.error(err); toast.error('Enrichment failed', { id: 'enrich-crm' }); }
    setIsEnriching(false);
  }, [updateContact, selectContact, addActivity]);

  useEffect(() => {
    if (selectedContact && !selectedContact.decisionMaker && !isEnriching) handleEnrichContact(selectedContact);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact?.id]);

  // Fetch competitor intel + attribution when contact changes
  useEffect(() => {
    if (!selectedContact) { setCompetitorIntel(null); setAttribution(null); return; }
    // Attribution (sync — no API call)
    const sentEmails = useAppStore.getState().sentEmails;
    setAttribution(buildAttributionReport(selectedContact, sentEmails));
    // Competitor intel (async — Gemini)
    setCompetitorIntel(null);
    setCompetitorLoading(true);
    analyzeCompetitorIntel(selectedContact)
      .then(result => setCompetitorIntel(result))
      .catch(() => setCompetitorIntel(null))
      .finally(() => setCompetitorLoading(false));
  }, [selectedContact?.id]);

  /** Check for prior outreach before email/call — shows alert with activity history if found */
  const checkPriorOutreach = useCallback((contact: CRMContact, action: 'email' | 'call') => {
    const activities = contact.activities || [];
    const outreachHistory = activities.filter(a => a.type === 'email_sent' || a.type === 'call_made').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (outreachHistory.length > 0) {
      setOutreachAlert({ contact, action, history: outreachHistory });
      return true; // blocked — alert shown
    }
    return false; // no prior outreach, proceed
  }, []);

  const handleLogCall = (outcome: string, newStatus: ContactStatus) => {
    if (!selectedContact) return;
    addActivity(selectedContact.id, 'call_made', `Call: ${outcome}`);
    updateContact(selectedContact.id, { status: newStatus, lastContactedAt: new Date() } as any);
    const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id); if (u) selectContact(u);
    toast.success(`Call logged: ${outcome}`);
  };

  const handleSendEmail = (bypassCheck = false) => {
    if (!selectedContact) return;
    // Check for prior outreach unless bypassed from the alert modal
    if (!bypassCheck && checkPriorOutreach(selectedContact, 'email')) return;
    const email = selectedContact.decisionMaker?.email || selectedContact.clinic.managerEmail || selectedContact.clinic.email;
    if (!email) {
      const w = selectedContact.clinic.website;
      if (w) { try { const d = new URL(w.startsWith('http') ? w : `https://${w}`).hostname.replace(/^www\./, ''); if (d && !['facebook.com','yelp.com','google.com'].includes(d)) { const g = `info@${d}`; const dr = generateEmailDraft(selectedContact); window.open(`mailto:${g}?subject=${encodeURIComponent(dr.subject)}&body=${encodeURIComponent(dr.body)}`); addActivity(selectedContact.id, 'email_sent', `Email sent to ${g} (guessed)`); toast.success(`Email opened for ${g}`); return; } } catch {} }
      toast.error('No email available — try calling'); return;
    }
    const dr = generateEmailDraft(selectedContact);
    window.open(`mailto:${email}?subject=${encodeURIComponent(dr.subject)}&body=${encodeURIComponent(dr.body)}`);
    addActivity(selectedContact.id, 'email_sent', `Email sent to ${email}`);
    updateContact(selectedContact.id, { lastContactedAt: new Date() } as any);
    const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id); if (u) selectContact(u);
    toast.success('Email client opened');
  };

  const handleSetFollowUp = () => {
    if (!selectedContact || !followUpDate) return;
    const d = new Date(followUpDate);
    updateContact(selectedContact.id, { nextFollowUp: d, status: 'follow_up' } as any);
    addActivity(selectedContact.id, 'follow_up_set', `Follow-up scheduled for ${d.toLocaleDateString()}`);
    const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id); if (u) selectContact(u);
    setShowFollowUp(false); setFollowUpDate(''); toast.success('Follow-up scheduled');
  };

  const handleCopyEmail = () => { const e = selectedContact?.decisionMaker?.email || selectedContact?.clinic.managerEmail; if (e) { navigator.clipboard.writeText(e); toast.success('Email copied'); } };

  const handleCallClinic = (bypassCheck = false) => {
    if (!selectedContact?.clinic.phone) return;
    if (!bypassCheck && checkPriorOutreach(selectedContact, 'call')) return;
    window.open(`tel:${selectedContact.clinic.phone}`);
  };

  const handleOutreachAlertProceed = () => {
    if (!outreachAlert) return;
    const { action } = outreachAlert;
    setOutreachAlert(null);
    if (action === 'email') handleSendEmail(true);
    else handleCallClinic(true);
  };

  const toggleSection = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }));
  const toggleRegion = (k: string) => setCollapsedRegions(p => ({ ...p, [k]: !p[k] }));

  const intel = selectedContact ? generateCallIntel(selectedContact) : null;
  const emailDraft = selectedContact ? generateEmailDraft(selectedContact) : null;
  const drawerOpen = !!selectedContact;

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">

      {/* ═══ Top Bar ═══ */}
      <div className="bg-slate-900/80 border-b border-white/[0.06] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Pipeline</h1>
            <p className="text-xs text-slate-500 mt-0.5">{filtered.length} accounts across {regions.length} region{regions.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {[
              { label: 'Accounts', value: stats.total, color: 'text-slate-300 bg-white/5 ring-white/[0.06]' },
              { label: 'Regions', value: stats.regions, color: 'text-novalyte-400 bg-novalyte-500/10 ring-novalyte-500/20' },
              { label: 'With Email', value: stats.withEmail, color: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20' },
              { label: 'Qualified', value: stats.qualified, color: 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20' },
              { label: 'Needs Action', value: stats.needsAction, color: 'text-amber-400 bg-amber-500/10 ring-amber-500/20' },
              { label: 'Overdue', value: stats.overdue, color: 'text-red-400 bg-red-500/10 ring-red-500/20' },
            ].map(s => (
              <div key={s.label} className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ring-1 text-xs font-medium', s.color)}>
                <span className="text-base font-bold tabular-nums">{s.value}</span>
                <span className="opacity-70">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="Search name, city, email..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/[0.06] rounded-lg text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 focus:border-novalyte-500/30" />
          </div>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className="text-xs py-2 px-3 bg-white/5 border border-white/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 text-slate-400 max-w-[180px]">
            <option value="">All Regions</option>
            {allRegionKeys.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="text-xs py-2 px-3 bg-white/5 border border-white/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 text-slate-400">
            <option value="">All Status</option>
            {Object.entries(statusCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as any)} className="text-xs py-2 px-3 bg-white/5 border border-white/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 text-slate-400">
            <option value="">All Priority</option>
            {Object.entries(priorityCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {/* ═══ Content ═══ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Region-grouped table ── */}
        <div className="flex-1 overflow-auto">
          {regions.length > 0 ? (
            <div className="pb-4">
              {regions.map(region => {
                const isCollapsed = collapsedRegions[region.key];
                return (
                  <div key={region.key} className="mb-1">
                    {/* Region header */}
                    <button
                      onClick={() => toggleRegion(region.key)}
                      className="w-full sticky top-0 z-10 flex items-center gap-3 px-6 py-2.5 bg-slate-900/95 backdrop-blur-sm border-b border-white/[0.06] hover:bg-white/[0.03] transition-colors"
                    >
                      {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                      <MapPinned className="w-4 h-4 text-novalyte-400 shrink-0" />
                      <span className="font-semibold text-sm text-slate-200">{region.city}, {region.state}</span>
                      <span className="text-[10px] text-slate-600 font-normal">{region.metro}</span>

                      {/* Region stats */}
                      <div className="flex items-center gap-3 ml-auto text-[11px]">
                        <span className="tabular-nums font-semibold text-slate-300">{region.contacts.length} <span className="font-normal text-slate-500">accounts</span></span>
                        <span className="text-slate-700">|</span>
                        <span className="tabular-nums">
                          <span className="font-semibold text-novalyte-400">{region.avgScore}</span>
                          <span className="text-slate-500 ml-0.5">avg score</span>
                        </span>
                        <span className="text-slate-700">|</span>
                        <span className="tabular-nums">
                          <span className="font-semibold text-emerald-400">{region.withEmail}</span>
                          <span className="text-slate-500 ml-0.5">w/ email</span>
                        </span>
                        {region.qualified > 0 && <>
                          <span className="text-slate-700">|</span>
                          <span className="tabular-nums font-semibold text-emerald-400">{region.qualified} qualified</span>
                        </>}
                        <span className="text-slate-700">|</span>
                        <span className="text-slate-500">Affluence <span className="font-semibold text-slate-400">{region.affluence}/10</span></span>
                        <span className="text-slate-500">${(region.medianIncome / 1000).toFixed(0)}k</span>
                        {region.topGrowthKeyword && region.topGrowthKeyword.growth > 0 && (
                          <>
                            <span className="text-slate-300">|</span>
                            <span className="flex items-center gap-0.5 text-emerald-600">
                              <TrendingUp className="w-3 h-3" />
                              {region.topGrowthKeyword.keyword} +{region.topGrowthKeyword.growth}%
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    {/* Contacts table within region */}
                    {!isCollapsed && (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-white/[0.04]">
                          {region.contacts.map(contact => {
                            const dm = contact.decisionMaker;
                            const hasEmail = !!(dm?.email || contact.clinic.managerEmail);
                            const isOverdue = contact.nextFollowUp && new Date(contact.nextFollowUp) < new Date();
                            const isActive = selectedContact?.id === contact.id;
                            const hasOutreach = contact.activities?.some(a => a.type === 'email_sent' || a.type === 'call_made');
                            return (
                              <tr key={contact.id} onClick={() => { selectContact(contact); setDrawerTab('intel'); }}
                                className={cn('cursor-pointer transition-colors group', isActive ? 'bg-novalyte-500/10' : 'bg-transparent hover:bg-white/[0.02]', isOverdue && !isActive && 'bg-red-500/5')}>
                                {/* Score */}
                                <td className="pl-14 pr-2 py-2.5 w-[60px]">
                                  <span className={cn('inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold',
                                    contact.priority === 'critical' ? 'bg-red-500/15 text-red-400' : contact.priority === 'high' ? 'bg-orange-500/15 text-orange-400' : contact.priority === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-white/5 text-slate-500'
                                  )}>{contact.score}</span>
                                </td>
                                {/* Clinic */}
                                <td className="px-3 py-2.5 min-w-[180px]">
                                  <p className="font-medium text-slate-200 truncate group-hover:text-novalyte-400 transition-colors">{contact.clinic.name}</p>
                                  <p className="text-[11px] text-slate-500 mt-0.5">{typeLabels[contact.clinic.type]}{contact.clinic.rating ? ` · ${Number(contact.clinic.rating).toFixed(1)}★` : ''}</p>
                                </td>
                                {/* DM */}
                                <td className="px-3 py-2.5 min-w-[170px]">
                                  {dm ? (
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-novalyte-400 to-novalyte-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">{dm.firstName[0]}{dm.lastName[0]}</div>
                                      <div className="min-w-0">
                                        <p className="text-sm text-slate-800 truncate">{dm.firstName} {dm.lastName}</p>
                                        {hasEmail && <p className="text-[10px] text-emerald-600 truncate flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5 shrink-0" />{dm.email}</p>}
                                      </div>
                                    </div>
                                  ) : <span className="text-xs text-slate-400 flex items-center gap-1"><AlertCircle className="w-3 h-3 text-amber-400" />No DM</span>}
                                </td>
                                {/* Status */}
                                <td className="px-3 py-2.5 w-[110px]">
                                  <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium', statusCfg[contact.status].bg, statusCfg[contact.status].text)}>
                                    <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg[contact.status].dot)} />{statusCfg[contact.status].label}
                                  </span>
                                  {isOverdue && <span className="ml-1 text-[9px] font-bold text-red-500">OVERDUE</span>}
                                  {hasOutreach && !isOverdue && <span className="ml-1 text-[9px] font-medium text-amber-500" title="Previously contacted">⚡</span>}
                                </td>
                                {/* Priority */}
                                <td className="px-3 py-2.5 w-[80px]">
                                  <span className={cn('text-[11px] font-semibold', priorityCfg[contact.priority].color)}>{priorityCfg[contact.priority].label}</span>
                                </td>
                                {/* Quick actions */}
                                <td className="px-3 py-2.5 w-[50px]">
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {contact.clinic.phone && <button onClick={e => { e.stopPropagation(); window.open(`tel:${contact.clinic.phone}`); }} className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400" title="Call"><Phone className="w-3.5 h-3.5" /></button>}
                                    {hasEmail && <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(dm?.email || contact.clinic.managerEmail || ''); toast.success('Copied'); }} className="p-1 rounded hover:bg-novalyte-500/10 text-novalyte-400" title="Copy email"><Copy className="w-3.5 h-3.5" /></button>}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4"><Users className="w-7 h-7 text-slate-600" /></div>
              <p className="font-medium text-slate-400 mb-1">No contacts yet</p>
              <p className="text-xs text-slate-600">Discover clinics and save them to CRM to start building your pipeline</p>
            </div>
          )}
        </div>

        {/* ── Slide-over Drawer ── */}
        <div className={cn('shrink-0 bg-slate-900 border-l border-white/[0.06] flex flex-col overflow-hidden transition-all duration-300 ease-in-out', drawerOpen ? 'w-[480px] opacity-100' : 'w-0 opacity-0')}>
          {selectedContact && (
            <>
              {/* Drawer Header */}
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06] shrink-0">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button onClick={() => selectContact(null)} className="p-1 -ml-1 rounded-md hover:bg-white/5 text-slate-500 hover:text-slate-300"><ChevronLeft className="w-4 h-4" /></button>
                      <h2 className="text-base font-semibold text-white truncate">{selectedContact.clinic.name}</h2>
                    </div>
                    <div className="flex items-center gap-3 mt-1 ml-7 text-[11px] text-slate-500">
                      <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{selectedContact.clinic.address.city}, {selectedContact.clinic.address.state}</span>
                      {selectedContact.clinic.rating && <span className="flex items-center gap-0.5"><Star className="w-3 h-3 text-amber-400 fill-amber-400" />{Number(selectedContact.clinic.rating).toFixed(1)}</span>}
                      <span>${(selectedContact.clinic.marketZone.medianIncome / 1000).toFixed(0)}k market</span>
                    </div>
                  </div>
                  <button onClick={() => selectContact(null)} className="p-1 rounded-md hover:bg-white/5 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-1.5 ml-7 mt-2">
                  <button onClick={() => handleSendEmail()} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-novalyte-600 text-white rounded-md text-[11px] font-medium hover:bg-novalyte-700"><Send className="w-3 h-3" /> Email</button>
                  <button onClick={() => handleCallClinic()} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-md text-[11px] font-medium hover:bg-emerald-700"><PhoneCall className="w-3 h-3" /> Call</button>
                  {(selectedContact.decisionMaker?.email || selectedContact.clinic.managerEmail) && <button onClick={handleCopyEmail} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/[0.06] text-slate-400 rounded-md text-[11px] font-medium hover:bg-white/[0.08]"><Copy className="w-3 h-3" /> Copy</button>}
                  <button onClick={() => setShowFollowUp(!showFollowUp)} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/[0.06] text-slate-400 rounded-md text-[11px] font-medium hover:bg-white/[0.08]"><Calendar className="w-3 h-3" /> Follow-up</button>
                  <button onClick={() => handleEnrichContact(selectedContact)} disabled={isEnriching} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/[0.06] text-slate-400 rounded-md text-[11px] font-medium hover:bg-white/[0.08] disabled:opacity-50 ml-auto"><RefreshCw className={cn('w-3 h-3', isEnriching && 'animate-spin')} /> Enrich</button>
                </div>
                {showFollowUp && (
                  <div className="flex items-center gap-2 mt-2 ml-7 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} className="flex-1 text-xs py-1 px-2 bg-slate-800 border border-white/[0.06] rounded text-slate-300" />
                    <button onClick={handleSetFollowUp} disabled={!followUpDate} className="px-2.5 py-1 bg-amber-500 text-white rounded text-[11px] font-medium hover:bg-amber-600 disabled:opacity-50">Set</button>
                    <button onClick={() => setShowFollowUp(false)} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2 ml-7">
                  <select value={selectedContact.status} onChange={e => { const prev = selectedContact.status; updateContactStatus(selectedContact.id, e.target.value as ContactStatus); addActivity(selectedContact.id, 'status_change', `Status: ${prev} → ${e.target.value}`); const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id); if (u) selectContact(u); }} className="text-[11px] py-1 px-2 bg-white/5 border border-white/[0.06] rounded-md text-slate-300 focus:outline-none focus:ring-2 focus:ring-novalyte-500/20">
                    {Object.entries(statusCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <span className={cn('text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded', priorityCfg[selectedContact.priority].bg, priorityCfg[selectedContact.priority].color)}>{selectedContact.score}</span>
                  {selectedContact.nextFollowUp && <span className={cn('text-[11px] flex items-center gap-0.5', new Date(selectedContact.nextFollowUp) < new Date() ? 'text-red-500 font-medium' : 'text-slate-400')}><Clock className="w-3 h-3" />{new Date(selectedContact.nextFollowUp).toLocaleDateString()}</span>}
                  {selectedContact.lastContactedAt && <span className="text-[10px] text-slate-400 ml-auto">Last: {new Date(selectedContact.lastContactedAt).toLocaleDateString()}</span>}
                </div>
              </div>

              {/* Drawer Tabs */}
              <div className="flex border-b border-white/[0.06] px-5 shrink-0">
                {([{ key: 'intel' as const, label: 'Intel', icon: Zap }, { key: 'details' as const, label: 'Details', icon: Building2 }, { key: 'activity' as const, label: 'Activity', icon: Clock }]).map(t => (
                  <button key={t.key} onClick={() => setDrawerTab(t.key)} className={cn('flex items-center gap-1 px-3 py-2 text-[11px] font-medium border-b-2 -mb-px transition-colors', drawerTab === t.key ? 'border-novalyte-500 text-novalyte-400' : 'border-transparent text-slate-500 hover:text-slate-300')}>
                    <t.icon className="w-3 h-3" />{t.label}
                  </button>
                ))}
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-auto p-5 space-y-3">
                {/* INTEL TAB */}
                {drawerTab === 'intel' && intel && (<>
                  <Section title="Decision Maker" icon={<UserCheck className="w-3.5 h-3.5 text-novalyte-400" />} accent="novalyte">
                    {selectedContact.decisionMaker ? (
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-novalyte-500 to-novalyte-700 flex items-center justify-center text-white font-bold text-xs shrink-0">{selectedContact.decisionMaker.firstName[0]}{selectedContact.decisionMaker.lastName[0]}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-slate-200 text-sm">{selectedContact.decisionMaker.firstName} {selectedContact.decisionMaker.lastName}</p>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-novalyte-500/15 text-novalyte-400 font-medium">{roleLabels[selectedContact.decisionMaker.role] || selectedContact.decisionMaker.role}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{selectedContact.decisionMaker.confidence}% confidence · via {selectedContact.decisionMaker.source}</p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {selectedContact.decisionMaker.email ? (
                              <span className="flex items-center gap-1 text-xs"><Mail className="w-3 h-3 text-novalyte-400" /><a href={`mailto:${selectedContact.decisionMaker.email}`} className="text-novalyte-400 hover:underline">{selectedContact.decisionMaker.email}</a>
                                {selectedContact.decisionMaker.title?.includes('[valid]') && <span className="text-[8px] px-1 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-medium">✓ Verified</span>}
                                {selectedContact.decisionMaker.title?.includes('[risky]') && <span className="text-[8px] px-1 py-0.5 bg-amber-500/15 text-amber-400 rounded font-medium">Risky</span>}
                                {selectedContact.decisionMaker.title?.includes('[invalid]') && <span className="text-[8px] px-1 py-0.5 bg-red-500/15 text-red-400 rounded font-medium">Invalid</span>}
                              </span>
                            ) : <span className="text-[11px] text-amber-400 flex items-center gap-1"><Mail className="w-3 h-3" />No email</span>}
                            {selectedContact.decisionMaker.phone && <a href={`tel:${selectedContact.decisionMaker.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-novalyte-400"><Phone className="w-3 h-3" />{selectedContact.decisionMaker.phone}</a>}
                            {selectedContact.decisionMaker.linkedInUrl && <a href={selectedContact.decisionMaker.linkedInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:underline"><Linkedin className="w-3 h-3" />LinkedIn</a>}
                          </div>
                        </div>
                      </div>
                    ) : isEnriching ? <div className="flex items-center gap-2 py-1 text-slate-400 text-xs"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Searching...</div> : <p className="text-xs text-slate-400">No DM found. Click Enrich.</p>}
                  </Section>

                  <Section title="Outreach Playbook" icon={<Sparkles className="w-3.5 h-3.5 text-emerald-500" />} accent="emerald">
                    {(() => {
                      const dm = selectedContact.decisionMaker; const hasEmail = !!(dm?.email || selectedContact.clinic.managerEmail || selectedContact.clinic.email); const hasPhone = !!selectedContact.clinic.phone; const hasWebsite = !!selectedContact.clinic.website; const isGuessedEmail = dm?.source === 'website_scrape';
                      const steps: { icon: typeof Phone; label: string; detail: string; action?: () => void; actionLabel?: string; priority: 'high' | 'medium' | 'low' }[] = [];
                      if (hasPhone) steps.push({ icon: PhoneCall, label: 'Call clinic', detail: `${selectedContact.clinic.phone}${dm ? ` — ask for ${dm.firstName}` : ''}`, action: () => handleCallClinic(), actionLabel: 'Call', priority: 'high' });
                      if (hasEmail && !isGuessedEmail) { const em = dm?.email || selectedContact.clinic.managerEmail || selectedContact.clinic.email || ''; steps.push({ icon: Send, label: `Email ${dm ? dm.firstName : 'clinic'}`, detail: em, action: () => handleSendEmail(), actionLabel: 'Email', priority: 'high' }); }
                      if (isGuessedEmail && dm?.email) steps.push({ icon: Mail, label: 'Try guessed email', detail: `${dm.email} — low confidence`, action: () => { window.open(`mailto:${dm.email}`); addActivity(selectedContact.id, 'email_sent', `Guessed email to ${dm.email}`); }, actionLabel: 'Try', priority: 'medium' });
                      if (hasWebsite) steps.push({ icon: Globe, label: 'Check website', detail: selectedContact.clinic.website!.replace(/^https?:\/\//, ''), action: () => window.open(selectedContact.clinic.website!, '_blank'), actionLabel: 'Visit', priority: hasEmail ? 'low' : 'high' });
                      if (!hasEmail && hasWebsite) { const d = (() => { try { return new URL(selectedContact.clinic.website!.startsWith('http') ? selectedContact.clinic.website! : `https://${selectedContact.clinic.website}`).hostname.replace(/^www\./, ''); } catch { return ''; } })(); if (d) steps.push({ icon: Mail, label: 'Try email patterns', detail: `info@${d}, contact@${d}`, action: () => { window.open(`mailto:info@${d}`); addActivity(selectedContact.id, 'email_sent', `Pattern email to info@${d}`); }, actionLabel: 'Email', priority: 'medium' }); }
                      steps.push({ icon: Search, label: 'LinkedIn search', detail: `${selectedContact.clinic.name} ${selectedContact.clinic.address.city}`, action: () => window.open(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(selectedContact.clinic.name + ' ' + selectedContact.clinic.address.city)}`, '_blank'), actionLabel: 'Search', priority: hasEmail ? 'low' : 'medium' });
                      steps.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
                      return (<div className="space-y-1.5">{steps.map((s, i) => { const Icon = s.icon; return (
                        <div key={i} className={cn('flex items-center gap-2.5 p-2 rounded-lg text-xs', s.priority === 'high' ? 'bg-emerald-500/10' : s.priority === 'medium' ? 'bg-amber-500/10' : 'bg-white/[0.03]')}>
                          <Icon className={cn('w-3.5 h-3.5 shrink-0', s.priority === 'high' ? 'text-emerald-400' : s.priority === 'medium' ? 'text-amber-400' : 'text-slate-500')} />
                          <div className="flex-1 min-w-0"><p className="font-medium text-slate-300">{i + 1}. {s.label}</p><p className="text-[10px] text-slate-500 truncate">{s.detail}</p></div>
                          {s.action && <button onClick={s.action} className={cn('shrink-0 px-2 py-1 rounded text-[10px] font-medium', s.priority === 'high' ? 'bg-emerald-600 text-white' : 'bg-white/5 border border-white/[0.06] text-slate-400')}>{s.actionLabel}</button>}
                        </div>); })}</div>);
                    })()}
                  </Section>

                  <Collapsible title="Call Script" icon={<PhoneCall className="w-3.5 h-3.5 text-emerald-500" />} open={expanded.opener} onToggle={() => toggleSection('opener')}>
                    <p className="text-xs text-slate-400 leading-relaxed italic bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/10">"{intel.opener}"</p>
                  </Collapsible>
                  <Collapsible title="Talking Points" icon={<Target className="w-3.5 h-3.5 text-blue-500" />} open={expanded.talkingPoints} onToggle={() => toggleSection('talkingPoints')} count={intel.talkingPoints.length}>
                    <ul className="space-y-1.5">{intel.talkingPoints.map((tp, i) => <li key={i} className="flex items-start gap-2 text-xs text-slate-400"><CircleDot className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />{tp}</li>)}</ul>
                  </Collapsible>
                  {intel.valueProps.length > 0 && <Collapsible title="Value Props" icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />} open={expanded.valueProps} onToggle={() => toggleSection('valueProps')} count={intel.valueProps.length}>
                    <ul className="space-y-1.5">{intel.valueProps.map((vp, i) => <li key={i} className="flex items-start gap-2 text-xs text-slate-400"><ArrowUpRight className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />{vp}</li>)}</ul>
                  </Collapsible>}
                  <Collapsible title="Objection Handlers" icon={<Shield className="w-3.5 h-3.5 text-red-400" />} open={expanded.objections} onToggle={() => toggleSection('objections')} count={intel.objectionHandlers.length}>
                    <div className="space-y-1.5">{intel.objectionHandlers.map((oh, i) => <div key={i} className="text-xs text-slate-400 bg-red-500/10 border border-red-500/10 p-2.5 rounded-lg leading-relaxed">{oh}</div>)}</div>
                  </Collapsible>
                  <Collapsible title="Email Draft" icon={<Mail className="w-3.5 h-3.5 text-novalyte-500" />} open={showEmailDraft} onToggle={() => setShowEmailDraft(!showEmailDraft)}>
                    {emailDraft && (<div className="space-y-2"><p className="text-[10px] text-slate-500">Subject: <span className="font-medium text-slate-300">{emailDraft.subject}</span></p><pre className="text-xs text-slate-400 bg-white/[0.03] border border-white/[0.06] p-3 rounded-lg whitespace-pre-wrap font-sans leading-relaxed">{emailDraft.body}</pre><button onClick={() => handleSendEmail()} className="w-full flex items-center justify-center gap-1 px-3 py-1.5 bg-novalyte-600 text-white rounded-md text-[11px] font-medium hover:bg-novalyte-700"><Send className="w-3 h-3" /> Open in Email Client</button></div>)}
                  </Collapsible>
                  <Section title="Log Call Outcome" icon={<Phone className="w-3.5 h-3.5 text-slate-400" />}>
                    <div className="grid grid-cols-2 gap-1.5">{callOutcomes.map(o => <button key={o.label} onClick={() => handleLogCall(o.label, o.status)} className="flex items-center gap-1.5 text-[11px] px-2.5 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg text-slate-400 text-left transition-colors"><span className="text-sm">{o.emoji}</span>{o.label}</button>)}</div>
                  </Section>
                  <Section title="Notes" icon={<FileText className="w-3.5 h-3.5 text-slate-400" />}>
                    <textarea value={selectedContact.notes} onChange={e => { updateContact(selectedContact.id, { notes: e.target.value }); const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id); if (u) selectContact(u); }} placeholder="Add notes..." className="w-full min-h-[60px] text-xs p-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-slate-300 focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 placeholder:text-slate-600 resize-y" />
                  </Section>
                </>)}

                {/* DETAILS TAB */}
                {drawerTab === 'details' && (<>
                  <Section title="Clinic Info" icon={<Building2 className="w-3.5 h-3.5 text-slate-500" />}>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between"><span className="text-slate-500">Type</span><span className="font-medium text-slate-300">{typeLabels[selectedContact.clinic.type]}</span></div>
                      <div className="flex items-center justify-between"><span className="text-slate-500">Phone</span>{selectedContact.clinic.phone ? <a href={`tel:${selectedContact.clinic.phone}`} className="font-medium text-novalyte-400 hover:underline">{selectedContact.clinic.phone}</a> : <span className="text-slate-600">—</span>}</div>
                      <div className="flex items-center justify-between"><span className="text-slate-500">Email</span>{selectedContact.clinic.email ? <span className="font-medium text-slate-300">{selectedContact.clinic.email}</span> : <span className="text-slate-600">—</span>}</div>
                      <div className="flex items-center justify-between"><span className="text-slate-500">Website</span>{selectedContact.clinic.website ? <a href={selectedContact.clinic.website.startsWith('http') ? selectedContact.clinic.website : `https://${selectedContact.clinic.website}`} target="_blank" rel="noopener noreferrer" className="font-medium text-novalyte-400 hover:underline flex items-center gap-1 truncate max-w-[200px]"><ExternalLink className="w-3 h-3 shrink-0" />{selectedContact.clinic.website.replace(/^https?:\/\//, '')}</a> : <span className="text-slate-600">—</span>}</div>
                      <div className="flex items-center justify-between"><span className="text-slate-500">Rating</span>{selectedContact.clinic.rating ? <span className="font-medium text-slate-300 flex items-center gap-1"><Star className="w-3 h-3 text-amber-400 fill-amber-400" />{Number(selectedContact.clinic.rating).toFixed(1)} ({selectedContact.clinic.reviewCount || 0} reviews)</span> : <span className="text-slate-600">—</span>}</div>
                      <div className="flex items-start justify-between"><span className="text-slate-500">Address</span><span className="font-medium text-slate-300 text-right">{selectedContact.clinic.address.street}<br />{selectedContact.clinic.address.city}, {selectedContact.clinic.address.state} {selectedContact.clinic.address.zip}</span></div>
                    </div>
                  </Section>

                  <Section title="Key Contacts" icon={<Users className="w-3.5 h-3.5 text-novalyte-400" />} accent="novalyte">
                    <div className="space-y-2 text-xs">
                      {selectedContact.clinic.ownerName && (
                        <div className="flex items-center justify-between p-2 bg-novalyte-500/10 rounded-lg">
                          <div><p className="font-medium text-slate-300">{selectedContact.clinic.ownerName}</p><p className="text-[10px] text-slate-500">Owner / Director</p></div>
                          {selectedContact.clinic.ownerEmail && <a href={`mailto:${selectedContact.clinic.ownerEmail}`} className="text-novalyte-400 hover:underline text-[11px]">{selectedContact.clinic.ownerEmail}</a>}
                        </div>
                      )}
                      {selectedContact.clinic.managerName && selectedContact.clinic.managerName !== selectedContact.clinic.ownerName && (
                        <div className="flex items-center justify-between p-2 bg-white/[0.03] rounded-lg">
                          <div><p className="font-medium text-slate-300">{selectedContact.clinic.managerName}</p><p className="text-[10px] text-slate-500">Manager</p></div>
                          {selectedContact.clinic.managerEmail && <a href={`mailto:${selectedContact.clinic.managerEmail}`} className="text-novalyte-400 hover:underline text-[11px]">{selectedContact.clinic.managerEmail}</a>}
                        </div>
                      )}
                      {!selectedContact.clinic.ownerName && !selectedContact.clinic.managerName && <p className="text-slate-500 text-[11px]">No contacts found yet. Click Enrich to search.</p>}
                    </div>
                  </Section>

                  <Section title="Market Intelligence" icon={<BarChart3 className="w-3.5 h-3.5 text-emerald-500" />} accent="emerald">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 bg-white/[0.03] rounded-lg"><p className="text-[10px] text-slate-500">Affluence</p><p className="font-bold text-slate-300">{selectedContact.clinic.marketZone.affluenceScore}/10</p></div>
                      <div className="p-2 bg-white/[0.03] rounded-lg"><p className="text-[10px] text-slate-500">Median Income</p><p className="font-bold text-slate-300">${(selectedContact.clinic.marketZone.medianIncome / 1000).toFixed(0)}k</p></div>
                      <div className="p-2 bg-white/[0.03] rounded-lg"><p className="text-[10px] text-slate-500">Metro</p><p className="font-bold text-slate-300">{selectedContact.clinic.marketZone.metropolitanArea}</p></div>
                      <div className="p-2 bg-white/[0.03] rounded-lg"><p className="text-[10px] text-slate-500">Population</p><p className="font-bold text-slate-300">{selectedContact.clinic.marketZone.population.toLocaleString()}</p></div>
                    </div>
                  </Section>

                  {selectedContact.clinic.services.length > 0 && (
                    <Section title="Services" icon={<Briefcase className="w-3.5 h-3.5 text-blue-500" />}>
                      <div className="flex flex-wrap gap-1.5">{selectedContact.clinic.services.map((s, i) => <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-[10px] font-medium">{s}</span>)}</div>
                    </Section>
                  )}

                  {/* Google Maps Embed */}
                  <Section title="Location" icon={<MapIcon className="w-3.5 h-3.5 text-blue-400" />}>
                    <div className="rounded-lg overflow-hidden border border-white/[0.06]">
                      <iframe
                        width="100%" height="180" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                        src={`https://www.google.com/maps/embed/v1/place?key=${(import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY || ''}&q=${encodeURIComponent(selectedContact.clinic.name + ' ' + selectedContact.clinic.address.city + ' ' + selectedContact.clinic.address.state)}&zoom=14`}
                      />
                    </div>
                  </Section>

                  {/* Competitor Intelligence */}
                  <Section title="Competitor Intel" icon={<Radar className="w-3.5 h-3.5 text-orange-400" />} accent="emerald">
                    {competitorLoading ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing with Gemini...</div>
                    ) : competitorIntel ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Has Agency?</span>
                          <span className={cn('font-medium', competitorIntel.hasAgency ? 'text-red-400' : 'text-emerald-400')}>{competitorIntel.hasAgency ? 'Likely Yes' : 'No'}</span>
                        </div>
                        {competitorIntel.agencyName && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Agency</span>
                            <span className="text-slate-300 font-medium">{competitorIntel.agencyName}</span>
                          </div>
                        )}
                        {competitorIntel.agencyType && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Type</span>
                            <span className="text-slate-300 capitalize">{competitorIntel.agencyType}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Confidence</span>
                          <span className={cn('font-medium', competitorIntel.confidence >= 70 ? 'text-emerald-400' : competitorIntel.confidence >= 40 ? 'text-amber-400' : 'text-slate-500')}>{competitorIntel.confidence}%</span>
                        </div>
                        {competitorIntel.signals.length > 0 && (
                          <div className="space-y-1 mt-1">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Signals</p>
                            {competitorIntel.signals.map((s, i) => (
                              <p key={i} className="text-[10px] text-slate-400 flex items-start gap-1"><CircleDot className="w-2.5 h-2.5 text-orange-400 mt-0.5 shrink-0" />{s}</p>
                            ))}
                          </div>
                        )}
                        <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/10 mt-1">
                          <p className="text-[10px] text-orange-300 font-medium">Recommendation</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{competitorIntel.recommendation}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No competitor data available</p>
                    )}
                  </Section>

                  {selectedContact.keywordMatches.length > 0 && (
                    <Section title="Keyword Trends" icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />} accent="emerald">
                      <div className="space-y-1.5">{selectedContact.keywordMatches.map((km, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 bg-white/[0.03] rounded-lg">
                          <span className="font-medium text-slate-300">{km.keyword}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500">Score: {km.trendScore}</span>
                            <span className={cn('font-semibold', km.growthRate > 0 ? 'text-emerald-400' : 'text-red-400')}>{km.growthRate > 0 ? '+' : ''}{km.growthRate}%</span>
                          </div>
                        </div>
                      ))}</div>
                    </Section>
                  )}

                  {selectedContact.tags.length > 0 && (
                    <Section title="Tags" icon={<FileText className="w-3.5 h-3.5 text-slate-400" />}>
                      <div className="flex flex-wrap gap-1.5">{selectedContact.tags.map((t, i) => <span key={i} className="px-2 py-0.5 bg-white/5 text-slate-400 rounded text-[10px] font-medium">{t}</span>)}</div>
                    </Section>
                  )}
                </>)}

                {/* ACTIVITY TAB */}
                {drawerTab === 'activity' && (<>
                  {/* Attribution Journey */}
                  {attribution && attribution.journey.length > 0 && (
                    <Section title="Attribution Journey" icon={<Sparkles className="w-3.5 h-3.5 text-purple-400" />} accent="novalyte">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-2">
                          <span>{attribution.totalTouchPoints} touchpoints</span>
                          <span>·</span>
                          <span>{attribution.daysInPipeline}d in pipeline</span>
                        </div>
                        <div className="px-2 py-1.5 bg-purple-500/10 rounded-lg border border-purple-500/10 mb-2">
                          <p className="text-[10px] text-purple-300 font-mono">{attribution.conversionPath}</p>
                        </div>
                        {attribution.journey.map((tp, i) => {
                          const tpColors: Record<string, string> = {
                            keyword_discovered: 'text-violet-400 bg-violet-500/15',
                            clinic_discovered: 'text-blue-400 bg-blue-500/15',
                            enriched: 'text-purple-400 bg-purple-500/15',
                            email_sent: 'text-novalyte-400 bg-novalyte-500/15',
                            email_opened: 'text-emerald-400 bg-emerald-500/15',
                            called: 'text-amber-400 bg-amber-500/15',
                            qualified: 'text-green-400 bg-green-500/15',
                          };
                          const color = tpColors[tp.type] || 'text-slate-400 bg-white/5';
                          return (
                            <div key={i} className="flex items-start gap-2.5">
                              <div className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[8px] font-bold', color)}>{i + 1}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-slate-300">{tp.detail}</p>
                                <p className="text-[9px] text-slate-600">{new Date(tp.timestamp).toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}

                  <Section title="Timeline" icon={<Clock className="w-3.5 h-3.5 text-slate-500" />}>
                    {selectedContact.activities.length > 0 ? (
                      <div className="space-y-2">
                        {[...selectedContact.activities].reverse().map(act => {
                          const iconMap: Record<Activity['type'], { icon: typeof Phone; color: string; bg: string }> = {
                            call_made: { icon: PhoneCall, color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
                            call_scheduled: { icon: Calendar, color: 'text-violet-400', bg: 'bg-violet-500/15' },
                            email_sent: { icon: Send, color: 'text-novalyte-400', bg: 'bg-novalyte-500/15' },
                            note_added: { icon: FileText, color: 'text-slate-400', bg: 'bg-white/5' },
                            status_change: { icon: ArrowUpDown, color: 'text-amber-400', bg: 'bg-amber-500/15' },
                            follow_up_set: { icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-500/15' },
                            enriched: { icon: Sparkles, color: 'text-purple-400', bg: 'bg-purple-500/15' },
                          };
                          const cfg = iconMap[act.type] || { icon: CircleDot, color: 'text-slate-500', bg: 'bg-white/5' };
                          const Icon = cfg.icon;
                          return (
                            <div key={act.id} className="flex items-start gap-2.5">
                              <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5', cfg.bg)}><Icon className={cn('w-3 h-3', cfg.color)} /></div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-300">{act.description}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{new Date(act.timestamp).toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-xs text-slate-400">No activity yet</p>}
                  </Section>

                  <Section title="Notes" icon={<FileText className="w-3.5 h-3.5 text-slate-400" />}>
                    <textarea
                      value={selectedContact.notes}
                      onChange={e => {
                        updateContact(selectedContact.id, { notes: e.target.value });
                        const u = useAppStore.getState().contacts.find(c => c.id === selectedContact.id);
                        if (u) selectContact(u);
                      }}
                      placeholder="Add notes..."
                      className="w-full min-h-[80px] text-xs p-2.5 bg-white/[0.03] border border-white/[0.06] rounded-lg text-slate-300 focus:outline-none focus:ring-2 focus:ring-novalyte-500/20 placeholder:text-slate-600 resize-y"
                    />
                    <button
                      onClick={() => {
                        if (selectedContact.notes.trim()) {
                          addActivity(selectedContact.id, 'note_added', selectedContact.notes.trim());
                          toast.success('Note saved to timeline');
                        }
                      }}
                      className="mt-1.5 w-full flex items-center justify-center gap-1 px-3 py-1.5 bg-white/5 text-slate-400 rounded-md text-[11px] font-medium hover:bg-white/[0.08]"
                    >
                      <MessageSquare className="w-3 h-3" /> Save to Timeline
                    </button>
                  </Section>
                </>)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Prior Outreach Alert Modal ═══ */}
      {outreachAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-white/[0.06]">
            <div className="px-5 py-4 bg-amber-500/10 border-b border-amber-500/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <h3 className="font-semibold text-white text-sm">Previous Outreach Detected</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {outreachAlert.contact.clinic.name} has been contacted before. Review activity before reaching out again.
              </p>
            </div>
            <div className="px-5 py-4 max-h-[280px] overflow-auto">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Outreach History ({outreachAlert.history.length})</p>
              <div className="space-y-2">
                {outreachAlert.history.map(act => (
                  <div key={act.id} className="flex items-start gap-2.5 p-2 bg-white/[0.03] rounded-lg">
                    <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0', act.type === 'call_made' ? 'bg-emerald-500/15' : 'bg-novalyte-500/15')}>
                      {act.type === 'call_made' ? <PhoneCall className="w-3 h-3 text-emerald-400" /> : <Send className="w-3 h-3 text-novalyte-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-300">{act.description}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{new Date(act.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button onClick={() => setOutreachAlert(null)} className="px-3 py-1.5 text-xs font-medium text-slate-400 bg-white/5 border border-white/[0.06] rounded-lg hover:bg-white/[0.08]">Cancel</button>
              <button onClick={handleOutreachAlertProceed} className={cn('px-3 py-1.5 text-xs font-medium text-white rounded-lg', outreachAlert.action === 'call' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-novalyte-600 hover:bg-novalyte-700')}>
                {outreachAlert.action === 'call' ? 'Call Anyway' : 'Email Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helper Components ─── */

function Section({ title, icon, accent, children }: { title: string; icon?: React.ReactNode; accent?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 border-b',
        accent === 'novalyte' ? 'bg-gradient-to-r from-novalyte-500/10 to-transparent border-novalyte-500/10' :
        accent === 'emerald' ? 'bg-gradient-to-r from-emerald-500/10 to-transparent border-emerald-500/10' :
        'bg-gradient-to-r from-white/[0.03] to-transparent border-white/[0.04]'
      )}>
        {icon}
        <span className="text-[11px] font-semibold text-slate-300">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Collapsible({ title, icon, open, onToggle, count, children }: { title: string; icon?: React.ReactNode; open: boolean; onToggle: () => void; count?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-white/[0.03] to-transparent hover:from-white/[0.05] transition-colors">
        {icon}
        <span className="text-[11px] font-semibold text-slate-300 flex-1 text-left">{title}</span>
        {count !== undefined && <span className="text-[10px] text-slate-500 tabular-nums">{count}</span>}
        {open ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
      </button>
      {open && <div className="p-3 border-t border-white/[0.04]">{children}</div>}
    </div>
  );
}

export default CRM;
