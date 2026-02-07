import { useState, useMemo } from 'react';
import {
  TrendingUp,
  Search,
  RefreshCw,
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  X,
  Building2,
  Radar,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  BarChart3,
  Target,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { keywordService } from '../services/keywordService';
import { clinicService } from '../services/clinicService';
import { KeywordTrend, MEN_HEALTH_KEYWORDS, MarketZone } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

type SortKey = 'trendScore' | 'growthRate' | 'searchVolume' | 'competitorActivity' | 'keyword' | 'market';
type SortDir = 'asc' | 'desc';

function KeywordScanner() {
  const {
    markets, selectedMarket, selectMarket,
    keywordTrends, addKeywordTrends,
    isScanning, setIsScanning,
    clinics, addClinics,
    setCurrentView,
  } = useAppStore();

  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<KeywordTrend | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('trendScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isDiscoveringFromTrend, setIsDiscoveringFromTrend] = useState(false);

  // ─── Scan handlers ───

  const handleScanMarket = async () => {
    if (!selectedMarket) { toast.error('Select a market first'); return; }
    setIsScanning(true);
    toast.loading('Scanning keyword trends...', { id: 'scanning' });
    try {
      const trends = await keywordService.getTrendingKeywordsForMarket(selectedMarket);
      addKeywordTrends(trends);
      toast.success(`Found ${trends.length} keyword trends`, { id: 'scanning' });
    } catch { toast.error('Failed to scan keywords', { id: 'scanning' }); }
    finally { setIsScanning(false); }
  };

  const handleScanAllMarkets = async () => {
    setIsScanning(true);
    toast.loading('Scanning all markets...', { id: 'scanning' });
    try {
      const trends = await keywordService.scanAllMarkets();
      addKeywordTrends(trends);
      toast.success(`Found ${trends.length} keyword trends across all markets`, { id: 'scanning' });
    } catch { toast.error('Failed to scan keywords', { id: 'scanning' }); }
    finally { setIsScanning(false); }
  };

  // ─── Actions from trend rows ───

  const handleDiscoverFromTrend = async (trend: KeywordTrend) => {
    setIsDiscoveringFromTrend(true);
    toast.loading(`Discovering clinics in ${trend.location.city}...`, { id: 'trend-discover' });
    try {
      const discovered = await clinicService.discoverClinicsInMarket(trend.location);
      addClinics(discovered);
      toast.success(`Found ${discovered.length} clinics in ${trend.location.city}`, { id: 'trend-discover' });
    } catch { toast.error('Discovery failed', { id: 'trend-discover' }); }
    finally { setIsDiscoveringFromTrend(false); }
  };

  const handleGoToMarketClinics = (market: MarketZone) => {
    selectMarket(market);
    setCurrentView('clinics');
  };

  const handleGoToMarketCRM = (market: MarketZone) => {
    selectMarket(market);
    setCurrentView('crm');
  };

  const handleDeleteTrend = (trendId: string) => {
    // Remove from store (local only — Supabase sync will reconcile)
    const store = useAppStore.getState();
    const updated = store.keywordTrends.filter(t => t.id !== trendId);
    useAppStore.setState({ keywordTrends: updated });
    if (selectedTrend?.id === trendId) setSelectedTrend(null);
    toast.success('Trend removed');
  };

  // ─── Sorting ───

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === 'desc'
      ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
      : <ChevronUp className="w-3 h-3 inline ml-0.5" />;
  };

  // ─── Filtered + sorted trends ───

  const filteredTrends = useMemo(() => {
    let list = keywordTrends.filter(trend => {
      if (selectedMarket && trend.location.id !== selectedMarket.id) return false;
      if (selectedKeyword && trend.keyword !== selectedKeyword) return false;
      return true;
    });

    const compMap = { low: 1, medium: 2, high: 3 };
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'trendScore': cmp = a.trendScore - b.trendScore; break;
        case 'growthRate': cmp = a.growthRate - b.growthRate; break;
        case 'searchVolume': cmp = a.searchVolume - b.searchVolume; break;
        case 'competitorActivity': cmp = compMap[a.competitorActivity] - compMap[b.competitorActivity]; break;
        case 'keyword': cmp = a.keyword.localeCompare(b.keyword); break;
        case 'market': cmp = a.location.city.localeCompare(b.location.city); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [keywordTrends, selectedMarket, selectedKeyword, sortKey, sortDir]);

  // ─── Summary stats ───

  const topMarket = useMemo(() => {
    if (filteredTrends.length === 0) return null;
    const scores = new Map<string, { market: MarketZone; total: number; count: number }>();
    for (const t of filteredTrends) {
      const key = t.location.id;
      const entry = scores.get(key) || { market: t.location, total: 0, count: 0 };
      entry.total += t.trendScore;
      entry.count++;
      scores.set(key, entry);
    }
    let best: { market: MarketZone; avg: number } | null = null;
    for (const v of scores.values()) {
      const avg = v.total / v.count;
      if (!best || avg > best.avg) best = { market: v.market, avg };
    }
    return best;
  }, [filteredTrends]);

  const clinicsInMarket = (marketId: string) => clinics.filter(c => c.marketZone.id === marketId).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Keyword Scanner</h1>
        <p className="text-slate-500">Track spiking men's health keywords — click any row to take action</p>
      </div>

      {/* Filters & Actions */}
      <div className="glass-card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-400 mb-1">
              <MapPin className="w-4 h-4 inline mr-1" />
              Select Market
            </label>
            <select
              value={selectedMarket?.id || ''}
              onChange={(e) => { selectMarket(markets.find(m => m.id === e.target.value) || null); }}
              className="input"
            >
              <option value="">All Markets</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.city}, {m.state} (Score: {m.affluenceScore})</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-400 mb-1">
              <Filter className="w-4 h-4 inline mr-1" />
              Filter Keyword
            </label>
            <select
              value={selectedKeyword || ''}
              onChange={(e) => setSelectedKeyword(e.target.value || null)}
              className="input"
            >
              <option value="">All Keywords</option>
              {MEN_HEALTH_KEYWORDS.map((kw) => (
                <option key={kw} value={kw}>{kw}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-6">
            <button onClick={handleScanMarket} disabled={isScanning || !selectedMarket} className="btn btn-primary">
              {isScanning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Scan Market
            </button>
            <button onClick={handleScanAllMarkets} disabled={isScanning} className="btn btn-secondary">
              <Radar className="w-4 h-4 mr-2" />
              Scan All
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {filteredTrends.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card p-4">
            <p className="text-xs text-slate-500 mb-1">Total Trends</p>
            <p className="text-2xl font-bold text-white">{filteredTrends.length}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-slate-500 mb-1">Avg Trend Score</p>
            <p className="text-2xl font-bold text-white">{Math.round(filteredTrends.reduce((s, t) => s + t.trendScore, 0) / filteredTrends.length)}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-slate-500 mb-1">Avg Growth</p>
            <p className="text-2xl font-bold text-emerald-400">+{Math.round(filteredTrends.reduce((s, t) => s + t.growthRate, 0) / filteredTrends.length)}%</p>
          </div>
          {topMarket && (
            <div className="glass-card p-4 cursor-pointer hover:border-novalyte-500/30" onClick={() => handleGoToMarketClinics(topMarket.market)}>
              <p className="text-xs text-slate-500 mb-1">Hottest Market</p>
              <p className="text-lg font-bold text-white">{topMarket.market.city}</p>
              <p className="text-xs text-slate-600">avg score {Math.round(topMarket.avg)} — click to discover</p>
            </div>
          )}
        </div>
      )}

      {/* Keyword pills */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {MEN_HEALTH_KEYWORDS.map((kw) => (
            <button
              key={kw}
              onClick={() => setSelectedKeyword(selectedKeyword === kw ? null : kw)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                selectedKeyword === kw ? 'bg-novalyte-500/20 text-novalyte-300 border border-novalyte-500/30' : 'bg-white/5 text-slate-400 border border-white/[0.06] hover:border-novalyte-500/30'
              )}
            >
              {kw}
            </button>
          ))}
        </div>
      </div>

      {/* Results table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">
            Keyword Trends
            <span className="text-slate-500 font-normal ml-2">({filteredTrends.length} results)</span>
          </h2>
        </div>

        {filteredTrends.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('keyword')}>
                    Keyword <SortIcon col="keyword" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('market')}>
                    Market <SortIcon col="market" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('trendScore')}>
                    Trend Score <SortIcon col="trendScore" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('growthRate')}>
                    Growth <SortIcon col="growthRate" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('competitorActivity')}>
                    Competition <SortIcon col="competitorActivity" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase cursor-pointer select-none" onClick={() => toggleSort('searchVolume')}>
                    Volume <SortIcon col="searchVolume" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredTrends.map((trend) => (
                  <tr
                    key={trend.id}
                    className={cn('hover:bg-white/[0.03] cursor-pointer transition-colors', selectedTrend?.id === trend.id && 'bg-novalyte-500/10')}
                    onClick={() => setSelectedTrend(selectedTrend?.id === trend.id ? null : trend)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-200">{trend.keyword}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <MapPin className="w-3.5 h-3.5 text-slate-600 mr-1" />
                        <span className="text-sm text-slate-400">{trend.location.city}, {trend.location.state}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <div className="w-20 bg-white/5 rounded-full h-2 mr-2">
                          <div className={cn('h-2 rounded-full', trend.trendScore >= 75 ? 'bg-green-500' : trend.trendScore >= 50 ? 'bg-novalyte-500' : 'bg-orange-400')} style={{ width: `${trend.trendScore}%` }} />
                        </div>
                        <span className="text-sm font-medium text-slate-300">{trend.trendScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        {trend.growthRate >= 0 ? <ArrowUpRight className="w-4 h-4 text-green-400 mr-1" /> : <ArrowDownRight className="w-4 h-4 text-red-400 mr-1" />}
                        <span className={cn('text-sm font-medium', trend.growthRate >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {trend.growthRate >= 0 ? '+' : ''}{trend.growthRate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('badge', { 'badge-success': trend.competitorActivity === 'low', 'badge-warning': trend.competitorActivity === 'medium', 'badge-danger': trend.competitorActivity === 'high' })}>
                        {trend.competitorActivity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{trend.searchVolume.toLocaleString()}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleGoToMarketClinics(trend.location)}
                          className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-novalyte-400"
                          title="View clinics in this market"
                        >
                          <Building2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDiscoverFromTrend(trend)}
                          disabled={isDiscoveringFromTrend}
                          className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-green-400"
                          title="Discover clinics in this market"
                        >
                          {isDiscoveringFromTrend ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDeleteTrend(trend.id)}
                          className="p-1.5 rounded hover:bg-white/5 text-slate-600 hover:text-red-400"
                          title="Remove this trend"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500">
            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium text-slate-400 mb-2">No keyword trends yet</p>
            <p className="text-sm text-slate-600 mb-4">Select a market and start scanning to discover trending keywords</p>
            <button onClick={handleScanAllMarkets} disabled={isScanning} className="btn btn-primary">Start Scanning</button>
          </div>
        )}
      </div>

      {/* ─── Detail Drawer ─── */}
      {selectedTrend && (
        <div className="fixed inset-y-0 right-0 w-[420px] bg-slate-900 shadow-2xl border-l border-white/[0.06] z-50 flex flex-col">
          {/* Drawer header */}
          <div className="p-5 border-b border-white/[0.06] flex items-start justify-between">
            <div>
              <h3 className="font-bold text-lg text-white">{selectedTrend.keyword}</h3>
              <p className="text-sm text-slate-500 flex items-center mt-1">
                <MapPin className="w-3.5 h-3.5 mr-1" />
                {selectedTrend.location.city}, {selectedTrend.location.state}
              </p>
            </div>
            <button onClick={() => setSelectedTrend(null)} className="p-1.5 rounded-lg hover:bg-white/5">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Drawer body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Score cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-novalyte-400" />
                  <span className="text-xs text-slate-500">Trend Score</span>
                </div>
                <p className="text-2xl font-bold text-white">{selectedTrend.trendScore}<span className="text-sm text-slate-600">/100</span></p>
                <div className="w-full bg-white/5 rounded-full h-2 mt-2">
                  <div className={cn('h-2 rounded-full', selectedTrend.trendScore >= 75 ? 'bg-green-500' : selectedTrend.trendScore >= 50 ? 'bg-novalyte-500' : 'bg-orange-400')} style={{ width: `${selectedTrend.trendScore}%` }} />
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-slate-500">Growth Rate</span>
                </div>
                <p className={cn('text-2xl font-bold', selectedTrend.growthRate >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {selectedTrend.growthRate >= 0 ? '+' : ''}{selectedTrend.growthRate}%
                </p>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-slate-500">Search Volume</span>
                </div>
                <p className="text-2xl font-bold text-white">{selectedTrend.searchVolume.toLocaleString()}</p>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-slate-500">Competition</span>
                </div>
                <span className={cn('badge text-base', { 'badge-success': selectedTrend.competitorActivity === 'low', 'badge-warning': selectedTrend.competitorActivity === 'medium', 'badge-danger': selectedTrend.competitorActivity === 'high' })}>
                  {selectedTrend.competitorActivity}
                </span>
              </div>
            </div>

            {/* Market info */}
            <div className="bg-white/[0.03] rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">Market Details</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Metro Area</span><span className="font-medium text-slate-300">{selectedTrend.location.metropolitanArea}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Median Income</span><span className="font-medium text-slate-300">${selectedTrend.location.medianIncome.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Population</span><span className="font-medium text-slate-300">{selectedTrend.location.population.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Affluence Score</span><span className="font-medium text-slate-300">{selectedTrend.location.affluenceScore}/10</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Clinics Discovered</span><span className="font-medium text-slate-300">{clinicsInMarket(selectedTrend.location.id)}</span></div>
              </div>
            </div>

            {/* Insight */}
            <div className="bg-novalyte-500/10 border border-novalyte-500/20 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-novalyte-300 mb-2">Opportunity Signal</h4>
              <p className="text-sm text-novalyte-200/80">
                {selectedTrend.trendScore >= 75 && selectedTrend.competitorActivity === 'low'
                  ? `High demand + low competition for "${selectedTrend.keyword}" in ${selectedTrend.location.city}. This is a prime opportunity — discover clinics and start outreach immediately.`
                  : selectedTrend.trendScore >= 75
                  ? `Strong demand for "${selectedTrend.keyword}" in ${selectedTrend.location.city}. Competition is ${selectedTrend.competitorActivity} — move fast to capture market share.`
                  : selectedTrend.growthRate > 15
                  ? `"${selectedTrend.keyword}" is growing rapidly at +${selectedTrend.growthRate}% in ${selectedTrend.location.city}. Early mover advantage is available.`
                  : `Moderate interest in "${selectedTrend.keyword}" in ${selectedTrend.location.city}. Consider this market for long-term pipeline building.`
                }
              </p>
            </div>
          </div>

          {/* Drawer actions */}
          <div className="p-5 border-t border-white/[0.06] space-y-2">
            <button
              onClick={() => handleDiscoverFromTrend(selectedTrend)}
              disabled={isDiscoveringFromTrend}
              className="btn btn-primary w-full"
            >
              {isDiscoveringFromTrend ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
              Discover Clinics in {selectedTrend.location.city}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => handleGoToMarketClinics(selectedTrend.location)} className="btn btn-secondary text-sm">
                <Building2 className="w-4 h-4 mr-1" /> View Clinics ({clinicsInMarket(selectedTrend.location.id)})
              </button>
              <button onClick={() => handleGoToMarketCRM(selectedTrend.location)} className="btn btn-secondary text-sm">
                <Target className="w-4 h-4 mr-1" /> Go to CRM
              </button>
            </div>
            <button onClick={() => handleDeleteTrend(selectedTrend.id)} className="btn w-full text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20">
              <Trash2 className="w-4 h-4 mr-1" /> Remove Trend
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default KeywordScanner;
