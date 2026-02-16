import { useState, useMemo, useCallback } from 'react';
import {
  Mail, Send, RefreshCw, Search, CheckCircle, Clock,
  AlertCircle, MousePointerClick, TrendingUp,
  Loader2, BarChart3, Radio, Inbox, MailOpen, MailX,
  Sparkles, Zap, X, ChevronDown, Edit3, Wand2, Users,
  ShieldCheck, ShieldAlert, ShieldX, Trash2,
  Upload, PenLine, Filter, ArrowUpDown, Plus,
  CheckSquare, Square, MinusSquare,
  Phone, Play, Pause, StopCircle, Eye,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { resendService, SentEmail, EmailEvent } from '../services/resendService';
import { generatePersonalizedEmail, SequenceStep } from '../services/intelligenceService';
import { voiceAgentService } from '../services/voiceAgentService';
import { smtpSendService } from '../services/smtpSendService';
import { vertexAI } from '../services/vertexAI';
import { googleVerifyService } from '../services/googleVerifyService';
import { CRMContact } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import axios from 'axios';

/* ─── Types ─── */
type Tab = 'compose' | 'manual' | 'sequences' | 'stream' | 'analytics';

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

/* ─── Email Verification Types ─── */
type VerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown' | 'pending';

interface EmailVerification {
  email: string;
  status: VerificationStatus;
  confidence: number; // 0-100
}

function getEmailConfidence(contact: CRMContact, verifications: Map<string, EmailVerification>): { score: number; status: VerificationStatus; label: string } {
  const email = getContactEmail(contact);
  if (!email) return { score: 0, status: 'unknown', label: 'No email' };

  // Check verification cache first
  const v = verifications.get(email);
  if (v) return { score: v.confidence, status: v.status, label: v.status === 'valid' ? 'Verified' : v.status === 'invalid' ? 'Invalid' : v.status === 'risky' ? 'Risky' : 'Unverified' };

  // Check DM verification status from enrichment
  const dm = contact.decisionMaker;
  if (dm?.emailVerified && dm.emailVerificationStatus === 'valid') return { score: 95, status: 'valid', label: 'Verified' };
  if (dm?.emailVerified && dm.emailVerificationStatus === 'invalid') return { score: 5, status: 'invalid', label: 'Invalid' };
  if (dm?.emailVerified && dm.emailVerificationStatus === 'risky') return { score: 60, status: 'risky', label: 'Risky' };

  // Check enrichedContacts for this email
  const ec = contact.clinic.enrichedContacts?.find(c => c.email === email);
  if (ec?.emailVerified && ec.emailVerificationStatus === 'valid') return { score: 95, status: 'valid', label: 'Verified' };
  if (ec?.emailVerified && ec.emailVerificationStatus === 'invalid') return { score: 5, status: 'invalid', label: 'Invalid' };
  if (ec?.emailVerified && ec.emailVerificationStatus === 'risky') return { score: 60, status: 'risky', label: 'Risky' };

  // Heuristic score based on source
  if (isGenericEmail(email)) return { score: 25, status: 'unknown', label: 'Generic' };
  if (dm?.source === 'apollo') return { score: dm.confidence || 70, status: 'unknown', label: 'Apollo' };
  if (dm?.source === 'npi') return { score: 55, status: 'unknown', label: 'NPI' };
  return { score: 40, status: 'unknown', label: 'Unverified' };
}

const REVENUEBASE_KEY = (() => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
  return metaEnv?.VITE_REVENUEBASE_API_KEY || '';
})();


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
  const [sendProvider, setSendProvider] = useState<'resend' | 'smtp'>('resend');

  const isConfigured = resendService.isConfigured;
  const smtpConfigured = smtpSendService.isConfigured;

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEmails = sentEmails.filter(e => new Date(e.sentAt) >= today);
    const resendToday = todayEmails.filter(e => !e.provider || e.provider === 'resend');
    const smtpToday = todayEmails.filter(e => e.provider === 'smtp');
    const delivered = todayEmails.filter(e => e.lastEvent === 'delivered' || e.lastEvent === 'opened' || e.lastEvent === 'clicked');
    const opened = todayEmails.filter(e => e.lastEvent === 'opened' || e.lastEvent === 'clicked');
    const bounced = todayEmails.filter(e => e.lastEvent === 'bounced');
    const clicked = todayEmails.filter(e => e.lastEvent === 'clicked');
    return {
      sentToday: todayEmails.length,
      resendSentToday: resendToday.length,
      smtpSentToday: smtpToday.length,
      delivered: delivered.length,
      opened: opened.length,
      bounced: bounced.length,
      clicked: clicked.length,
      openRate: todayEmails.length ? Math.round((opened.length / todayEmails.length) * 100) : 0,
      resendRemaining: Math.max(0, 100 - resendToday.length),
      smtpRemaining: Math.max(0, 900 - smtpToday.length),
      total: sentEmails.length,
    };
  }, [sentEmails]);

  const remainingForProvider = sendProvider === 'smtp' ? stats.smtpRemaining : stats.resendRemaining;

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
    <div className="space-y-4 sm:space-y-6 animate-fade-in p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100">Email Outreach</h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-powered email campaigns — {stats.resendRemaining} V-send left · {stats.smtpRemaining} SMTP left today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-white/[0.03] border border-white/[0.06]">
            <span className="text-slate-500">Provider</span>
            <select
              value={sendProvider}
              onChange={e => setSendProvider(e.target.value as any)}
              className="bg-transparent text-slate-200 outline-none"
              title="Choose sending provider"
            >
              <option value="resend">V-send (Resend)</option>
              <option value="smtp">SMTP</option>
            </select>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full',
              sendProvider === 'resend' ? 'bg-novalyte-500/20 text-novalyte-300' : 'bg-blue-500/10 text-blue-300'
            )}>
              {remainingForProvider} left
            </span>
          </div>
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
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            smtpConfigured ? 'bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/20' : 'bg-slate-500/10 text-slate-500 ring-1 ring-white/[0.06]'
          )}>
            <Radio className={cn('w-3 h-3', smtpConfigured && 'animate-subtle-pulse')} />
            {smtpConfigured ? 'SMTP Connected' : 'SMTP Not Configured'}
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
      <div className="flex items-center gap-1 p-1 bg-white/[0.03] rounded-lg border border-white/[0.06] overflow-x-auto scrollbar-hide sm:w-fit">
        {(['compose', 'manual', 'sequences', 'stream', 'analytics'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0',
            tab === t ? 'bg-novalyte-500/20 text-novalyte-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
          )}>
            {t === 'compose' && <Sparkles className="w-4 h-4" />}
            {t === 'manual' && <PenLine className="w-4 h-4" />}
            {t === 'sequences' && <Zap className="w-4 h-4" />}
            {t === 'stream' && <Inbox className="w-4 h-4" />}
            {t === 'analytics' && <BarChart3 className="w-4 h-4" />}
            {t === 'compose' ? 'AI Compose' : t === 'manual' ? 'Manual Compose' : t.charAt(0).toUpperCase() + t.slice(1)}
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
          remaining={remainingForProvider}
          provider={sendProvider}
        />
      )}
      {tab === 'manual' && (
        <ManualComposeTab
          contacts={contacts}
          sentEmails={sentEmails}
          addSentEmails={addSentEmails}
          updateContact={updateContact}
          isConfigured={isConfigured}
          remaining={remainingForProvider}
          provider={sendProvider}
        />
      )}
      {tab === 'sequences' && (
        <SequencesTab contacts={contacts} sentEmails={sentEmails} provider={sendProvider} remaining={remainingForProvider} />
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
  provider,
}: {
  contacts: CRMContact[];
  sentEmails: SentEmail[];
  addSentEmails: (emails: SentEmail[]) => void;
  updateContact: (id: string, updates: Partial<CRMContact>) => void;
  isConfigured: boolean;
  remaining: number;
  provider: 'resend' | 'smtp';
}) {
  const { addContacts, markets, selectedMarket } = useAppStore();
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
  const [verifications, setVerifications] = useState<Map<string, EmailVerification>>(new Map());
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState({ done: 0, total: 0 });
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importUnmatched, setImportUnmatched] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'verified' | 'risky' | 'unverified'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'city' | 'confidence'>('score');
  const [aiDirection, setAiDirection] = useState('');
  const [googleVerifying, setGoogleVerifying] = useState(false);
  const [googleVerifyProgress, setGoogleVerifyProgress] = useState({ done: 0, total: 0 });

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

  // Filtered for dropdown search + status filter + sort
  const filtered = useMemo(() => {
    let list = eligible;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.clinic.name.toLowerCase().includes(q) ||
        c.clinic.address.city.toLowerCase().includes(q) ||
        c.clinic.address.state.toLowerCase().includes(q) ||
        (getContactEmail(c) || '').toLowerCase().includes(q) ||
        (c.decisionMaker && `${c.decisionMaker.firstName} ${c.decisionMaker.lastName}`.toLowerCase().includes(q))
      );
    }
    if (filterStatus !== 'all') {
      list = list.filter(c => {
        const { status } = getEmailConfidence(c, verifications);
        if (filterStatus === 'verified') return status === 'valid';
        if (filterStatus === 'risky') return status === 'risky';
        if (filterStatus === 'unverified') return status === 'unknown';
        return true;
      });
    }
    const sorted = [...list];
    if (sortBy === 'name') sorted.sort((a, b) => a.clinic.name.localeCompare(b.clinic.name));
    else if (sortBy === 'city') sorted.sort((a, b) => a.clinic.address.city.localeCompare(b.clinic.address.city));
    else if (sortBy === 'confidence') sorted.sort((a, b) => getEmailConfidence(b, verifications).score - getEmailConfidence(a, verifications).score);
    else sorted.sort((a, b) => b.score - a.score);
    return sorted;
  }, [eligible, search, filterStatus, sortBy, verifications]);

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
    const cap = Math.max(0, Math.min(eligible.length, remaining || eligible.length));
    setSelectedIds(new Set(eligible.slice(0, cap).map(c => c.id)));
    setDropdownOpen(false);
  };

  const selectAllFiltered = () => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      const cap = Math.max(0, Math.min(filtered.length, remaining || filtered.length));
      filtered.slice(0, cap).forEach(c => s.add(c.id));
      return s;
    });
  };

  const unselectAll = () => {
    setSelectedIds(new Set());
  };

  const invertSelection = () => {
    setSelectedIds(prev => {
      const s = new Set<string>();
      eligible.forEach(c => { if (!prev.has(c.id)) s.add(c.id); });
      return s;
    });
  };

  const selectVerifiedOnly = () => {
    setSelectedIds(new Set(
      eligible.filter(c => {
        const { status } = getEmailConfidence(c, verifications);
        return status === 'valid';
      }).slice(0, Math.max(0, Math.min(eligible.length, remaining || eligible.length))).map(c => c.id)
    ));
  };

  /* ── Import Emails ── */
  const handleImportEmails = () => {
    if (!importText.trim()) return;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const imported = [...new Set((importText.match(emailRegex) || []).map(e => e.toLowerCase()))];
    if (imported.length === 0) { toast.error('No valid email addresses found'); return; }
    // Match imported emails to existing contacts
    let matched = 0;
    const unmatched: string[] = [];
    const newSelected = new Set(selectedIds);
    for (const email of imported) {
      const contact = eligible.find(c => {
        const ce = getContactEmail(c);
        return ce && ce.toLowerCase() === email;
      });
      if (contact) { newSelected.add(contact.id); matched++; }
      else unmatched.push(email);
    }
    setSelectedIds(newSelected);
    setImportUnmatched(unmatched);
    toast.success(`Imported ${imported.length} emails — ${matched} matched to CRM contacts, ${unmatched.length} unmatched`);
  };

  const handleCreateLeadsForUnmatched = () => {
    if (importUnmatched.length === 0) return;
    const market = selectedMarket || markets?.[0];
    if (!market) { toast.error('No market configured'); return; }

    const byDomain = new Map<string, string>();
    for (const e of importUnmatched) {
      const domain = String(e.split('@')[1] || '').toLowerCase().trim();
      if (!domain) continue;
      if (!byDomain.has(domain)) byDomain.set(domain, e);
    }
    const domains = Array.from(byDomain.keys());
    if (domains.length === 0) { toast.error('No valid domains found'); return; }

    const newContacts: CRMContact[] = [];
    for (const domain of domains) {
      const email = byDomain.get(domain)!;
      const clinicId = `clinic-import-${domain.replace(/[^a-z0-9.-]/g, '-')}`;
      const contactId = `contact-import-${clinicId}`;
      const local = String(email.split('@')[0] || '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
      const parts = local.split(/\s+/).filter(Boolean);
      const firstName = (parts[0] || 'Imported').slice(0, 32);
      const lastName = (parts.slice(1).join(' ') || 'Lead').slice(0, 32);
      const clinicName = domain.replace(/^www\./, '');

      newContacts.push({
        id: contactId,
        clinic: {
          id: clinicId,
          name: clinicName,
          type: 'mens_health_clinic',
          address: { street: '', city: '', state: '', zip: '', country: 'USA' },
          phone: '',
          email,
          website: `https://${clinicName}`,
          managerName: `${firstName} ${lastName}`.trim(),
          managerEmail: email,
          ownerName: undefined,
          ownerEmail: undefined,
          services: [],
          marketZone: market,
          discoveredAt: new Date(),
          lastUpdated: new Date(),
        },
        decisionMaker: {
          id: `dm-import-${clinicId}`,
          clinicId,
          firstName,
          lastName,
          title: 'Imported Lead',
          role: 'clinic_manager',
          email,
          phone: undefined,
          linkedInUrl: undefined,
          confidence: 40,
          enrichedAt: new Date(),
          source: 'manual',
          emailVerified: false,
          emailVerificationStatus: 'unknown',
        },
        status: 'ready_to_call',
        priority: 'medium',
        score: 50,
        tags: ['imported-email'],
        notes: 'Imported email list lead (no clinic enrichment yet).',
        keywordMatches: [],
        activities: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (newContacts.length === 0) { toast.error('No leads created'); return; }
    addContacts(newContacts);
    // Select newly created contacts (they may not be in eligible due to emailed-today filter; still helpful).
    setSelectedIds(prev => {
      const s = new Set(prev);
      for (const c of newContacts) s.add(c.id);
      return s;
    });
    setImportUnmatched([]);
    setShowImport(false);
    setImportText('');
    toast.success(`Created ${newContacts.length} lead${newContacts.length !== 1 ? 's' : ''} in CRM from unmatched emails`);
  };

  /* ── Google Verify (Bulk) ── */
  const handleGoogleVerifySelected = async () => {
    if (googleVerifying || selectedContacts.length === 0) return;
    if (!googleVerifyService.isConfigured) {
      toast.error('Google verify is not configured');
      return;
    }
    setGoogleVerifying(true);
    setGoogleVerifyProgress({ done: 0, total: selectedContacts.length });
    toast.loading(`Verifying ${selectedContacts.length} clinics with Google...`, { id: 'gverify-bulk' });
    try {
      for (let i = 0; i < selectedContacts.length; i++) {
        const c = selectedContacts[i];
        const leadEmail = getContactEmail(c);
        try {
          const result = await googleVerifyService.verifyClinic(c.clinic, leadEmail);
          const clinicUpdates: any = {
            googleVerifyStatus: result.status,
            googleVerifyOfficialWebsite: result.officialWebsite || undefined,
            googleVerifyConfirmedEmail: result.confirmedEmail || undefined,
            googleVerifyFoundEmails: result.foundEmails || [],
            googleVerifyCheckedAt: result.checkedAt,
          };
          if (result.officialWebsite) clinicUpdates.website = result.officialWebsite;
          updateContact(c.id, { clinic: { ...c.clinic, ...clinicUpdates } } as any);
        } catch {
          // ignore per-item failures
        }
        setGoogleVerifyProgress({ done: i + 1, total: selectedContacts.length });
        // gentle pacing to avoid hammering
        await new Promise(r => setTimeout(r, 250));
      }
      toast.success('Google verify complete', { id: 'gverify-bulk' });
    } catch {
      toast.error('Google verify failed', { id: 'gverify-bulk' });
    } finally {
      setGoogleVerifying(false);
    }
  };

  /* ── Email Verification ── */
  const handleVerifyEmails = async () => {
    if (verifying || selectedIds.size === 0 || !REVENUEBASE_KEY) {
      if (!REVENUEBASE_KEY) toast.error('RevenueBase API key not configured');
      return;
    }
    setVerifying(true);
    const toVerify = selectedContacts.map(c => ({ id: c.id, email: getContactEmail(c)! })).filter(e => e.email);
    const unique = [...new Map(toVerify.map(e => [e.email, e])).values()];
    setVerifyProgress({ done: 0, total: unique.length });
    const newVerifications = new Map(verifications);
    let validCount = 0, invalidCount = 0;

    for (let i = 0; i < unique.length; i += 3) {
      const batch = unique.slice(i, i + 3);
      await Promise.all(batch.map(async ({ email }) => {
        try {
          const res = await axios.post('https://api.revenuebase.ai/v1/process-email', { email }, {
            headers: { 'x-key': REVENUEBASE_KEY, 'Content-Type': 'application/json' }, timeout: 10000,
          });
          const status = (res.data.status || res.data.result || res.data.verification_status || '').toLowerCase();
          let vs: VerificationStatus = 'unknown';
          let confidence = 40;
          if (status === 'valid' || status === 'deliverable' || status === 'safe') { vs = 'valid'; confidence = 95; validCount++; }
          else if (status === 'invalid' || status === 'undeliverable' || status === 'bounce') { vs = 'invalid'; confidence = 5; invalidCount++; }
          else if (status === 'risky' || status === 'catch-all' || status === 'catch_all' || status === 'accept_all') { vs = 'risky'; confidence = 60; }
          newVerifications.set(email, { email, status: vs, confidence });
        } catch (err: any) {
          if (err?.response?.status === 422 || err?.response?.status === 400) {
            newVerifications.set(email, { email, status: 'invalid', confidence: 5 }); invalidCount++;
          } else {
            newVerifications.set(email, { email, status: 'unknown', confidence: 40 });
          }
        }
      }));
      setVerifyProgress({ done: Math.min(i + 3, unique.length), total: unique.length });
      setVerifications(new Map(newVerifications));
    }

    setVerifying(false);
    toast.success(`Verified ${unique.length} emails: ${validCount} valid, ${invalidCount} invalid`);
  };

  const handleRemoveBadEmails = () => {
    const badIds = new Set<string>();
    for (const c of selectedContacts) {
      const email = getContactEmail(c);
      if (!email) { badIds.add(c.id); continue; }
      const v = verifications.get(email);
      if (v?.status === 'invalid') badIds.add(c.id);
      else if (c.decisionMaker?.emailVerified && c.decisionMaker.emailVerificationStatus === 'invalid') badIds.add(c.id);
      else if (c.clinic.enrichedContacts?.find(ec => ec.email === email)?.emailVerificationStatus === 'invalid') badIds.add(c.id);
    }
    if (badIds.size === 0) { toast('No invalid emails to remove'); return; }
    setSelectedIds(prev => { const s = new Set(prev); badIds.forEach(id => s.delete(id)); return s; });
    setDrafts(prev => { const m = new Map(prev); badIds.forEach(id => m.delete(id)); return m; });
    toast.success(`Removed ${badIds.size} invalid email${badIds.size !== 1 ? 's' : ''}`);
  };

  // Verification summary for selected contacts
  const verificationSummary = useMemo(() => {
    let valid = 0, invalid = 0, risky = 0, unverified = 0;
    for (const c of selectedContacts) {
      const { status } = getEmailConfidence(c, verifications);
      if (status === 'valid') valid++;
      else if (status === 'invalid') invalid++;
      else if (status === 'risky') risky++;
      else unverified++;
    }
    return { valid, invalid, risky, unverified, total: selectedContacts.length };
  }, [selectedContacts, verifications]);

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
      const ai = await generatePersonalizedEmail(contact, step, prevEmails, aiDirection || undefined);
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
    if (provider === 'resend' && !isConfigured) { toast.error('V-send (Resend) not configured'); return; }
    if (provider === 'smtp' && !smtpSendService.isConfigured) { toast.error('SMTP not configured'); return; }
    setSending(true);
    const toSend = Array.from(drafts.values()).slice(0, remaining);
    setSendProgress({ sent: 0, total: toSend.length });
    let successCount = 0;

    for (let i = 0; i < toSend.length; i++) {
      const draft = toSend[i];
      try {
        const result = provider === 'smtp'
          ? await smtpSendService.sendAIPersonalized(draft.contact, draft.email, { subject: draft.subject, html: draft.html, text: draft.plainText }, draft.step)
          : await resendService.sendAIPersonalized(draft.contact, draft.email, { subject: draft.subject, html: draft.html }, draft.step);
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
      {provider === 'resend' && !isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Resend not configured</p>
            <p className="text-xs text-slate-400">Add VITE_RESEND_API_KEY to .env to enable sending.</p>
          </div>
        </div>
      )}
      {provider === 'smtp' && !smtpSendService.isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">SMTP not configured</p>
            <p className="text-xs text-slate-400">Set VITE_SMTP_SEND_FUNCTION_URL (and deploy the smtp-send Cloud Function) to enable SMTP sending.</p>
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
          <div className="flex items-center gap-2">
            <button onClick={() => setShowImport(!showImport)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                showImport ? 'bg-novalyte-500/20 text-novalyte-300 border-novalyte-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06]')}>
              <Upload className="w-3 h-3" /> Import
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

        {/* Selection controls bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Select / Deselect */}
          <div className="flex items-center rounded-lg border border-white/[0.06] overflow-hidden">
            <button onClick={selectAllClinics} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-slate-400 hover:text-novalyte-300 hover:bg-white/[0.04] transition-all border-r border-white/[0.06]">
              <CheckSquare className="w-3 h-3" /> All
            </button>
            <button onClick={unselectAll} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-all border-r border-white/[0.06]">
              <Square className="w-3 h-3" /> None
            </button>
            <button onClick={invertSelection} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-all border-r border-white/[0.06]">
              <MinusSquare className="w-3 h-3" /> Invert
            </button>
            <button onClick={selectVerifiedOnly} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-emerald-400/70 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all">
              <ShieldCheck className="w-3 h-3" /> Verified Only
            </button>
          </div>
          {dropdownOpen && (
            <button onClick={selectAllFiltered} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-novalyte-400 hover:text-novalyte-300 bg-novalyte-500/5 hover:bg-novalyte-500/10 border border-novalyte-500/20 transition-all">
              <CheckSquare className="w-3 h-3" /> Select Filtered ({Math.min(filtered.length, 100)})
            </button>
          )}
          {/* Filter */}
          <div className="flex items-center gap-1 ml-auto">
            <Filter className="w-3 h-3 text-slate-600" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
              className="bg-white/[0.03] border border-white/[0.06] rounded-lg text-[11px] text-slate-400 px-2 py-1.5 outline-none focus:border-novalyte-500/30">
              <option value="all">All Statuses</option>
              <option value="verified">Verified Only</option>
              <option value="risky">Risky Only</option>
              <option value="unverified">Unverified Only</option>
            </select>
            <ArrowUpDown className="w-3 h-3 text-slate-600 ml-1" />
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="bg-white/[0.03] border border-white/[0.06] rounded-lg text-[11px] text-slate-400 px-2 py-1.5 outline-none focus:border-novalyte-500/30">
              <option value="score">Sort: Score</option>
              <option value="name">Sort: Name</option>
              <option value="city">Sort: City</option>
              <option value="confidence">Sort: Email Confidence</option>
            </select>
          </div>
        </div>

        {/* Import panel */}
        {showImport && (
          <div className="mb-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-novalyte-400" />
              <h4 className="text-xs font-semibold text-slate-200">Import Email Addresses</h4>
            </div>
            <p className="text-[10px] text-slate-500">Paste email addresses below (one per line, comma-separated, or mixed text — we'll extract all valid emails). Imported emails will be matched to existing CRM contacts.</p>
            <textarea value={importText} onChange={e => setImportText(e.target.value)}
              placeholder="john@clinic.com, jane@medspa.com&#10;dr.smith@health.com&#10;Or paste any text containing email addresses..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30 resize-y font-mono" />
            {importUnmatched.length > 0 && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3">
                <p className="text-[11px] text-amber-300 font-medium">{importUnmatched.length} unmatched email{importUnmatched.length !== 1 ? 's' : ''}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  You can create lightweight CRM leads for unmatched emails (domain-based clinic shell), then enroll them in sequences.
                </p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-[10px] text-slate-600 truncate">
                    Example: {importUnmatched[0]}
                    {importUnmatched.length > 1 ? ` +${importUnmatched.length - 1} more` : ''}
                  </p>
                  <button onClick={handleCreateLeadsForUnmatched} className="btn btn-secondary text-xs">
                    <Plus className="w-3.5 h-3.5" /> Create Leads
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => { setShowImport(false); setImportText(''); setImportUnmatched([]); }} className="btn btn-secondary text-xs">Cancel</button>
              <button onClick={handleImportEmails} disabled={!importText.trim()} className="btn btn-primary text-xs gap-1">
                <Upload className="w-3.5 h-3.5" /> Import & Match
              </button>
            </div>
          </div>
        )}

        {/* Verification bar */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-medium text-slate-300">Email Health</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              {verificationSummary.valid > 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">{verificationSummary.valid} verified</span>}
              {verificationSummary.risky > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">{verificationSummary.risky} risky</span>}
              {verificationSummary.invalid > 0 && <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">{verificationSummary.invalid} invalid</span>}
              {verificationSummary.unverified > 0 && <span className="px-2 py-0.5 rounded-full bg-white/5 text-slate-500 font-medium">{verificationSummary.unverified} unverified</span>}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {verificationSummary.invalid > 0 && (
                <button onClick={handleRemoveBadEmails} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                  <Trash2 className="w-3 h-3" /> Remove Invalid ({verificationSummary.invalid})
                </button>
              )}
              <button onClick={handleGoogleVerifySelected} disabled={googleVerifying || selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                title={googleVerifyService.isConfigured ? 'Verify official website + confirmed email' : 'Google verify unavailable'}
              >
                {googleVerifying ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Google {googleVerifyProgress.done}/{googleVerifyProgress.total}</>
                ) : (
                  <><CheckCircle className="w-3.5 h-3.5" /> Verify w/ Google</>
                )}
              </button>
              <button onClick={handleVerifyEmails} disabled={verifying || selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                {verifying ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Verifying {verifyProgress.done}/{verifyProgress.total}</>
                ) : (
                  <><ShieldCheck className="w-3.5 h-3.5" /> Verify Emails</>
                )}
              </button>
            </div>
            {verifying && (
              <div className="w-full mt-1">
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${verifyProgress.total ? (verifyProgress.done / verifyProgress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            {googleVerifying && (
              <div className="w-full -mt-1">
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${googleVerifyProgress.total ? (googleVerifyProgress.done / googleVerifyProgress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

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
                const emailConf = getEmailConfidence(c, verifications);
                return (
                  <div key={c.id} onClick={() => toggleClinic(c.id)}
                    className={cn('flex items-center gap-4 px-4 py-3 cursor-pointer transition-all border-b border-white/[0.04] last:border-0',
                      isSelected ? 'bg-novalyte-500/10' : 'hover:bg-white/[0.04]',
                      emailConf.status === 'invalid' && 'opacity-50')}>
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
                    {/* Email confidence badge */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {emailConf.status === 'valid' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                      {emailConf.status === 'risky' && <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
                      {emailConf.status === 'invalid' && <ShieldX className="w-3.5 h-3.5 text-red-400" />}
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                        emailConf.score >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
                        emailConf.score >= 50 ? 'bg-amber-500/10 text-amber-400' :
                        emailConf.score >= 20 ? 'bg-red-500/10 text-red-400' :
                        'bg-white/5 text-slate-500'
                      )}>{emailConf.score}%</span>
                    </div>
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

        {/* AI Direction — user describes the approach/angle */}
        <div className="mb-3">
          <label className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium mb-1.5 flex items-center gap-1.5">
            <Wand2 className="w-3 h-3" /> AI Direction (optional)
          </label>
          <textarea
            value={aiDirection}
            onChange={e => setAiDirection(e.target.value)}
            placeholder="e.g. Focus on GLP-1 weight loss opportunity, mention our 40% close rate, offer a free market analysis call..."
            rows={2}
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40 resize-none"
          />
          <p className="text-[9px] text-slate-600 mt-1">Tell Gemini the angle, tone, or offer you want in the first message. Leave blank for auto-personalization.</p>
        </div>

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
                      {/* Email confidence badge on draft */}
                      {(() => {
                        const conf = getEmailConfidence(draft.contact, verifications);
                        return (
                          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5',
                            conf.status === 'valid' ? 'bg-emerald-500/10 text-emerald-400' :
                            conf.status === 'invalid' ? 'bg-red-500/10 text-red-400' :
                            conf.status === 'risky' ? 'bg-amber-500/10 text-amber-400' :
                            'bg-white/5 text-slate-500'
                          )}>
                            {conf.status === 'valid' && <ShieldCheck className="w-2.5 h-2.5" />}
                            {conf.status === 'invalid' && <ShieldX className="w-2.5 h-2.5" />}
                            {conf.status === 'risky' && <ShieldAlert className="w-2.5 h-2.5" />}
                            {conf.score}%
                          </span>
                        );
                      })()}
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
        <div className="glass-card p-4 space-y-3">
          {/* Invalid email warning */}
          {(() => {
            const invalidDrafts = readyDrafts.filter(d => {
              const conf = getEmailConfidence(d.contact, verifications);
              return conf.status === 'invalid';
            });
            const riskyDrafts = readyDrafts.filter(d => {
              const conf = getEmailConfidence(d.contact, verifications);
              return conf.status === 'risky';
            });
            const avgConfidence = readyDrafts.length > 0
              ? Math.round(readyDrafts.reduce((sum, d) => sum + getEmailConfidence(d.contact, verifications).score, 0) / readyDrafts.length)
              : 0;
            return (
              <>
                {/* Confidence score bar */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-medium text-slate-300">Send Queue Health</span>
                  </div>
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all',
                      avgConfidence >= 80 ? 'bg-emerald-500' : avgConfidence >= 50 ? 'bg-amber-500' : 'bg-red-500'
                    )} style={{ width: `${avgConfidence}%` }} />
                  </div>
                  <span className={cn('text-sm font-bold tabular-nums',
                    avgConfidence >= 80 ? 'text-emerald-400' : avgConfidence >= 50 ? 'text-amber-400' : 'text-red-400'
                  )}>{avgConfidence}%</span>
                </div>

                {invalidDrafts.length > 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                    <ShieldX className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-xs text-red-300 flex-1">{invalidDrafts.length} draft{invalidDrafts.length !== 1 ? 's have' : ' has'} invalid email{invalidDrafts.length !== 1 ? 's' : ''} — these will likely bounce.</p>
                    <button onClick={() => {
                      const badIds = new Set(invalidDrafts.map(d => d.contactId));
                      setDrafts(prev => { const m = new Map(prev); badIds.forEach(id => m.delete(id)); return m; });
                      setSelectedIds(prev => { const s = new Set(prev); badIds.forEach(id => s.delete(id)); return s; });
                      toast.success(`Removed ${badIds.size} invalid drafts`);
                    }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 shrink-0">
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                )}
                {riskyDrafts.length > 0 && invalidDrafts.length === 0 && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-300">{riskyDrafts.length} email{riskyDrafts.length !== 1 ? 's are' : ' is'} marked risky — may be catch-all domains. Proceed with caution.</p>
                  </div>
                )}
              </>
            );
          })()}

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
              disabled={(provider === 'resend' ? !isConfigured : !smtpSendService.isConfigured) || sending || readyDrafts.length === 0 || remaining === 0}
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
   MANUAL COMPOSE TAB — Write your own email to any address
   ═══════════════════════════════════════════════════════════════ */

function ManualComposeTab({
  contacts, addSentEmails, updateContact, isConfigured, remaining,
  provider,
}: {
  contacts: CRMContact[];
  sentEmails: SentEmail[];
  addSentEmails: (emails: SentEmail[]) => void;
  updateContact: (id: string, updates: Partial<CRMContact>) => void;
  isConfigured: boolean;
  remaining: number;
  provider: 'resend' | 'smtp';
}) {
  const [toEmail, setToEmail] = useState('');
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');

  // AI Sidecar (Vertex AI / Gemini) — drafts subject + body based on optional context.
  const [aiDirection, setAiDirection] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ subject: string; body: string } | null>(null);
  const [contextSearch, setContextSearch] = useState('');
  const [contextContactId, setContextContactId] = useState<string>('');

  const contextCandidates = useMemo(() => {
    if (!contextSearch.trim()) return [];
    const q = contextSearch.toLowerCase();
    return contacts
      .filter(c =>
        c.clinic.name.toLowerCase().includes(q) ||
        c.clinic.address.city.toLowerCase().includes(q) ||
        (getContactEmail(c) || '').toLowerCase().includes(q) ||
        (c.decisionMaker && `${c.decisionMaker.firstName} ${c.decisionMaker.lastName}`.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [contacts, contextSearch]);

  const addEmail = () => {
    const email = toEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address'); return; }
    if (toEmails.includes(email)) { toast.error('Email already added'); return; }
    setToEmails(prev => [...prev, email]);
    setToEmail('');
  };

  const removeEmail = (email: string) => {
    setToEmails(prev => prev.filter(e => e !== email));
  };

  const handleBulkImport = () => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const found = [...new Set((bulkText.match(emailRegex) || []).map(e => e.toLowerCase()))];
    if (found.length === 0) { toast.error('No valid emails found'); return; }
    const existing = new Set(toEmails);
    const newEmails = found.filter(e => !existing.has(e));
    setToEmails(prev => [...prev, ...newEmails]);
    setShowBulkImport(false);
    setBulkText('');
    toast.success(`Added ${newEmails.length} email${newEmails.length !== 1 ? 's' : ''}`);
  };

  const handleSend = async () => {
    if (provider === 'resend' && !isConfigured) { toast.error('V-send (Resend) not configured'); return; }
    if (provider === 'smtp' && !smtpSendService.isConfigured) { toast.error('SMTP not configured'); return; }
    if (toEmails.length === 0) { toast.error('Add at least one recipient'); return; }
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!body.trim()) { toast.error('Body is required'); return; }

    setSending(true);
    const toSend = toEmails.slice(0, remaining);
    setSendProgress({ sent: 0, total: toSend.length });
    let successCount = 0;

    const htmlBody = body.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => `<p style="font-size:15px;line-height:1.7;margin:0 0 12px 0;">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('\n');
    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">${htmlBody}</div>`;

    for (let i = 0; i < toSend.length; i++) {
      const email = toSend[i];
      try {
        // Try to match to a CRM contact
        const contact = contacts.find(c => {
          const ce = getContactEmail(c);
          return ce && ce.toLowerCase() === email;
        });

        const result = provider === 'smtp'
          ? await smtpSendService.sendEmail({
              to: email,
              subject: subject.trim(),
              html,
              text: body,
              contactId: contact?.id || `manual-${Date.now()}-${i}`,
              clinicName: contact?.clinic.name || email.split('@')[1] || 'Manual',
              market: contact ? `${contact.clinic.marketZone.city}, ${contact.clinic.marketZone.state}` : 'Manual',
              tags: [{ name: 'source', value: 'manual_compose' }],
            })
          : await resendService.sendEmail({
              to: email,
              subject: subject.trim(),
              html,
              contactId: contact?.id || `manual-${Date.now()}-${i}`,
              clinicName: contact?.clinic.name || email.split('@')[1] || 'Manual',
              market: contact ? `${contact.clinic.marketZone.city}, ${contact.clinic.marketZone.state}` : 'Manual',
              tags: [{ name: 'source', value: 'manual_compose' }],
            });
        addSentEmails([result]);

        if (contact) {
          updateContact(contact.id, {
            lastContactedAt: new Date(),
            activities: [...(contact.activities || []), {
              id: `act-manual-${Date.now()}-${i}`, type: 'email_sent' as const,
              description: `Manual email sent: "${subject}" to ${email}`,
              timestamp: new Date(),
              metadata: { resendId: result.id, manual: true },
            }],
          });
        }
        successCount++;
      } catch (err: any) {
        console.warn(`Send failed for ${email}:`, err);
      }
      setSendProgress({ sent: i + 1, total: toSend.length });
      if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 1200));
    }

    setSending(false);
    if (successCount > 0) {
      toast.success(`Sent ${successCount}/${toSend.length} emails`);
      setToEmails([]);
      setSubject('');
      setBody('');
    } else {
      toast.error('All sends failed');
    }
  };

  const generateWithAI = async () => {
    if (aiLoading) return;
    if (!vertexAI.isConfigured) {
      toast.error('Vertex AI / Gemini not configured (VITE_GEMINI_API_KEY or Vertex credentials)');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const ctxContact = contextContactId ? contacts.find(c => c.id === contextContactId) : null;
      const ctx = ctxContact ? {
        clinic: {
          name: ctxContact.clinic.name,
          city: ctxContact.clinic.address.city,
          state: ctxContact.clinic.address.state,
          services: ctxContact.clinic.services,
          rating: ctxContact.clinic.rating,
          website: ctxContact.clinic.website,
        },
        decisionMaker: ctxContact.decisionMaker ? {
          firstName: ctxContact.decisionMaker.firstName,
          lastName: ctxContact.decisionMaker.lastName,
          title: ctxContact.decisionMaker.title,
        } : null,
        keyword: ctxContact.keywordMatches?.[0] ? {
          keyword: ctxContact.keywordMatches[0].keyword,
          growthRate: ctxContact.keywordMatches[0].growthRate,
        } : null,
      } : null;

      const prompt = [
        "You are an expert outbound email copywriter for a men's health clinic marketing product (Novalyte).",
        'Write a complete cold outreach email with a clear offer and a short CTA.',
        '',
        'Output STRICT JSON only with keys: subject, body.',
        'The body must be plain text with line breaks (no markdown).',
        '',
        aiDirection ? `DIRECTION:\\n${aiDirection}` : '',
        aiContext ? `EXTRA CONTEXT (user uploaded):\\n${aiContext}` : '',
        ctx ? `CRM CONTEXT (if present):\\n${JSON.stringify(ctx)}` : '',
        '',
        'Constraints:',
        '- Keep it under 160 words.',
        '- Avoid hype, avoid buzzwords, avoid emojis.',
        "- Personalize using the context if available, otherwise stay generic but specific to men's health clinics.",
      ].filter(Boolean).join('\\n');

      const resp = await vertexAI.generateContent({
        model: 'gemini-2.0-flash',
        prompt,
        temperature: 0.4,
        maxOutputTokens: 900,
      });
      const parsed = vertexAI.parseJSON<{ subject: string; body: string }>(resp.text);
      if (!parsed?.subject || !parsed?.body) {
        throw new Error('AI response was not valid JSON with subject/body');
      }
      setAiSuggestion({ subject: parsed.subject.trim(), body: parsed.body.trim() });
    } catch (err: any) {
      setAiError(err?.message || 'AI draft failed');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4">
      <div className="space-y-4">
      {provider === 'resend' && !isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">Resend not configured</p>
            <p className="text-xs text-slate-400">Add VITE_RESEND_API_KEY to .env to enable sending.</p>
          </div>
        </div>
      )}
      {provider === 'smtp' && !smtpSendService.isConfigured && (
        <div className="glass-card p-4 border-amber-500/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm text-amber-300 font-medium">SMTP not configured</p>
            <p className="text-xs text-slate-400">Set VITE_SMTP_SEND_FUNCTION_URL to enable SMTP sending.</p>
          </div>
        </div>
      )}

      {/* Recipients */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-novalyte-400" />
            <h3 className="text-sm font-semibold text-slate-200">Recipients</h3>
            {toEmails.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-500">{toEmails.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowBulkImport(!showBulkImport)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                showBulkImport ? 'bg-novalyte-500/20 text-novalyte-300 border-novalyte-500/30' : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.06]')}>
              <Upload className="w-3 h-3" /> Bulk Import
            </button>
            {toEmails.length > 0 && (
              <button onClick={() => setToEmails([])} className="text-[11px] text-slate-500 hover:text-red-400 transition-colors">Clear All</button>
            )}
          </div>
        </div>

        {/* Add single email */}
        <div className="flex items-center gap-2">
          <input value={toEmail} onChange={e => setToEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
            placeholder="Enter email address and press Enter..."
            className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30" />
          <button onClick={addEmail} className="btn btn-secondary text-xs gap-1">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* Bulk import */}
        {showBulkImport && (
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <p className="text-[10px] text-slate-500">Paste emails — one per line, comma-separated, or any text containing emails.</p>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
              placeholder="john@clinic.com, jane@medspa.com&#10;dr.smith@health.com"
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30 resize-y font-mono" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowBulkImport(false); setBulkText(''); }} className="btn btn-secondary text-xs">Cancel</button>
              <button onClick={handleBulkImport} disabled={!bulkText.trim()} className="btn btn-primary text-xs gap-1">
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
            </div>
          </div>
        )}

        {/* Email chips */}
        {toEmails.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {toEmails.map(email => {
              const inCRM = contacts.some(c => { const ce = getContactEmail(c); return ce && ce.toLowerCase() === email; });
              return (
                <span key={email}
                  className={cn('inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ring-1',
                    inCRM ? 'bg-novalyte-500/10 text-novalyte-300 ring-novalyte-500/20' : 'bg-white/[0.03] text-slate-400 ring-white/[0.08]')}>
                  {inCRM && <CheckCircle className="w-3 h-3 text-emerald-400" />}
                  {email}
                  <X className="w-3 h-3 cursor-pointer hover:text-red-400 transition-colors" onClick={() => removeEmail(email)} />
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Compose */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <PenLine className="w-4 h-4 text-novalyte-400" />
          <h3 className="text-sm font-semibold text-slate-200">Compose Email</h3>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Email subject line..."
            className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30" />
        </div>

        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Body (plain text — will be formatted as HTML)</label>
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder="Write your email here...&#10;&#10;Each line becomes a paragraph.&#10;&#10;Best,&#10;Jamil"
            rows={10}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-slate-300 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30 resize-y leading-relaxed" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            {toEmails.length} recipient{toEmails.length !== 1 ? 's' : ''} · {remaining} sends remaining today
          </p>
          <button onClick={handleSend}
            disabled={(provider === 'resend' ? !isConfigured : !smtpSendService.isConfigured) || sending || toEmails.length === 0 || !subject.trim() || !body.trim() || remaining === 0}
            className={cn('btn gap-2', sending ? 'btn-secondary' : 'btn-primary')}>
            {sending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending {sendProgress.sent}/{sendProgress.total}</>
            ) : (
              <><Send className="w-4 h-4" /> Send {toEmails.length} Email{toEmails.length !== 1 ? 's' : ''}</>
            )}
          </button>
        </div>
        {sending && (
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-novalyte-500 to-novalyte-400 rounded-full transition-all duration-500"
              style={{ width: `${sendProgress.total ? (sendProgress.sent / sendProgress.total) * 100 : 0}%` }} />
          </div>
        )}
      </div>
      </div>

      {/* AI Sidecar */}
      <div className="glass-card p-5 space-y-4 h-fit lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-slate-200">Vertex AI Sidecar</h3>
          </div>
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full border',
            vertexAI.isConfigured ? 'bg-purple-500/10 text-purple-300 border-purple-500/20' : 'bg-red-500/10 text-red-300 border-red-500/20'
          )}>
            {vertexAI.isConfigured ? `Gemini (${vertexAI.provider})` : 'Not configured'}
          </span>
        </div>

        <p className="text-[10px] text-slate-500">
          Tell the AI what you want. It will draft a complete subject + email body using your uploaded context and (optionally) a CRM clinic profile.
        </p>

        <div className="space-y-2">
          <label className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium">Use CRM Context (optional)</label>
          <input
            value={contextSearch}
            onChange={e => { setContextSearch(e.target.value); setContextContactId(''); }}
            placeholder="Search clinic or decision maker..."
            className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-novalyte-500/30"
          />
          {contextCandidates.length > 0 && !contextContactId && (
            <div className="rounded-lg border border-white/[0.06] bg-black/40 overflow-hidden">
              {contextCandidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setContextContactId(c.id); setContextSearch(c.clinic.name); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0"
                >
                  <p className="text-xs text-slate-200 font-medium truncate">{c.clinic.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{c.clinic.address.city}, {c.clinic.address.state}</p>
                </button>
              ))}
            </div>
          )}
          {contextContactId && (
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Context locked to: <span className="text-slate-300">{contextSearch}</span></span>
              <button onClick={() => { setContextContactId(''); setContextSearch(''); }} className="text-slate-500 hover:text-red-400">Clear</button>
            </div>
          )}
        </div>

        <div>
          <label className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium mb-1.5 block">Direction</label>
          <textarea
            value={aiDirection}
            onChange={e => setAiDirection(e.target.value)}
            placeholder="e.g. Mention we specialize in men's health, offer a free market report, ask for a 15-min call..."
            rows={3}
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40 resize-none"
          />
        </div>

        <div>
          <label className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium mb-1.5 block">Uploaded Data / Notes</label>
          <textarea
            value={aiContext}
            onChange={e => setAiContext(e.target.value)}
            placeholder="Paste any data you uploaded (pricing, offer, ICP, clinic list notes, etc.). The AI will use it."
            rows={5}
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40 resize-y"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={generateWithAI}
            disabled={aiLoading}
            className="btn btn-secondary gap-2 text-xs"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            Draft Email
          </button>
          {aiSuggestion && (
            <button
              onClick={() => { setSubject(aiSuggestion.subject); setBody(aiSuggestion.body); toast.success('Applied AI draft to editor'); }}
              className="btn btn-primary gap-2 text-xs"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Apply
            </button>
          )}
        </div>

        {aiError && <p className="text-[10px] text-red-400">{aiError}</p>}

        {aiSuggestion && (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 space-y-2">
            <p className="text-[10px] text-slate-500">Subject</p>
            <p className="text-xs text-slate-200 font-medium">{aiSuggestion.subject}</p>
            <p className="text-[10px] text-slate-500 mt-2">Body</p>
            <pre className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">{aiSuggestion.body}</pre>
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   SEQUENCES TAB — Smart sequencing engine view
   ═══════════════════════════════════════════════════════════════ */

const stepConfig: Record<SequenceStep, { label: string; color: string; bg: string; icon: typeof Mail; day: number }> = {
  intro: { label: 'Day 1 · Intro Email', color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Mail, day: 1 },
  follow_up: { label: 'Day 2 · Follow-Up', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Send, day: 2 },
  phone_call: { label: 'Day 3 · Phone Call', color: 'text-novalyte-400', bg: 'bg-novalyte-500/10', icon: Phone, day: 3 },
  value_add: { label: 'Day 4 · Value-Add', color: 'text-purple-400', bg: 'bg-purple-500/10', icon: Sparkles, day: 4 },
  breakup: { label: 'Day 5 · Breakup', color: 'text-red-400', bg: 'bg-red-500/10', icon: MailX, day: 5 },
  completed: { label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle, day: 0 },
  replied: { label: 'Engaged', color: 'text-violet-400', bg: 'bg-violet-500/10', icon: MailOpen, day: 0 },
  opted_out: { label: 'Opted Out', color: 'text-slate-500', bg: 'bg-white/5', icon: AlertCircle, day: 0 },
};

function SequencesTab({ contacts, sentEmails, provider, remaining }: { contacts: CRMContact[]; sentEmails: SentEmail[]; provider: 'resend' | 'smtp'; remaining: number }) {
  /* ─── 5-Day Sequence Types ─── */
  type SeqStatus = 'active' | 'paused' | 'stopped' | 'completed' | 'replied';

  interface StepDraft {
    day: number;
    step: SequenceStep;
    type: 'email' | 'phone';
    status: 'pending' | 'generating' | 'ready' | 'sent' | 'called' | 'skipped';
    subject?: string;
    body?: string;
    html?: string;
    callId?: string;
    callStatus?: string;
    executedAt?: Date;
    edited?: boolean;
  }

  interface Enrollment {
    contactId: string;
    status: SeqStatus;
    currentDay: number;
    enrolledAt: Date;
    steps: StepDraft[];
  }

  const SEQ_BLUEPRINT: { day: number; step: SequenceStep; type: 'email' | 'phone'; label: string; desc: string }[] = [
    { day: 1, step: 'intro', type: 'email', label: 'Intro Email', desc: 'Personalized intro with market data' },
    { day: 2, step: 'follow_up', type: 'email', label: 'Follow-Up Email', desc: 'Reference intro, add new value' },
    { day: 3, step: 'phone_call', type: 'phone', label: 'Phone Call (Kaizen)', desc: 'Voice agent call via Vapi' },
    { day: 4, step: 'value_add', type: 'email', label: 'Value-Add Email', desc: 'Case study or market insight' },
    { day: 5, step: 'breakup', type: 'email', label: 'Breakup Email', desc: 'Graceful close, leave door open' },
  ];

  /* ─── State ─── */
  const [enrollments, setEnrollments] = useState<Map<string, Enrollment>>(new Map());
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState('');
  const [enrollSelected, setEnrollSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<{ contactId: string; day: number } | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState({ done: 0, total: 0 });
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'paused' | 'completed' | 'replied'>('all');
  const [sequenceDirection, setSequenceDirection] = useState('');

  /* ─── Source detection helpers ─── */
  const getSource = (c: CRMContact): 'ai-engine' | 'discovery' | 'crm' => {
    if (c.tags?.includes('drip-sequence')) return 'ai-engine';
    if (c.decisionMaker?.source === 'ai-engine') return 'ai-engine';
    if (c.tags?.includes('clinic-discovery')) return 'discovery';
    return 'crm';
  };
  const sourceConfig = {
    'ai-engine': { label: 'AI Engine', color: 'text-novalyte-400', bg: 'bg-novalyte-500/10', ring: 'ring-novalyte-500/20' },
    'discovery': { label: 'Discovery', color: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' },
    'crm': { label: 'CRM', color: 'text-blue-400', bg: 'bg-blue-500/10', ring: 'ring-blue-500/20' },
  };

  const [sourceFilter, setSourceFilter] = useState<'all' | 'ai-engine' | 'discovery' | 'crm'>('all');

  /* ─── Eligible contacts for enrollment ─── */
  const eligible = useMemo(() => {
    return contacts.filter(c => {
      const email = getContactEmail(c);
      return !!email && !enrollments.has(c.id);
    }).sort((a, b) => b.score - a.score);
  }, [contacts, enrollments]);

  /* ─── Source counts ─── */
  const sourceCounts = useMemo(() => {
    const counts = { 'ai-engine': 0, 'discovery': 0, 'crm': 0 };
    eligible.forEach(c => { counts[getSource(c)]++; });
    return counts;
  }, [eligible]);

  /* ─── AI Engine staged clinics (drip-sequence tag, not yet enrolled) ─── */
  const stagedFromAI = useMemo(() =>
    eligible.filter(c => c.tags?.includes('drip-sequence')),
    [eligible]
  );

  const filteredEnroll = useMemo(() => {
    let list = eligible;
    if (sourceFilter !== 'all') {
      list = list.filter(c => getSource(c) === sourceFilter);
    }
    if (!enrollSearch) return list;
    const q = enrollSearch.toLowerCase();
    return list.filter(c =>
      c.clinic.name.toLowerCase().includes(q) ||
      c.clinic.address.city.toLowerCase().includes(q) ||
      (c.decisionMaker && `${c.decisionMaker.firstName} ${c.decisionMaker.lastName}`.toLowerCase().includes(q))
    );
  }, [eligible, enrollSearch, sourceFilter]);

  /* ─── Enrollment list with filters ─── */
  const enrollmentList = useMemo(() => {
    const list = Array.from(enrollments.entries()).map(([id, e]) => ({
      enrollment: e,
      contact: contacts.find(c => c.id === id)!,
    })).filter(x => x.contact);
    if (filterStatus === 'all') return list;
    return list.filter(x => x.enrollment.status === filterStatus);
  }, [enrollments, contacts, filterStatus]);

  /* ─── Stats ─── */
  const seqStats = useMemo(() => {
    let active = 0, paused = 0, completed = 0, replied = 0, stopped = 0;
    enrollments.forEach(e => {
      if (e.status === 'active') active++;
      else if (e.status === 'paused') paused++;
      else if (e.status === 'completed') completed++;
      else if (e.status === 'replied') replied++;
      else if (e.status === 'stopped') stopped++;
    });
    return { total: enrollments.size, active, paused, completed, replied, stopped };
  }, [enrollments]);

  /* ─── Check reply detection from sent emails ─── */
  const checkReplies = useCallback(() => {
    setEnrollments(prev => {
      const updated = new Map(prev);
      let changed = false;
      for (const [id, enrollment] of updated) {
        if (enrollment.status !== 'active') continue;
        const contact = contacts.find(c => c.id === id);
        const hasReply = Boolean(contact?.activities?.some(a => a.type === 'email_reply'));
        const contactEmails = sentEmails.filter(e => e.contactId === id);
        const hasBounce = contactEmails.some(e => e.lastEvent === 'bounced');
        if (hasReply) {
          updated.set(id, { ...enrollment, status: 'replied' });
          changed = true;
        } else if (hasBounce) {
          updated.set(id, { ...enrollment, status: 'stopped' });
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, [sentEmails, contacts]);

  // Auto-check replies when sentEmails change
  useMemo(() => { checkReplies(); }, [sentEmails]);

  /* ─── Enroll clinics into sequence ─── */
  const handleEnroll = () => {
    if (enrollSelected.size === 0) return;
    const newEnrollments = new Map(enrollments);
    let count = 0;
    for (const id of enrollSelected) {
      if (newEnrollments.has(id)) continue;
      const steps: StepDraft[] = SEQ_BLUEPRINT.map(s => ({
        day: s.day, step: s.step, type: s.type, status: 'pending' as const,
      }));
      newEnrollments.set(id, {
        contactId: id, status: 'active', currentDay: 1,
        enrolledAt: new Date(), steps,
      });
      count++;
    }
    setEnrollments(newEnrollments);
    setEnrollSelected(new Set());
    setShowEnroll(false);
    toast.success(`Enrolled ${count} clinic${count !== 1 ? 's' : ''} in 5-day sequence`);
  };

  const handleEnrollStagedFromAI = () => {
    const staged = stagedFromAI.slice(0, 200).map(c => c.id);
    if (!staged.length) { toast('No staged AI Engine clinics found'); return; }
    setEnrollSelected(new Set(staged));
    setShowEnroll(true);
  };

  /* ─── AI Generate all email steps for an enrollment ─── */
  const handleGenerateSteps = async (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    const enrollment = enrollments.get(contactId);
    if (!contact || !enrollment) return;
    setGenerating(true);
    const emailSteps = enrollment.steps.filter(s => s.type === 'email' && s.status === 'pending');
    setGenProgress({ done: 0, total: emailSteps.length });
    const updatedSteps = [...enrollment.steps];

    for (let i = 0; i < emailSteps.length; i++) {
      const s = emailSteps[i];
      const idx = updatedSteps.findIndex(us => us.day === s.day);
      updatedSteps[idx] = { ...updatedSteps[idx], status: 'generating' };
      setEnrollments(prev => {
        const m = new Map(prev);
        m.set(contactId, { ...enrollment, steps: [...updatedSteps] });
        return m;
      });

      try {
        const stepType = s.step === 'intro' ? 'intro' : s.step === 'follow_up' ? 'follow_up' : 'breakup';
        const prevEmails = sentEmails.filter(e => e.contactId === contactId);
        const ai = await generatePersonalizedEmail(contact, stepType as any, prevEmails, sequenceDirection || undefined);
        updatedSteps[idx] = {
          ...updatedSteps[idx], status: 'ready',
          subject: ai.subject, body: ai.plainText, html: ai.html,
        };
      } catch {
        updatedSteps[idx] = { ...updatedSteps[idx], status: 'pending' };
      }
      setGenProgress({ done: i + 1, total: emailSteps.length });
      setEnrollments(prev => {
        const m = new Map(prev);
        m.set(contactId, { ...enrollment, steps: [...updatedSteps] });
        return m;
      });
      if (i < emailSteps.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
    setGenerating(false);
    toast.success(`Generated ${emailSteps.length} email drafts for ${contact.clinic.name}`);
  };

  /* ─── Generate all steps for ALL active enrollments ─── */
  const handleGenerateAll = async () => {
    const active = Array.from(enrollments.entries())
      .filter(([_, e]) => e.status === 'active' && e.steps.some(s => s.type === 'email' && s.status === 'pending'));
    if (active.length === 0) { toast('No pending email steps to generate'); return; }
    setGenerating(true);
    let totalSteps = 0;
    active.forEach(([_, e]) => { totalSteps += e.steps.filter(s => s.type === 'email' && s.status === 'pending').length; });
    setGenProgress({ done: 0, total: totalSteps });
    let doneCount = 0;

    for (const [id] of active) {
      const contact = contacts.find(c => c.id === id);
      const enrollment = enrollments.get(id);
      if (!contact || !enrollment) continue;
      const emailSteps = enrollment.steps.filter(s => s.type === 'email' && s.status === 'pending');
      const updatedSteps = [...enrollment.steps];

      for (const s of emailSteps) {
        const idx = updatedSteps.findIndex(us => us.day === s.day);
        try {
          const stepType = s.step === 'intro' ? 'intro' : s.step === 'follow_up' ? 'follow_up' : 'breakup';
          const ai = await generatePersonalizedEmail(contact, stepType as any, sentEmails.filter(e => e.contactId === id), sequenceDirection || undefined);
          updatedSteps[idx] = { ...updatedSteps[idx], status: 'ready', subject: ai.subject, body: ai.plainText, html: ai.html };
        } catch { /* skip */ }
        doneCount++;
        setGenProgress({ done: doneCount, total: totalSteps });
        setEnrollments(prev => {
          const m = new Map(prev);
          m.set(id, { ...enrollment, steps: [...updatedSteps] });
          return m;
        });
        await new Promise(r => setTimeout(r, 800));
      }
    }
    setGenerating(false);
    toast.success(`Generated ${doneCount} email drafts`);
  };

  /* ─── Execute current day step for a clinic ─── */
  const handleExecuteStep = async (contactId: string, day: number) => {
    const contact = contacts.find(c => c.id === contactId);
    const enrollment = enrollments.get(contactId);
    if (!contact || !enrollment) return;
    if (enrollment.status !== 'active') { toast.error('Sequence is not active'); return; }

    const stepIdx = enrollment.steps.findIndex(s => s.day === day);
    const step = enrollment.steps[stepIdx];
    if (!step) return;

    if (step.type === 'phone') {
      // Phone call via voice agent
      if (!voiceAgentService.isConfigured) { toast.error('Vapi not configured'); return; }
      if (!voiceAgentService.isWithinBusinessHours()) {
        toast.error(`Outside business hours. ${voiceAgentService.getNextBusinessWindow()}`);
        return;
      }
      if (!contact.clinic.phone) { toast.error('No phone number for this clinic'); return; }
      try {
        const call = await voiceAgentService.initiateCall(contact);
        const updatedSteps = [...enrollment.steps];
        updatedSteps[stepIdx] = { ...step, status: 'called', callId: call.id, callStatus: call.status, executedAt: new Date() };
        setEnrollments(prev => {
          const m = new Map(prev);
          m.set(contactId, { ...enrollment, steps: updatedSteps, currentDay: Math.min(day + 1, 5) });
          return m;
        });
        toast.success(`Call initiated to ${contact.clinic.name}`);
      } catch (err: any) {
        toast.error(err.message || 'Call failed');
      }
      return;
    }

    // Email step
    if (!step.subject || !step.html) { toast.error('Generate email content first'); return; }
    const email = getContactEmail(contact);
    if (!email) { toast.error('No email for this contact'); return; }

    try {
      if (provider === 'resend' && !resendService.isConfigured) { toast.error('V-send (Resend) not configured'); return; }
      if (provider === 'smtp' && !smtpSendService.isConfigured) { toast.error('SMTP not configured'); return; }

      if (provider === 'smtp') {
        await smtpSendService.sendAIPersonalized(
          contact,
          email,
          { subject: step.subject, html: step.html, text: step.body },
          step.step === 'value_add' ? 'follow_up' : step.step as any
        );
      } else {
        await resendService.sendAIPersonalized(
          contact,
          email,
          { subject: step.subject, html: step.html },
          step.step === 'value_add' ? 'follow_up' : step.step as any
        );
      }
      const updatedSteps = [...enrollment.steps];
      updatedSteps[stepIdx] = { ...step, status: 'sent', executedAt: new Date() };
      setEnrollments(prev => {
        const m = new Map(prev);
        const nextDay = Math.min(day + 1, 5);
        const isLast = day === 5;
        m.set(contactId, {
          ...enrollment, steps: updatedSteps,
          currentDay: nextDay,
          status: isLast ? 'completed' : enrollment.status,
        });
        return m;
      });
      toast.success(`Day ${day} email sent to ${contact.clinic.name}`);
    } catch (err: any) {
      toast.error(err.message || 'Send failed');
    }
  };

  /* ─── Execute all ready steps for current day across all active enrollments ─── */
  const handleExecuteAllReady = async () => {
    const ready: { contactId: string; day: number }[] = [];
    enrollments.forEach((e, id) => {
      if (e.status !== 'active') return;
      const currentStep = e.steps.find(s => s.day === e.currentDay);
      if (!currentStep) return;
      if (currentStep.type === 'email' && currentStep.status === 'ready') {
        ready.push({ contactId: id, day: e.currentDay });
      }
    });
    if (ready.length === 0) { toast('No ready steps to execute'); return; }
    if (remaining === 0) { toast.error('No sends remaining for selected provider today'); return; }
    setExecuting(true);
    const toRun = ready.slice(0, remaining);
    setExecProgress({ done: 0, total: toRun.length });
    for (let i = 0; i < toRun.length; i++) {
      await handleExecuteStep(toRun[i].contactId, toRun[i].day);
      setExecProgress({ done: i + 1, total: toRun.length });
      if (i < toRun.length - 1) await new Promise(r => setTimeout(r, 1200));
    }
    setExecuting(false);
    toast.success(`Executed ${toRun.length} sequence steps`);
  };

  /* ─── Pause / Resume / Stop controls ─── */
  const handlePause = (contactId: string) => {
    setEnrollments(prev => {
      const m = new Map(prev);
      const e = m.get(contactId);
      if (e && e.status === 'active') m.set(contactId, { ...e, status: 'paused' });
      return m;
    });
  };

  const handleResume = (contactId: string) => {
    setEnrollments(prev => {
      const m = new Map(prev);
      const e = m.get(contactId);
      if (e && e.status === 'paused') m.set(contactId, { ...e, status: 'active' });
      return m;
    });
  };

  const handleStop = (contactId: string) => {
    setEnrollments(prev => {
      const m = new Map(prev);
      const e = m.get(contactId);
      if (e) m.set(contactId, { ...e, status: 'stopped' });
      return m;
    });
  };

  const handleRemove = (contactId: string) => {
    setEnrollments(prev => { const m = new Map(prev); m.delete(contactId); return m; });
  };

  const handleBulkPause = () => {
    setEnrollments(prev => {
      const m = new Map(prev);
      m.forEach((e, id) => { if (e.status === 'active') m.set(id, { ...e, status: 'paused' }); });
      return m;
    });
    toast.success('All active sequences paused');
  };

  const handleBulkResume = () => {
    setEnrollments(prev => {
      const m = new Map(prev);
      m.forEach((e, id) => { if (e.status === 'paused') m.set(id, { ...e, status: 'active' }); });
      return m;
    });
    toast.success('All paused sequences resumed');
  };

  /* ─── Edit step content ─── */
  const handleSaveStepEdit = () => {
    if (!editingStep) return;
    setEnrollments(prev => {
      const m = new Map(prev);
      const e = m.get(editingStep.contactId);
      if (!e) return prev;
      const steps = [...e.steps];
      const idx = steps.findIndex(s => s.day === editingStep.day);
      if (idx === -1) return prev;
      const htmlBody = editBody.split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => `<p style="font-size:15px;line-height:1.7;margin:0 0 12px 0;">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
        .join('\n');
      const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">${htmlBody}</div>`;
      steps[idx] = { ...steps[idx], subject: editSubject, body: editBody, html, edited: true, status: 'ready' };
      m.set(editingStep.contactId, { ...e, steps });
      return m;
    });
    setEditingStep(null);
    toast.success('Step updated');
  };

  return (
    <div className="space-y-4">
      {/* AI Engine → Outreach handoff */}
      {stagedFromAI.length > 0 && (
        <div className="glass-card p-4 border border-novalyte-500/20 bg-novalyte-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-novalyte-400" />
              <div>
                <p className="text-sm font-semibold text-slate-200">AI Engine Inbox</p>
                <p className="text-xs text-slate-500">{stagedFromAI.length} clinics staged for drip sequence</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleEnrollStagedFromAI}
                className="btn btn-primary gap-2 text-xs"
                title="Enroll AI Engine staged clinics into the 5-day sequence"
              >
                <Plus className="w-3.5 h-3.5" />
                Enroll Staged ({Math.min(stagedFromAI.length, 200)})
              </button>
              <button
                onClick={() => setShowEnroll(true)}
                className="btn btn-secondary gap-2 text-xs"
              >
                <Users className="w-3.5 h-3.5" />
                Enroll Any
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Sequence Blueprint ─── */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-novalyte-400" />
          <h3 className="text-sm font-semibold text-slate-200">5-Day Multi-Touch Sequence</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-novalyte-500/10 text-novalyte-400">AI + Voice</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {SEQ_BLUEPRINT.map((s, i) => {
            const cfg = stepConfig[s.step];
            const StepIcon = cfg.icon;
            return (
              <div key={s.day} className="flex items-center shrink-0">
                <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border', cfg.bg, 'border-white/[0.06]')}>
                  <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold', cfg.bg, cfg.color)}>
                    {s.day}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <StepIcon className={cn('w-3 h-3', cfg.color)} />
                      <span className={cn('text-[11px] font-medium', cfg.color)}>{s.label}</span>
                    </div>
                    <p className="text-[9px] text-slate-500">{s.desc}</p>
                  </div>
                </div>
                {i < SEQ_BLUEPRINT.length - 1 && (
                  <div className="w-4 h-px bg-white/10 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Stats Bar ─── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'Total', value: seqStats.total, color: 'text-slate-300' },
          { label: 'Active', value: seqStats.active, color: 'text-novalyte-400' },
          { label: 'Paused', value: seqStats.paused, color: 'text-amber-400' },
          { label: 'Replied', value: seqStats.replied, color: 'text-violet-400' },
          { label: 'Completed', value: seqStats.completed, color: 'text-emerald-400' },
          { label: 'Stopped', value: seqStats.stopped, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="glass-card p-3 text-center">
            <p className={cn('text-xl font-bold tabular-nums', s.color)}>{s.value}</p>
            <p className="text-[10px] text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ─── Controls Bar ─── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[260px]">
          <label className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium mb-1 block">AI Direction (used for Generate All)</label>
          <textarea
            value={sequenceDirection}
            onChange={e => setSequenceDirection(e.target.value)}
            placeholder="e.g. Emphasize men's health specialization, offer a free demand report, keep it short, ask for 15 minutes..."
            rows={2}
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40 resize-none"
          />
        </div>
        <button onClick={() => setShowEnroll(!showEnroll)}
          className={cn('btn gap-1.5 text-xs', showEnroll ? 'btn-primary' : 'btn-secondary')}>
          <Plus className="w-3.5 h-3.5" /> Import Prospects
          {stagedFromAI.length > 0 && !showEnroll && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-novalyte-500/20 text-novalyte-300 text-[9px] font-bold animate-pulse">
              {stagedFromAI.length} staged
            </span>
          )}
        </button>
        <button onClick={handleGenerateAll} disabled={generating || enrollments.size === 0}
          className="btn btn-secondary gap-1.5 text-xs">
          {generating ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating {genProgress.done}/{genProgress.total}</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> AI Generate All</>
          )}
        </button>
        <button onClick={handleExecuteAllReady} disabled={executing || enrollments.size === 0}
          className="btn btn-secondary gap-1.5 text-xs">
          {executing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executing {execProgress.done}/{execProgress.total}</>
          ) : (
            <><Play className="w-3.5 h-3.5" /> Execute Ready Steps</>
          )}
        </button>
        {seqStats.active > 0 && (
          <button onClick={handleBulkPause} className="btn btn-secondary gap-1 text-xs">
            <Pause className="w-3 h-3" /> Pause All
          </button>
        )}
        {seqStats.paused > 0 && (
          <button onClick={handleBulkResume} className="btn btn-secondary gap-1 text-xs">
            <Play className="w-3 h-3" /> Resume All
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Filter className="w-3 h-3 text-slate-600" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
            className="bg-white/[0.03] border border-white/[0.06] rounded-lg text-[11px] text-slate-400 px-2 py-1.5 outline-none">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="replied">Replied</option>
          </select>
        </div>
      </div>

      {generating && (
        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-novalyte-400 rounded-full transition-all duration-500"
            style={{ width: `${genProgress.total ? (genProgress.done / genProgress.total) * 100 : 0}%` }} />
        </div>
      )}

      {/* ─── Import Prospects Panel ─── */}
      {showEnroll && (
        <div className="glass-card p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-novalyte-400" />
              <h4 className="text-sm font-semibold text-slate-200">Import Prospects</h4>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
                {enrollSelected.size} selected · {eligible.length} available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEnrollSelected(new Set(filteredEnroll.slice(0, 50).map(c => c.id)))}
                className="text-[11px] text-novalyte-400 hover:text-novalyte-300">Select All</button>
              <button onClick={() => setEnrollSelected(new Set())}
                className="text-[11px] text-slate-500 hover:text-slate-300">Clear</button>
            </div>
          </div>

          {/* Quick Import Sources */}
          <div className="flex flex-wrap gap-2">
            {stagedFromAI.length > 0 && (
              <button onClick={() => {
                setEnrollSelected(new Set(stagedFromAI.slice(0, 50).map(c => c.id)));
                setSourceFilter('ai-engine');
              }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-novalyte-500/10 text-novalyte-300 border border-novalyte-500/20 hover:bg-novalyte-500/20 transition-all">
                <Zap className="w-3.5 h-3.5" />
                Import AI Engine Staged ({stagedFromAI.length})
              </button>
            )}
            {sourceCounts['discovery'] > 0 && (
              <button onClick={() => {
                const disc = eligible.filter(c => getSource(c) === 'discovery');
                setEnrollSelected(new Set(disc.slice(0, 50).map(c => c.id)));
                setSourceFilter('discovery');
              }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">
                <Search className="w-3.5 h-3.5" />
                Import from Discovery ({sourceCounts['discovery']})
              </button>
            )}
            {sourceCounts['crm'] > 0 && (
              <button onClick={() => {
                const crm = eligible.filter(c => getSource(c) === 'crm');
                setEnrollSelected(new Set(crm.slice(0, 50).map(c => c.id)));
                setSourceFilter('crm');
              }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20 transition-all">
                <Users className="w-3.5 h-3.5" />
                Import from CRM ({sourceCounts['crm']})
              </button>
            )}
          </div>

          {/* Source filter tabs + Search */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-0.5 bg-white/[0.03] rounded-lg border border-white/[0.06]">
              {(['all', 'ai-engine', 'discovery', 'crm'] as const).map(src => (
                <button key={src} onClick={() => setSourceFilter(src)}
                  className={cn('px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    sourceFilter === src ? 'bg-white/10 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
                  {src === 'all' ? `All (${eligible.length})` :
                   src === 'ai-engine' ? `AI Engine (${sourceCounts['ai-engine']})` :
                   src === 'discovery' ? `Discovery (${sourceCounts['discovery']})` :
                   `CRM (${sourceCounts['crm']})`}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input value={enrollSearch} onChange={e => setEnrollSearch(e.target.value)}
                placeholder="Search clinics..."
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none" />
            </div>
          </div>

          {/* Clinic list */}
          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-white/[0.06]">
            {filteredEnroll.slice(0, 50).map(c => {
              const email = getContactEmail(c)!;
              const dm = c.decisionMaker;
              const selected = enrollSelected.has(c.id);
              const src = getSource(c);
              const srcCfg = sourceConfig[src];
              return (
                <div key={c.id} onClick={() => {
                  setEnrollSelected(prev => {
                    const s = new Set(prev);
                    s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                    return s;
                  });
                }}
                  className={cn('flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-white/[0.04] last:border-0 transition-all',
                    selected ? 'bg-novalyte-500/10' : 'hover:bg-white/[0.03]')}>
                  <input type="checkbox" checked={selected} readOnly
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-novalyte-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-slate-200 font-medium truncate">{c.clinic.name}</p>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium ring-1', srcCfg.bg, srcCfg.color, srcCfg.ring)}>
                        {srcCfg.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {dm ? `${dm.firstName} ${dm.lastName} · ` : ''}{email} · {c.clinic.address.city}, {c.clinic.address.state}
                      {c.clinic.phone ? ` · ${c.clinic.phone}` : ' · No phone'}
                    </p>
                  </div>
                  <span className={cn('text-xs font-bold', c.score >= 80 ? 'text-emerald-400' : c.score >= 60 ? 'text-amber-400' : 'text-slate-500')}>{c.score}</span>
                </div>
              );
            })}
            {filteredEnroll.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                {eligible.length === 0 ? 'No eligible clinics. Push clinics from AI Engine or Clinic Discovery first.' : 'No matching clinics found'}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500">{filteredEnroll.length} clinics available</p>
            <button onClick={handleEnroll} disabled={enrollSelected.size === 0}
              className="btn btn-primary text-xs gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Enroll {enrollSelected.size} Clinic{enrollSelected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ─── Enrollment List ─── */}
      {enrollmentList.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Zap className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No clinics enrolled yet</p>
          <p className="text-xs text-slate-500 mt-1">Click "Import Prospects" to pull clinics from AI Engine, Discovery, or CRM into a 5-day sequence</p>
        </div>
      ) : (
        <div className="space-y-2">
          {enrollmentList.map(({ enrollment, contact }) => {
            const isExpanded = expandedId === contact.id;
            const email = getContactEmail(contact) || '';
            const dm = contact.decisionMaker;
            const statusColors: Record<string, string> = {
              active: 'text-novalyte-400 bg-novalyte-500/10',
              paused: 'text-amber-400 bg-amber-500/10',
              completed: 'text-emerald-400 bg-emerald-500/10',
              replied: 'text-violet-400 bg-violet-500/10',
              stopped: 'text-red-400 bg-red-500/10',
            };

            return (
              <div key={contact.id} className="glass-card overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-all"
                  onClick={() => setExpandedId(isExpanded ? null : contact.id)}>
                  <ChevronDown className={cn('w-4 h-4 text-slate-500 transition-transform shrink-0', isExpanded && 'rotate-180')} />
                  <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium shrink-0', statusColors[enrollment.status])}>
                    {enrollment.status.charAt(0).toUpperCase() + enrollment.status.slice(1)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-200 font-medium truncate">{contact.clinic.name}</p>
                      {dm && <span className="text-[10px] text-slate-500">{dm.firstName} {dm.lastName}</span>}
                      {(() => {
                        const src = getSource(contact);
                        const srcCfg = sourceConfig[src];
                        return (
                          <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium ring-1', srcCfg.bg, srcCfg.color, srcCfg.ring)}>
                            {srcCfg.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-[10px] text-slate-500">{email} · {contact.clinic.address.city}, {contact.clinic.address.state}</p>
                  </div>
                  {/* Timeline dots */}
                  <div className="flex items-center gap-1 shrink-0">
                    {enrollment.steps.map(s => {
                      const cfg = stepConfig[s.step];
                      return (
                        <div key={s.day} className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border',
                          s.status === 'sent' || s.status === 'called' ? `${cfg.bg} ${cfg.color} border-transparent` :
                          s.status === 'ready' ? 'bg-white/5 text-slate-300 border-novalyte-500/30' :
                          s.day === enrollment.currentDay ? 'bg-white/5 text-slate-400 border-white/20' :
                          'bg-white/[0.02] text-slate-600 border-white/[0.06]'
                        )} title={`Day ${s.day}: ${s.status}`}>
                          {s.day}
                        </div>
                      );
                    })}
                  </div>
                  {/* Controls */}
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {enrollment.status === 'active' && (
                      <button onClick={() => handlePause(contact.id)} className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-amber-400 transition-all" title="Pause">
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {enrollment.status === 'paused' && (
                      <button onClick={() => handleResume(contact.id)} className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-novalyte-400 transition-all" title="Resume">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(enrollment.status === 'active' || enrollment.status === 'paused') && (
                      <button onClick={() => handleStop(contact.id)} className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-red-400 transition-all" title="Stop">
                        <StopCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => handleRemove(contact.id)} className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-red-400 transition-all" title="Remove">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded: Step Timeline */}
                {isExpanded && (
                  <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">Sequence Timeline</p>
                      {enrollment.status === 'active' && (
                        <button onClick={() => handleGenerateSteps(contact.id)} disabled={generating}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors">
                          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          AI Generate All Steps
                        </button>
                      )}
                    </div>
                    {enrollment.steps.map(s => {
                      const cfg = stepConfig[s.step];
                      const StepIcon = cfg.icon;
                      const isCurrentDay = s.day === enrollment.currentDay && enrollment.status === 'active';
                      const isEditing = editingStep?.contactId === contact.id && editingStep?.day === s.day;

                      return (
                        <div key={s.day} className={cn('rounded-lg border p-3 transition-all',
                          isCurrentDay ? 'border-novalyte-500/30 bg-novalyte-500/5' : 'border-white/[0.06] bg-white/[0.01]',
                          s.status === 'sent' || s.status === 'called' ? 'opacity-70' : ''
                        )}>
                          <div className="flex items-center gap-3">
                            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', cfg.bg)}>
                              <StepIcon className={cn('w-4 h-4', cfg.color)} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn('text-xs font-medium', cfg.color)}>Day {s.day} · {cfg.label.split(' · ')[1] || cfg.label}</span>
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                                  s.status === 'sent' || s.status === 'called' ? 'bg-emerald-500/10 text-emerald-400' :
                                  s.status === 'ready' ? 'bg-novalyte-500/10 text-novalyte-400' :
                                  s.status === 'generating' ? 'bg-purple-500/10 text-purple-400' :
                                  'bg-white/5 text-slate-500'
                                )}>{s.status}</span>
                                {s.edited && <span className="text-[9px] text-amber-400">edited</span>}
                                {s.executedAt && <span className="text-[9px] text-slate-500">{format(new Date(s.executedAt), 'MMM d, h:mm a')}</span>}
                              </div>
                              {s.subject && !isEditing && (
                                <p className="text-[11px] text-slate-400 mt-0.5 truncate">Subject: {s.subject}</p>
                              )}
                              {s.type === 'phone' && s.callId && (
                                <p className="text-[11px] text-novalyte-400 mt-0.5">Call ID: {s.callId} · Status: {s.callStatus || 'unknown'}</p>
                              )}
                              {s.type === 'phone' && !s.callId && s.status === 'pending' && (
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  {contact.clinic.phone ? `Will call ${contact.clinic.phone}` : 'No phone number — will skip'}
                                  {!voiceAgentService.isWithinBusinessHours() && ' · Outside business hours'}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {s.type === 'email' && s.status === 'ready' && !isEditing && (
                                <>
                                  <button onClick={() => { setEditingStep({ contactId: contact.id, day: s.day }); setEditSubject(s.subject || ''); setEditBody(s.body || ''); }}
                                    className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-slate-300 transition-all" title="Edit">
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => { setEditingStep(null); handleGenerateSteps(contact.id); }}
                                    className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-purple-400 transition-all" title="Regenerate">
                                    <Wand2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              {s.type === 'email' && s.status === 'ready' && isCurrentDay && enrollment.status === 'active' && (
                                <button onClick={() => handleExecuteStep(contact.id, s.day)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-novalyte-500/20 text-novalyte-300 hover:bg-novalyte-500/30 transition-all">
                                  <Send className="w-3 h-3" /> Send
                                </button>
                              )}
                              {s.type === 'phone' && s.status === 'pending' && isCurrentDay && enrollment.status === 'active' && contact.clinic.phone && (
                                <button onClick={() => handleExecuteStep(contact.id, s.day)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-novalyte-500/20 text-novalyte-300 hover:bg-novalyte-500/30 transition-all">
                                  <Phone className="w-3 h-3" /> Call
                                </button>
                              )}
                              {s.status === 'pending' && s.type === 'email' && (
                                <button onClick={() => { setEditingStep({ contactId: contact.id, day: s.day }); setEditSubject(''); setEditBody(''); }}
                                  className="p-1.5 rounded hover:bg-white/[0.05] text-slate-500 hover:text-slate-300 transition-all" title="Write manually">
                                  <PenLine className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(s.status === 'sent' || s.status === 'called') && (
                                <Eye className="w-3.5 h-3.5 text-slate-600" />
                              )}
                            </div>
                          </div>

                          {/* Inline editor */}
                          {isEditing && (
                            <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                              <div>
                                <label className="text-[10px] text-slate-500 block mb-1">Subject</label>
                                <input value={editSubject} onChange={e => setEditSubject(e.target.value)}
                                  className="w-full px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 outline-none focus:border-novalyte-500/30" />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 block mb-1">Body</label>
                                <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={6}
                                  className="w-full px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.08] text-sm text-slate-300 outline-none focus:border-novalyte-500/30 resize-y leading-relaxed" />
                              </div>
                              <div className="flex items-center gap-2 justify-end">
                                <button onClick={() => setEditingStep(null)} className="btn btn-secondary text-xs">Cancel</button>
                                <button onClick={handleSaveStepEdit} className="btn btn-primary text-xs gap-1">
                                  <CheckCircle className="w-3.5 h-3.5" /> Save
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Preview body when ready and not editing */}
                          {s.body && !isEditing && s.status === 'ready' && (
                            <div className="mt-2 text-[11px] text-slate-500 leading-relaxed line-clamp-2">{s.body}</div>
                          )}
                        </div>
                      );
                    })}
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
        <div className="flex items-center gap-2">
          <button onClick={() => {
            if (confirm(`Clear all ${sorted.length} sent email records?`)) {
              useAppStore.getState().clearSentEmails();
              toast.success('Sent emails cleared');
            }
          }} className="btn bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 gap-2 text-xs">
            <Trash2 className="w-3.5 h-3.5" /> Clear All
          </button>
          <button onClick={onRefresh} disabled={refreshing} className="btn btn-secondary gap-2 text-xs">
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing...' : 'Refresh All'}
          </button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3">Status</th>
              <th className="text-left text-xs text-slate-500 font-medium px-4 py-3 hidden md:table-cell">Provider</th>
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
              const provider = em.provider || 'resend';
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
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                      provider === 'smtp'
                        ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                        : 'bg-novalyte-500/20 text-novalyte-300 border-novalyte-500/30'
                    )}>
                      {provider === 'smtp' ? 'SMTP' : 'V-send'}
                    </span>
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
