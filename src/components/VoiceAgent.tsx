import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, Users, Clock, CheckCircle, XCircle,
  MessageSquare, RefreshCw, Play, Pause, Search, Filter, MapPin, Star,
  Zap, Target, BarChart3, Mic, Volume2, FileText, Send, Copy,
  ChevronDown, ChevronUp, ChevronLeft, X, AlertCircle, Radio, Headphones,
  TrendingUp, Building2, Shield, UserCheck, Sparkles, Activity,
  Globe, Mail, Edit3, Eye, SkipForward, PhoneForwarded, Loader2,
  BadgeCheck, Hash, Stethoscope, Settings,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { voiceAgentService } from '../services/voiceAgentService';
import { enrichmentService } from '../services/enrichmentService';
import { emailIntelService, EmailCandidate } from '../services/emailIntelService';
import { CRMContact, VoiceCall, ContactStatus, DecisionMaker } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';

/* ─── NPI result type for inline display ─── */
interface NpiPerson {
  npi: string;
  name: string;
  title: string;
  role: string;
  phone?: string;
  email?: string;
  taxonomy?: string;
  source: 'npi';
}

/* ─── Types ─── */
type Tab = 'queue' | 'active' | 'history' | 'dialpad' | 'vapi';
type QueueSort = 'score' | 'priority' | 'name' | 'market';

/* ─── Helpers ─── */
const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const statusLabels: Record<string, { label: string; color: string; icon: typeof Phone }> = {
  queued: { label: 'Queued', color: 'text-slate-400', icon: Clock },
  ringing: { label: 'Ringing', color: 'text-blue-400', icon: Phone },
  in_progress: { label: 'In Progress', color: 'text-green-400', icon: PhoneCall },
  completed: { label: 'Completed', color: 'text-emerald-400', icon: CheckCircle },
  failed: { label: 'Failed', color: 'text-red-400', icon: XCircle },
  no_answer: { label: 'No Answer', color: 'text-orange-400', icon: PhoneMissed },
  voicemail: { label: 'Voicemail', color: 'text-amber-400', icon: MessageSquare },
};

const outcomeLabels: Record<string, { label: string; emoji: string; color: string }> = {
  interested: { label: 'Interested', emoji: '🟢', color: 'text-emerald-400 bg-emerald-500/10' },
  schedule_demo: { label: 'Demo Scheduled', emoji: '📅', color: 'text-emerald-400 bg-emerald-500/10' },
  send_info: { label: 'Send Info', emoji: '📧', color: 'text-blue-400 bg-blue-500/10' },
  not_interested: { label: 'Not Interested', emoji: '🔴', color: 'text-red-400 bg-red-500/10' },
  callback_requested: { label: 'Callback', emoji: '📞', color: 'text-amber-400 bg-amber-500/10' },
  wrong_contact: { label: 'Wrong Contact', emoji: '❌', color: 'text-slate-400 bg-white/5' },
  gatekeeper_block: { label: 'Gatekeeper', emoji: '🚪', color: 'text-orange-400 bg-orange-500/10' },
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function getElapsed(start: Date): number {
  return Math.floor((Date.now() - new Date(start).getTime()) / 1000);
}


/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function VoiceAgent() {
  const {
    contacts, activeCalls, callHistory,
    addCall, updateCall, completeCall, clearStaleCalls,
    updateContact, updateContactStatus,
  } = useAppStore();

  const [tab, setTab] = useState<Tab>('queue');
  const [search, setSearch] = useState('');
  const [queueSort, setQueueSort] = useState<QueueSort>('score');
  const [selectedCall, setSelectedCall] = useState<VoiceCall | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [callingIds, setCallingIds] = useState<Set<string>>(new Set());
  const [batchCalling, setBatchCalling] = useState(false);
  const [batchDelay, setBatchDelay] = useState(15);
  const [tick, setTick] = useState(0);
  const [customScripts, setCustomScripts] = useState<Record<string, string>>({});
  const pollRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const tickRef = useRef<NodeJS.Timeout>();
  const batchRef = useRef(false);

  const isConfigured = voiceAgentService.isConfigured;

  // Tick every second for elapsed timers on active calls
  useEffect(() => {
    if (activeCalls.length > 0) {
      tickRef.current = setInterval(() => setTick(t => t + 1), 1000);
      return () => clearInterval(tickRef.current);
    }
  }, [activeCalls.length]);

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      pollRef.current.forEach(t => clearInterval(t));
      pollRef.current.clear();
    };
  }, []);

  // Keep batch ref in sync
  useEffect(() => { batchRef.current = batchCalling; }, [batchCalling]);

  /* ─── Queue ─── */
  const queue = useMemo(() => {
    let list = contacts.filter(c =>
      (c.status === 'ready_to_call' || c.status === 'new' || c.status === 'follow_up') && c.clinic.phone
    );
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.clinic.name.toLowerCase().includes(q) ||
        c.clinic.address.city.toLowerCase().includes(q) ||
        c.clinic.address.state.toLowerCase().includes(q) ||
        (c.decisionMaker && `${c.decisionMaker.firstName} ${c.decisionMaker.lastName}`.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      switch (queueSort) {
        case 'score': return b.score - a.score;
        case 'priority': return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
        case 'name': return a.clinic.name.localeCompare(b.clinic.name);
        case 'market': return a.clinic.marketZone.city.localeCompare(b.clinic.marketZone.city);
        default: return 0;
      }
    });
    return list;
  }, [contacts, search, queueSort]);

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCalls = callHistory.filter(c => new Date(c.startTime) >= today);
    const connected = todayCalls.filter(c => c.status === 'completed' && c.outcome && c.outcome !== 'wrong_contact');
    const qualified = todayCalls.filter(c => c.outcome === 'interested' || c.outcome === 'schedule_demo');
    const durations = todayCalls.filter(c => c.duration).map(c => c.duration!);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const successRate = todayCalls.length ? Math.round((connected.length / todayCalls.length) * 100) : 0;
    return { totalToday: todayCalls.length, connected: connected.length, qualified: qualified.length, avgDuration, successRate, active: activeCalls.length };
  }, [callHistory, activeCalls.length, tick]);

  /* ─── Call Initiation ─── */
  const initiateCall = useCallback(async (contact: CRMContact, customMsg?: string) => {
    if (callingIds.has(contact.id)) return;
    setCallingIds(prev => new Set(prev).add(contact.id));
    try {
      const call = await voiceAgentService.initiateCall(contact, customMsg);
      addCall(call);
      updateContactStatus(contact.id, 'called');
      updateContact(contact.id, {
        lastContactedAt: new Date(),
        activities: [...(contact.activities || []), {
          id: `act-${Date.now()}`, type: 'call_made' as const,
          description: 'Outbound call initiated via Vapi', timestamp: new Date(),
          metadata: { callId: call.id },
        }],
      });
      toast.success(`Calling ${contact.clinic.name}...`);
      setTab('active');
      startPolling(call.id, contact.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate call');
    } finally {
      setCallingIds(prev => { const s = new Set(prev); s.delete(contact.id); return s; });
    }
  }, [callingIds, addCall, updateContactStatus, updateContact]);

  /* ─── Status Polling (with max retries) ─── */
  const startPolling = useCallback((callId: string, contactId: string) => {
    if (pollRef.current.has(callId)) return;
    let retries = 0;
    const MAX_RETRIES = 60; // 60 × 5s = 5 minutes max polling
    let consecutiveErrors = 0;
    const interval = setInterval(async () => {
      retries++;
      if (retries > MAX_RETRIES) {
        // Timed out — auto-complete the call
        clearInterval(interval);
        pollRef.current.delete(callId);
        completeCall(callId, {
          status: 'completed',
          notes: 'Auto-completed: polling timed out after 5 minutes',
        });
        toast('Call polling timed out — moved to history', { icon: '⏱️' });
        return;
      }
      try {
        const status = await voiceAgentService.getCallStatus(callId);
        consecutiveErrors = 0;
        updateCall(callId, status);
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'no_answer') {
          clearInterval(interval);
          pollRef.current.delete(callId);
          const outcome = status.status === 'completed' && status.transcript
            ? voiceAgentService.analyzeCallOutcome(status.transcript) : undefined;
          const duration = status.endTime
            ? Math.round((new Date(status.endTime).getTime() - new Date().getTime()) / 1000 + getElapsed(new Date()))
            : undefined;
          completeCall(callId, {
            ...status,
            duration: duration && duration > 0 ? duration : undefined,
            outcome: outcome?.outcome, sentiment: outcome?.sentiment,
            followUpRequired: outcome?.followUpRequired ?? false,
            notes: outcome?.summary || status.notes,
          });
          if (outcome) {
            const statusMap: Record<string, ContactStatus> = {
              interested: 'qualified', schedule_demo: 'qualified', send_info: 'follow_up',
              not_interested: 'not_interested', callback_requested: 'follow_up',
              wrong_contact: 'wrong_number', gatekeeper_block: 'follow_up',
            };
            if (statusMap[outcome.outcome]) updateContactStatus(contactId, statusMap[outcome.outcome]);
            const ct = contacts.find(c => c.id === contactId);
            if (ct) {
              updateContact(contactId, {
                activities: [...(ct.activities || []), {
                  id: `act-${Date.now()}`, type: 'call_made' as const,
                  description: `Call completed: ${outcome.summary}`, timestamp: new Date(),
                  metadata: { callId, outcome: outcome.outcome, sentiment: outcome.sentiment },
                }],
              });
            }
          }
          toast.success(`Call to ${contacts.find(c => c.id === contactId)?.clinic.name || 'clinic'} completed`);
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= 6) {
          // 6 consecutive errors (30s) — give up
          clearInterval(interval);
          pollRef.current.delete(callId);
          completeCall(callId, {
            status: 'failed',
            notes: 'Auto-failed: lost connection to Vapi API',
          });
          toast.error('Lost connection to Vapi — call moved to history');
        }
      }
    }, 5000);
    pollRef.current.set(callId, interval);
  }, [updateCall, completeCall, updateContactStatus, updateContact, contacts]);

  /* ─── Batch Call ─── */
  const startBatchCall = useCallback(async () => {
    if (batchCalling || queue.length === 0) return;
    setBatchCalling(true);
    batchRef.current = true;
    setTab('active');
    for (let i = 0; i < queue.length; i++) {
      if (!batchRef.current) break;
      await initiateCall(queue[i]);
      if (i < queue.length - 1 && batchRef.current) {
        await new Promise(r => setTimeout(r, batchDelay * 1000));
      }
    }
    setBatchCalling(false);
    batchRef.current = false;
  }, [batchCalling, queue, batchDelay, initiateCall]);

  const stopBatch = useCallback(() => {
    setBatchCalling(false);
    batchRef.current = false;
  }, []);

  /* ─── Render ─── */
  const tabCounts: Record<Tab, number> = { queue: queue.length, active: activeCalls.length, history: callHistory.length, dialpad: 0, vapi: 0 };

  const tabMeta: { id: Tab; label: string; icon: typeof Phone }[] = [
    { id: 'queue', label: 'Queue', icon: Users },
    { id: 'active', label: 'Active', icon: PhoneCall },
    { id: 'history', label: 'History', icon: FileText },
    { id: 'dialpad', label: 'Dial Pad', icon: Hash },
    { id: 'vapi', label: 'Vapi', icon: Radio },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100">Voice Agent</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">AI-powered outbound calling — tap a clinic to open controls</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {batchCalling && (
            <button onClick={stopBatch} className="btn btn-danger gap-2 text-xs sm:text-sm">
              <Pause className="w-4 h-4" /> Stop Batch
            </button>
          )}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            isConfigured ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
          )}>
            <Radio className={cn('w-3 h-3', isConfigured && 'animate-subtle-pulse')} />
            {isConfigured ? 'Vapi Connected' : 'Not Configured'}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 lg:grid-cols-6 scrollbar-hide">
        {[
          { label: 'Calls Today', value: stats.totalToday, icon: Phone, color: 'text-novalyte-400' },
          { label: 'Connected', value: stats.connected, icon: PhoneCall, color: 'text-emerald-400' },
          { label: 'Qualified', value: stats.qualified, icon: Target, color: 'text-violet-400' },
          { label: 'Avg Duration', value: stats.avgDuration ? formatDuration(stats.avgDuration) : '—', icon: Clock, color: 'text-amber-400' },
          { label: 'Success Rate', value: stats.successRate ? `${stats.successRate}%` : '—', icon: TrendingUp, color: 'text-emerald-400' },
          { label: 'Active Now', value: stats.active, icon: Activity, color: stats.active > 0 ? 'text-green-400' : 'text-slate-500' },
        ].map(s => (
          <div key={s.label} className="glass-card p-3 min-w-[130px] sm:min-w-0 shrink-0 sm:shrink">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={cn('w-4 h-4', s.color)} />
              <span className="text-xs text-slate-500">{s.label}</span>
            </div>
            <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-lg border border-white/[0.06] overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-1 sm:w-fit">
        {tabMeta.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={cn(
            'px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0',
            tab === id ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
          )}>
            <Icon className="w-4 h-4" />
            {label}
            {tabCounts[id] > 0 && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                id === 'active' && tabCounts[id] > 0 ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-slate-400'
              )}>{tabCounts[id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'queue' && (
        <QueueTab
          queue={queue} search={search} setSearch={setSearch}
          queueSort={queueSort} setQueueSort={setQueueSort}
          callingIds={callingIds} batchCalling={batchCalling}
          batchDelay={batchDelay} setBatchDelay={setBatchDelay}
          onCall={initiateCall} onBatchCall={startBatchCall}
          isConfigured={isConfigured}
          expandedId={expandedId} setExpandedId={setExpandedId}
          customScripts={customScripts} setCustomScripts={setCustomScripts}
          updateContactStatus={updateContactStatus}
        />
      )}
      {tab === 'active' && (
        <ActiveTab calls={activeCalls} contacts={contacts} tick={tick} onSelect={setSelectedCall} onClearAll={clearStaleCalls} />
      )}
      {tab === 'history' && (
        <HistoryTab calls={callHistory} contacts={contacts} onSelect={setSelectedCall} />
      )}
      {tab === 'dialpad' && (
        <DialPadTab
          isConfigured={isConfigured}
          onCallStarted={(call) => { addCall(call); setTab('active'); }}
          startPolling={startPolling}
        />
      )}
      {tab === 'vapi' && <VapiTab />}

      {/* Call Detail Drawer */}
      {selectedCall && (
        <CallDrawer
          call={selectedCall}
          contact={contacts.find(c => c.id === selectedCall.contactId)}
          onClose={() => setSelectedCall(null)}
        />
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   CLINIC INTEL PANEL — NPI Registry + 3 Emails + Decision Makers
   Renders inside the expanded queue row (Column 1)
   ═══════════════════════════════════════════════════════════════ */

function ClinicIntelPanel({ contact }: { contact: CRMContact }) {
  const { updateContact } = useAppStore();
  const clinic = contact.clinic;
  const market = clinic.marketZone;
  const dm = contact.decisionMaker;

  const [npiResults, setNpiResults] = useState<NpiPerson[]>([]);
  const [npiLoading, setNpiLoading] = useState(false);
  const [npiSearched, setNpiSearched] = useState(false);
  const [emails, setEmails] = useState<EmailCandidate[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsSearched, setEmailsSearched] = useState(false);

  // Auto-fetch NPI + emails when panel opens
  useEffect(() => {
    fetchNpi();
    fetchEmails();
  }, [contact.id]);

  const fetchNpi = async () => {
    if (npiLoading) return;
    setNpiLoading(true);
    try {
      const results = await enrichmentService.findDecisionMakers(clinic);
      const npiPeople: NpiPerson[] = results
        .filter(r => r.source === 'npi')
        .map(r => ({
          npi: r.id.replace('npi-', '').replace('npi-broad-', ''),
          name: `${r.firstName} ${r.lastName}`.trim(),
          title: r.title,
          role: r.role.replace(/_/g, ' '),
          phone: r.phone,
          email: r.email,
          taxonomy: r.title,
          source: 'npi' as const,
        }));
      setNpiResults(npiPeople);
      setNpiSearched(true);

      // Also update the contact's decision maker if we found a better one
      if (npiPeople.length > 0 && (!dm || dm.source !== 'npi' || dm.confidence < 60)) {
        const best = results.find(r => r.source === 'npi' && r.confidence >= 50);
        if (best) {
          updateContact(contact.id, { decisionMaker: best });
        }
      }
    } catch (err) {
      console.warn('NPI lookup failed:', err);
    } finally {
      setNpiLoading(false);
    }
  };

  const fetchEmails = async () => {
    if (emailsLoading) return;
    setEmailsLoading(true);
    try {
      const candidates = await emailIntelService.findAndVerifyEmails(clinic);
      // Take top 3 non-generic personal emails, then fill with generics if needed
      const personal = candidates.filter(c => !c.isGeneric);
      const generic = candidates.filter(c => c.isGeneric);
      const top3 = [...personal.slice(0, 3)];
      if (top3.length < 3) top3.push(...generic.slice(0, 3 - top3.length));
      setEmails(top3);
      setEmailsSearched(true);
    } catch (err) {
      console.warn('Email lookup failed:', err);
    } finally {
      setEmailsLoading(false);
    }
  };

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    toast.success('Email copied');
  };

  return (
    <div className="space-y-3">
      {/* Market data */}
      <h4 className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
        <Building2 className="w-3 h-3" /> Clinic Intel
      </h4>
      <div className="space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Market</span><span className="text-slate-300">{market.city}, {market.state}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Affluence</span><span className="text-emerald-400 font-medium">{market.affluenceScore}/10</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Median Income</span><span className="text-slate-300">${(market.medianIncome / 1000).toFixed(0)}k</span></div>
        {clinic.rating && <div className="flex justify-between"><span className="text-slate-500">Rating</span><span className="text-amber-400">{Number(clinic.rating).toFixed(1)}★ ({clinic.reviewCount || 0})</span></div>}
        {clinic.website && (
          <a href={clinic.website.startsWith('http') ? clinic.website : `https://${clinic.website}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-novalyte-400 hover:text-novalyte-300 mt-1">
            <Globe className="w-3 h-3" /> Visit website
          </a>
        )}
      </div>

      {/* ─── NPI Registry Section ─── */}
      <div className="border-t border-white/[0.04] pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Stethoscope className="w-3 h-3" /> NPI Registry
          </h4>
          <button onClick={fetchNpi} disabled={npiLoading}
            className="text-[10px] text-novalyte-400 hover:text-novalyte-300 flex items-center gap-1 transition-all disabled:opacity-50">
            {npiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {npiLoading ? 'Searching...' : 'Refresh'}
          </button>
        </div>

        {npiLoading && !npiSearched && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Searching NPI Registry...
          </div>
        )}

        {npiSearched && npiResults.length === 0 && (
          <p className="text-[10px] text-slate-600 py-1">No NPI records found for this clinic</p>
        )}

        {npiResults.length > 0 && (
          <div className="space-y-2">
            {npiResults.slice(0, 4).map((person, i) => (
              <div key={i} className="bg-white/[0.02] rounded-lg p-2 border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <BadgeCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="text-xs text-slate-200 font-medium">{person.name}</span>
                  </div>
                  <span className="text-[9px] text-slate-600 font-mono">NPI: {person.npi}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-slate-400 capitalize">{person.role}</span>
                  {person.taxonomy && person.taxonomy !== person.role && (
                    <span className="text-slate-500">{person.taxonomy}</span>
                  )}
                  {person.phone && (
                    <span className="text-slate-400 flex items-center gap-0.5">
                      <Phone className="w-2.5 h-2.5" /> {person.phone}
                    </span>
                  )}
                  {person.email && (
                    <button onClick={() => copyEmail(person.email!)}
                      className="text-novalyte-400 hover:text-novalyte-300 flex items-center gap-0.5 transition-all">
                      <Mail className="w-2.5 h-2.5" /> {person.email}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Emails Section (3 per clinic) ─── */}
      <div className="border-t border-white/[0.04] pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> Emails ({emails.length}/3)
          </h4>
          <button onClick={fetchEmails} disabled={emailsLoading}
            className="text-[10px] text-novalyte-400 hover:text-novalyte-300 flex items-center gap-1 transition-all disabled:opacity-50">
            {emailsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {emailsLoading ? 'Finding...' : 'Refresh'}
          </button>
        </div>

        {emailsLoading && !emailsSearched && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Running email intel pipeline...
          </div>
        )}

        {emailsSearched && emails.length === 0 && (
          <p className="text-[10px] text-slate-600 py-1">No emails found — try refreshing</p>
        )}

        {emails.length > 0 && (
          <div className="space-y-1.5">
            {emails.map((em, i) => (
              <div key={i} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-2.5 py-1.5 border border-white/[0.04] group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('text-xs font-medium truncate',
                      em.isGeneric ? 'text-slate-500' : 'text-slate-200'
                    )}>{em.email}</span>
                    {em.verified && em.verificationStatus === 'valid' && (
                      <BadgeCheck className="w-3 h-3 text-emerald-400 shrink-0" title="Verified valid" />
                    )}
                    {em.verified && em.verificationStatus === 'risky' && (
                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" title="Risky — catch-all" />
                    )}
                    {em.verified && em.verificationStatus === 'invalid' && (
                      <XCircle className="w-3 h-3 text-red-400 shrink-0" title="Invalid" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    {em.personName && <span>{em.personName}</span>}
                    {em.personTitle && <span className="capitalize">· {em.personTitle}</span>}
                    <span className="text-slate-600">· {em.confidence}% conf</span>
                  </div>
                </div>
                <button onClick={() => copyEmail(em.email)}
                  className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Existing DM from CRM */}
      {dm && dm.source !== 'npi' && (
        <div className="border-t border-white/[0.04] pt-3">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <UserCheck className="w-3 h-3" /> CRM Decision Maker
          </h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Name</span><span className="text-slate-200 font-medium">{dm.firstName} {dm.lastName}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Role</span><span className="text-slate-300 capitalize">{dm.role.replace(/_/g, ' ')}</span></div>
            {dm.email && <div className="flex justify-between"><span className="text-slate-500">Email</span>
              <button onClick={() => copyEmail(dm.email!)} className="text-novalyte-400 hover:text-novalyte-300 transition-all">{dm.email}</button>
            </div>}
            <div className="flex justify-between"><span className="text-slate-500">Source</span><span className="text-slate-500 capitalize">{dm.source}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Confidence</span><span className={cn(
              dm.confidence >= 70 ? 'text-emerald-400' : dm.confidence >= 40 ? 'text-amber-400' : 'text-slate-500'
            )}>{dm.confidence}%</span></div>
          </div>
        </div>
      )}

      {/* Keyword matches */}
      {contact.keywordMatches.length > 0 && (
        <div className="border-t border-white/[0.04] pt-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Trending Keywords</p>
          <div className="flex flex-wrap gap-1">
            {contact.keywordMatches.slice(0, 4).map(kw => (
              <span key={kw.id} className="badge bg-violet-500/10 text-violet-400 text-[10px]">
                {kw.keyword} +{kw.growthRate}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   QUEUE TAB — Interactive, click-to-expand with full controls
   ═══════════════════════════════════════════════════════════════ */

function QueueTab({
  queue, search, setSearch, queueSort, setQueueSort,
  callingIds, batchCalling, batchDelay, setBatchDelay,
  onCall, onBatchCall, isConfigured, expandedId, setExpandedId,
  customScripts, setCustomScripts, updateContactStatus,
}: {
  queue: CRMContact[];
  search: string; setSearch: (s: string) => void;
  queueSort: QueueSort; setQueueSort: (s: QueueSort) => void;
  callingIds: Set<string>; batchCalling: boolean;
  batchDelay: number; setBatchDelay: (d: number) => void;
  onCall: (c: CRMContact, customMsg?: string) => void;
  onBatchCall: () => void;
  isConfigured: boolean;
  expandedId: string | null; setExpandedId: (id: string | null) => void;
  customScripts: Record<string, string>;
  setCustomScripts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  updateContactStatus: (id: string, status: ContactStatus) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search clinics, contacts, cities..." className="input pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Sort:</span>
          {(['score', 'priority', 'name', 'market'] as QueueSort[]).map(s => (
            <button key={s} onClick={() => setQueueSort(s)} className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-all',
              queueSort === s ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
            )}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Delay:</span>
            <input type="number" min={5} max={120} value={batchDelay}
              onChange={e => setBatchDelay(Number(e.target.value))} className="input w-16 text-center" />
            <span>sec</span>
          </div>
          <button onClick={onBatchCall} disabled={!isConfigured || queue.length === 0 || batchCalling}
            className="btn btn-primary gap-2">
            <Zap className="w-4 h-4" /> Call All ({queue.length})
          </button>
        </div>
      </div>

      {!isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Vapi not configured</p>
            <p className="text-xs text-slate-400">Add your Vapi API keys to .env to enable calling.</p>
          </div>
        </div>
      )}

      {queue.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No contacts in the call queue</p>
          <p className="text-xs text-slate-500 mt-1">Add contacts with status "Ready to Call" from the CRM</p>
        </div>
      ) : (
        <div className="space-y-2">
          {queue.map(contact => {
            const isExpanded = expandedId === contact.id;
            const isCalling = callingIds.has(contact.id);
            const dm = contact.decisionMaker;
            const clinic = contact.clinic;
            const market = clinic.marketZone;
            const defaultScript = voiceAgentService.buildFirstMessage(contact);
            const currentScript = customScripts[contact.id] ?? defaultScript;

            return (
              <div key={contact.id} className={cn(
                'glass-card transition-all overflow-hidden',
                isExpanded ? 'ring-1 ring-novalyte-500/30' : 'hover:bg-white/[0.02]'
              )}>
                {/* Row header — clickable */}
                <div
                  className="p-4 cursor-pointer flex items-center gap-4"
                  onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                >
                  {/* Score badge */}
                  <div className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0',
                    contact.score >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                    contact.score >= 60 ? 'bg-amber-500/15 text-amber-400' : 'bg-white/5 text-slate-400'
                  )}>{contact.score}</div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">{clinic.name}</span>
                      <span className={cn('badge text-[10px]',
                        contact.priority === 'critical' ? 'bg-red-500/10 text-red-400' :
                        contact.priority === 'high' ? 'bg-orange-500/10 text-orange-400' : 'bg-white/5 text-slate-500'
                      )}>{contact.priority}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {dm && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{dm.firstName} {dm.lastName}</span>}
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{clinic.address.city}, {clinic.address.state}</span>
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{clinic.phone}</span>
                    </div>
                  </div>

                  {/* Services */}
                  <div className="hidden lg:flex items-center gap-1 max-w-[200px] overflow-hidden">
                    {clinic.services.slice(0, 2).map(s => (
                      <span key={s} className="badge bg-white/5 text-slate-500 text-[10px] truncate">{s}</span>
                    ))}
                  </div>

                  {/* Expand indicator */}
                  <div className="shrink-0 text-slate-500">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* ─── Expanded Control Panel ─── */}
                {isExpanded && (
                  <div className="border-t border-white/[0.06] bg-white/[0.01] animate-fade-in">
                    <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

                      {/* Column 1: Clinic Intel + NPI + Emails */}
                      <ClinicIntelPanel contact={contact} />

                      {/* Column 2: Editable Call Script */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Edit3 className="w-3 h-3" /> Call Script
                          </h4>
                          {customScripts[contact.id] && (
                            <button onClick={() => setCustomScripts(prev => { const n = { ...prev }; delete n[contact.id]; return n; })}
                              className="text-[10px] text-slate-500 hover:text-slate-300 transition-all">
                              Reset to default
                            </button>
                          )}
                        </div>
                        <textarea
                          value={currentScript}
                          onChange={e => setCustomScripts(prev => ({ ...prev, [contact.id]: e.target.value }))}
                          rows={6}
                          className="input text-xs leading-relaxed resize-none"
                          placeholder="Edit the opening message the AI agent will use..."
                        />
                        <div className="flex gap-2">
                          <button onClick={() => { navigator.clipboard.writeText(currentScript); toast.success('Script copied'); }}
                            className="btn btn-secondary gap-1.5 text-xs flex-1">
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                          <button onClick={() => {
                            const script = voiceAgentService.buildFirstMessage(contact);
                            setCustomScripts(prev => ({ ...prev, [contact.id]: script }));
                          }} className="btn btn-secondary gap-1.5 text-xs flex-1">
                            <RefreshCw className="w-3 h-3" /> Regenerate
                          </button>
                        </div>
                      </div>

                      {/* Column 3: Actions */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3 h-3" /> Actions
                        </h4>

                        {/* Big call button */}
                        <button
                          onClick={() => onCall(contact, customScripts[contact.id] || undefined)}
                          disabled={!isConfigured || isCalling}
                          className={cn(
                            'w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all',
                            isCalling
                              ? 'bg-green-500/20 text-green-400 border border-green-500/20 cursor-wait'
                              : 'bg-gradient-to-r from-novalyte-500 to-novalyte-400 text-white hover:from-novalyte-400 hover:to-novalyte-300 shadow-lg shadow-novalyte-500/20'
                          )}
                        >
                          {isCalling ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Initiating Call...</>
                          ) : (
                            <><Phone className="w-4 h-4" /> Call {dm ? dm.firstName : clinic.name}</>
                          )}
                        </button>

                        {/* Quick actions */}
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => { updateContactStatus(contact.id, 'not_interested'); setExpandedId(null); toast.success('Marked not interested'); }}
                            className="btn btn-secondary gap-1.5 text-xs justify-center">
                            <XCircle className="w-3 h-3 text-red-400" /> Skip
                          </button>
                          <button onClick={() => { updateContactStatus(contact.id, 'call_scheduled'); setExpandedId(null); toast.success('Marked for later'); }}
                            className="btn btn-secondary gap-1.5 text-xs justify-center">
                            <Clock className="w-3 h-3 text-amber-400" /> Later
                          </button>
                          <button onClick={() => { updateContactStatus(contact.id, 'follow_up'); setExpandedId(null); toast.success('Moved to follow-up'); }}
                            className="btn btn-secondary gap-1.5 text-xs justify-center">
                            <PhoneForwarded className="w-3 h-3 text-blue-400" /> Follow Up
                          </button>
                          <button onClick={() => {
                            const phone = clinic.phone;
                            if (phone) { navigator.clipboard.writeText(phone); toast.success('Phone copied'); }
                          }} className="btn btn-secondary gap-1.5 text-xs justify-center">
                            <Copy className="w-3 h-3" /> Copy #
                          </button>
                        </div>

                        {/* Services list */}
                        {clinic.services.length > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Services</p>
                            <div className="flex flex-wrap gap-1">
                              {clinic.services.map(s => (
                                <span key={s} className="badge bg-white/5 text-slate-400 text-[10px]">{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   ACTIVE TAB — live calls with real-time status
   ═══════════════════════════════════════════════════════════════ */

function ActiveTab({ calls, contacts, tick, onSelect, onClearAll }: {
  calls: VoiceCall[]; contacts: CRMContact[]; tick: number; onSelect: (c: VoiceCall) => void; onClearAll: () => void;
}) {
  if (calls.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <PhoneCall className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No active calls</p>
        <p className="text-xs text-slate-500 mt-1">Start a call from the Queue tab — click a clinic to open controls</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* Clear All button for stuck/phantom calls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{calls.length} active call{calls.length !== 1 ? 's' : ''}</p>
        <button onClick={onClearAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 transition-all">
          <XCircle className="w-3.5 h-3.5" /> Clear All
        </button>
      </div>
      {calls.map(call => {
        const contact = contacts.find(c => c.id === call.contactId);
        const elapsed = getElapsed(call.startTime);
        const sl = statusLabels[call.status] || statusLabels.queued;
        const StatusIcon = sl.icon;
        return (
          <div key={call.id} onClick={() => onSelect(call)}
            className="glass-card p-4 cursor-pointer hover:bg-white/[0.02] transition-all">
            <div className="flex items-center gap-4">
              <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
                call.status === 'in_progress' ? 'bg-green-500/15 ring-2 ring-green-500/30' :
                call.status === 'ringing' ? 'bg-blue-500/15 ring-2 ring-blue-500/30 animate-subtle-pulse' : 'bg-white/5'
              )}><StatusIcon className={cn('w-5 h-5', sl.color)} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{contact?.clinic.name || 'Unknown Clinic'}</span>
                  <span className={cn('badge text-[10px]', sl.color, 'bg-white/5')}>{sl.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                  {contact?.decisionMaker && <span>{contact.decisionMaker.firstName} {contact.decisionMaker.lastName}</span>}
                  {contact && <span>{contact.clinic.address.city}, {contact.clinic.address.state}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={cn('text-lg font-mono font-bold',
                  call.status === 'in_progress' ? 'text-green-400' : 'text-slate-400'
                )}>{formatDuration(elapsed)}</p>
                <p className="text-[10px] text-slate-500">elapsed</p>
              </div>
              {call.status === 'in_progress' && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-subtle-pulse" />
                  <span className="text-xs text-green-400 font-medium">LIVE</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY TAB
   ═══════════════════════════════════════════════════════════════ */

function HistoryTab({ calls, contacts, onSelect }: {
  calls: VoiceCall[]; contacts: CRMContact[]; onSelect: (c: VoiceCall) => void;
}) {
  const sorted = useMemo(() =>
    [...calls].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()), [calls]);

  if (sorted.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <FileText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No call history yet</p>
        <p className="text-xs text-slate-500 mt-1">Completed calls will appear here</p>
      </div>
    );
  }
  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Clinic</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden sm:table-cell">Time</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Duration</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Status</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Outcome</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden lg:table-cell">Sentiment</th>
            <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden xl:table-cell">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(call => {
            const contact = contacts.find(c => c.id === call.contactId);
            const sl = statusLabels[call.status] || statusLabels.completed;
            const ol = call.outcome ? outcomeLabels[call.outcome] : null;
            return (
              <tr key={call.id} onClick={() => onSelect(call)}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-all">
                <td className="px-4 py-3">
                  <p className="text-sm text-slate-200 font-medium">{contact?.clinic.name || 'Unknown'}</p>
                  <p className="text-xs text-slate-500">{contact?.clinic.address.city}, {contact?.clinic.address.state}</p>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <p className="text-xs text-slate-400">{format(new Date(call.startTime), 'MMM d, h:mm a')}</p>
                  <p className="text-[10px] text-slate-600">{formatDistanceToNow(new Date(call.startTime), { addSuffix: true })}</p>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-sm font-mono text-slate-300">{call.duration ? formatDuration(call.duration) : '—'}</span>
                </td>
                <td className="px-4 py-3"><span className={cn('badge text-[10px]', sl.color, 'bg-white/5')}>{sl.label}</span></td>
                <td className="px-4 py-3">
                  {ol ? <span className={cn('badge text-[10px]', ol.color)}>{ol.emoji} {ol.label}</span> : <span className="text-xs text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {call.sentiment ? (
                    <span className={cn('text-xs font-medium',
                      call.sentiment === 'positive' ? 'text-emerald-400' : call.sentiment === 'negative' ? 'text-red-400' : 'text-slate-400'
                    )}>{call.sentiment === 'positive' ? '😊' : call.sentiment === 'negative' ? '😞' : '😐'} {call.sentiment}</span>
                  ) : <span className="text-xs text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell max-w-[200px]">
                  <p className="text-xs text-slate-500 truncate">{call.notes || '—'}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   DIAL PAD TAB — manual dialing with T9-style keypad
   ═══════════════════════════════════════════════════════════════ */

const DIAL_KEYS: { digit: string; letters: string }[] = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

function DialPadTab({ isConfigured, onCallStarted, startPolling }: {
  isConfigured: boolean;
  onCallStarted: (call: VoiceCall) => void;
  startPolling: (callId: string, contactId: string) => void;
}) {
  const [number, setNumber] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [calling, setCalling] = useState(false);
  const [recentDials, setRecentDials] = useState<{ number: string; name: string; time: Date }[]>([]);

  const audioCtx = useRef<AudioContext | null>(null);

  const playTone = useCallback((digit: string) => {
    try {
      if (!audioCtx.current) audioCtx.current = new AudioContext();
      const ctx = audioCtx.current;
      // DTMF frequencies
      const freqMap: Record<string, [number, number]> = {
        '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
        '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
        '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
        '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
      };
      const freqs = freqMap[digit];
      if (!freqs) return;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.1;
      osc1.frequency.value = freqs[0];
      osc2.frequency.value = freqs[1];
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.12);
    } catch { /* audio not available */ }
  }, []);

  const pressKey = useCallback((digit: string) => {
    playTone(digit);
    setNumber(prev => prev + digit);
  }, [playTone]);

  const backspace = useCallback(() => {
    setNumber(prev => prev.slice(0, -1));
  }, []);

  const clearNumber = useCallback(() => {
    setNumber('');
  }, []);

  const formatDisplay = (raw: string): string => {
    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  };

  const handleDial = async () => {
    if (!number || calling) return;
    setCalling(true);
    try {
      const call = await voiceAgentService.dialManualCall(number, recipientName || undefined);
      onCallStarted(call);
      startPolling(call.id, call.contactId);
      setRecentDials(prev => [{ number, name: recipientName, time: new Date() }, ...prev.slice(0, 9)]);
      toast.success(`Calling ${number}...`);
      setNumber('');
      setRecipientName('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to dial');
    } finally {
      setCalling(false);
    }
  };

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9*#]$/.test(e.key)) { pressKey(e.key); e.preventDefault(); }
      if (e.key === 'Backspace') { backspace(); e.preventDefault(); }
      if (e.key === 'Enter' && number) { handleDial(); e.preventDefault(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [number, pressKey, backspace]);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Phone display */}
      <div className="glass-card p-6">
        <div className="text-center mb-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Manual Dial</p>
          <div className="h-14 flex items-center justify-center">
            <span className={cn(
              'font-mono tracking-wider transition-all',
              number ? 'text-3xl text-slate-100' : 'text-xl text-slate-600'
            )}>
              {number ? formatDisplay(number) : 'Enter number'}
            </span>
          </div>
          {number && (
            <button onClick={clearNumber} className="text-[10px] text-slate-500 hover:text-slate-300 mt-1 transition-all">
              Clear
            </button>
          )}
        </div>

        {/* Recipient name (optional) */}
        <div className="mb-4">
          <input
            value={recipientName}
            onChange={e => setRecipientName(e.target.value)}
            placeholder="Recipient name (optional)"
            className="input text-center text-sm"
          />
        </div>

        {/* Dial pad grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {DIAL_KEYS.map(({ digit, letters }) => (
            <button
              key={digit}
              onClick={() => pressKey(digit)}
              className="h-16 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.12] border border-white/[0.06] transition-all flex flex-col items-center justify-center gap-0.5 group"
            >
              <span className="text-xl font-semibold text-slate-200 group-active:scale-95 transition-transform">{digit}</span>
              {letters && <span className="text-[9px] text-slate-500 tracking-[0.2em]">{letters}</span>}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={backspace}
            disabled={!number}
            className="flex-1 h-14 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm">Delete</span>
          </button>
          <button
            onClick={handleDial}
            disabled={!isConfigured || !number || calling}
            className={cn(
              'flex-[2] h-14 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all',
              calling
                ? 'bg-green-500/20 text-green-400 border border-green-500/20'
                : number && isConfigured
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-400 hover:to-green-400 shadow-lg shadow-emerald-500/20'
                  : 'bg-white/[0.04] text-slate-600 border border-white/[0.06] cursor-not-allowed'
            )}
          >
            {calling ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Dialing...</>
            ) : (
              <><Phone className="w-5 h-5" /> Call</>
            )}
          </button>
        </div>

        {!isConfigured && (
          <p className="text-center text-xs text-amber-400/70 mt-3">Configure Vapi API keys to enable calling</p>
        )}
      </div>

      {/* Recent dials */}
      {recentDials.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Recent Dials
          </h4>
          <div className="space-y-2">
            {recentDials.map((dial, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                <div>
                  <button onClick={() => { setNumber(dial.number); setRecipientName(dial.name); }}
                    className="text-sm text-slate-200 hover:text-novalyte-400 font-mono transition-all">
                    {formatDisplay(dial.number)}
                  </button>
                  {dial.name && <p className="text-[10px] text-slate-500">{dial.name}</p>}
                </div>
                <span className="text-[10px] text-slate-600">{formatDistanceToNow(dial.time, { addSuffix: true })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keyboard hint */}
      <p className="text-center text-[10px] text-slate-600">
        Tip: Use your keyboard number keys to dial, Backspace to delete, Enter to call
      </p>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   VAPI TAB — Integration status, config, test connection
   ═══════════════════════════════════════════════════════════════ */

function VapiTab() {
  const config = voiceAgentService.config;
  const isConfigured = voiceAgentService.isConfigured;

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs: number; assistantName?: string } | null>(null);
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await voiceAgentService.testConnection();
      setTestResult(result);
      toast[result.ok ? 'success' : 'error'](result.message);
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Test failed', latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  const loadRecentCalls = async () => {
    setLoadingCalls(true);
    try {
      const calls = await voiceAgentService.listCalls(10);
      setRecentCalls(calls);
    } catch (err: any) {
      toast.error('Failed to load calls: ' + (err.message || 'Unknown error'));
    } finally {
      setLoadingCalls(false);
    }
  };

  const configItems: { label: string; value: string; set: boolean; env: string }[] = [
    { label: 'API Key', value: config.apiKey, set: config.apiKeySet, env: 'VITE_VAPI_API_KEY' },
    { label: 'Assistant ID', value: config.assistantId, set: config.assistantIdSet, env: 'VITE_VAPI_ASSISTANT_ID' },
    { label: 'Phone Number ID', value: config.phoneNumberId, set: config.phoneNumberIdSet, env: 'VITE_VAPI_PHONE_NUMBER_ID' },
    { label: 'Phone Number', value: config.phoneNumber, set: config.phoneNumberSet, env: 'VITE_VAPI_PHONE_NUMBER' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Connection Status Card */}
      <div className={cn(
        'glass-card p-6 border',
        isConfigured ? 'border-emerald-500/20' : 'border-red-500/20'
      )}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              isConfigured ? 'bg-emerald-500/15' : 'bg-red-500/15'
            )}>
              <Radio className={cn('w-6 h-6', isConfigured ? 'text-emerald-400' : 'text-red-400')} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-200">Vapi Integration</h3>
              <p className={cn('text-sm', isConfigured ? 'text-emerald-400' : 'text-red-400')}>
                {isConfigured ? 'All systems operational' : 'Configuration incomplete'}
              </p>
            </div>
          </div>
          <button
            onClick={testConnection}
            disabled={!isConfigured || testing}
            className={cn(
              'btn gap-2',
              isConfigured ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'
            )}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn(
            'rounded-lg p-3 flex items-center gap-3 mt-3',
            testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
          )}>
            {testResult.ok ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-medium', testResult.ok ? 'text-emerald-300' : 'text-red-300')}>
                {testResult.message}
              </p>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                <span>Latency: {testResult.latencyMs}ms</span>
                {testResult.assistantName && <span>Assistant: {testResult.assistantName}</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="glass-card p-6">
        <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Settings className="w-3.5 h-3.5" /> Configuration
        </h4>
        <div className="space-y-3">
          {configItems.map(item => (
            <div key={item.label} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  item.set ? 'bg-emerald-400' : 'bg-red-400'
                )} />
                <div>
                  <p className="text-sm text-slate-300">{item.label}</p>
                  <p className="text-[10px] text-slate-600 font-mono">{item.env}</p>
                </div>
              </div>
              <div className="text-right">
                {item.set ? (
                  <span className="text-xs text-slate-400 font-mono bg-white/[0.03] px-2 py-1 rounded">{item.value}</span>
                ) : (
                  <span className="text-xs text-red-400">Not set</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isConfigured && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-amber-300">
              Add missing keys to your <span className="font-mono">.env</span> file and restart the dev server.
            </p>
          </div>
        )}
      </div>

      {/* API Endpoints */}
      <div className="glass-card p-6">
        <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5" /> API Endpoints
        </h4>
        <div className="space-y-2 text-sm">
          {[
            { label: 'Base URL', value: 'https://api.vapi.ai' },
            { label: 'Outbound Calls', value: 'POST /call/phone' },
            { label: 'Call Status', value: 'GET /call/{id}' },
            { label: 'List Calls', value: 'GET /call?limit=N' },
            { label: 'Assistant', value: 'GET /assistant/{id}' },
          ].map(ep => (
            <div key={ep.label} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
              <span className="text-slate-500">{ep.label}</span>
              <span className="text-slate-300 font-mono text-xs">{ep.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent API Calls */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Recent Vapi Calls
          </h4>
          <button onClick={loadRecentCalls} disabled={!isConfigured || loadingCalls}
            className="btn btn-secondary gap-1.5 text-xs">
            {loadingCalls ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {loadingCalls ? 'Loading...' : 'Fetch'}
          </button>
        </div>

        {recentCalls.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-4">
            {isConfigured ? 'Click Fetch to load recent calls from Vapi' : 'Configure Vapi to view calls'}
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {recentCalls.map((call: any) => (
              <div key={call.id} className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full',
                      call.status === 'ended' ? 'bg-emerald-400' :
                      call.status === 'in-progress' ? 'bg-green-400 animate-pulse' :
                      call.status === 'failed' ? 'bg-red-400' : 'bg-slate-500'
                    )} />
                    <span className="text-xs text-slate-300 font-mono">{call.id.slice(0, 12)}...</span>
                    <span className={cn('badge text-[10px]',
                      call.status === 'ended' ? 'bg-emerald-500/10 text-emerald-400' :
                      call.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-slate-400'
                    )}>{call.status}</span>
                  </div>
                  <span className="text-[10px] text-slate-600">
                    {call.createdAt ? format(new Date(call.createdAt), 'MMM d, h:mm a') : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                  {call.customer?.number && <span>To: {call.customer.number}</span>}
                  {call.customer?.name && <span>· {call.customer.name}</span>}
                  {call.endedAt && call.startedAt && (
                    <span>· {Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)}s</span>
                  )}
                  {call.cost != null && <span>· ${call.cost.toFixed(3)}</span>}
                </div>
                {call.summary && <p className="text-[10px] text-slate-400 mt-1 truncate">{call.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Capabilities */}
      <div className="glass-card p-6">
        <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" /> Capabilities
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Outbound Calls', desc: 'AI-powered cold calling', active: true },
            { label: 'Call Recording', desc: 'Auto-recorded with transcript', active: true },
            { label: 'Sentiment Analysis', desc: 'Real-time call analysis', active: true },
            { label: 'Custom Scripts', desc: 'Per-clinic opening messages', active: true },
            { label: 'Batch Calling', desc: 'Auto-dial queue with delay', active: true },
            { label: 'DTMF Dial Pad', desc: 'Manual number dialing', active: true },
          ].map(cap => (
            <div key={cap.label} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02]">
              <CheckCircle className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', cap.active ? 'text-emerald-400' : 'text-slate-600')} />
              <div>
                <p className="text-xs text-slate-300">{cap.label}</p>
                <p className="text-[10px] text-slate-500">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   CALL DETAIL DRAWER — full transcript, recording, AI analysis
   ═══════════════════════════════════════════════════════════════ */

function CallDrawer({ call, contact, onClose }: {
  call: VoiceCall; contact?: CRMContact; onClose: () => void;
}) {
  const sl = statusLabels[call.status] || statusLabels.completed;
  const ol = call.outcome ? outcomeLabels[call.outcome] : null;
  const StatusIcon = sl.icon;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-slate-900 border-l border-white/[0.06] shadow-2xl overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-white/[0.06] p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center',
              call.status === 'completed' ? 'bg-emerald-500/15' : 'bg-white/5'
            )}><StatusIcon className={cn('w-5 h-5', sl.color)} /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">{contact?.clinic.name || 'Call Details'}</h3>
              <p className="text-xs text-slate-500">{format(new Date(call.startTime), 'MMM d, yyyy · h:mm a')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Status grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Status</p>
              <span className={cn('badge', sl.color, 'bg-white/5')}>{sl.label}</span>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Outcome</p>
              {ol ? <span className={cn('badge', ol.color)}>{ol.emoji} {ol.label}</span> : <span className="text-xs text-slate-600">Pending</span>}
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Duration</p>
              <span className="text-sm font-mono text-slate-300">{call.duration ? formatDuration(call.duration) : '—'}</span>
            </div>
            <div className="glass-card p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Sentiment</p>
              {call.sentiment ? (
                <span className={cn('text-sm font-medium',
                  call.sentiment === 'positive' ? 'text-emerald-400' : call.sentiment === 'negative' ? 'text-red-400' : 'text-slate-400'
                )}>{call.sentiment === 'positive' ? '😊 Positive' : call.sentiment === 'negative' ? '😞 Negative' : '😐 Neutral'}</span>
              ) : <span className="text-xs text-slate-600">—</span>}
            </div>
          </div>

          {/* Contact info */}
          {contact && (
            <div className="glass-card p-4">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5" /> Clinic Details
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Clinic</span><span className="text-slate-200">{contact.clinic.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Location</span><span className="text-slate-200">{contact.clinic.address.city}, {contact.clinic.address.state}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Phone</span><span className="text-slate-200">{contact.clinic.phone}</span></div>
                {contact.decisionMaker && (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Decision Maker</span><span className="text-slate-200">{contact.decisionMaker.firstName} {contact.decisionMaker.lastName}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Role</span><span className="text-slate-200 capitalize">{contact.decisionMaker.role.replace(/_/g, ' ')}</span></div>
                  </>
                )}
                <div className="flex justify-between"><span className="text-slate-500">Lead Score</span>
                  <span className={cn('font-bold', contact.score >= 80 ? 'text-emerald-400' : contact.score >= 60 ? 'text-amber-400' : 'text-slate-400')}>{contact.score}</span>
                </div>
              </div>
            </div>
          )}

          {/* AI Summary */}
          {call.notes && (
            <div className="glass-card p-4">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> AI Analysis
              </h4>
              <p className="text-sm text-slate-300 leading-relaxed">{call.notes}</p>
            </div>
          )}

          {/* Transcript */}
          {call.transcript && (
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" /> Transcript
                </h4>
                <button onClick={() => { navigator.clipboard.writeText(call.transcript || ''); toast.success('Transcript copied'); }}
                  className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto text-sm text-slate-400 leading-relaxed whitespace-pre-wrap bg-white/[0.02] rounded-lg p-3 border border-white/[0.04]">
                {call.transcript}
              </div>
            </div>
          )}

          {/* Recording */}
          {call.recording_url && (
            <div className="glass-card p-4">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Headphones className="w-3.5 h-3.5" /> Recording
              </h4>
              <audio controls className="w-full" src={call.recording_url}>Your browser does not support audio.</audio>
              <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-novalyte-400 hover:text-novalyte-300 mt-2 inline-flex items-center gap-1">
                Open in new tab <Send className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Follow-up */}
          {call.followUpRequired && (
            <div className="glass-card p-4 border-amber-500/20">
              <h4 className="text-xs text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> Follow-up Required
              </h4>
              <p className="text-sm text-slate-400">
                {call.outcome === 'send_info' && 'Send market report and case study via email.'}
                {call.outcome === 'schedule_demo' && 'Confirm demo date/time and send calendar invite.'}
                {call.outcome === 'callback_requested' && 'Schedule a callback at the requested time.'}
                {call.outcome === 'gatekeeper_block' && 'Try calling at a different time to reach the decision maker.'}
                {!['send_info', 'schedule_demo', 'callback_requested', 'gatekeeper_block'].includes(call.outcome || '') && 'Review transcript and determine next steps.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
