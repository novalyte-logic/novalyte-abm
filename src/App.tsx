import { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard, TrendingUp, Building2, Users, Phone,
  Cloud, CloudOff, RefreshCw, Brain, ChevronLeft,
  ChevronRight, DownloadCloud, Sparkles, Mail, DollarSign,
  Menu, X, UserCheck, Lock, Eye, EyeOff, BarChart3, ArrowRight, LogOut,
  ShieldAlert, Rocket,
} from 'lucide-react';
import { startSession, trackPageView, trackAction, setupSessionFlush, getCurrentSession, endSession, forceLogoutAll, requestLiveAccessCode, submitGuestLogoutFeedback, type SessionInfo } from './services/sessionTracker';
import { useAppStore } from './stores/appStore';
import { cn } from './utils/cn';
import Dashboard from './components/Dashboard';
import KeywordScanner from './components/KeywordScanner';
import ClinicDiscovery from './components/ClinicDiscovery';
import CRM from './components/CRM';
import VoiceAgent from './components/VoiceAgent';
import EmailOutreach from './components/EmailOutreach';
import RevenueForecastPage from './components/RevenueForecast';
import PatientLeads from './components/PatientLeads';
import AdAnalytics from './components/AdAnalytics';
import AIEngine from './components/AIEngine';
import EngineCopilot from './components/EngineCopilot';

const navItems = [
  { id: 'dashboard', label: 'Command Center', shortLabel: 'Home', icon: LayoutDashboard, badge: null },
  { id: 'analytics', label: 'Ad Analytics', shortLabel: 'Ads', icon: BarChart3, badge: 'markets' },
  { id: 'aiengine', label: 'AI Engine', shortLabel: 'AI', icon: Brain, badge: 'aiengine' },
  { id: 'clinics', label: 'Clinic Discovery', shortLabel: 'Clinics', icon: Building2, badge: 'clinics' },
  { id: 'email', label: 'Email Outreach', shortLabel: 'Email', icon: Mail, badge: 'emails' },
  { id: 'keywords', label: 'Keyword Scanner', shortLabel: 'Keywords', icon: TrendingUp, badge: 'trends' },
  { id: 'leads', label: 'Patient Leads', shortLabel: 'Leads', icon: UserCheck, badge: 'leads' },
  { id: 'crm', label: 'Pipeline CRM', shortLabel: 'CRM', icon: Users, badge: 'contacts' },
  { id: 'forecast', label: 'Revenue Forecast', shortLabel: 'Revenue', icon: DollarSign, badge: 'forecast' },
  { id: 'voice', label: 'Voice Agent', shortLabel: 'Voice', icon: Phone, badge: 'calls' },
] as const;

const ADMIN_CODE = '1459';
const GUEST_CODE = '2104';

function LoginScreen({ onAuth }: { onAuth: (session: SessionInfo) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'code' | 'name'>('code');
  const [guestName, setGuestName] = useState('');
  const [guestCompany, setGuestCompany] = useState('');

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(async () => {
      if (code === ADMIN_CODE) {
        // Admin — direct access, no name prompt
        const session = await startSession('admin', code, 'Jamil');
        sessionStorage.setItem('novalyte-auth', 'true');
        onAuth(session);
      } else if (code === GUEST_CODE) {
        // YC Guest — ask for name first
        setStep('name');
      } else {
        setError(true);
        setCode('');
        setTimeout(() => setError(false), 2000);
      }
      setLoading(false);
    }, 400);
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !guestCompany.trim()) return;
    setLoading(true);
    const session = await startSession('guest', GUEST_CODE, guestName.trim(), guestCompany.trim());
    sessionStorage.setItem('novalyte-auth', 'true');
    onAuth(session);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        {/* Logo */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-2 border-novalyte-400 bg-black flex items-center justify-center relative mx-auto shadow-lg shadow-novalyte-500/30">
            <span className="text-novalyte-400 font-extrabold text-2xl leading-none">N</span>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[3px] h-[70%] bg-novalyte-400 rotate-[-40deg] rounded-full" />
            </div>
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-100">Novalyte AI</h1>
          <p className="text-xs text-slate-500 mt-1">AI Intelligence Engine · Restricted Access</p>
        </div>

        {step === 'code' ? (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="glass-card p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-4 h-4 text-novalyte-400" />
                <span className="text-sm font-medium text-slate-300">Enter Access Code</span>
              </div>
              <div className="relative">
                <input
                  type={showCode ? 'text' : 'password'}
                  value={code}
                  onChange={e => { setCode(e.target.value); setError(false); }}
                  placeholder="••••"
                  maxLength={10}
                  autoFocus
                  className={cn(
                    'w-full px-4 py-3 rounded-lg bg-white/[0.03] border text-center text-lg font-mono tracking-[0.5em] text-slate-200 placeholder:text-slate-700 outline-none transition-all',
                    error ? 'border-red-500/50 shake' : 'border-white/[0.08] focus:border-novalyte-500/40'
                  )}
                />
                <button type="button" onClick={() => setShowCode(!showCode)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {error && (
                <p className="text-xs text-red-400 text-center animate-fade-in">Invalid access code</p>
              )}
              <button type="submit" disabled={!code.trim() || loading}
                className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-[#06B6D4] text-[#000000] hover:bg-[#22D3EE] disabled:opacity-40 disabled:cursor-not-allowed">
                {loading ? 'Verifying...' : 'Access Platform'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div className="glass-card p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-novalyte-400" />
                <span className="text-sm font-medium text-slate-300">Welcome — What's your name?</span>
              </div>
              <input
                type="text"
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.08] focus:border-novalyte-500/40 text-center text-lg text-slate-200 placeholder:text-slate-600 outline-none transition-all"
              />
              <input
                type="text"
                value={guestCompany}
                onChange={e => setGuestCompany(e.target.value)}
                placeholder="Company"
                className="w-full px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.08] focus:border-novalyte-500/40 text-center text-lg text-slate-200 placeholder:text-slate-600 outline-none transition-all"
              />
              <button type="submit" disabled={!guestName.trim() || !guestCompany.trim() || loading}
                className="w-full py-3 rounded-lg font-medium text-sm transition-all bg-[#06B6D4] text-[#000000] hover:bg-[#22D3EE] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loading ? 'Setting up...' : <><ArrowRight className="w-4 h-4" /> Enter Dashboard</>}
              </button>
            </div>
          </form>
        )}

        <p className="text-[10px] text-slate-600 text-center">
          Authorized personnel only · Novalyte AI © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function App() {
  const {
    currentView, setCurrentView, supabaseReady, isSyncing,
    initSupabase, pushToSupabase, contacts, clinics, keywordTrends, callHistory, sentEmails, markets,
  } = useAppStore();

  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('novalyte-auth') === 'true');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(() => getCurrentSession());
  const [engineMode, setEngineMode] = useState<'demo' | 'live'>(() => (sessionStorage.getItem('novalyte-mode') as 'demo' | 'live') || 'live');
  const [showDemoNotice, setShowDemoNotice] = useState(false);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveAccessReason, setLiveAccessReason] = useState('');
  const [liveRequestSent, setLiveRequestSent] = useState(false);
  const [showAccessCodeModal, setShowAccessCodeModal] = useState(false);
  const [liveCode, setLiveCode] = useState('');
  const [liveCodeError, setLiveCodeError] = useState(false);
  const [showGuestFeedbackModal, setShowGuestFeedbackModal] = useState(false);
  const [guestFeedback, setGuestFeedback] = useState('');
  const [guestFeedbackError, setGuestFeedbackError] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const isAdmin = sessionInfo?.role === 'admin';
  const isGuest2104 = sessionInfo?.role === 'guest' && sessionInfo?.code === GUEST_CODE;
  const canRunLive = isAdmin || engineMode === 'live';

  useEffect(() => {
    if (!authenticated || !sessionInfo) return;
    if (!canRunLive) return;
    initSupabase();
  }, [initSupabase, authenticated, sessionInfo, canRunLive]);

  const doLogout = useCallback(() => {
    endSession();
    sessionStorage.removeItem('novalyte-auth');
    sessionStorage.removeItem('novalyte-session-info');
    sessionStorage.removeItem('novalyte-mode');
    setAuthenticated(false);
    setSessionInfo(null);
  }, []);

  // Setup session flush + force-logout polling
  useEffect(() => {
    if (authenticated && sessionInfo) {
      const cleanup = setupSessionFlush(doLogout);
      return cleanup;
    }
  }, [authenticated, sessionInfo, doLogout]);

  // Track page views
  useEffect(() => {
    if (authenticated && sessionInfo) {
      trackPageView(currentView);
    }
  }, [currentView, authenticated, sessionInfo]);

  if (!authenticated) {
    return <LoginScreen onAuth={(session) => {
      setAuthenticated(true);
      setSessionInfo(session);
      if (session.role === 'guest' && session.code === GUEST_CODE) {
        setEngineMode('demo');
        sessionStorage.setItem('novalyte-mode', 'demo');
        setShowDemoNotice(true);
      } else {
        setEngineMode('live');
        sessionStorage.setItem('novalyte-mode', 'live');
      }
    }} />;
  }

  const getBadgeCount = (badge: string | null) => {
    switch (badge) {
      case 'trends': return keywordTrends.length || null;
      case 'clinics': return clinics.length || null;
      case 'contacts': return contacts.length || null;
      case 'calls': return callHistory.length || null;
      case 'emails': return sentEmails.length || null;
      case 'markets': return markets.length || null;
      case 'forecast': return markets.length || null;
      case 'aiengine': {
        try { const raw = localStorage.getItem('novalyte_ai_engine_clinics'); return raw ? JSON.parse(raw).length || null : null; } catch { return null; }
      }
      case 'leads': {
        try { const raw = localStorage.getItem('novalyte_patient_leads_count'); return raw ? parseInt(raw, 10) || null : null; } catch { return null; }
      }
      default: return null;
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <Dashboard />;
      case 'keywords': return <KeywordScanner />;
      case 'clinics': return <ClinicDiscovery />;
      case 'crm': return <CRM />;
      case 'leads': return <PatientLeads />;
      case 'voice': return <VoiceAgent />;
      case 'email': return <EmailOutreach />;
      case 'analytics': return <AdAnalytics />;
      case 'forecast': return <RevenueForecastPage />;
      case 'aiengine': return <AIEngine />;
      default: return <Dashboard />;
    }
  };

  const handleExport = () => {
    trackAction('export', 'Exported all data as JSON');
    try {
      const state = useAppStore.getState();
      const payload = JSON.stringify(state, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `novalyte-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
  };

  const handleLogout = () => {
    if (isGuest2104) {
      setShowGuestFeedbackModal(true);
      return;
    }
    trackAction('logout', 'User logged out');
    doLogout();
  };

  const handleForceLogoutAll = async () => {
    if (!confirm('This will log out EVERYONE currently in the dashboard. Continue?')) return;
    trackAction('force_logout', 'Admin triggered global logout');
    const ok = await forceLogoutAll();
    if (ok) {
      doLogout();
    }
  };

  const displayName = [sessionInfo?.name?.trim(), sessionInfo?.company?.trim()].filter(Boolean).join(' · ') || 'Guest';
  const collapsed = !isSidebarHovered;

  const handleMobileNav = (id: string) => {
    setCurrentView(id as typeof currentView);
    setMobileMenuOpen(false);
  };

  const handleGoLive = () => {
    if (isAdmin) {
      setEngineMode('live');
      sessionStorage.setItem('novalyte-mode', 'live');
      return;
    }
    setShowLiveModal(true);
    setLiveRequestSent(false);
  };

  const submitLiveAccessRequest = async () => {
    try {
      await requestLiveAccessCode(liveAccessReason);
      setLiveRequestSent(true);
      trackAction('live_access_request', 'Requested live access code from Jamil');
    } catch {
      setLiveRequestSent(false);
    }
  };

  const submitLiveCode = () => {
    if (liveCode.trim() !== ADMIN_CODE) {
      setLiveCodeError(true);
      return;
    }
    setLiveCodeError(false);
    setEngineMode('live');
    sessionStorage.setItem('novalyte-mode', 'live');
    setShowAccessCodeModal(false);
    setShowLiveModal(false);
    setLiveCode('');
    trackAction('mode_change', 'Upgraded to Live Mode with access code');
  };

  return (
    <div className="relative flex h-screen bg-black">

      {/* ═══ Mobile Top Bar — visible < lg ═══ */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3 flex items-center justify-between safe-top">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full border-2 border-novalyte-400 bg-black flex items-center justify-center relative shadow-lg shadow-novalyte-500/20">
            <span className="text-novalyte-400 font-extrabold text-xs leading-none">N</span>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[2px] h-[65%] bg-novalyte-400 rotate-[-40deg] rounded-full" />
            </div>
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100">Novalyte AI</h1>
            <p className="text-[9px] text-slate-500">AI Intelligence Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (engineMode === 'live') {
                setEngineMode('demo');
                sessionStorage.setItem('novalyte-mode', 'demo');
                trackAction('mode_change', 'Switched to Demo Mode');
                return;
              }
              handleGoLive();
            }}
            className={cn(
              'text-[10px] px-2 py-1 rounded-full border',
              engineMode === 'live' ? 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10' : 'text-amber-300 border-amber-400/40 bg-amber-500/10'
            )}
            title="Toggle Demo / Live"
          >
            {engineMode === 'live' ? 'LIVE' : 'DEMO'}
          </button>
          <span className="text-[11px] text-slate-300 max-w-[120px] truncate" title={`Welcome, ${displayName}`}>
            Welcome, {displayName}
          </span>
          <button
            onClick={() => pushToSupabase()}
            disabled={!supabaseReady || isSyncing || !canRunLive}
            className="p-2 rounded-lg hover:bg-white/5"
          >
            {isSyncing ? <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" /> :
             supabaseReady ? <Cloud className="w-4 h-4 text-emerald-400" /> :
             <CloudOff className="w-4 h-4 text-slate-600" />}
          </button>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 rounded-lg hover:bg-white/5">
            {mobileMenuOpen ? <X className="w-5 h-5 text-slate-300" /> : <Menu className="w-5 h-5 text-slate-300" />}
          </button>
        </div>
      </div>

      {/* Desktop top-right welcome */}
      <div className="hidden lg:flex fixed top-4 right-4 z-30 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/70 px-3 py-2 backdrop-blur-xl">
        <button
          onClick={() => {
            if (engineMode === 'live') {
              setEngineMode('demo');
              sessionStorage.setItem('novalyte-mode', 'demo');
              trackAction('mode_change', 'Switched to Demo Mode');
              return;
            }
            handleGoLive();
          }}
          className={cn(
            'text-[10px] px-2 py-1 rounded-full border inline-flex items-center gap-1',
            engineMode === 'live'
              ? 'text-emerald-300 border-emerald-400/50 bg-emerald-500/10'
              : 'text-amber-300 border-amber-400/50 bg-amber-500/10'
          )}
        >
          <Rocket className="w-3 h-3" /> {engineMode === 'live' ? 'LIVE' : 'DEMO'}
        </button>
        {!isAdmin && (
          <button
            onClick={() => {
              setShowAccessCodeModal(true);
              setLiveCode('');
              setLiveCodeError(false);
            }}
            className="text-[10px] px-2 py-1 rounded-full border border-cyan-400/50 bg-cyan-500/10 text-cyan-200"
          >
            I have access code
          </button>
        )}
        <span className="text-xs text-slate-300">Welcome, {displayName}</span>
      </div>

      {/* ═══ Mobile Slide-Down Menu ═══ */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 pt-[60px]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative bg-black/98 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl animate-fade-in max-h-[70vh] overflow-y-auto">
            <div className="p-3 space-y-0.5">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                const count = getBadgeCount(item.badge);
                return (
                  <button key={item.id} onClick={() => handleMobileNav(item.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                      isActive ? 'bg-novalyte-500/15 text-novalyte-300' : 'text-slate-400 active:bg-white/5'
                    )}>
                    <Icon className={cn('w-5 h-5', isActive && 'text-novalyte-400')} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {count !== null && (
                      <span className={cn('text-[10px] tabular-nums px-2 py-0.5 rounded-full font-semibold',
                        isActive ? 'bg-novalyte-500/30 text-novalyte-300' : 'bg-white/5 text-slate-500'
                      )}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-white/[0.06] p-3 flex gap-2">
              <button onClick={handleExport} className="flex-1 btn btn-secondary gap-2 text-xs justify-center">
                <DownloadCloud className="w-3.5 h-3.5" /> Export
              </button>
              <button onClick={handleLogout} className="flex-1 btn btn-secondary gap-2 text-xs justify-center">
                <LogOut className="w-3.5 h-3.5" /> Logout
              </button>
              {isAdmin && !isGuest2104 && (
                <button onClick={handleForceLogoutAll} className="flex-1 btn btn-danger gap-2 text-xs justify-center">
                  <LogOut className="w-3.5 h-3.5" /> Logout All
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Desktop Sidebar — hidden < lg ═══ */}
      <aside className={cn(
        'hidden lg:flex fixed left-0 top-0 bottom-0 z-40 bg-black/95 backdrop-blur-xl text-white flex-col transition-all duration-300 ease-in-out border-r border-white/[0.06]',
        collapsed ? 'w-16' : 'w-64'
      )}
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => setIsSidebarHovered(false)}
      >
        {/* Logo */}
        <div className={cn('border-b border-white/5 flex items-center', collapsed ? 'px-3 py-4 justify-center' : 'px-5 py-5')}>
          <div className="w-9 h-9 rounded-full border-2 border-novalyte-400 bg-black flex items-center justify-center relative shrink-0 shadow-lg shadow-novalyte-500/20">
            <span className="text-novalyte-400 font-extrabold text-sm leading-none">N</span>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[2px] h-[70%] bg-novalyte-400 rotate-[-40deg] rounded-full" />
            </div>
          </div>
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <h1 className="text-sm font-bold tracking-tight">Novalyte AI</h1>
              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                <Brain className="w-2.5 h-2.5" /> AI Intelligence Engine
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-hidden">
          <ul className={cn('space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              const count = getBadgeCount(item.badge);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setCurrentView(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all relative',
                      collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5',
                      isActive
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    )}
                  >
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-novalyte-400 rounded-r-full" />}
                    <Icon className={cn('w-[18px] h-[18px] shrink-0', isActive && 'text-novalyte-400')} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {count !== null && (
                          <span className={cn('text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-semibold',
                            isActive ? 'bg-novalyte-500/30 text-novalyte-300' : 'bg-white/5 text-slate-500'
                          )}>{count}</span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom section */}
        <div className={cn('border-t border-white/5 space-y-1', collapsed ? 'p-2' : 'p-3')}>
          {/* AI Status */}
          <div className={cn('rounded-lg bg-gradient-to-r from-novalyte-900/50 to-accent-900/30 border border-white/5',
            collapsed ? 'p-2 flex justify-center' : 'p-3'
          )}>
            <div className="flex items-center gap-2">
              <div className="relative shrink-0">
                <Sparkles className="w-4 h-4 text-novalyte-400" />
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-300">AI Engine</p>
                  <p className="text-[9px] text-slate-500">Gemini 2.0 Flash</p>
                </div>
              )}
            </div>
          </div>

          {/* Sync */}
          <button
            onClick={() => pushToSupabase()}
            disabled={!supabaseReady || isSyncing || !canRunLive}
            title={collapsed ? (supabaseReady ? 'Sync to Cloud' : 'Cloud Offline') : undefined}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg text-[12px] font-medium transition-colors',
              collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2',
              supabaseReady
                ? 'text-emerald-400 hover:bg-white/5'
                : 'text-slate-600 cursor-not-allowed'
            )}
          >
            {isSyncing ? <RefreshCw className="w-4 h-4 animate-spin shrink-0" /> :
             supabaseReady ? <Cloud className="w-4 h-4 shrink-0" /> :
             <CloudOff className="w-4 h-4 shrink-0" />}
            {!collapsed && (isSyncing ? 'Syncing...' : supabaseReady ? 'Sync to Cloud' : 'Cloud Offline')}
          </button>

          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg text-[12px] font-medium text-slate-300 hover:bg-white/5 transition-colors',
              collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
            )}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && 'Logout'}
          </button>

          <div className={cn(
            'w-full flex items-center gap-2.5 rounded-lg text-[12px] font-medium text-slate-600',
            collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
          )}>
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4 shrink-0" /> Stealth Sidebar</>}
          </div>
        </div>
      </aside>

      {!canRunLive && (
        <div className="fixed left-1/2 -translate-x-1/2 top-[70px] lg:top-3 z-50 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 backdrop-blur-xl">
          Demo Mode Active: Live actions are locked. Use Go Live to request live access from Jamil.
        </div>
      )}

      {/* ═══ Main Content ═══ */}
      <main className="flex-1 overflow-auto pt-[60px] pb-[72px] lg:pt-0 lg:pb-0 lg:pl-16">
        {renderView()}
      </main>

      {/* ═══ Mobile Bottom Nav — visible < lg ═══ */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-t border-white/[0.06] safe-bottom">
        <div className="flex items-center justify-around px-1 py-1">
          {navItems.slice(0, 5).map(item => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const count = getBadgeCount(item.badge);
            return (
              <button key={item.id} onClick={() => setCurrentView(item.id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg min-w-0 flex-1 transition-all relative',
                  isActive ? 'text-novalyte-400' : 'text-slate-500 active:text-slate-300'
                )}>
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {count !== null && count > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-novalyte-500 text-white text-[9px] font-bold px-1">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium truncate w-full text-center">{item.shortLabel}</span>
                {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-novalyte-400 rounded-full" />}
              </button>
            );
          })}
          {/* More button for remaining items */}
          <button onClick={() => setMobileMenuOpen(true)}
            className={cn(
              'flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg min-w-0 flex-1 transition-all',
              ['email', 'forecast', 'aiengine'].includes(currentView) ? 'text-novalyte-400' : 'text-slate-500 active:text-slate-300'
            )}>
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {showDemoNotice && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-400/40 bg-[#030712]/95 p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Intelligent Dashboard Is Live</h3>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  This dashboard is connected to live Google Ads data streams. Do not run live activity from guest access.
                  Start in <span className="text-amber-300 font-semibold">Demo Mode</span> from the top-right by your name.
                  If authorized, click <span className="text-emerald-300 font-semibold">Go Live</span> and request live access from Jamil.
                </p>
                <button
                  onClick={() => setShowDemoNotice(false)}
                  className="mt-4 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs font-medium"
                >
                  Continue In Demo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLiveModal && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-400/40 bg-[#030712]/95 p-5">
            <h3 className="text-sm font-semibold text-slate-100">Request Go Live Access</h3>
            <p className="text-xs text-slate-400 mt-1">Demo users cannot self-activate live mode. Request access from Jamil.</p>
            <div className="mt-4 space-y-2">
              <button
                onClick={submitLiveAccessRequest}
                className="w-full px-3 py-2 rounded-lg text-xs text-cyan-200 border border-cyan-400/40 bg-cyan-500/10"
              >
                Request live access code from Jamil
              </button>
              <button
                onClick={() => {
                  setShowAccessCodeModal(true);
                  setLiveCode('');
                  setLiveCodeError(false);
                }}
                className="w-full px-3 py-2 rounded-lg text-xs text-emerald-200 border border-emerald-400/40 bg-emerald-500/15"
              >
                I have access code
              </button>
              <textarea
                value={liveAccessReason}
                onChange={(e) => setLiveAccessReason(e.target.value)}
                rows={2}
                placeholder="Optional: Why do you want to go live?"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.1] text-slate-200 text-xs outline-none focus:border-cyan-400/40 resize-none"
              />
              {liveRequestSent && (
                <p className="text-[11px] text-emerald-300">Request sent to Jamil on Slack.</p>
              )}
              <p className="text-[11px] text-slate-400">
                Need faster access? Text <span className="text-cyan-300 font-semibold">415-918-1995</span>.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowLiveModal(false)} className="px-3 py-2 rounded-lg text-xs text-slate-400 border border-white/[0.1]">Close</button>
            </div>
          </div>
        </div>
      )}

      {showAccessCodeModal && (
        <div className="fixed inset-0 z-[96] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-400/40 bg-[#030712]/95 p-5">
            <h3 className="text-sm font-semibold text-slate-100">Enter Access Code</h3>
            <p className="text-xs text-slate-400 mt-1">Provided by Jamil only.</p>
            <input
              value={liveCode}
              onChange={(e) => { setLiveCode(e.target.value); setLiveCodeError(false); }}
              placeholder="Access code"
              className={cn(
                'mt-4 w-full px-3 py-2 rounded-lg bg-white/[0.03] border text-slate-200 outline-none',
                liveCodeError ? 'border-red-500/50' : 'border-white/[0.1] focus:border-emerald-400/50'
              )}
            />
            {liveCodeError && <p className="text-[11px] text-red-400 mt-2">Invalid access code</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowAccessCodeModal(false)} className="px-3 py-2 rounded-lg text-xs text-slate-400 border border-white/[0.1]">Close</button>
              <button onClick={submitLiveCode} className="px-3 py-2 rounded-lg text-xs text-emerald-200 border border-emerald-400/40 bg-emerald-500/10">Go Live</button>
            </div>
          </div>
        </div>
      )}

      {showGuestFeedbackModal && (
        <div className="fixed inset-0 z-[95] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-400/40 bg-[#030712]/95 p-5">
            <h3 className="text-sm font-semibold text-slate-100">Before Logout: Mandatory Feedback</h3>
            <p className="text-xs text-slate-400 mt-1">Please give your honest feedback (max 1000 characters).</p>
            <textarea
              value={guestFeedback}
              onChange={(e) => {
                setGuestFeedback(e.target.value.slice(0, 1000));
                setGuestFeedbackError(false);
              }}
              rows={6}
              placeholder="Share what worked, what was confusing, and what should improve..."
              className={cn(
                'mt-4 w-full px-3 py-2 rounded-lg bg-white/[0.03] border text-slate-200 text-xs outline-none resize-none',
                guestFeedbackError ? 'border-red-500/50' : 'border-white/[0.1] focus:border-cyan-400/40'
              )}
            />
            <div className="mt-1 text-[10px] text-slate-500 text-right">{guestFeedback.length}/1000</div>
            {guestFeedbackError && <p className="text-[11px] text-red-400 mt-2">Feedback is required before logout.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowGuestFeedbackModal(false)} className="px-3 py-2 rounded-lg text-xs text-slate-400 border border-white/[0.1]">Stay Logged In</button>
              <button
                disabled={submittingFeedback}
                onClick={async () => {
                  const text = guestFeedback.trim();
                  if (!text) {
                    setGuestFeedbackError(true);
                    return;
                  }
                  setSubmittingFeedback(true);
                  try {
                    await submitGuestLogoutFeedback(text);
                  } finally {
                    setSubmittingFeedback(false);
                  }
                  trackAction('logout_feedback', 'Submitted mandatory guest feedback');
                  trackAction('logout', 'User logged out');
                  setShowGuestFeedbackModal(false);
                  doLogout();
                }}
                className="px-3 py-2 rounded-lg text-xs text-cyan-200 border border-cyan-400/40 bg-cyan-500/10 disabled:opacity-40"
              >
                {submittingFeedback ? 'Sending...' : 'Submit & Logout'}
              </button>
            </div>
          </div>
        </div>
      )}

      <EngineCopilot currentView={currentView} mode={engineMode} />
    </div>
  );
}

export default App;
