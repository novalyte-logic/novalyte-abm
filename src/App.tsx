import { 
  LayoutDashboard, 
  TrendingUp, 
  Building2, 
  Users, 
  Phone,
  Megaphone,
  Settings
} from 'lucide-react';
import { useAppStore } from './stores/appStore';
import { cn } from './utils/cn';
import Dashboard from './components/Dashboard';
import KeywordScanner from './components/KeywordScanner';
import ClinicDiscovery from './components/ClinicDiscovery';
import CRM from './components/CRM';
import VoiceAgent from './components/VoiceAgent';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'keywords', label: 'Keyword Scanner', icon: TrendingUp },
  { id: 'clinics', label: 'Clinic Discovery', icon: Building2 },
  { id: 'crm', label: 'CRM', icon: Users },
  { id: 'voice', label: 'Voice Agent', icon: Phone },
] as const;

function App() {
  const { currentView, setCurrentView } = useAppStore();

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'keywords':
        return <KeywordScanner />;
      case 'clinics':
        return <ClinicDiscovery />;
      case 'crm':
        return <CRM />;
      case 'voice':
        return <VoiceAgent />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-novalyte-950 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-novalyte-800">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="w-8 h-8 bg-gradient-to-br from-novalyte-400 to-accent-500 rounded-lg flex items-center justify-center text-sm font-bold">
              N
            </span>
            Novalyte ABM
          </h1>
          <p className="text-xs text-novalyte-400 mt-1">Account Based Marketing</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4">
          <ul className="space-y-1 px-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setCurrentView(item.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-novalyte-800 text-white'
                        : 'text-novalyte-300 hover:bg-novalyte-900 hover:text-white'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Settings */}
        <div className="p-3 border-t border-novalyte-800">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-novalyte-300 hover:bg-novalyte-900 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {renderView()}
      </main>
    </div>
  );
}

export default App;
