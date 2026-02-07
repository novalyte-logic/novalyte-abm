import { useState, useMemo, useCallback } from 'react';
import {
  Mail, Send, RefreshCw, Search, CheckCircle, Clock,
  AlertCircle, MousePointerClick, TrendingUp,
  Loader2, BarChart3, Radio, Inbox, MailOpen, MailX,
  Sparkles, Zap, X, ChevronDown, Edit3, Wand2, Users,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { resendService, SentEmail, EmailEvent } from '../services/resendService';
import { generatePersonalizedEmail, getSequenceQueue, computeSequenceState, SequenceStep } from '../services/intelligenceService';
import { CRMContact } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';

/* ─── Types ─── */
type Tab = 'compose' | 'sequences' | 'stream' | 'analytics';

const eventConfig: Record<EmailEvent, { label: string; color: string; icon: typeof Mail; bg: string }> = {
  sent: { label: 'Sent', color: 'text-slate-400', icon: Send, bg: 'bg-white/5' },
  delivered: { label: 'Delivered', color: 'text-emerald-400', icon: CheckCircle, bg: 'bg-emerald-500/10' },
  opened: { label: 'Opened', color: 'text-blue-400', icon: MailOpen, bg: 'bg-blue-500/10' },
  clicked: { label: 'Clicked', color: 'text-violet-400', icon: MousePointerClick, bg: 'bg-violet-500/10' },
  bounced: { label: 'Bounced', color: 'text-red-400', icon: MailX, bg: 'bg-red-500/10' },
  complained: { label: 'Spam', color: 'text-red-400', icon: AlertCircle, bg: 'bg-red-500/10' },
  delivery_delayed: { label: 'Delayed', color: 'text-amber-400', icon: Clock, bg: 'bg-amber-500/10' },
};

const GENERIC_PREFIXES = ['info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help', 'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply'];
function isGenericEmail(email: string): boolean {
  return GENERIC_PREFIXES.includes(email.split('@')[0].toLowerCase());
}

function getContactEmail(c: CRMContact): string | null {
  if (c.decisionMaker?.email && !isGenericEmail(c.decisionMaker.email)) return c.decisionMaker.email;
  if (c.clinic.email && !isGenericEmail(c.clinic.email)) return c.clinic.email;
  if (c.decisionMaker?.email) return c.decisionMaker.email;
  if (c.clinic.email) return c.clinic.email;
  return null;
}


/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function EmailOutreach() {
  const {
    contacts, sentEmails, addSentEmails, updateSentEmails,
    updateContact,
  } = useAppStore();

  const [tab, setTab] = useState<Tab>('compose');
  const [refreshing, setRefreshing] = useState(false);

  const isConfigured = resendService.isConfigured;

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEmails = sentEmails.filter(e => new Date(e.sentAt) >= today);
    const delivered = todayEmails.filter(e => e.lastEvent === 'delivered' || e.lastEvent === 'opened' || e.lastEvent === 'clicked');
    const opened = todayEmails.filter(e => e.lastEvent === 'opened' || e.lastEvent === 'clicked');
    const bounced = todayEmails.filter(e => e.lastEvent === 'bounced');
    const clicked = todayEmails.filter(e => e.lastEvent === 'clicked');
    return {
      sentToday: todayEmails.length,
      delivered: delivered.length,
      opened: opened.length,
      bounced: bounced.length,
      clicked: clicked.length,
      openRate: todayEmails.length ? Math.round((opened.length / todayEmails.length) * 100) : 0,
      remaining: Math.max(0, 100 - todayEmails.length),
      total: sentEmails.length,
    };
  }, [sentEmails]);

  /* ─── Refresh statuses ─── */
  const handleRefreshStatuses = useCallback(async () => {
    if (refreshing || sentEmails.length === 0) return;
    setRefreshing(true);
    try {
      const recent = [...sentEmails]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .slice(0, 50);
      const updated = await resendService.refreshStatuses(recent);
      updateSentEmails(updated);
      toast.success('Email statuses refreshed');
    } catch {
      toast.error('Failed to refresh statuses');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, sentEmails, updateSentEmails]);

  return (
    <div className="space-y-6 animate-fade-in p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Email Outreach</h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-powered email campaigns — {stats.remaining} sends remaining today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRefreshStatuses} disabled={refreshing || sentEmails.length === 0}
            className="btn btn-secondary gap-2">
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing...' : 'Refresh Statuses'}
          </button>
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            isConfigured ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
          )}>
            <Radio className={cn('w-3 h-3', isConfigured && 'animate-subtle-pulse')} />
            {isConfigured ? 'Resend Connected' : 'Resend Not Configured'}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Sent Today', value: stats.sentToday, icon: Send, color: 'text-novalyte-400' },
          { label: 'Delivered', value: stats.delivered, icon: CheckCircle, color: 'text-emerald-400' },
          { label: 'Opened', value: stats.opened, icon: MailOpen, color: 'text-blue-400' },
          { label: 'Clicked', value: stats.clicked, icon: MousePointerClick, color: 'text-violet-400' },
          { label: 'Bounced', value: stats.bounced, icon: MailX, color: 'text-red-400' },
          { label: 'Open Rate', value: stats.openRate ? `${stats.openRate}%` : '—', icon: TrendingUp, color: 'text-emerald-400' },
          { label: 'Total Sent', value: stats.total, icon: Mail, color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="glass-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={cn('w-4 h-4', s.color)} />
              <span className="text-xs text-slate-500">{s.label}</span>
            </div>
            <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-lg border border-white/[0.06] w-fit">
        {(['compose', 'sequences', 'stream', 'analytics'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2',
            tab === t ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
          )}>
            {t === 'compose' && <Sparkles className="w-4 h-4" />}
            {t === 'sequences' && <Zap className="w-4 h-4" />}
            {t === 'stream' && <Inbox className="w-4 h-4" />}
            {t === 'analytics' && <BarChart3 className="w-4 h-4" />}
            {t === 'compose' ? 'AI Compose' : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'stream' && sentEmails.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-slate-400">{sentEmails.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'compose' && (
        <ComposeTab
          contacts={contacts}
          sentEmails={sentEmails}
          addSentEmails={addSentEmails}
          updateContact={updateContact}
          isConfigured={isConfigured}
          remaining={stats.remaining}
        />
      )}
      {tab === 'sequences' && (
        <SequencesTab contacts={contacts} sentEmails={sentEmails} />
      )}
      {tab === 'stream' && (
        <StreamTab emails={sentEmails} onRefresh={handleRefreshStatuses} refreshing={refreshing} />
      )}
      {tab === 'analytics' && (
        <AnalyticsTab emails={sentEmails} />
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   COMPOSE TAB — AI Smart Compose with clinic selector
   ═══════════════════════════════════════════════════════════════ */

interface GeneratedDraft {
  contactId: string;
  contact: CRMContact;
  email: string;
  subject: string;
  html: string;
  plainText: string;
  notes: string;
  step: 'intro' | 'follow_up' | 'breakup';
  edited: boolean;
}

function ComposeTab({
  contacts, sentEmails, addSentEmails, updateContact, isConfigured, remaining,
}: {
  contacts: CRMContact[];
  sentEmails: SentEmail[];
  addSentEmails: (emails: SentEmail[]) => void;
  updateContact: (id: string, updates: Partial<CRMContact>) => void;
  isConfigured: boolean;
  remaining: number;
}) {
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Map<string, GeneratedDraft>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Eligible contacts: have email, not emailed today
  const eligible = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const emailedToday = new Set(
      sentEmails.filter(e => new Date(e.sentAt) >= today).map(e => e.contactId)
    );
    return contacts
      .filter(c => !emailedToday.has(c.id) && !!getContactEmail(c))
      .sort((a, b) => b.score - a.score);
  }, [contacts, sentEmails]);

  // Filtered for dropdown search
  const filtered = useMemo(() => {
    if (!search) return eligible;
    const q = search.toLowerCase();
    return eligible.filter(c =>
      c.clinic.name.toLowerCase().includes(q) ||
      c.clinic.address.city.toLowerCase().includes(q) ||
      c.clinic.address.state.toLowerCase().includes(q) ||
      (c.decisionMaker && `${c.decisionMaker.firstName} ${c.decisionMaker.lastName}`.toLowerCase().includes(q))
    );
  }, [eligible, search]);

  const selectedContacts = useMemo(() =>
    eligible.filter(c => selectedIds.has(c.id)),
    [eligible, selectedIds]
  );

  const toggleClinic = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const selectAllClinics = () => {
    setSelectedIds(new Set(eligible.slice(0, 100).map(c => c.id)));
    setDropdownOpen(false);
  };

  const clearAll = () => {
    setSelectedIds(new Set());
    setDrafts(new Map());
  };

  const getStep = (contact: CRMContact): 'intro' | 'follow_up' | 'breakup' => {
    const prev = sentEmails.filter(e => e.contactId === contact.id);
    if (prev.length === 0) return 'intro';
    if (prev.length === 1) return 'follow_up';
    return 'breakup';
  };

  const generateOne = async (contact: CRMContact): Promise<GeneratedDraft | null> => {
    const email = getContactEmail(contact);
    if (!email) return null;
    const step = getStep(contact);
    const prevEmails = sentEmails.filter(e => e.contactId === contact.id);
    try {
      const ai = await generatePersonalizedEmail(contact, step, prevEmails);
      return {
        contactId: contact.id, contact, email,
        subject: ai.subject, html: ai.html, plainText: ai.plainText,
        notes: ai.personalizationNotes, step, edited: false,
      };
    } catch (err: any) {
      console.warn(`AI gen failed for ${contact.clinic.name}:`, err);
      return null;
    }
  };

  const handleGenerateAll = async () => {
    if (generating || selectedIds.size === 0) return;
    setGenerating(true);
    const toGen = selectedContacts.slice(0, remaining);
    setGenProgress({ done: 0, total: toGen.length });
    const newDrafts = new Map(drafts);
    let successCount = 0;

    for (let i = 0; i < toGen.length; i++) {
      const c = toGen[i];
      if (!newDrafts.has(c.id)) {
        const draft = await generateOne(c);
        if (draft) { newDrafts.set(c.id, draft); successCount++; }
        if (i < toGen.length - 1) await new Promise(r => setTimeout(r, 800));
      } else { successCount++; }
      setGenProgress({ done: i + 1, total: toGen.length });
      setDrafts(new Map(newDrafts));
    }

    setGenerating(false);
    toast.success(`Generated ${successCount} personalized emails`);
  };

  const handleGenerateOne = async (contact: CRMContact) => {
    setGenerating(true);
    setGenProgress({ done: 0, total: 1 });
    const draft = await generateOne(contact);
    if (draft) {
      setDrafts(prev => { const m = new Map(prev); m.set(contact.id, draft); return m; });
      toast.success(`Email generated for ${contact.clinic.name}`);
    } else {
      toast.error(`Failed to generate for ${contact.clinic.name}`);
    }
    setGenProgress({ done: 1, total: 1 });
    setGenerating(false);
  };

  const startEdit = (draft: GeneratedDraft) => {
    setEditingId(draft.contactId);
    setEditSubject(draft.subject);
    setEditBody(draft.plainText);
  };

  const saveEdit = () => {
    if (!editingId) return;
    setDrafts(prev => {
      const m = new Map(prev);
      const existing = m.get(editingId);
      if (existing) {
        const htmlBody = editBody.split('\n').map(l => l.trim()).filter(Boolean)
          .map(l => `<p style="font-size:15px;line-height:1.7;margin:0 0 12px 0;">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
          .join('\n');
        const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">${htmlBody}</div>`;
        m.set(editingId, { ...existing, subject: editSubject, html, plainText: editBody, edited: true });
      }
      return m;
    });
    setEditingId(null);
    toast.success('Draft updated');
  };

  const handleSendAll = async () => {
    if (sending || drafts.size === 0) return;
    setSending(true);
    const toSend = Array.from(drafts.values()).slice(0, remaining);
    setSendProgress({ sent: 0, total: toSend.length });
    let successCount = 0;

    for (let i = 0; i < toSend.length; i++) {
      const draft = toSend[i];
      try {
        const result = await resendService.sendAIPersonalized(
          draft.contact, draft.email,
          { subject: draft.subject, html: draft.html },
          draft.step
        );
        addSentEmails([result]);
        const ct = contacts.find(c => c.id === draft.contactId);
        if (ct) {
          updateContact(draft.contactId, {
            lastContactedAt: new Date(),
            activities: [...(ct.activities || []), {
              id: `act-${Date.now()}-${i}`, type: 'email_sent' as const,
              description: `AI email sent: "${draft.subject}" to ${draft.email}`,
              timestamp: new Date(),
              metadata: { resendId: result.id, aiGenerated: true, sequenceStep: draft.step },
            }],
          });
        }
        successCount++;
        setDrafts(prev => { const m = new Map(prev); m.delete(draft.contactId); return m; });
      } catch (err: any) {
        console.warn(`Send failed for ${draft.contact.clinic.name}:`, err);
      }
      setSendProgress({ sent: i + 1, total: toSend.length });
      if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 1200));
    }

    setSending(false);
    setSelectedIds(new Set());
    toast.success(`Sent ${successCount}/${toSend.length} emails`);
  };

  const readyDrafts = Array.from(drafts.values());

  return (
    <div className="space-y-4">
      {!isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Resend not configured</p>
            <p className="text-xs text-slate-400">Add VITE_RESEND_API_KEY to .env to enable sending.</p>
          </div>
        </div>
      )}

      {/* ── Step 1: Select Clinics ── */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-novalyte-400" />
            <h3 className="text-sm font-semibold text-slate-200">Select Clinics</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
              {selectedIds.size} selected · {eligible.length} eligible
            </span>
          </div>
          <div className="flex items-center gap-3">
            {selectedIds.size > 0 && (
              <button onClick={clearAll} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear all</button>
            )}
            <button onClick={selectAllClinics} className="text-xs text-novalyte-400 hover:text-novalyte-300 transition-colors font-medium">
              Select all ({Math.min(eligible.length, 100)})
            </button>
            <button onClick={() => setDropdownOpen(!dropdownOpen)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                dropdownOpen
                  ? 'bg-novalyte-500/20 text-novalyte-300 border-novalyte-500/30'
                  : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06]'
              )}>
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', dropdownOpen && 'rotate-180')} />
              {dropdownOpen ? 'Hide List' : 'Show Clinics'}
            </button>
          </div>
        </div>

        {/* Selected chips */}
        {selectedContacts.length > 0 && !dropdownOpen && (
          <div className="flex flex-wrap gap-2 mb-4">
            {selectedContacts.slice(0, 30).map(c => (
              <span key={c.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-novalyte-500/10 text-novalyte-300 text-xs font-medium ring-1 ring-novalyte-500/20">
                {c.clinic.name}
                <X className="w-3 h-3 cursor-pointer hover:text-red-400 transition-colors" onClick={() => toggleClinic(c.id)} />
              </span>
            ))}
            {selectedContacts.length > 30 && (
              <span className="text-xs text-slate-500 self-center">+{selectedContacts.length - 30} more</span>
            )}
          </div>
        )}

        {/* Inline expandable clinic list */}
        {dropdownOpen && (
          <div>
            {/* Search bar */}
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-3">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search clinics by name, city, contact..."
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none" />
              {search && (
                <button onClick={() => setSearch('')} className="text-slate-600 hover:text-slate-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Clinic list — inline, scrollable */}
            <div className="max-h-[400px] overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.01]">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">No matching clinics</div>
              ) : filtered.slice(0, 60).map(c => {
                const email = getContactEmail(c)!;
                const dm = c.decisionMaker;
                const isSelected = selectedIds.has(c.id);
                return (
                  <div key={c.id} onClick={() => toggleClinic(c.id)}
                    className={cn('flex items-center gap-4 px-4 py-3 cursor-pointer transition-all border-b border-white/[0.04] last:border-0',
                      isSelected ? 'bg-novalyte-500/10' : 'hover:bg-white/[0.04]')}>
                    <input type="checkbox" checked={isSelected} readOnly
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-novalyte-500 focus:ring-novalyte-500/30 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm text-slate-200 font-medium truncate">{c.clinic.name}</p>
                        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded',
                          c.score >= 80 ? 'text-emerald-400 bg-emerald-500/10' : c.score >= 60 ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 bg-white/5'
                        )}>{c.score}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{c.clinic.address.city}, {c.clinic.address.state}</span>
                        <span className="text-slate-700">·</span>
                        {dm ? <span className="text-slate-400">{dm.firstName} {dm.lastName}</span> : <span className="text-slate-600">No DM</span>}
                        <span className="text-slate-700">·</span>
                        <span className={isGenericEmail(email) ? 'text-slate-600' : 'text-novalyte-400/80'}>{email}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-600 shrink-0">{c.clinic.services.slice(0, 2).join(', ')}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-600 mt-2 text-center">
              Showing {Math.min(filtered.length, 60)} of {filtered.length} clinics
            </p>
          </div>
        )}
      </div>

      {/* ── Step 2: Generate AI Emails ── */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-slate-200">AI Smart Compose</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">Vertex AI / Gemini</span>
          </div>
          <div className="flex items-center gap-2">
            {readyDrafts.length > 0 && (
              <span className="text-[10px] text-emerald-400">{readyDrafts.length} drafts ready</span>
            )}
            <button onClick={handleGenerateAll} disabled={generating || selectedIds.size === 0}
              className="btn btn-secondary gap-1.5 text-xs">
              {generating ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating {genProgress.done}/{genProgress.total}</>
              ) : (
                <><Wand2 className="w-3.5 h-3.5" /> Generate All ({selectedIds.size})</>
              )}
            </button>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 mb-3">
          Gemini writes a unique email per clinic using their services, market data, keywords, rating, and decision maker info. Edit any draft before sending.
        </p>

        {generating && (
          <div className="mb-3">
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-500 to-novalyte-400 rounded-full transition-all duration-500"
                style={{ width: `${genProgress.total ? (genProgress.done / genProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {/* Draft queue */}
        {readyDrafts.length > 0 && (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {readyDrafts.map(draft => {
              const isEditing = editingId === draft.contactId;
              return (
                <div key={draft.contactId} className="rounded-lg bg-white/[0.02] border border-white/[0.04] overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium',
                        draft.step === 'intro' ? 'bg-blue-500/10 text-blue-400' :
                        draft.step === 'follow_up' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-red-500/10 text-red-400'
                      )}>
                        {draft.step === 'intro' ? 'Intro' : draft.step === 'follow_up' ? 'Follow-Up' : 'Breakup'}
                      </span>
                      <p className="text-xs text-slate-200 font-medium truncate">{draft.contact.clinic.name}</p>
                      <span className="text-[10px] text-slate-600">→ {draft.email}</span>
                      {draft.edited && <span className="text-[9px] text-amber-400">edited</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isEditing && (
                        <button onClick={() => startEdit(draft)}
                          className="p-1 rounded hover:bg-white/[0.05] text-slate-500 hover:text-slate-300 transition-all">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => handleGenerateOne(draft.contact)} disabled={generating}
                        className="p-1 rounded hover:bg-white/[0.05] text-slate-500 hover:text-purple-400 transition-all">
                        <Wand2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDrafts(prev => { const m = new Map(prev); m.delete(draft.contactId); return m; })}
                        className="p-1 rounded hover:bg-white/[0.05] text-slate-500 hover:text-red-400 transition-all">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="p-3 space-y-2">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Subject</label>
                        <input value={editSubject} onChange={e => setEditSubject(e.target.value)}
                          className="w-full px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 outline-none focus:border-novalyte-500/30" />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Body</label>
                        <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={8}
                          className="w-full px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-sm text-slate-300 outline-none focus:border-novalyte-500/30 resize-y leading-relaxed" />
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="btn btn-secondary text-xs">Cancel</button>
                        <button onClick={saveEdit} className="btn btn-primary text-xs gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-[10px] text-slate-500 mb-1">Subject:</p>
                      <p className="text-sm text-slate-200 font-medium mb-2">{draft.subject}</p>
                      <div className="text-xs text-slate-400 leading-relaxed line-clamp-4"
                        dangerouslySetInnerHTML={{ __html: draft.html }} />
                      {draft.notes && (
                        <p className="text-[9px] text-purple-400/60 mt-2 italic">AI angle: {draft.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {readyDrafts.length === 0 && !generating && (
          <div className="text-center py-8">
            <Wand2 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Select clinics above, then click "Generate All" to create personalized emails</p>
          </div>
        )}
      </div>

      {/* ── Step 3: Send ── */}
      {readyDrafts.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Send className="w-4 h-4 text-novalyte-400" />
              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {readyDrafts.length} email{readyDrafts.length !== 1 ? 's' : ''} ready to send
                </p>
                <p className="text-[10px] text-slate-500">{remaining} sends remaining today</p>
              </div>
            </div>
            <button onClick={handleSendAll}
              disabled={!isConfigured || sending || readyDrafts.length === 0 || remaining === 0}
              className={cn('btn gap-2', sending ? 'btn-secondary' : 'btn-primary')}>
              {sending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Sending {sendProgress.sent}/{sendProgress.total}</>
              ) : (
                <><Send className="w-4 h-4" /> Send {Math.min(readyDrafts.length, remaining)} Emails</>
              )}
            </button>
          </div>
          {sending && (
            <div className="mt-3">
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-novalyte-500 to-novalyte-400 rounded-full transition-all duration-500"
                  style={{ width: `${sendProgress.total ? (sendProgress.sent / sendProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   SEQUENCES TAB — Smart sequencing engine view
   ═══════════════════════════════════════════════════════════════ */

const stepConfig: Record<SequenceStep, { label: string; color: string; bg: string }> = {
  intro: { label: 'Intro', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  follow_up: { label: 'Follow-Up', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  breakup: { label: 'Breakup', color: 'text-red-400', bg: 'bg-red-500/10' },
  completed: { label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  replied: { label: 'Engaged', color: 'text-violet-400', bg: 'bg-violet-500/10' },
  opted_out: { label: 'Opted Out', color: 'text-slate-500', bg: 'bg-white/5' },
};

function SequencesTab({ contacts, sentEmails }: { contacts: CRMContact[]; sentEmails: SentEmail[] }) {
  const sequenceQueue = useMemo(() => getSequenceQueue(contacts, sentEmails), [contacts, sentEmails]);

  const allSequences = useMemo(() => {
    return contacts
      .filter(c => {
        const email = c.decisionMaker?.email || c.clinic.email;
        return !!email;
      })
      .map(c => ({
        contact: c,
        sequence: computeSequenceState(c.id, sentEmails),
      }))
      .sort((a, b) => {
        const order: Record<SequenceStep, number> = { intro: 0, follow_up: 1, breakup: 2, replied: 3, completed: 4, opted_out: 5 };
        return (order[a.sequence.currentStep] ?? 5) - (order[b.sequence.currentStep] ?? 5);
      });
  }, [contacts, sentEmails]);

  const seqStats = useMemo(() => {
    const counts: Record<SequenceStep, number> = { intro: 0, follow_up: 0, breakup: 0, completed: 0, replied: 0, opted_out: 0 };
    for (const s of allSequences) counts[s.sequence.currentStep] = (counts[s.sequence.currentStep] || 0) + 1;
    return counts;
  }, [allSequences]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {(Object.entries(seqStats) as [SequenceStep, number][]).map(([step, count]) => {
          const cfg = stepConfig[step];
          return (
            <div key={step} className="glass-card p-3 text-center">
              <p className={cn('text-xl font-bold tabular-nums', cfg.color)}>{count}</p>
              <p className="text-[10px] text-slate-500">{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {sequenceQueue.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h4 className="text-sm font-semibold text-slate-200">Ready to Send</h4>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{sequenceQueue.length}</span>
            </div>
            <p className="text-[10px] text-slate-500">These contacts are due for their next sequence email</p>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {sequenceQueue.slice(0, 20).map(({ contact, step }) => {
              const cfg = stepConfig[step];
              const email = contact.decisionMaker?.email || contact.clinic.email || '';
              return (
                <div key={contact.id} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-all">
                  <span className={cn('px-2 py-1 rounded text-[10px] font-medium', cfg.bg, cfg.color)}>{cfg.label}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 font-medium truncate">{contact.clinic.name}</p>
                    <p className="text-[10px] text-slate-500">{email} · {contact.clinic.marketZone.city}, {contact.clinic.marketZone.state}</p>
                  </div>
                  <span className={cn('text-xs font-bold', contact.score >= 80 ? 'text-emerald-400' : contact.score >= 60 ? 'text-amber-400' : 'text-slate-500')}>{contact.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h4 className="text-sm font-semibold text-slate-200">All Sequences ({allSequences.length})</h4>
        </div>
        {allSequences.length === 0 ? (
          <div className="p-12 text-center">
            <Zap className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No sequences yet</p>
            <p className="text-xs text-slate-500 mt-1">Send emails from the Compose tab to start sequences</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Step</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Clinic</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden sm:table-cell">Contact</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Intro</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Follow-Up</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden lg:table-cell">Breakup</th>
                <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden lg:table-cell">Next</th>
              </tr>
            </thead>
            <tbody>
              {allSequences.slice(0, 50).map(({ contact, sequence }) => {
                const cfg = stepConfig[sequence.currentStep];
                const dm = contact.decisionMaker;
                return (
                  <tr key={contact.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-all">
                    <td className="px-4 py-2.5">
                      <span className={cn('px-2 py-1 rounded text-[10px] font-medium', cfg.bg, cfg.color)}>{cfg.label}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-sm text-slate-200 font-medium">{contact.clinic.name}</p>
                      <p className="text-[10px] text-slate-500">{contact.clinic.marketZone.city}, {contact.clinic.marketZone.state}</p>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      {dm ? <span className="text-xs text-slate-300">{dm.firstName} {dm.lastName}</span> : <span className="text-xs text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {sequence.introSentAt ? (
                        <span className="text-[10px] text-emerald-400">{format(new Date(sequence.introSentAt), 'MMM d')}</span>
                      ) : <span className="text-[10px] text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {sequence.followUpSentAt ? (
                        <span className="text-[10px] text-amber-400">{format(new Date(sequence.followUpSentAt), 'MMM d')}</span>
                      ) : <span className="text-[10px] text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      {sequence.breakupSentAt ? (
                        <span className="text-[10px] text-red-400">{format(new Date(sequence.breakupSentAt), 'MMM d')}</span>
                      ) : <span className="text-[10px] text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      {sequence.pausedUntil ? (
                        <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(sequence.pausedUntil), { addSuffix: true })}</span>
                      ) : sequence.currentStep === 'completed' || sequence.currentStep === 'replied' || sequence.currentStep === 'opted_out' ? (
                        <span className="text-[10px] text-slate-600">Done</span>
                      ) : (
                        <span className="text-[10px] text-amber-400">Now</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   STREAM TAB — live sending stream with delivery status
   ═══════════════════════════════════════════════════════════════ */

function StreamTab({ emails, onRefresh, refreshing }: {
  emails: SentEmail[];
  onRefresh: () => void; refreshing: boolean;
}) {
  const sorted = useMemo(() =>
    [...emails].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [emails]
  );

  if (sorted.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <Inbox className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No emails sent yet</p>
        <p className="text-xs text-slate-500 mt-1">Send your first batch from the Compose tab</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{sorted.length} emails in stream</p>
        <button onClick={onRefresh} disabled={refreshing} className="btn btn-secondary gap-2 text-xs">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Status</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Clinic</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden sm:table-cell">To</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Subject</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden lg:table-cell">Market</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Sent</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(em => {
              const ev = eventConfig[em.lastEvent] || eventConfig.sent;
              const EvIcon = ev.icon;
              return (
                <tr key={em.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-all">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', ev.bg)}>
                        <EvIcon className={cn('w-3.5 h-3.5', ev.color)} />
                      </div>
                      <span className={cn('text-xs font-medium', ev.color)}>{ev.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-slate-200 font-medium">{em.clinicName}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs text-slate-400">{em.to}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell max-w-[250px]">
                    <p className="text-xs text-slate-400 truncate">{em.subject}</p>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs text-slate-500">{em.market}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-400">{format(new Date(em.sentAt), 'MMM d, h:mm a')}</p>
                    <p className="text-[10px] text-slate-600">{formatDistanceToNow(new Date(em.sentAt), { addSuffix: true })}</p>
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
   ANALYTICS TAB — aggregate email performance
   ═══════════════════════════════════════════════════════════════ */

function AnalyticsTab({ emails }: { emails: SentEmail[] }) {
  const byEvent = useMemo(() => {
    const counts: Record<EmailEvent, number> = {
      sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, delivery_delayed: 0,
    };
    for (const e of emails) counts[e.lastEvent] = (counts[e.lastEvent] || 0) + 1;
    return counts;
  }, [emails]);

  const byMarket = useMemo(() => {
    const map = new Map<string, { sent: number; opened: number; bounced: number }>();
    for (const e of emails) {
      const m = e.market || 'Unknown';
      const cur = map.get(m) || { sent: 0, opened: 0, bounced: 0 };
      cur.sent++;
      if (e.lastEvent === 'opened' || e.lastEvent === 'clicked') cur.opened++;
      if (e.lastEvent === 'bounced') cur.bounced++;
      map.set(m, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].sent - a[1].sent);
  }, [emails]);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of emails) {
      const day = format(new Date(e.sentAt), 'MMM d');
      map.set(day, (map.get(day) || 0) + 1);
    }
    return Array.from(map.entries()).slice(-14);
  }, [emails]);

  if (emails.length === 0) {
    return (
      <div className="glass-card p-12 text-center">
        <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No data yet</p>
        <p className="text-xs text-slate-500 mt-1">Analytics will appear after you send emails</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Delivery Funnel</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {(Object.entries(byEvent) as [EmailEvent, number][]).map(([event, count]) => {
            const cfg = eventConfig[event];
            const Icon = cfg.icon;
            return (
              <div key={event} className="text-center">
                <div className={cn('w-10 h-10 rounded-xl mx-auto flex items-center justify-center mb-1', cfg.bg)}>
                  <Icon className={cn('w-5 h-5', cfg.color)} />
                </div>
                <p className={cn('text-lg font-bold', cfg.color)}>{count}</p>
                <p className="text-[10px] text-slate-500">{cfg.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {byDay.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Daily Send Volume</h4>
          <div className="flex items-end gap-1 h-24">
            {byDay.map(([day, count]) => {
              const maxCount = Math.max(...byDay.map(d => d[1]));
              const height = maxCount ? (count / maxCount) * 100 : 0;
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-slate-500">{count}</span>
                  <div className="w-full bg-novalyte-500/30 rounded-t" style={{ height: `${Math.max(height, 4)}%` }} />
                  <span className="text-[8px] text-slate-600 truncate w-full text-center">{day}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {byMarket.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Performance by Market</h4>
          <div className="space-y-2">
            {byMarket.slice(0, 10).map(([market, data]) => (
              <div key={market} className="flex items-center gap-3">
                <span className="text-xs text-slate-300 w-40 truncate">{market}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-novalyte-500/50 rounded-full" style={{ width: `${(data.sent / Math.max(...byMarket.map(m => m[1].sent))) * 100}%` }} />
                </div>
                <div className="flex items-center gap-3 text-[10px] shrink-0">
                  <span className="text-slate-400">{data.sent} sent</span>
                  <span className="text-blue-400">{data.opened} opened</span>
                  {data.bounced > 0 && <span className="text-red-400">{data.bounced} bounced</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
