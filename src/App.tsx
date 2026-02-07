import { useEffect, useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Building2, Users, Phone,
  Settings, Cloud, CloudOff, RefreshCw, Brain, ChevronLeft,
  ChevronRight, DownloadCloud, Trash2, Sparkles, Mail, DollarSign,
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

const navItems = [
  { id: 'dashboard', label: 'Command Center', icon: LayoutDashboard, badge: null },
  { id: 'keywords', label: 'Keyword Scanner', icon: TrendingUp, badge: 'trends' },
  { id: 'clinics', label: 'Clinic Discovery', icon: Building2, badge: 'clinics' },
  { id: 'crm', label: 'Pipeline CRM', icon: Users, badge: 'contacts' },
  { id: 'voice', label: 'Voice Agent', icon: Phone, badge: 'calls' },
  { id: 'email', label: 'Email Outreach', icon: Mail, badge: 'emails' },
  { id: 'forecast', label: 'Revenue Forecast', icon: DollarSign, badge: null },
] as const;

function App() {
  const {
    currentView, setCurrentView, supabaseReady, isSyncing,
    initSupabase, pushToSupabase, contacts, clinics, keywordTrends, callHistory, sentEmails,
  } = useAppStore();

  const [collapsed, setCollapsed] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => { initSupabase(); }, [initSupabase]);

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
      case 'voice': return <VoiceAgent />;
      case 'email': return <EmailOutreach />;
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

  return (
    <div className="flex h-screen bg-slate-950">
      {/* ═══ Sidebar ═══ */}
      <aside className={cn(
        'bg-slate-950 text-white flex flex-col transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-[68px]' : 'w-[240px]'
      )}>
        {/* Logo */}
        <div className={cn('border-b border-white/5 flex items-center', collapsed ? 'px-3 py-4 justify-center' : 'px-5 py-5')}>
          <div className="w-9 h-9 bg-gradient-to-br from-novalyte-400 via-novalyte-500 to-accent-500 rounded-xl flex items-center justify-center text-sm font-black shrink-0 shadow-lg shadow-novalyte-500/20">
            N
          </div>
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <h1 className="text-sm font-bold tracking-tight">Novalyte</h1>
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
              <div className={cn('absolute bottom-full mb-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl z-50 py-1 min-w-[160px]',
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
      <main className="flex-1 overflow-auto">
        {renderView()}
      </main>

      {/* Click-away for export menu */}
      {showExportMenu && <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />}
    </div>
  );
}

export default App;
