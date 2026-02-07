/**
 * Novalyte AI Intelligence Engine
 * 
 * Gemini-powered strategic intelligence layer that generates:
 * - Pipeline health analysis
 * - Market opportunity scoring
 * - Next-best-action recommendations
 * - Revenue forecasting signals
 * - Competitive intelligence summaries
 */
import { vertexAI } from './vertexAI';
import { CRMContact, KeywordTrend, MarketZone, Clinic } from '../types';

export interface AIInsight {
  id: string;
  type: 'opportunity' | 'risk' | 'action' | 'trend' | 'forecast';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  metric?: string;
  actionLabel?: string;
  actionTarget?: string; // view to navigate to
  timestamp: Date;
}

export interface PipelineHealth {
  score: number; // 0-100
  trend: 'improving' | 'stable' | 'declining';
  velocity: number; // avg days from new → qualified
  conversionRate: number;
  bottleneck?: string;
  recommendation: string;
}

export interface MarketOpportunity {
  market: MarketZone;
  score: number;
  clinicsDiscovered: number;
  clinicsInCRM: number;
  penetration: number; // percentage
  topKeyword?: string;
  topGrowth?: number;
  signal: string;
}

class AIInsightsService {
  private insightCache: AIInsight[] = [];
  private lastGenerated: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 min

  /**
   * Generate real-time pipeline health metrics
   */
  computePipelineHealth(contacts: CRMContact[]): PipelineHealth {
    if (contacts.length === 0) {
      return { score: 0, trend: 'stable', velocity: 0, conversionRate: 0, recommendation: 'Start by discovering clinics and adding them to your pipeline.' };
    }

    const qualified = contacts.filter(c => c.status === 'qualified').length;
    const conversionRate = contacts.length > 0 ? (qualified / contacts.length) * 100 : 0;
    const withEmail = contacts.filter(c => c.decisionMaker?.email).length;
    const emailRate = (withEmail / contacts.length) * 100;
    const needsAction = contacts.filter(c => c.status === 'new' || c.status === 'researching').length;
    const staleRate = (needsAction / contacts.length) * 100;
    const overdue = contacts.filter(c => c.nextFollowUp && new Date(c.nextFollowUp) < new Date()).length;
    const avgScore = contacts.reduce((s, c) => s + c.score, 0) / contacts.length;

    // Pipeline health score
    let score = 50;
    score += Math.min(conversionRate * 2, 20); // conversion bonus
    score += Math.min(emailRate * 0.15, 15); // email coverage
    score -= Math.min(staleRate * 0.3, 15); // stale penalty
    score -= Math.min(overdue * 2, 10); // overdue penalty
    score += Math.min(avgScore * 0.1, 10); // lead quality bonus
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Determine trend based on recent activity
    const recentActivities = contacts.flatMap(c => c.activities || [])
      .filter(a => new Date(a.timestamp).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000);
    const trend = recentActivities.length > contacts.length * 0.3 ? 'improving' : recentActivities.length > contacts.length * 0.1 ? 'stable' : 'declining';

    // Velocity: avg time from creation to first activity
    const velocities = contacts
      .filter(c => c.activities && c.activities.length > 0)
      .map(c => {
        const first = c.activities[0];
        return (new Date(first.timestamp).getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      });
    const velocity = velocities.length > 0 ? Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length) : 0;

    // Bottleneck detection
    let bottleneck: string | undefined;
    if (staleRate > 50) bottleneck = 'Too many contacts stuck in New/Researching — enrich and start outreach';
    else if (emailRate < 30) bottleneck = 'Low email coverage — run enrichment to find decision makers';
    else if (overdue > 5) bottleneck = `${overdue} overdue follow-ups — prioritize callbacks`;
    else if (conversionRate < 5 && contacts.length > 20) bottleneck = 'Low conversion rate — review targeting and call scripts';

    const recommendation = bottleneck || (
      score >= 80 ? 'Pipeline is healthy. Focus on converting qualified leads.' :
      score >= 60 ? 'Pipeline is solid. Increase outreach velocity to improve conversion.' :
      score >= 40 ? 'Pipeline needs attention. Enrich contacts and start calling.' :
      'Pipeline is weak. Discover more clinics and build your contact base.'
    );

    return { score, trend, velocity, conversionRate: Math.round(conversionRate * 10) / 10, bottleneck, recommendation };
  }

  /**
   * Compute market opportunity scores
   */
  computeMarketOpportunities(
    markets: MarketZone[],
    clinics: Clinic[],
    contacts: CRMContact[],
    trends: KeywordTrend[]
  ): MarketOpportunity[] {
    return markets.map(market => {
      const marketClinics = clinics.filter(c => c.marketZone.id === market.id);
      const marketContacts = contacts.filter(c => c.clinic.marketZone.id === market.id);
      const marketTrends = trends.filter(t => t.location.id === market.id);
      const penetration = marketClinics.length > 0 ? (marketContacts.length / marketClinics.length) * 100 : 0;

      const topTrend = marketTrends.length > 0
        ? marketTrends.reduce((a, b) => a.growthRate > b.growthRate ? a : b)
        : undefined;

      // Opportunity score
      let score = market.affluenceScore * 8; // base from affluence
      if (marketTrends.length > 0) {
        const avgTrend = marketTrends.reduce((s, t) => s + t.trendScore, 0) / marketTrends.length;
        score += avgTrend * 0.2;
      }
      if (penetration < 30) score += 15; // low penetration = opportunity
      if (topTrend && topTrend.growthRate > 20) score += 10;
      score = Math.min(100, Math.round(score));

      const signal = penetration < 10
        ? `Untapped market — only ${marketContacts.length} of ${marketClinics.length} clinics in CRM`
        : penetration < 50
        ? `Growing pipeline — ${Math.round(penetration)}% penetration`
        : `Well-covered — focus on conversion`;

      return {
        market, score,
        clinicsDiscovered: marketClinics.length,
        clinicsInCRM: marketContacts.length,
        penetration: Math.round(penetration),
        topKeyword: topTrend?.keyword,
        topGrowth: topTrend?.growthRate,
        signal,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Generate AI-powered insights using local heuristics + optional Gemini enhancement
   */
  async generateInsights(
    contacts: CRMContact[],
    clinics: Clinic[],
    trends: KeywordTrend[],
    markets: MarketZone[]
  ): Promise<AIInsight[]> {
    // Check cache
    if (Date.now() - this.lastGenerated < this.CACHE_TTL && this.insightCache.length > 0) {
      return this.insightCache;
    }

    const insights: AIInsight[] = [];
    const now = new Date();

    // ── Overdue follow-ups ──
    const overdue = contacts.filter(c => c.nextFollowUp && new Date(c.nextFollowUp) < now);
    if (overdue.length > 0) {
      insights.push({
        id: 'overdue-followups', type: 'risk', severity: overdue.length > 5 ? 'critical' : 'high',
        title: `${overdue.length} Overdue Follow-up${overdue.length > 1 ? 's' : ''}`,
        description: `${overdue.map(c => c.clinic.name).slice(0, 3).join(', ')}${overdue.length > 3 ? ` and ${overdue.length - 3} more` : ''} need immediate attention.`,
        actionLabel: 'View Pipeline', actionTarget: 'crm', timestamp: now,
      });
    }

    // ── Stale contacts ──
    const stale = contacts.filter(c => {
      const daysSinceUpdate = (now.getTime() - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return (c.status === 'new' || c.status === 'researching') && daysSinceUpdate > 3;
    });
    if (stale.length > 5) {
      insights.push({
        id: 'stale-contacts', type: 'action', severity: 'medium',
        title: `${stale.length} Contacts Need Enrichment`,
        description: 'These contacts have been sitting without decision maker data. Enrich them to unlock outreach.',
        actionLabel: 'Open CRM', actionTarget: 'crm', timestamp: now,
      });
    }

    // ── High-growth keyword opportunities ──
    const hotTrends = trends.filter(t => t.growthRate > 30 && t.trendScore > 60);
    if (hotTrends.length > 0) {
      const top = hotTrends.reduce((a, b) => a.growthRate > b.growthRate ? a : b);
      insights.push({
        id: 'hot-keyword', type: 'opportunity', severity: 'high',
        title: `"${top.keyword}" Surging +${top.growthRate}%`,
        description: `In ${top.location.city} — high demand with ${top.competitorActivity} competition. Discover clinics and start outreach.`,
        metric: `+${top.growthRate}%`,
        actionLabel: 'Discover Clinics', actionTarget: 'clinics', timestamp: now,
      });
    }

    // ── Untapped markets ──
    const untapped = markets.filter(m => {
      const inCRM = contacts.filter(c => c.clinic.marketZone.id === m.id).length;
      return inCRM === 0 && m.affluenceScore >= 8;
    });
    if (untapped.length > 0) {
      insights.push({
        id: 'untapped-markets', type: 'opportunity', severity: 'medium',
        title: `${untapped.length} Premium Market${untapped.length > 1 ? 's' : ''} Untapped`,
        description: `${untapped.map(m => m.city).slice(0, 3).join(', ')} — affluent markets with zero CRM presence.`,
        actionLabel: 'Scan Markets', actionTarget: 'clinics', timestamp: now,
      });
    }

    // ── Qualified leads ready for conversion ──
    const qualified = contacts.filter(c => c.status === 'qualified');
    if (qualified.length > 0) {
      insights.push({
        id: 'qualified-ready', type: 'forecast', severity: 'high',
        title: `${qualified.length} Qualified Lead${qualified.length > 1 ? 's' : ''} Ready`,
        description: 'These contacts have expressed interest. Schedule demos and close deals.',
        metric: `${qualified.length}`,
        actionLabel: 'View Qualified', actionTarget: 'crm', timestamp: now,
      });
    }

    // ── Pipeline velocity insight ──
    const readyToCall = contacts.filter(c => c.status === 'ready_to_call');
    if (readyToCall.length > 10) {
      insights.push({
        id: 'call-backlog', type: 'action', severity: 'medium',
        title: `${readyToCall.length} Contacts Ready to Call`,
        description: 'Large call backlog detected. Consider batch calling or prioritize by score.',
        actionLabel: 'Start Calling', actionTarget: 'voice', timestamp: now,
      });
    }

    // ── Email coverage gap ──
    const noEmail = contacts.filter(c => !c.decisionMaker?.email);
    if (noEmail.length > contacts.length * 0.5 && contacts.length > 5) {
      insights.push({
        id: 'email-gap', type: 'risk', severity: 'medium',
        title: `${Math.round((noEmail.length / contacts.length) * 100)}% Missing Decision Maker Email`,
        description: 'Over half your pipeline lacks actionable email addresses. Run bulk enrichment.',
        metric: `${noEmail.length}/${contacts.length}`,
        actionLabel: 'Enrich Contacts', actionTarget: 'crm', timestamp: now,
      });
    }

    // ── High-value clinics not in CRM ──
    const highValueNotInCRM = clinics.filter(c => {
      const inCRM = contacts.some(ct => ct.clinic.id === c.id || (c.googlePlaceId && ct.clinic.googlePlaceId === c.googlePlaceId));
      return !inCRM && (c.rating || 0) >= 4.5 && (c.reviewCount || 0) >= 20;
    });
    if (highValueNotInCRM.length > 0) {
      insights.push({
        id: 'high-value-missed', type: 'opportunity', severity: 'high',
        title: `${highValueNotInCRM.length} High-Rated Clinics Not in CRM`,
        description: `Clinics with 4.5+ stars and 20+ reviews are waiting. ${highValueNotInCRM.slice(0, 2).map(c => c.name).join(', ')}`,
        actionLabel: 'Add to CRM', actionTarget: 'clinics', timestamp: now,
      });
    }

    // Try Gemini enhancement (non-blocking)
    try {
      const geminiInsight = await this.getGeminiInsight(contacts, trends, markets);
      if (geminiInsight) insights.unshift(geminiInsight);
    } catch {
      // Gemini enhancement is optional
    }

    this.insightCache = insights;
    this.lastGenerated = Date.now();
    return insights;
  }

  /**
   * Ask Gemini for a strategic insight based on current data
   */
  private async getGeminiInsight(
    contacts: CRMContact[],
    trends: KeywordTrend[],
    _markets: MarketZone[]
  ): Promise<AIInsight | null> {
    if (!vertexAI.isConfigured || contacts.length === 0) return null;

    const summary = {
      totalContacts: contacts.length,
      qualified: contacts.filter(c => c.status === 'qualified').length,
      withEmail: contacts.filter(c => c.decisionMaker?.email).length,
      topMarkets: [...new Set(contacts.map(c => c.clinic.address.city))].slice(0, 5),
      topServices: this.getTopServices(contacts),
      avgScore: Math.round(contacts.reduce((s, c) => s + c.score, 0) / contacts.length),
      hotKeywords: trends.filter(t => t.growthRate > 20).map(t => `${t.keyword} (+${t.growthRate}%)`).slice(0, 5),
      statusBreakdown: this.getStatusBreakdown(contacts),
    };

    const result = await vertexAI.generateJSON<{ title: string; insight: string; action: string }>({
      prompt: `You are the AI intelligence engine for Novalyte, a men's health clinic sales platform.

Given this pipeline data:
${JSON.stringify(summary, null, 2)}

Generate ONE strategic insight. Be specific, data-driven, and actionable. Focus on revenue opportunity or risk.

Respond in JSON: { "title": "short title", "insight": "2-3 sentence analysis", "action": "specific next step" }`,
      model: 'gemini-2.0-flash',
      temperature: 0.4,
      maxOutputTokens: 256,
      systemInstruction: "You are a B2B sales intelligence AI. Be concise, specific, and revenue-focused. No fluff.",
    });

    if (!result) return null;

    return {
      id: `gemini-${Date.now()}`,
      type: 'forecast',
      severity: 'high',
      title: `🧠 ${result.title}`,
      description: `${result.insight} → ${result.action}`,
      timestamp: new Date(),
    };
  }

  private getTopServices(contacts: CRMContact[]): string[] {
    const counts = new Map<string, number>();
    contacts.forEach(c => c.clinic.services.forEach(s => counts.set(s, (counts.get(s) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  }

  private getStatusBreakdown(contacts: CRMContact[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    contacts.forEach(c => { breakdown[c.status] = (breakdown[c.status] || 0) + 1; });
    return breakdown;
  }

  /** Clear cache to force regeneration */
  invalidateCache() {
    this.insightCache = [];
    this.lastGenerated = 0;
  }
}

export const aiInsightsService = new AIInsightsService();
