import { useEffect, useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Building2, Users, Phone,
  Settings, Cloud, CloudOff, RefreshCw, Brain, ChevronLeft,
  ChevronRight, DownloadCloud, Trash2, Sparkles, Mail, DollarSign,
  Menu, X, UserCheck, Lock, Eye, EyeOff, BarChart3,
} from 'lucide-react';
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

const navItems = [
  { id: 'dashboard', label: 'Command Center', shortLabel: 'Home', icon: LayoutDashboard, badge: null },
  { id: 'keywords', label: 'Keyword Scanner', shortLabel: 'Keywords', icon: TrendingUp, badge: 'trends' },
  { id: 'clinics', label: 'Clinic Discovery', shortLabel: 'Clinics', icon: Building2, badge: 'clinics' },
  { id: 'leads', label: 'Patient Leads', shortLabel: 'Leads', icon: UserCheck, badge: null },
  { id: 'crm', label: 'Pipeline CRM', shortLabel: 'CRM', icon: Users, badge: 'contacts' },
  { id: 'voice', label: 'Voice Agent', shortLabel: 'Voice', icon: Phone, badge: 'calls' },
  { id: 'email', label: 'Email Outreach', shortLabel: 'Email', icon: Mail, badge: 'emails' },
  { id: 'analytics', label: 'Ad Analytics', shortLabel: 'Ads', icon: BarChart3, badge: null },
  { id: 'forecast', label: 'Revenue Forecast', shortLabel: 'Revenue', icon: DollarSign, badge: null },
] as const;

const ACCESS_CODE = '2104';

function LoginScreen({ onAuth }: { onAuth: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (code === ACCESS_CODE) {
        sessionStorage.setItem('novalyte-auth', 'true');
        onAuth();
      } else {
        setError(true);
        setCode('');
        setTimeout(() => setError(false), 2000);
      }
      setLoading(false);
    }, 400);
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
          <h1 className="mt-4 text-xl font-bold text-slate-100">Novalyte<span className="text-novalyte-400 text-[8px] align-super">™</span> AI</h1>
          <p className="text-xs text-slate-500 mt-1">AI Intelligence Engine · Restricted Access</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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
    initSupabase, pushToSupabase, contacts, clinics, keywordTrends, callHistory, sentEmails,
  } = useAppStore();

  const [collapsed, setCollapsed] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('novalyte-auth') === 'true');

  useEffect(() => { initSupabase(); }, [initSupabase]);

  if (!authenticated) {
    return <LoginScreen onAuth={() => setAuthenticated(true)} />;
  }

  const getBadgeCount = (badge: string | null) => {
    switch (badge) {
      case 'trends': return keywordTrends.length || null;
      case 'clinics': return clinics.length || null;
      case 'contacts': return contacts.length || null;
      case 'calls': return callHistory.length || null;
      case 'emails': return sentEmails.length || null;
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
      default: return <Dashboard />;
    }
  };

  const handleExport = () => {
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
    setShowExportMenu(false);
  };

  const handleClear = () => {
    if (!confirm('Clear all local data? This will reload the app.')) return;
    localStorage.removeItem('novalyte-store');
    window.location.reload();
  };

  const handleMobileNav = (id: string) => {
    setCurrentView(id as typeof currentView);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen bg-black">

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
            <h1 className="text-sm font-bold text-slate-100">Novalyte<span className="text-novalyte-400 text-[6px] align-super">™</span> AI</h1>
            <p className="text-[9px] text-slate-500">AI Intelligence Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => pushToSupabase()}
            disabled={!supabaseReady || isSyncing}
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
              <button onClick={handleClear} className="flex-1 btn btn-danger gap-2 text-xs justify-center">
                <Trash2 className="w-3.5 h-3.5" /> Clear Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Desktop Sidebar — hidden < lg ═══ */}
      <aside className={cn(
        'hidden lg:flex bg-black text-white flex-col transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}>
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
              <h1 className="text-sm font-bold tracking-tight">Novalyte<span className="text-novalyte-400 text-[7px] align-super">™</span> AI</h1>
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
            disabled={!supabaseReady || isSyncing}
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

          {/* Export / Clear */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              title={collapsed ? 'Tools' : undefined}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg text-[12px] font-medium text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors',
                collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
              )}
            >
              <Settings className="w-4 h-4 shrink-0" />
              {!collapsed && 'Tools'}
            </button>
            {showExportMenu && (
              <div className={cn('absolute bottom-full mb-1 bg-black border border-white/10 rounded-lg shadow-xl z-50 py-1 min-w-[160px]',
                collapsed ? 'left-full ml-2' : 'left-0'
              )}>
                <button onClick={handleExport} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">
                  <DownloadCloud className="w-3.5 h-3.5" /> Export Data
                </button>
                <button onClick={handleClear} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/5">
                  <Trash2 className="w-3.5 h-3.5" /> Clear All Data
                </button>
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'w-full flex items-center gap-2.5 rounded-lg text-[12px] font-medium text-slate-600 hover:bg-white/5 hover:text-slate-400 transition-colors',
              collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
            )}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronLeft className="w-4 h-4 shrink-0" /> Collapse</>}
          </button>
        </div>
      </aside>

      {/* ═══ Main Content ═══ */}
      <main className="flex-1 overflow-auto pt-[60px] pb-[72px] lg:pt-0 lg:pb-0">
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
              ['email', 'forecast'].includes(currentView) ? 'text-novalyte-400' : 'text-slate-500 active:text-slate-300'
            )}>
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Click-away for export menu */}
      {showExportMenu && <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />}
    </div>
  );
}

export default App;
