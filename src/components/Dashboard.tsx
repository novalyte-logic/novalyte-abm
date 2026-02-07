import { 
  TrendingUp, 
  Building2, 
  Users, 
  Phone, 
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Target
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { cn } from '../utils/cn';

const stats = [
  {
    label: 'Total Clinics',
    value: '0',
    change: '+0%',
    trend: 'up',
    icon: Building2,
    color: 'bg-blue-500',
  },
  {
    label: 'CRM Contacts',
    value: '0',
    change: '+0%',
    trend: 'up',
    icon: Users,
    color: 'bg-green-500',
  },
  {
    label: 'Calls Today',
    value: '0',
    change: '+0%',
    trend: 'up',
    icon: Phone,
    color: 'bg-purple-500',
  },
  {
    label: 'Qualified Leads',
    value: '0',
    change: '+0%',
    trend: 'up',
    icon: Target,
    color: 'bg-orange-500',
  },
];

function Dashboard() {
  const { clinics, contacts, keywordTrends, markets, callHistory, setCurrentView } = useAppStore();

  const statsWithData = [
    { ...stats[0], value: clinics.length.toString() },
    { ...stats[1], value: contacts.length.toString() },
    { ...stats[2], value: callHistory.filter(c => {
      const today = new Date();
      return c.startTime.toDateString() === today.toDateString();
    }).length.toString() },
    { ...stats[3], value: contacts.filter(c => c.status === 'qualified').length.toString() },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Welcome to Novalyte ABM - Target men's health clinics with precision</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statsWithData.map((stat) => {
          const Icon = stat.icon;
          const isUp = stat.trend === 'up';
          
          return (
            <div key={stat.label} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={cn('p-3 rounded-lg', stat.color)}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <div className="flex items-center mt-4 text-sm">
                {isUp ? (
                  <ArrowUpRight className="w-4 h-4 text-green-500 mr-1" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-500 mr-1" />
                )}
                <span className={isUp ? 'text-green-600' : 'text-red-600'}>
                  {stat.change}
                </span>
                <span className="text-gray-500 ml-1">vs last week</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Trending Keywords */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Trending Keywords</h2>
            <button 
              onClick={() => setCurrentView('keywords')}
              className="text-sm text-novalyte-600 hover:text-novalyte-700"
            >
              View All
            </button>
          </div>
          {keywordTrends.length > 0 ? (
            <div className="space-y-3">
              {keywordTrends.slice(0, 5).map((trend) => (
                <div key={trend.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{trend.keyword}</span>
                  <div className="flex items-center">
                    <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                    <span className="text-sm font-medium text-green-600">
                      +{trend.growthRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No keyword data yet</p>
              <button 
                onClick={() => setCurrentView('keywords')}
                className="btn btn-primary mt-3 text-sm"
              >
                Start Scanning
              </button>
            </div>
          )}
        </div>

        {/* Top Markets */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Top Affluent Markets</h2>
            <button 
              onClick={() => setCurrentView('clinics')}
              className="text-sm text-novalyte-600 hover:text-novalyte-700"
            >
              Discover
            </button>
          </div>
          <div className="space-y-3">
            {markets.slice(0, 5).map((market) => (
              <div key={market.id} className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">{market.city}, {market.state}</span>
                  <p className="text-xs text-gray-500">{market.metropolitanArea}</p>
                </div>
                <div className="text-right">
                  <span className="badge badge-success">
                    Score: {market.affluenceScore}/10
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Contacts</h2>
            <button 
              onClick={() => setCurrentView('crm')}
              className="text-sm text-novalyte-600 hover:text-novalyte-700"
            >
              View CRM
            </button>
          </div>
          {contacts.length > 0 ? (
            <div className="space-y-3">
              {contacts.slice(0, 5).map((contact) => (
                <div key={contact.id} className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{contact.clinic.name}</span>
                    <p className="text-xs text-gray-500">{contact.clinic.address.city}</p>
                  </div>
                  <span className={cn('badge', {
                    'badge-success': contact.status === 'qualified',
                    'badge-warning': contact.status === 'follow_up',
                    'badge-info': contact.status === 'new',
                  })}>
                    {contact.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No contacts yet</p>
              <button 
                onClick={() => setCurrentView('clinics')}
                className="btn btn-primary mt-3 text-sm"
              >
                Discover Clinics
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Getting Started */}
      <div className="card p-6 bg-gradient-to-r from-novalyte-600 to-accent-600 text-white">
        <h2 className="text-xl font-bold mb-2">Get Started with ABM</h2>
        <p className="text-novalyte-100 mb-4">
          Follow these steps to find and reach men's health clinics in affluent markets
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white/10 rounded-lg p-4">
            <div className="text-2xl font-bold mb-1">1</div>
            <p className="text-sm">Scan keyword trends in target markets</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4">
            <div className="text-2xl font-bold mb-1">2</div>
            <p className="text-sm">Discover clinics in high-demand areas</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4">
            <div className="text-2xl font-bold mb-1">3</div>
            <p className="text-sm">Enrich contacts with decision makers</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4">
            <div className="text-2xl font-bold mb-1">4</div>
            <p className="text-sm">Launch AI voice campaigns</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
