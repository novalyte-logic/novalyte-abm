import axios from 'axios';
import { KeywordTrend, MarketZone, MEN_HEALTH_KEYWORDS, AFFLUENT_MARKETS } from '../types';

const SERPAPI_BASE = 'https://serpapi.com/search';

interface GoogleTrendsResponse {
  interest_over_time?: {
    timeline_data: Array<{
      date: string;
      values: Array<{ value: string; extracted_value: number }>;
    }>;
  };
  interest_by_region?: Array<{
    location: string;
    value: number;
    extracted_value: number;
  }>;
}

export class KeywordService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || import.meta.env.VITE_SERPAPI_KEY || '';
  }

  /**
   * Scan Google Trends for keyword interest in a specific market
   */
  async scanKeywordTrend(
    keyword: string,
    market: MarketZone
  ): Promise<KeywordTrend | null> {
    try {
      const response = await axios.get<GoogleTrendsResponse>(SERPAPI_BASE, {
        params: {
          engine: 'google_trends',
          q: keyword,
          geo: `US-${market.state}`,
          data_type: 'TIMESERIES',
          api_key: this.apiKey,
        },
      });

      const timelineData = response.data.interest_over_time?.timeline_data || [];
      
      if (timelineData.length === 0) return null;

      // Calculate trend score from recent data
      const recentData = timelineData.slice(-4); // Last 4 data points
      const avgScore = recentData.reduce((sum, d) => {
        const value = d.values[0]?.extracted_value || 0;
        return sum + value;
      }, 0) / recentData.length;

      // Calculate growth rate
      const oldData = timelineData.slice(0, 4);
      const oldAvg = oldData.reduce((sum, d) => {
        const value = d.values[0]?.extracted_value || 0;
        return sum + value;
      }, 0) / (oldData.length || 1);
      
      const growthRate = oldAvg > 0 ? ((avgScore - oldAvg) / oldAvg) * 100 : 0;

      return {
        id: `${keyword}-${market.id}-${Date.now()}`,
        keyword,
        location: market,
        trendScore: Math.round(avgScore),
        searchVolume: Math.round(avgScore * 100), // Estimated
        growthRate: Math.round(growthRate * 10) / 10,
        timestamp: new Date(),
        competitorActivity: this.estimateCompetitorActivity(avgScore),
      };
    } catch (error) {
      console.error(`Error scanning keyword ${keyword} in ${market.city}:`, error);
      return null;
    }
  }

  /**
   * Scan all men's health keywords across all affluent markets
   */
  async scanAllMarkets(): Promise<KeywordTrend[]> {
    const trends: KeywordTrend[] = [];
    const markets = AFFLUENT_MARKETS.map((m, i) => ({ ...m, id: `market-${i}` }));

    for (const market of markets) {
      for (const keyword of MEN_HEALTH_KEYWORDS) {
        const trend = await this.scanKeywordTrend(keyword, market);
        if (trend) {
          trends.push(trend);
        }
        // Rate limiting
        await this.delay(200);
      }
    }

    return trends;
  }

  /**
   * Get trending keywords for a specific market, sorted by trend score
   */
  async getTrendingKeywordsForMarket(market: MarketZone): Promise<KeywordTrend[]> {
    const trends: KeywordTrend[] = [];

    for (const keyword of MEN_HEALTH_KEYWORDS) {
      const trend = await this.scanKeywordTrend(keyword, market);
      if (trend) {
        trends.push(trend);
      }
      await this.delay(200);
    }

    return trends.sort((a, b) => b.trendScore - a.trendScore);
  }

  /**
   * Find markets with spiking interest for a specific keyword
   */
  async findSpikingMarkets(keyword: string): Promise<KeywordTrend[]> {
    const markets = AFFLUENT_MARKETS.map((m, i) => ({ ...m, id: `market-${i}` }));
    const trends: KeywordTrend[] = [];

    for (const market of markets) {
      const trend = await this.scanKeywordTrend(keyword, market);
      if (trend && trend.growthRate > 10) { // Only return markets with >10% growth
        trends.push(trend);
      }
      await this.delay(200);
    }

    return trends.sort((a, b) => b.growthRate - a.growthRate);
  }

  private estimateCompetitorActivity(trendScore: number): 'low' | 'medium' | 'high' {
    if (trendScore < 30) return 'low';
    if (trendScore < 60) return 'medium';
    return 'high';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const keywordService = new KeywordService();
