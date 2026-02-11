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
  FileText,
  Copy,
  Loader2,
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
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(new Set());
  const [selectedTrend, setSelectedTrend] = useState<KeywordTrend | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('trendScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isDiscoveringFromTrend, setIsDiscoveringFromTrend] = useState(false);

  // ─── Scan handlers ───

  const handleScanMarket = async () => {
    if (!selectedMarket && selectedMarkets.size === 0) { toast.error('Select a market first'); return; }
    setIsScanning(true);
    const marketsToScan = selectedMarkets.size > 0
      ? markets.filter(m => selectedMarkets.has(m.id))
      : selectedMarket ? [selectedMarket] : [];
    const keywordsToScan = selectedKeywords.size > 0
      ? Array.from(selectedKeywords)
      : undefined;
    toast.loading(`Scanning ${marketsToScan.length} market${marketsToScan.length !== 1 ? 's' : ''}...`, { id: 'scanning' });
    try {
      let allTrends: KeywordTrend[] = [];
      for (const market of marketsToScan) {
        const trends = await keywordService.getTrendingKeywordsForMarket(market, keywordsToScan);
        allTrends = [...allTrends, ...trends];
      }
      addKeywordTrends(allTrends);
      toast.success(`Found ${allTrends.length} keyword trends across ${marketsToScan.length} market${marketsToScan.length !== 1 ? 's' : ''}`, { id: 'scanning' });
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

  /* ─── Blog Post Generator ─── */
  const [generatingBlog, setGeneratingBlog] = useState(false);
  const [generatedBlog, setGeneratedBlog] = useState<{ title: string; slug: string; content: string; keyword: string; market: string } | null>(null);

  const handleGenerateBlogPost = async (trend: KeywordTrend) => {
    setGeneratingBlog(true);
    toast.loading(`Generating blog post for "${trend.keyword}" in ${trend.location.city}...`, { id: 'blog-gen' });
    try {
      const keyword = trend.keyword;
      const city = trend.location.city;
      const state = trend.location.state;
      const volume = trend.searchVolume;
      const growth = trend.growthRate;

      const prompt = `Write a comprehensive, SEO-optimized blog article for a men's health platform called Novalyte AI.

TARGET KEYWORD: "${keyword}"
TARGET MARKET: ${city}, ${state}
SEARCH VOLUME: ${volume}/mo (growing ${growth}%)

REQUIREMENTS:
- Title must include the keyword and city name for local SEO
- 800-1200 words, informative and authoritative
- Include H2 and H3 subheadings with keyword variations
- Write for men aged 30-55 searching for this treatment
- Include practical advice, what to expect, costs, and how to find a provider
- End with a CTA to take a free AI health assessment
- Tone: knowledgeable, direct, no fluff — like talking to a smart friend
- Do NOT include medical disclaimers inline (we add those separately)
- Output as HTML with <h2>, <h3>, <p>, <ul>, <li> tags only

Also provide:
- SEO title (60 chars max)
- Meta description (155 chars max)
- URL slug (lowercase, hyphens)

Format your response as:
TITLE: [seo title]
SLUG: [url-slug]
DESCRIPTION: [meta description]
---
[html content]`;

      // Use Bedrock/Claude via the AI service
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      });

      // Fallback: generate locally if API fails
      let title = `${keyword} in ${city}, ${state}: What Men Need to Know in 2026`;
      let slug = `${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${city.toLowerCase()}-${state.toLowerCase()}`;
      let content = '';

      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parts = text.split('---');
        const meta = parts[0] || '';
        content = (parts.slice(1).join('---') || '').trim();

        const titleMatch = meta.match(/TITLE:\s*(.+)/i);
        const slugMatch = meta.match(/SLUG:\s*(.+)/i);
        if (titleMatch) title = titleMatch[1].trim();
        if (slugMatch) slug = slugMatch[1].trim();
      }

      if (!content) {
        // Generate a solid fallback
        content = `<h2>${keyword} in ${city}: Growing Demand</h2>
<p>Search interest for "${keyword}" in ${city}, ${state} has grown ${growth}% recently, with ${volume.toLocaleString()} monthly searches. Men in the ${city} metro area are increasingly seeking treatment options, and the demand shows no signs of slowing.</p>
<h2>What to Look For in a Provider</h2>
<p>When searching for ${keyword.toLowerCase()} services in ${city}, prioritize clinics with board-certified physicians, comprehensive lab work, and individualized treatment protocols. Avoid providers who offer one-size-fits-all approaches.</p>
<h2>Take the First Step</h2>
<p>If you're in the ${city} area and considering treatment, a free AI health assessment can help determine if you're a candidate and match you with qualified providers near you.</p>`;
      }

      setGeneratedBlog({ title, slug, content, keyword, market: `${city}, ${state}` });
      toast.success('Blog post generated — copy and deploy to intel-landing', { id: 'blog-gen' });
    } catch (err: any) {
      console.error('Blog generation failed:', err);
      toast.error('Blog generation failed', { id: 'blog-gen' });
    } finally {
      setGeneratingBlog(false);
    }
  };

  const handleCopyBlogPost = () => {
    if (!generatedBlog) return;
    const postData = JSON.stringify({
      slug: generatedBlog.slug,
      title: generatedBlog.title,
      keyword: generatedBlog.keyword,
      market: generatedBlog.market,
      content: generatedBlog.content,
      date: new Date().toISOString().slice(0, 10),
    }, null, 2);
    navigator.clipboard.writeText(postData);
    toast.success('Blog post JSON copied to clipboard');
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
      if (selectedKeywords.size > 0 && !selectedKeywords.has(trend.keyword)) return false;
      if (selectedKeyword && selectedKeywords.size === 0 && trend.keyword !== selectedKeyword) return false;
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
  }, [keywordTrends, selectedMarket, selectedKeyword, selectedKeywords, sortKey, sortDir]);

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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-4 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-white">Keyword Scanner</h1>
        <p className="text-slate-500">Track spiking men's health keywords — click any row to take action</p>
      </div>

      {/* Filters & Actions */}
      <div className="glass-card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-slate-400 mb-1">
              <MapPin className="w-4 h-4 inline mr-1" />
              Select Markets
              {selectedMarkets.size > 0 && <span className="text-[10px] text-[#06B6D4] ml-1">({selectedMarkets.size} selected)</span>}
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
            {/* Multi-select market pills */}
            <div className="flex flex-wrap gap-1 mt-2 max-h-[80px] overflow-y-auto">
              {markets.map(m => {
                const isSelected = selectedMarkets.has(m.id);
                return (
                  <button key={m.id} onClick={() => {
                    setSelectedMarkets(prev => {
                      const s = new Set(prev);
                      s.has(m.id) ? s.delete(m.id) : s.add(m.id);
                      return s;
                    });
                  }}
                    className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border',
                      isSelected ? 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30' : 'bg-white/[0.03] text-slate-500 border-white/[0.06] hover:text-slate-300')}>
                    {m.city}, {m.state}
                  </button>
                );
              })}
            </div>
            {selectedMarkets.size > 0 && (
              <button onClick={() => setSelectedMarkets(new Set())} className="text-[10px] text-red-400 hover:text-red-300 mt-1">Clear market selection</button>
            )}
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
            <button onClick={handleScanMarket} disabled={isScanning || (!selectedMarket && selectedMarkets.size === 0)} className="btn btn-primary">
              {isScanning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Scan {selectedMarkets.size > 1 ? `${selectedMarkets.size} Markets` : 'Market'}
            </button>
            <button onClick={handleScanAllMarkets} disabled={isScanning} className="btn btn-secondary">
              <Radar className="w-4 h-4 mr-2" />
              Scan All ({markets.length})
            </button>
            {keywordTrends.length > 0 && (
              <button onClick={() => {
                if (confirm(`Clear all ${keywordTrends.length} keyword trends? This lets you scan fresh without mixing old data.`)) {
                  useAppStore.getState().clearKeywordTrends();
                  setSelectedKeyword(null);
                  setSelectedKeywords(new Set());
                  setSelectedTrend(null);
                  toast.success('All keyword trends cleared');
                }
              }} className="btn bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
                <Trash2 className="w-4 h-4 mr-2" /> Clear All ({keywordTrends.length})
              </button>
            )}
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

      {/* Keyword pills — multi-select */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-500">Select keywords to scan:</span>
          {selectedKeywords.size > 0 && (
            <button onClick={() => setSelectedKeywords(new Set())} className="text-[10px] text-red-400 hover:text-red-300">Clear ({selectedKeywords.size})</button>
          )}
          <button onClick={() => setSelectedKeywords(new Set(MEN_HEALTH_KEYWORDS))} className="text-[10px] text-[#06B6D4] hover:text-[#22D3EE]">Select All</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {MEN_HEALTH_KEYWORDS.map((kw) => {
            const isSelected = selectedKeywords.has(kw);
            return (
              <button
                key={kw}
                onClick={() => {
                  setSelectedKeywords(prev => {
                    const s = new Set(prev);
                    s.has(kw) ? s.delete(kw) : s.add(kw);
                    return s;
                  });
                  setSelectedKeyword(null);
                }}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  isSelected ? 'bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30' : 'bg-white/5 text-slate-400 border border-white/[0.06] hover:border-[#06B6D4]/30'
                )}
              >
                {kw}
              </button>
            );
          })}
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
                          onClick={() => handleGenerateBlogPost(trend)}
                          disabled={generatingBlog}
                          className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-purple-400"
                          title="Generate blog post for this keyword"
                        >
                          {generatingBlog ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
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
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedTrend(null)} />
          <div className="relative w-full sm:w-[420px] bg-black shadow-2xl border-l border-white/[0.06] flex flex-col">
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
            <button
              onClick={() => handleGenerateBlogPost(selectedTrend)}
              disabled={generatingBlog}
              className="btn w-full text-sm text-purple-400 hover:bg-purple-500/10 border border-purple-500/20"
            >
              {generatingBlog ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
              Generate Blog Post for "{selectedTrend.keyword}"
            </button>
            <button onClick={() => handleDeleteTrend(selectedTrend.id)} className="btn w-full text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20">
              <Trash2 className="w-4 h-4 mr-1" /> Remove Trend
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Generated Blog Post Preview */}
      {generatedBlog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setGeneratedBlog(null)}>
          <div className="bg-surface-800 border border-white/[0.08] rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <h3 className="font-bold text-white">Generated Blog Post</h3>
                </div>
                <p className="text-xs text-slate-500">Keyword: "{generatedBlog.keyword}" · Market: {generatedBlog.market}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCopyBlogPost} className="btn btn-secondary text-xs gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Copy JSON
                </button>
                <button onClick={() => setGeneratedBlog(null)} className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">SEO Title</p>
                <p className="text-sm font-medium text-white">{generatedBlog.title}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-3 mb-1">URL Slug</p>
                <p className="text-xs text-novalyte-400 font-mono">/blog/{generatedBlog.slug}</p>
              </div>
              <div className="prose prose-sm max-w-none text-slate-300 [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-slate-200 [&_h3]:font-semibold [&_h3]:text-sm [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:pl-5 [&_ul]:my-2 [&_li]:text-sm [&_li]:leading-relaxed [&_li]:mb-1"
                dangerouslySetInnerHTML={{ __html: generatedBlog.content }} />
            </div>
            <div className="p-4 border-t border-white/[0.06] flex items-center justify-between">
              <p className="text-[10px] text-slate-500">Copy the JSON and add it to intel-landing/blog/posts.ts to publish</p>
              <button onClick={handleCopyBlogPost} className="btn btn-primary text-xs gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copy Blog Post
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KeywordScanner;
