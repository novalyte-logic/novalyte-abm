import { useState } from 'react';
import { 
  TrendingUp, 
  Search, 
  RefreshCw,
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Filter
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { keywordService } from '../services/keywordService';
import { MEN_HEALTH_KEYWORDS, KeywordTrend } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

function KeywordScanner() {
  const { markets, selectedMarket, selectMarket, keywordTrends, addKeywordTrends, isScanning, setIsScanning } = useAppStore();
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  const handleScanMarket = async () => {
    if (!selectedMarket) {
      toast.error('Please select a market first');
      return;
    }

    setIsScanning(true);
    toast.loading('Scanning keyword trends...', { id: 'scanning' });

    try {
      const trends = await keywordService.getTrendingKeywordsForMarket(selectedMarket);
      addKeywordTrends(trends);
      toast.success(`Found ${trends.length} keyword trends`, { id: 'scanning' });
    } catch (error) {
      toast.error('Failed to scan keywords', { id: 'scanning' });
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanAllMarkets = async () => {
    setIsScanning(true);
    toast.loading('Scanning all markets...', { id: 'scanning' });

    try {
      const trends = await keywordService.scanAllMarkets();
      addKeywordTrends(trends);
      toast.success(`Found ${trends.length} keyword trends across all markets`, { id: 'scanning' });
    } catch (error) {
      toast.error('Failed to scan keywords', { id: 'scanning' });
    } finally {
      setIsScanning(false);
    }
  };

  const filteredTrends = keywordTrends.filter(trend => {
    if (selectedMarket && trend.location.id !== selectedMarket.id) return false;
    if (selectedKeyword && trend.keyword !== selectedKeyword) return false;
    return true;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Keyword Scanner</h1>
        <p className="text-gray-600">Track spiking keywords for men's health services across affluent markets</p>
      </div>

      {/* Filters & Actions */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Market Selector */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <MapPin className="w-4 h-4 inline mr-1" />
              Select Market
            </label>
            <select
              value={selectedMarket?.id || ''}
              onChange={(e) => {
                const market = markets.find(m => m.id === e.target.value);
                selectMarket(market || null);
              }}
              className="input"
            >
              <option value="">All Markets</option>
              {markets.map((market) => (
                <option key={market.id} value={market.id}>
                  {market.city}, {market.state} (Score: {market.affluenceScore})
                </option>
              ))}
            </select>
          </div>

          {/* Keyword Filter */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Filter className="w-4 h-4 inline mr-1" />
              Filter Keyword
            </label>
            <select
              value={selectedKeyword || ''}
              onChange={(e) => setSelectedKeyword(e.target.value || null)}
              className="input"
            >
              <option value="">All Keywords</option>
              {MEN_HEALTH_KEYWORDS.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {keyword}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-6">
            <button
              onClick={handleScanMarket}
              disabled={isScanning || !selectedMarket}
              className="btn btn-primary"
            >
              {isScanning ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Search className="w-4 h-4 mr-2" />
              )}
              Scan Market
            </button>
            <button
              onClick={handleScanAllMarkets}
              disabled={isScanning}
              className="btn btn-secondary"
            >
              Scan All
            </button>
          </div>
        </div>
      </div>

      {/* Keywords Grid */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4">Target Keywords</h2>
        <div className="flex flex-wrap gap-2">
          {MEN_HEALTH_KEYWORDS.map((keyword) => (
            <button
              key={keyword}
              onClick={() => setSelectedKeyword(selectedKeyword === keyword ? null : keyword)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                selectedKeyword === keyword
                  ? 'bg-novalyte-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {keyword}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold">
            Keyword Trends 
            <span className="text-gray-500 font-normal ml-2">
              ({filteredTrends.length} results)
            </span>
          </h2>
        </div>

        {filteredTrends.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keyword</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Market</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Trend Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Growth Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Competition</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Volume (Est.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTrends.map((trend) => (
                  <tr key={trend.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{trend.keyword}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 text-gray-400 mr-1" />
                        <span className="text-sm text-gray-600">
                          {trend.location.city}, {trend.location.state}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                          <div 
                            className="bg-novalyte-600 h-2 rounded-full"
                            style={{ width: `${trend.trendScore}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{trend.trendScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        {trend.growthRate >= 0 ? (
                          <ArrowUpRight className="w-4 h-4 text-green-500 mr-1" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-red-500 mr-1" />
                        )}
                        <span className={cn(
                          'text-sm font-medium',
                          trend.growthRate >= 0 ? 'text-green-600' : 'text-red-600'
                        )}>
                          {trend.growthRate >= 0 ? '+' : ''}{trend.growthRate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('badge', {
                        'badge-success': trend.competitorActivity === 'low',
                        'badge-warning': trend.competitorActivity === 'medium',
                        'badge-danger': trend.competitorActivity === 'high',
                      })}>
                        {trend.competitorActivity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {trend.searchVolume.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-gray-500">
            <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No keyword trends yet</p>
            <p className="text-sm mb-4">Select a market and start scanning to discover trending keywords</p>
            <button onClick={handleScanAllMarkets} disabled={isScanning} className="btn btn-primary">
              Start Scanning
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default KeywordScanner;
