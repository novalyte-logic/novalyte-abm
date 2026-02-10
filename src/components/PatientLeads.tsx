import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, Search, Filter, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Clock, Star, Zap, Send, ExternalLink,
  CheckCircle2, XCircle, UserCheck, Building2, Loader2,
  FileText, Globe, ClipboardList, Smartphone, Tablet, Monitor,
  PhoneCall, MessageSquare,
} from 'lucide-react';
import { cn } from '../utils/cn';
import {
  fetchLeads, updateLeadStatus, assignLeadToClinic, getLeadStats,
  getTreatmentLabel, getTreatmentShort, getLeadPrice, getQuestionnaireForLead,
  searchClinicsNearZip,
  type PatientLead, type LeadStatus, type NearbyClinic,
} from '../services/patientLeadService';
import { sendReferralEmail } from '../services/leadReferralService';
import { VoiceAgentService } from '../services/voiceAgentService';

// ─── Status Config ───

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  new: { label: 'New', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: Zap },
  contacted: { label: 'Contacted', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: Phone },
  qualified: { label: 'Qualified', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserCheck },
  assigned: { label: 'Assigned', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', icon: Building2 },
  converted: { label: 'Converted', color: 'text-green-400 bg-green-500/10 border-green-500/20', icon: CheckCircle2 },
  disqualified: { label: 'DQ', color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: XCircle },
  abandoned: { label: 'Abandoned', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: XCircle },
};

const TREATMENT_COLORS: Record<string, string> = {
  trt: 'text-orange-400 bg-orange-500/10',
  glp1: 'text-cyan-400 bg-cyan-500/10',
  peptides: 'text-violet-400 bg-violet-500/10',
  longevity: 'text-emerald-400 bg-emerald-500/10',
  sexual: 'text-pink-400 bg-pink-500/10',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

// ─── Clinic Finder Panel ───

function ClinicFinderPanel({ lead, onAssign, onClose }: {
  lead: PatientLead;
  onAssign: (clinic: NearbyClinic) => void;
  onClose: () => void;
}) {
  const [clinics, setClinics] = useState<NearbyClinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClinic, setSelectedClinic] = useState<NearbyClinic | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    if (!lead.zip_code) { setLoading(false); setSearchError('No zip code on this lead'); return; }
    setLoading(true);
    setSearchError(null);
    try {
      const results = await searchClinicsNearZip(lead.zip_code, lead.treatment);
      setClinics(results);
      if (results.length === 0) setSearchError('No clinics found — try broadening the search or check the browser console for API errors.');
    } catch (err: any) {
      setSearchError(err.message || 'Search failed');
    }
    setLoading(false);
  }, [lead.zip_code, lead.treatment]);

  useEffect(() => { doSearch(); }, [doSearch]);

  const handleSendReferral = async () => {
    if (!selectedClinic || !emailTo) return;
    setSendingEmail(true);
    setEmailError(null);
    setEmailSent(null);
    const result = await sendReferralEmail(lead, selectedClinic, emailTo);
    setSendingEmail(false);
    if (result.success) {
      setEmailSent(`Referral sent to ${emailTo}`);
      onAssign(selectedClinic);
    } else {
      setEmailError(result.error || 'Failed to send');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-novalyte-400 uppercase tracking-wider flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5" /> Find Clinic Near {lead.zip_code}
        </p>
        <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-white">Close</button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Searching clinics near {lead.zip_code}...</span>
        </div>
      ) : clinics.length === 0 ? (
        <div className="text-center py-3 space-y-2">
          <p className="text-xs text-slate-500">{searchError || `No clinics found near ${lead.zip_code}.`}</p>
          <button onClick={doSearch} className="text-xs text-novalyte-400 hover:text-novalyte-300 underline">Retry Search</button>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
          {clinics.map(c => (
            <button key={c.id} onClick={() => { setSelectedClinic(c); setEmailTo(c.phone ? '' : ''); }}
              className={cn(
                'w-full text-left p-2.5 rounded-lg border transition-all',
                selectedClinic?.id === c.id
                  ? 'border-novalyte-500/40 bg-novalyte-500/10'
                  : 'border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03]'
              )}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate">{c.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{c.address}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.rating && (
                    <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                      <Star className="w-3 h-3 fill-amber-400" />{c.rating}
                    </span>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}
                      className="p-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">
                      <Phone className="w-3 h-3" />
                    </a>
                  )}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                      className="p-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">
                      <Globe className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              {c.phone && <p className="text-[10px] text-slate-500 mt-1">{c.phone}</p>}
            </button>
          ))}
        </div>
      )}

      {/* Send Referral Email */}
      {selectedClinic && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-2">
          <p className="text-[10px] text-novalyte-400 uppercase tracking-wider font-medium">
            Send Referral to {selectedClinic.name}
          </p>
          <div className="flex gap-2">
            <input type="email" placeholder="Clinic email address"
              value={emailTo} onChange={e => setEmailTo(e.target.value)}
              className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40" />
            <button onClick={handleSendReferral}
              disabled={!emailTo || sendingEmail}
              className="btn btn-primary gap-1.5 text-xs px-4 disabled:opacity-50">
              {sendingEmail ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send
            </button>
          </div>
          {emailSent && <p className="text-[10px] text-emerald-400">✅ {emailSent}</p>}
          {emailError && <p className="text-[10px] text-red-400">❌ {emailError}</p>}
          <div className="flex gap-2">
            {selectedClinic.phone && (
              <a href={`tel:${selectedClinic.phone}`}
                className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded">
                <Phone className="w-3 h-3" /> Call Clinic
              </a>
            )}
            {selectedClinic.website && (
              <a href={selectedClinic.website} target="_blank" rel="noopener"
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded">
                <ExternalLink className="w-3 h-3" /> Website
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Lead Card (Full Assessment View) ───

function LeadCard({ lead, expanded, onToggle, onStatusChange, onRefresh, scoreColor }: {
  lead: PatientLead; expanded: boolean; onToggle: () => void;
  onStatusChange: (id: string, s: LeadStatus) => void;
  onRefresh: () => void;
  scoreColor: (s: number | null) => string;
}) {
  const [showClinicFinder, setShowClinicFinder] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [callingPatient, setCallingPatient] = useState(false);
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [emailingPatient, setEmailingPatient] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const sc = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
  const tc = TREATMENT_COLORS[lead.treatment] || 'text-slate-400 bg-white/5';
  const ago = timeAgo(lead.created_at);
  const qa = getQuestionnaireForLead(lead);

  const DeviceIcon = lead.device_type === 'mobile' ? Smartphone : lead.device_type === 'tablet' ? Tablet : Monitor;

  const handleAssignClinic = async (clinic: NearbyClinic) => {
    await assignLeadToClinic(lead.id, clinic.name);
    onRefresh();
  };

  const handleCallPatient = async () => {
    if (!lead.phone) return;
    setCallingPatient(true);
    setCallStatus(null);
    try {
      const voiceService = new VoiceAgentService();
      if (!voiceService.isConfigured) {
        setCallStatus('Vapi not configured — check API keys');
        setCallingPatient(false);
        return;
      }
      await voiceService.dialManualCall(lead.phone, lead.name);
      setCallStatus('Call initiated — Kaizen is calling the patient');
    } catch (err: any) {
      setCallStatus(err.message || 'Call failed');
    }
    setCallingPatient(false);
  };

  const handleEmailPatient = async () => {
    if (!lead.email) return;
    setEmailingPatient(true);
    setEmailStatus(null);
    try {
      const INTEL_API = import.meta.env.VITE_INTEL_API_URL || 'https://intel.novalyte.io';
      const resp = await fetch(`${INTEL_API}/api/resend/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Novalyte <onboarding@resend.dev>',
          to: lead.email,
          subject: `${lead.name}, Your Clinic Match is Ready — Novalyte™ AI`,
          html: `<div style="font-family:sans-serif;background:#0A0B0D;color:#E5E7EB;padding:32px;border-radius:12px;max-width:480px;margin:0 auto;">
            <h2 style="color:white;margin:0 0 16px;">Hi ${lead.name},</h2>
            <p style="line-height:1.6;margin:0 0 16px;">Your matched clinic is ready to connect with you. A specialist will be reaching out within 24 hours to discuss your personalized treatment plan.</p>
            <p style="line-height:1.6;margin:0 0 16px;">If you'd like to get started sooner, reply to this email or call us directly.</p>
            <p style="color:#06B6D4;font-weight:600;margin:0;">— Novalyte™ AI Team</p>
          </div>`
        })
      });
      const data = await resp.json();
      setEmailStatus(data.success ? 'Email sent to patient' : (data.error || 'Failed'));
    } catch (err: any) {
      setEmailStatus(err.message || 'Email failed');
    }
    setEmailingPatient(false);
  };

  return (
    <div className={cn('border rounded-xl transition-all', expanded ? 'border-novalyte-500/30 bg-white/[0.03]' : 'border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.02]')}>
      {/* Collapsed row */}
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-left">
        <div className={cn('text-center min-w-[44px]', scoreColor(lead.match_score))}>
          <p className="text-lg font-bold leading-none">{lead.match_score ?? '—'}</p>
          <p className="text-[9px] mt-0.5">score</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{lead.name || 'Unknown'}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium border', sc.color)}>{sc.label}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-medium', tc)}>{getTreatmentShort(lead.treatment)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
            {lead.zip_code && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.zip_code}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{ago}</span>
            {lead.device_type && <span className="flex items-center gap-1"><DeviceIcon className="w-3 h-3" />{lead.device_type}</span>}
            {lead.financial_readiness === 'high_tier' && <span className="text-emerald-500">💰 High-tier</span>}
            {lead.timeline === 'immediate' && <span className="text-amber-400">⚡ Immediate</span>}
            {lead.assigned_clinic && <span className="text-purple-400 flex items-center gap-1"><Building2 className="w-3 h-3" />{lead.assigned_clinic}</span>}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-4 border-t border-white/[0.06] pt-3">

          {/* ── Contact Info ── */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-medium">Contact Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-xs text-novalyte-400 hover:text-novalyte-300 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2 truncate">
                  <Mail className="w-3.5 h-3.5 shrink-0" />{lead.email}
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-xs text-novalyte-400 hover:text-novalyte-300 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2">
                  <Phone className="w-3.5 h-3.5 shrink-0" />{lead.phone}
                </a>
              )}
              {lead.zip_code && (
                <span className="flex items-center gap-2 text-xs text-slate-400 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />{lead.zip_code}
                </span>
              )}
            </div>
          </div>

          {/* ── Full Questionnaire ── */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" /> Assessment Questionnaire — {getTreatmentLabel(lead.treatment)}
            </p>
            {qa.length > 0 ? (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
                {qa.map((item, i) => (
                  <div key={i} className={cn('flex items-start gap-3 px-3 py-2.5', i > 0 && 'border-t border-white/[0.04]')}>
                    <span className="text-[11px] text-slate-500 min-w-[140px] shrink-0">{item.question}</span>
                    <span className="text-[11px] text-white font-medium">{item.answer}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No questionnaire data available</p>
            )}
          </div>

          {/* ── AI Analysis ── */}
          {lead.analysis_result && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> AI Analysis
              </p>
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-2">
                {lead.analysis_result.summary && (
                  <p className="text-xs text-slate-300 leading-relaxed">{lead.analysis_result.summary}</p>
                )}
                {lead.analysis_result.recommendation && (
                  <p className="text-xs text-emerald-400"><span className="text-slate-500">Recommendation:</span> {lead.analysis_result.recommendation}</p>
                )}
                {lead.urgency && (
                  <p className="text-[10px] text-slate-500">Urgency: <span className="text-white font-medium">{lead.urgency}</span></p>
                )}
                {/* Biomarkers */}
                {lead.analysis_result.biomarkers?.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-[10px] text-novalyte-400 font-medium">Recommended Biomarkers</p>
                    {lead.analysis_result.biomarkers.map((b: any, i: number) => (
                      <div key={i} className="text-[10px] bg-white/[0.02] rounded px-2 py-1.5 border border-white/[0.04]">
                        <span className="text-white font-medium">{b.name}</span>
                        <span className="text-slate-500"> — {b.relevance}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tracking ── */}
          {(lead.utm_source || lead.utm_campaign || lead.source) && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              {lead.source && <span className="px-2 py-1 rounded bg-white/5 text-slate-400">Source: <span className="text-white">{lead.source}</span></span>}
              {lead.utm_source && <span className="px-2 py-1 rounded bg-white/5 text-slate-400">UTM: <span className="text-white">{lead.utm_source}</span></span>}
              {lead.utm_medium && <span className="px-2 py-1 rounded bg-white/5 text-slate-400">Medium: <span className="text-white">{lead.utm_medium}</span></span>}
              {lead.utm_campaign && <span className="px-2 py-1 rounded bg-white/5 text-slate-400">Campaign: <span className="text-white">{lead.utm_campaign}</span></span>}
            </div>
          )}

          {/* ── Device & Contact Preference ── */}
          <div className="flex flex-wrap gap-2 text-[10px]">
            {lead.device_type && (
              <span className="px-2 py-1 rounded bg-white/5 text-slate-400 flex items-center gap-1">
                <DeviceIcon className="w-3 h-3" /> Device: <span className="text-white capitalize">{lead.device_type}</span>
              </span>
            )}
            {lead.contact_preference && lead.contact_preference.length > 0 && (
              <span className="px-2 py-1 rounded bg-white/5 text-slate-400">
                Contact Pref: <span className="text-white">{lead.contact_preference.join(', ')}</span>
              </span>
            )}
          </div>

          {/* ── Voice Transcript ── */}
          {lead.voice_transcript && (
            <div>
              <button onClick={() => setShowTranscript(!showTranscript)}
                className="flex items-center gap-1.5 text-[10px] text-novalyte-400 hover:text-novalyte-300 font-medium">
                <MessageSquare className="w-3.5 h-3.5" />
                {showTranscript ? 'Hide' : 'View'} Voice Transcript
              </button>
              {showTranscript && (
                <div className="mt-2 bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 max-h-[200px] overflow-y-auto">
                  <pre className="text-[10px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{lead.voice_transcript}</pre>
                </div>
              )}
            </div>
          )}

          {/* ── Call / Email Patient ── */}
          <div className="flex flex-wrap gap-2">
            {lead.phone && (
              <button onClick={handleCallPatient} disabled={callingPatient}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 transition-all text-xs font-medium disabled:opacity-50">
                {callingPatient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                AI Call Patient
              </button>
            )}
            {lead.email && (
              <button onClick={handleEmailPatient} disabled={emailingPatient}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-novalyte-500/20 bg-novalyte-500/5 text-novalyte-400 hover:bg-novalyte-500/10 transition-all text-xs font-medium disabled:opacity-50">
                {emailingPatient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Email Patient
              </button>
            )}
          </div>
          {callStatus && <p className={`text-[10px] ${callStatus.includes('initiated') ? 'text-emerald-400' : 'text-red-400'}`}>{callStatus.includes('initiated') ? '✅' : '❌'} {callStatus}</p>}
          {emailStatus && <p className={`text-[10px] ${emailStatus.includes('sent') ? 'text-emerald-400' : 'text-red-400'}`}>{emailStatus.includes('sent') ? '✅' : '❌'} {emailStatus}</p>}

          {/* ── Clinic Finder ── */}
          {showClinicFinder ? (
            <ClinicFinderPanel lead={lead} onAssign={handleAssignClinic} onClose={() => setShowClinicFinder(false)} />
          ) : (
            <button onClick={() => setShowClinicFinder(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-novalyte-500/30 text-novalyte-400 hover:bg-novalyte-500/5 transition-all text-xs font-medium">
              <Building2 className="w-3.5 h-3.5" />
              {lead.assigned_clinic ? `Reassign Clinic (current: ${lead.assigned_clinic})` : 'Find & Refer to Clinic'}
            </button>
          )}

          {/* ── Status Actions ── */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              if (key === lead.status || key === 'abandoned') return null;
              const BtnIcon = cfg.icon;
              return (
                <button key={key} onClick={() => onStatusChange(lead.id, key as LeadStatus)}
                  className={cn('flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all hover:opacity-80', cfg.color)}>
                  <BtnIcon className="w-3 h-3" />{cfg.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───

export default function PatientLeads() {
  const [leads, setLeads] = useState<PatientLead[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLeadStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTreatment, setFilterTreatment] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [leadsData, statsData] = await Promise.all([fetchLeads(), getLeadStats()]);
    setLeads(leadsData);
    setStats(statsData);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    const ok = await updateLeadStatus(id, status);
    if (ok) setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
  };

  const filtered = leads.filter(l => {
    if (filterTreatment !== 'all' && l.treatment !== filterTreatment) return false;
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.phone.includes(q) || l.zip_code.includes(q);
    }
    return true;
  });

  const scoreColor = (s: number | null) => !s ? 'text-slate-500' : s >= 80 ? 'text-emerald-400' : s >= 60 ? 'text-cyan-400' : 'text-amber-400';

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-novalyte-400" />
            Patient Leads
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Real-time qualified leads from ads.novalyte.io — click to view full assessment</p>
        </div>
        <button onClick={load} disabled={loading}
          className="btn btn-secondary gap-2 text-xs self-start">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Total Leads" value={stats.total} icon={Users} color="text-novalyte-400" />
          <StatCard label="Qualified" value={stats.qualified} icon={UserCheck} color="text-emerald-400" />
          <StatCard label="Avg Score" value={`${stats.avgScore}%`} icon={Star} color="text-amber-400" />
          <StatCard label="New" value={stats.byStatus['new'] || 0} icon={Zap} color="text-blue-400" />
          <StatCard label="Converted" value={stats.byStatus['converted'] || 0} icon={CheckCircle2} color="text-green-400" />
        </div>
      )}

      {/* Treatment Breakdown */}
      {stats && Object.keys(stats.byTreatment).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(stats.byTreatment).map(([t, count]) => (
            <button key={t} onClick={() => setFilterTreatment(filterTreatment === t ? 'all' : t)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-all',
                filterTreatment === t ? 'border-novalyte-500/40 bg-novalyte-500/10' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
              )}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{getTreatmentShort(t)}</p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold text-white">{count}</span>
                <span className="text-[10px] text-slate-600">{getLeadPrice(t)}/lead</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder="Search by name, email, phone, zip..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-novalyte-500/40" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className="btn btn-secondary gap-2 text-xs">
          <Filter className="w-3.5 h-3.5" /> Filters
          {(filterTreatment !== 'all' || filterStatus !== 'all') && <span className="w-2 h-2 rounded-full bg-novalyte-400" />}
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filterTreatment} onChange={e => setFilterTreatment(e.target.value)}
            className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white">
            <option value="all">All Treatments</option>
            {['trt','glp1','peptides','longevity','sexual'].map(t => <option key={t} value={t}>{getTreatmentShort(t)}</option>)}
          </select>
          {(filterTreatment !== 'all' || filterStatus !== 'all') && (
            <button onClick={() => { setFilterTreatment('all'); setFilterStatus('all'); }}
              className="text-xs text-red-400 hover:text-red-300 px-2">Clear</button>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">{filtered.length} lead{filtered.length !== 1 ? 's' : ''}</p>

      {/* Lead Cards */}
      <div className="space-y-2">
        {loading && leads.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-600" />
            <p className="text-sm">Loading leads from Supabase...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Users className="w-8 h-8 mx-auto mb-3 text-slate-600" />
            <p className="text-sm">No leads found</p>
            <p className="text-xs mt-1">Leads appear here when patients complete assessments on ads.novalyte.io</p>
          </div>
        ) : filtered.map(lead => (
          <LeadCard key={lead.id} lead={lead} expanded={expandedId === lead.id}
            onToggle={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
            onStatusChange={handleStatusChange} onRefresh={load} scoreColor={scoreColor} />
        ))}
      </div>
    </div>
  );
}
