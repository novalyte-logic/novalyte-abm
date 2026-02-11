import { KeywordTrend, MarketZone, MEN_HEALTH_KEYWORDS, AFFLUENT_MARKETS } from '../types';
import { vertexAI } from './vertexAI';
import axios from 'axios';

const SERPAPI_KEY = import.meta.env.VITE_SERPAPI_KEY || '';

export class KeywordService {
  /**
   * Scan keyword trend for a specific market using SerpAPI Google search
   * to measure real search presence, then Vertex AI for trend analysis.
   */
  async scanKeywordTrend(
    keyword: string,
    market: MarketZone
  ): Promise<KeywordTrend | null> {
    try {
      // Try SerpAPI for real search data
      if (SERPAPI_KEY) {
        return await this.scanViaSerpAPI(keyword, market);
      }
    } catch (err) {
      console.warn(`SerpAPI failed for "${keyword}" in ${market.city}:`, err);
    }

    try {
      // Fall back to Vertex AI trend estimation
      if (vertexAI.isConfigured) {
        return await this.scanViaVertexAI(keyword, market);
      }
    } catch (err) {
      console.warn(`Vertex AI failed for "${keyword}" in ${market.city}:`, err);
    }

    // Last resort: local estimation
    return this.generateEstimatedTrend(keyword, market);
  }

  /**
   * SerpAPI: query Google search for "{keyword} clinic in {city}, {state}"
   * and derive trend signals from organic results + search metadata.
   */
  private async scanViaSerpAPI(keyword: string, market: MarketZone): Promise<KeywordTrend> {
    const query = `${keyword} clinic ${market.city} ${market.state}`;
    const url = `https://serpapi.com/search.json`;

    const { data } = await axios.get(url, {
      params: {
        q: query,
        location: `${market.city}, ${market.state}`,
        api_key: SERPAPI_KEY,
        engine: 'google',
        num: 20,
      },
      timeout: 15000,
    });

    const organicCount = data.organic_results?.length || 0;
    const localCount = data.local_results?.places?.length || data.local_results?.length || 0;
    const totalResults = data.search_information?.total_results || 0;
    const relatedSearches = data.related_searches?.length || 0;

    // Derive trend score from real search signals
    const localSignal = Math.min(localCount * 8, 40);       // local pack presence
    const organicSignal = Math.min(organicCount * 3, 30);    // organic depth
    const volumeSignal = Math.min(Math.log10(Math.max(totalResults, 1)) * 5, 20); // result volume
    const interestSignal = Math.min(relatedSearches * 2, 10); // related search breadth
    const trendScore = Math.min(Math.round(localSignal + organicSignal + volumeSignal + interestSignal), 100);

    const searchVolume = Math.round(totalResults / 100 + localCount * 200 + organicCount * 50);
    const growthRate = Math.round((market.affluenceScore - 5) * 3 + (localCount > 3 ? 12 : -3) + Math.random() * 8);

    return {
      id: `${keyword}-${market.id}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      keyword,
      location: market,
      trendScore,
      searchVolume,
      growthRate,
      timestamp: new Date(),
      competitorActivity: this.estimateCompetitorActivity(localCount + organicCount),
    };
  }

  /**
   * Vertex AI: ask Gemini to estimate keyword trend data for a market
   * based on its training knowledge of healthcare market dynamics.
   */
  private async scanViaVertexAI(keyword: string, market: MarketZone): Promise<KeywordTrend> {
    const result = await vertexAI.generateJSON<{
      trendScore: number;
      searchVolume: number;
      growthRate: number;
      competitorActivity: string;
    }>({
      prompt: `Estimate the market trend data for the men's health keyword "${keyword}" in ${market.city}, ${market.state} (median income: $${market.medianIncome.toLocaleString()}, population: ${market.population.toLocaleString()}).

Return JSON with:
- trendScore: 0-100 (how trending this service is in this market)
- searchVolume: estimated monthly searches
- growthRate: year-over-year growth percentage
- competitorActivity: "low", "medium", or "high"

Consider: local demographics, affluence level (${market.affluenceScore}/10), men's health market maturity, and competition density. Be realistic.`,
      model: 'gemini-2.0-flash',
      temperature: 0.4,
      maxOutputTokens: 256,
    });

    if (result) {
      return {
        id: `${keyword}-${market.id}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        keyword,
        location: market,
        trendScore: Math.min(Math.max(result.trendScore || 50, 0), 100),
        searchVolume: result.searchVolume || 500,
        growthRate: result.growthRate || 5,
        timestamp: new Date(),
        competitorActivity: (['low', 'medium', 'high'].includes(result.competitorActivity)
          ? result.competitorActivity as 'low' | 'medium' | 'high'
          : 'medium'),
      };
    }

    // If Gemini returned garbage, fall back
    return this.generateEstimatedTrend(keyword, market);
  }

  /**
   * Local estimation fallback — no API calls needed.
   */
  private generateEstimatedTrend(keyword: string, market: MarketZone): KeywordTrend {
    const keywordWeights: Record<string, number> = {
      'TRT': 85,
      'Testosterone Replacement Therapy': 80,
      'GLP-1': 90,
      'Semaglutide': 88,
      'Tirzepatide': 82,
      'IV Therapy': 70,
      'ED Treatment': 75,
      'Erectile Dysfunction': 72,
      'Sexual Health': 65,
      'Peptide Therapy': 68,
      'Hair Loss Restoration': 65,
      'Hair Transplant': 60,
      'PRP Therapy': 55,
      'Hormone Optimization': 72,
      "Men's Wellness": 60,
      'Low T': 78,
      'HGH': 62,
      'Bioidentical Hormones': 66,
    };

    const baseWeight = keywordWeights[keyword] || 50;
    const affluenceBonus = market.affluenceScore * 3;
    const trendScore = Math.min(baseWeight + affluenceBonus + Math.floor(Math.random() * 10), 100);
    const growthRate = Math.floor((market.affluenceScore - 5) * 4 + Math.random() * 15);

    return {
      id: `${keyword}-${market.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      keyword,
      location: market,
      trendScore,
      searchVolume: trendScore * 80 + Math.floor(Math.random() * 500),
      growthRate,
      timestamp: new Date(),
      competitorActivity: this.estimateCompetitorActivity(trendScore / 10),
    };
  }

  /**
   * Scan all keywords across all affluent markets
   */
  async scanAllMarkets(): Promise<KeywordTrend[]> {
    const trends: KeywordTrend[] = [];
    const markets = AFFLUENT_MARKETS.map((m, i) => ({ ...m, id: `market-${i}` }));

    for (const market of markets) {
      for (const keyword of MEN_HEALTH_KEYWORDS) {
        const trend = await this.scanKeywordTrend(keyword, market);
        if (trend) trends.push(trend);
        await this.delay(100);
      }
    }

    return trends;
  }

  /**
   * Get trending keywords for a specific market, sorted by trend score
   */
  async getTrendingKeywordsForMarket(market: MarketZone, keywords?: string[]): Promise<KeywordTrend[]> {
    const trends: KeywordTrend[] = [];
    const keywordsToScan = keywords && keywords.length > 0 ? keywords : MEN_HEALTH_KEYWORDS as unknown as string[];

    for (const keyword of keywordsToScan) {
      const trend = await this.scanKeywordTrend(keyword, market);
      if (trend) trends.push(trend);
      await this.delay(100);
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
      if (trend && trend.growthRate > 10) {
        trends.push(trend);
      }
      await this.delay(100);
    }

    return trends.sort((a, b) => b.growthRate - a.growthRate);
  }

  private estimateCompetitorActivity(signal: number): 'low' | 'medium' | 'high' {
    if (signal < 3) return 'low';
    if (signal < 8) return 'medium';
    return 'high';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const keywordService = new KeywordService();
