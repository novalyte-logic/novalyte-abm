import { CRMContact, Priority } from '../types';

/**
 * Enhanced lead scoring — factors in market affluence, keyword trends,
 * decision maker availability, email availability, services breadth,
 * clinic rating, and review count.
 *
 * Returns 0–100 score and a priority tier.
 */
export function computeLeadScore(contact: CRMContact): { score: number; priority: Priority } {
  let score = 0;

  const market = contact.clinic.marketZone;
  const dm = contact.decisionMaker;
  const clinic = contact.clinic;
  const trends = contact.keywordMatches || [];

  // ── Market quality (0–30) ──
  // Affluence score is 1–10, map to 0–20
  score += Math.min(market.affluenceScore * 2, 20);
  // High median income bonus (0–10)
  if (market.medianIncome >= 200000) score += 10;
  else if (market.medianIncome >= 150000) score += 7;
  else if (market.medianIncome >= 100000) score += 4;

  // ── Keyword trend signal (0–25) ──
  if (trends.length > 0) {
    const avgTrend = trends.reduce((s, t) => s + t.trendScore, 0) / trends.length;
    score += Math.min(Math.round(avgTrend * 0.2), 15); // trend score contribution
    // Growth rate bonus
    const maxGrowth = Math.max(...trends.map(t => t.growthRate));
    if (maxGrowth >= 50) score += 10;
    else if (maxGrowth >= 20) score += 6;
    else if (maxGrowth > 0) score += 3;
  } else {
    score += 5; // baseline if no trend data
  }

  // ── Decision maker quality (0–20) ──
  if (dm) {
    score += 5; // has a DM at all
    if (dm.email) score += 8; // has email — actionable
    if (dm.role === 'owner' || dm.role === 'medical_director') score += 4; // high-value role
    if (dm.confidence >= 80) score += 3;
    else if (dm.confidence >= 50) score += 1;
  }

  // ── Clinic signals (0–15) ──
  if (clinic.rating && clinic.rating >= 4.5) score += 5;
  else if (clinic.rating && clinic.rating >= 4.0) score += 3;
  if (clinic.reviewCount && clinic.reviewCount >= 50) score += 3;
  else if (clinic.reviewCount && clinic.reviewCount >= 20) score += 1;
  if (clinic.website) score += 2;
  // Services breadth — more services = more upsell potential
  const svcCount = clinic.services?.length || 0;
  if (svcCount >= 5) score += 5;
  else if (svcCount >= 3) score += 3;
  else if (svcCount >= 1) score += 1;

  // ── Engagement bonus (0–10) ──
  const activities = contact.activities || [];
  if (activities.some(a => a.type === 'call_made')) score += 3;
  if (activities.some(a => a.type === 'email_sent')) score += 2;
  if (contact.status === 'qualified') score += 5;
  else if (contact.status === 'follow_up') score += 2;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Priority tiers
  const priority: Priority =
    score >= 75 ? 'critical' :
    score >= 55 ? 'high' :
    score >= 35 ? 'medium' : 'low';

  return { score, priority };
}
