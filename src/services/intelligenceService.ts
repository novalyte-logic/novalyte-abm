/**
 * Intelligence Service — Multi-LLM powered features
 * 
 * Model routing:
 * - Claude Sonnet 4 (Bedrock) → email personalization, competitor intel (strongest reasoning)
 * - Claude Haiku 3.5 (Bedrock) → fast classification, structured extraction
 * - Gemini 2.0 Flash (Vertex AI) → fallback when Bedrock unavailable
 * 
 * #1 AI Email Personalization
 * #2 Smart Sequencing
 * #5 Competitor Intelligence
 * #7 Revenue Forecasting
 * #8 Multi-Touch Attribution
 */
import { vertexAI } from './vertexAI';
import { bedrockService, MODELS } from './bedrockService';
import { CRMContact } from '../types';
import { SentEmail } from './resendService';

/* ═══════════════════════════════════════════════════════════════
   #1 — AI EMAIL PERSONALIZATION (Gemini writes unique emails)
   ═══════════════════════════════════════════════════════════════ */

export interface AIGeneratedEmail {
  subject: string;
  html: string;
  plainText: string;
  personalizationNotes: string;
  model: string; // which LLM generated this
}

export async function generatePersonalizedEmail(
  contact: CRMContact,
  sequenceStep: 'intro' | 'follow_up' | 'breakup',
  previousEmails?: SentEmail[],
): Promise<AIGeneratedEmail> {
  const c = contact.clinic;
  const dm = contact.decisionMaker;
  const market = c.marketZone;
  const services = c.services.join(', ') || "men's health services";
  const topKw = contact.keywordMatches[0];
  const prevSubjects = (previousEmails || []).map(e => e.subject).join('; ');

  const prompt = `You are an expert B2B sales copywriter for Novalyte, a men's health clinic growth platform. Write a highly personalized cold outreach email.

CLINIC DATA:
- Name: ${c.name}
- Services: ${services}
- Location: ${c.address.city}, ${c.address.state}
- Rating: ${c.rating ? `${c.rating}/5 (${c.reviewCount} reviews)` : 'Unknown'}
- Market Affluence: ${market.affluenceScore}/10
- Median Income: $${(market.medianIncome / 1000).toFixed(0)}k
${dm ? `- Decision Maker: ${dm.firstName} ${dm.lastName}, ${dm.title} (${dm.role.replace(/_/g, ' ')})` : '- Decision Maker: Unknown'}
${topKw ? `- Trending Keyword: "${topKw.keyword}" growing ${topKw.growthRate}% in their area` : ''}
${c.website ? `- Website: ${c.website}` : ''}

SEQUENCE STEP: ${sequenceStep}
${prevSubjects ? `PREVIOUS EMAIL SUBJECTS (don't repeat): ${prevSubjects}` : ''}

RULES:
- ${sequenceStep === 'intro' ? 'First touch — lead with a specific data point about their market or services. Be curious, not salesy.' : ''}
- ${sequenceStep === 'follow_up' ? 'Second touch — reference the first email briefly, add new value (case study stat, market insight). Shorter than intro.' : ''}
- ${sequenceStep === 'breakup' ? 'Final touch — graceful close, leave the door open, very short (3-4 sentences max).' : ''}
- Write like a real human, not a template. No corporate jargon.
- Mention something specific about their clinic (services, rating, location).
- Keep it under 150 words for intro/follow-up, under 80 for breakup.
- Sign off as "Jamil" from Novalyte.
- Subject line must be compelling and under 60 chars. No emojis in subject.

Respond ONLY with valid JSON:
{
  "subject": "...",
  "body": "...(plain text, use \\n for line breaks)...",
  "personalizationNotes": "...(1 sentence explaining the angle you chose)..."
}`;

  let result: { subject: string; body: string; personalizationNotes: string } | null = null;
  let usedModel = 'unknown';

  // Try Claude Sonnet first (strongest reasoning for persuasive copy)
  if (bedrockService.isConfigured) {
    try {
      result = await bedrockService.generateJSON<typeof result>({
        prompt,
        model: MODELS.CLAUDE_OPUS,
        temperature: 0.7,
        maxTokens: 1024,
        systemPrompt: 'You are an elite B2B sales copywriter. Always respond with valid JSON only, no markdown.',
      });
      usedModel = 'claude-opus-4.6';
    } catch (err) {
      console.warn('Bedrock Claude failed for email gen, falling back to Gemini:', err);
    }
  }

  // Fallback to Gemini
  if (!result?.subject || !result?.body) {
    result = await vertexAI.generateJSON<typeof result>({
      prompt,
      model: 'gemini-2.0-flash',
      temperature: 0.7,
      maxOutputTokens: 1024,
    });
    usedModel = 'gemini-2.0-flash';
  }

  if (!result?.subject || !result?.body) {
    throw new Error('All LLMs failed to generate email');
  }

  // Convert plain text to HTML
  const htmlBody = result.body
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p style="font-size:15px;line-height:1.7;margin:0 0 12px 0;">${escHtml(line)}</p>`)
    .join('\n');

  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
${htmlBody}
</div>`;

  return {
    subject: result.subject,
    html,
    plainText: result.body,
    personalizationNotes: result.personalizationNotes || '',
    model: usedModel,
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ═══════════════════════════════════════════════════════════════
   #2 — SMART SEQUENCING ENGINE
   Day 1: Intro → Day 3: Follow-up (if no open) → Day 7: Breakup
   ═══════════════════════════════════════════════════════════════ */

export type SequenceStep = 'intro' | 'follow_up' | 'phone_call' | 'value_add' | 'breakup' | 'completed' | 'replied' | 'opted_out';

export interface ContactSequence {
  contactId: string;
  currentStep: SequenceStep;
  introSentAt?: Date;
  followUpSentAt?: Date;
  breakupSentAt?: Date;
  lastEventReceived?: string; // 'opened', 'clicked', 'bounced', etc.
  pausedUntil?: Date;
  completedAt?: Date;
}

const SEQUENCE_DELAYS = {
  intro_to_follow_up: 3, // days
  follow_up_to_breakup: 4, // days (total day 7)
};

export function computeSequenceState(
  contactId: string,
  sentEmails: SentEmail[],
): ContactSequence {
  const emails = sentEmails
    .filter(e => e.contactId === contactId)
    .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  if (emails.length === 0) {
    return { contactId, currentStep: 'intro' };
  }

  const intro = emails[0];
  const followUp = emails.length > 1 ? emails[1] : undefined;
  const breakup = emails.length > 2 ? emails[2] : undefined;

  // Check if any email was opened/clicked — sequence success
  const anyOpened = emails.some(e => e.lastEvent === 'opened' || e.lastEvent === 'clicked');
  const anyBounced = emails.some(e => e.lastEvent === 'bounced');

  if (anyBounced) {
    return {
      contactId, currentStep: 'opted_out',
      introSentAt: new Date(intro.sentAt),
      lastEventReceived: 'bounced',
      completedAt: new Date(),
    };
  }

  if (anyOpened) {
    return {
      contactId,
      currentStep: 'replied', // treat opens as engagement — manual follow-up
      introSentAt: new Date(intro.sentAt),
      followUpSentAt: followUp ? new Date(followUp.sentAt) : undefined,
      breakupSentAt: breakup ? new Date(breakup.sentAt) : undefined,
      lastEventReceived: 'opened',
    };
  }

  if (breakup) {
    return {
      contactId, currentStep: 'completed',
      introSentAt: new Date(intro.sentAt),
      followUpSentAt: followUp ? new Date(followUp.sentAt) : undefined,
      breakupSentAt: new Date(breakup.sentAt),
      completedAt: new Date(breakup.sentAt),
    };
  }

  if (followUp) {
    // Check if it's time for breakup
    const daysSinceFollowUp = daysBetween(new Date(followUp.sentAt), new Date());
    if (daysSinceFollowUp >= SEQUENCE_DELAYS.follow_up_to_breakup) {
      return {
        contactId, currentStep: 'breakup',
        introSentAt: new Date(intro.sentAt),
        followUpSentAt: new Date(followUp.sentAt),
      };
    }
    return {
      contactId, currentStep: 'follow_up', // waiting
      introSentAt: new Date(intro.sentAt),
      followUpSentAt: new Date(followUp.sentAt),
      pausedUntil: addDays(new Date(followUp.sentAt), SEQUENCE_DELAYS.follow_up_to_breakup),
    };
  }

  // Only intro sent — check if time for follow-up
  const daysSinceIntro = daysBetween(new Date(intro.sentAt), new Date());
  if (daysSinceIntro >= SEQUENCE_DELAYS.intro_to_follow_up) {
    return {
      contactId, currentStep: 'follow_up',
      introSentAt: new Date(intro.sentAt),
    };
  }

  return {
    contactId, currentStep: 'intro', // waiting for follow-up window
    introSentAt: new Date(intro.sentAt),
    pausedUntil: addDays(new Date(intro.sentAt), SEQUENCE_DELAYS.intro_to_follow_up),
  };
}

/** Get all contacts that need the next email in their sequence */
export function getSequenceQueue(
  contacts: CRMContact[],
  sentEmails: SentEmail[],
): { contact: CRMContact; step: SequenceStep; sequence: ContactSequence }[] {
  const queue: { contact: CRMContact; step: SequenceStep; sequence: ContactSequence }[] = [];

  for (const contact of contacts) {
    const seq = computeSequenceState(contact.id, sentEmails);

    // Skip completed/replied/opted-out
    if (seq.currentStep === 'completed' || seq.currentStep === 'replied' || seq.currentStep === 'opted_out') continue;

    // Skip if paused (waiting for delay)
    if (seq.pausedUntil && new Date() < new Date(seq.pausedUntil)) continue;

    // Determine what to send next
    if (seq.currentStep === 'intro' && !seq.introSentAt) {
      queue.push({ contact, step: 'intro', sequence: seq });
    } else if (seq.currentStep === 'follow_up' && !seq.followUpSentAt) {
      queue.push({ contact, step: 'follow_up', sequence: seq });
    } else if (seq.currentStep === 'breakup' && !seq.breakupSentAt) {
      queue.push({ contact, step: 'breakup', sequence: seq });
    }
  }

  return queue;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}


/* ═══════════════════════════════════════════════════════════════
   #5 — COMPETITOR INTELLIGENCE (Claude + Gemini fallback)
   ═══════════════════════════════════════════════════════════════ */

export interface CompetitorIntel {
  hasAgency: boolean;
  agencyName?: string;
  agencyType?: string;
  confidence: number;
  signals: string[];
  recommendation: string;
  model: string;
}

export async function analyzeCompetitorIntel(contact: CRMContact): Promise<CompetitorIntel> {
  const c = contact.clinic;

  const prompt = `You are a competitive intelligence analyst for Novalyte, a men's health clinic marketing platform.

Analyze this clinic and determine if they likely already work with a marketing agency:

CLINIC:
- Name: ${c.name}
- Location: ${c.address.city}, ${c.address.state}
- Services: ${c.services.join(', ')}
- Website: ${c.website || 'Unknown'}
- Rating: ${c.rating || 'Unknown'}/5 (${c.reviewCount || 0} reviews)

Based on typical patterns for ${c.type.replace(/_/g, ' ')} clinics in ${c.address.city}:
1. Do they likely have a marketing agency? (consider: website quality signals, review count, market size)
2. If yes, what type? (SEO, PPC, full-service, social media)
3. What signals suggest this?
4. What's the best approach for outreach given this?

Respond ONLY with valid JSON:
{
  "hasAgency": true/false,
  "agencyName": "name or null",
  "agencyType": "type or null",
  "confidence": 0-100,
  "signals": ["signal1", "signal2"],
  "recommendation": "1-2 sentence outreach recommendation"
}`;

  let result: CompetitorIntel | null = null;
  let usedModel = 'unknown';

  // Try Claude Haiku first (fast structured analysis)
  if (bedrockService.isConfigured) {
    try {
      result = await bedrockService.generateJSON<CompetitorIntel>({
        prompt,
        model: MODELS.CLAUDE_HAIKU,
        temperature: 0.3,
        maxTokens: 512,
        systemPrompt: 'You are a competitive intelligence analyst. Always respond with valid JSON only.',
      });
      if (result) {
        usedModel = 'claude-haiku-3.5';
        result.model = usedModel;
      }
    } catch (err) {
      console.warn('Bedrock Claude failed for competitor intel, falling back to Gemini:', err);
    }
  }

  // Fallback to Gemini
  if (!result) {
    result = await vertexAI.generateJSON<CompetitorIntel>({
      prompt,
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      maxOutputTokens: 512,
    });
    usedModel = 'gemini-2.0-flash';
    if (result) result.model = usedModel;
  }

  return result || {
    hasAgency: false,
    confidence: 0,
    signals: ['Unable to analyze'],
    recommendation: 'Proceed with standard outreach',
    model: 'none',
  };
}

/* ═══════════════════════════════════════════════════════════════
   #7 — REVENUE FORECASTING
   Based on real men's health clinic lead economics:
   
   HIGH-END MEN'S HEALTH LEAD VALUES (per pre-qualified patient):
   ┌─────────────────────────────┬──────────┬──────────┬──────────┐
   │ Service                     │ Lead CPL │ LTV/pt   │ Close %  │
   ├─────────────────────────────┼──────────┼──────────┼──────────┤
   │ TRT / Hormone Therapy       │ $150-350 │ $6,000+  │ 25-40%   │
   │ ED / Sexual Health          │ $200-500 │ $4,000+  │ 20-35%   │
   │ Peptide Therapy             │ $100-250 │ $8,000+  │ 30-45%   │
   │ GLP-1 / Weight Loss         │ $75-200  │ $5,000+  │ 35-50%   │
   │ Hair Restoration            │ $250-600 │ $12,000+ │ 15-25%   │
   │ IV Therapy                  │ $50-150  │ $2,400+  │ 40-55%   │
   │ Anti-Aging / Aesthetics     │ $100-300 │ $3,500+  │ 25-40%   │
   │ PRP Therapy                 │ $150-400 │ $5,000+  │ 20-30%   │
   └─────────────────────────────┴──────────┴──────────┴──────────┘
   
   Novalyte charges per qualified lead delivered to the clinic.
   Revenue = leads_delivered × lead_price
   ═══════════════════════════════════════════════════════════════ */

/** Per-service lead economics for high-end men's health clinics */
const SERVICE_LEAD_ECONOMICS: Record<string, { cplLow: number; cplHigh: number; patientLTV: number; closeRate: number; label: string }> = {
  trt:          { cplLow: 150, cplHigh: 350, patientLTV: 6000,  closeRate: 0.32, label: 'TRT / Hormone Therapy' },
  testosterone: { cplLow: 150, cplHigh: 350, patientLTV: 6000,  closeRate: 0.32, label: 'Testosterone Therapy' },
  hormone:      { cplLow: 150, cplHigh: 350, patientLTV: 6000,  closeRate: 0.32, label: 'Hormone Optimization' },
  ed:           { cplLow: 200, cplHigh: 500, patientLTV: 4000,  closeRate: 0.28, label: 'ED Treatment' },
  erectile:     { cplLow: 200, cplHigh: 500, patientLTV: 4000,  closeRate: 0.28, label: 'Erectile Dysfunction' },
  sexual:       { cplLow: 200, cplHigh: 500, patientLTV: 4000,  closeRate: 0.28, label: 'Sexual Health' },
  peptide:      { cplLow: 100, cplHigh: 250, patientLTV: 8000,  closeRate: 0.38, label: 'Peptide Therapy' },
  'glp-1':      { cplLow: 75,  cplHigh: 200, patientLTV: 5000,  closeRate: 0.42, label: 'GLP-1 / Weight Loss' },
  semaglutide:  { cplLow: 75,  cplHigh: 200, patientLTV: 5000,  closeRate: 0.42, label: 'Semaglutide' },
  tirzepatide:  { cplLow: 75,  cplHigh: 200, patientLTV: 5000,  closeRate: 0.42, label: 'Tirzepatide' },
  weight:       { cplLow: 75,  cplHigh: 200, patientLTV: 5000,  closeRate: 0.42, label: 'Weight Management' },
  hair:         { cplLow: 250, cplHigh: 600, patientLTV: 12000, closeRate: 0.20, label: 'Hair Restoration' },
  prp:          { cplLow: 150, cplHigh: 400, patientLTV: 5000,  closeRate: 0.25, label: 'PRP Therapy' },
  iv:           { cplLow: 50,  cplHigh: 150, patientLTV: 2400,  closeRate: 0.48, label: 'IV Therapy' },
  'anti-aging': { cplLow: 100, cplHigh: 300, patientLTV: 3500,  closeRate: 0.32, label: 'Anti-Aging' },
  aesthetic:    { cplLow: 100, cplHigh: 300, patientLTV: 3500,  closeRate: 0.32, label: 'Aesthetics' },
  hgh:          { cplLow: 200, cplHigh: 450, patientLTV: 9000,  closeRate: 0.25, label: 'HGH Therapy' },
  bioidentical: { cplLow: 150, cplHigh: 350, patientLTV: 7000,  closeRate: 0.30, label: 'Bioidentical Hormones' },
};

/** Default for clinics where we can't match a specific service */
const DEFAULT_LEAD_ECONOMICS = { cplLow: 125, cplHigh: 300, patientLTV: 4500, closeRate: 0.30, label: "Men's Health (General)" };

/** Match a clinic's services to our lead economics table */
function matchServiceEconomics(services: string[]): { cplLow: number; cplHigh: number; patientLTV: number; closeRate: number; label: string }[] {
  const matched: typeof DEFAULT_LEAD_ECONOMICS[] = [];
  const seen = new Set<string>();
  for (const svc of services) {
    const lower = svc.toLowerCase();
    for (const [key, econ] of Object.entries(SERVICE_LEAD_ECONOMICS)) {
      if (lower.includes(key) && !seen.has(econ.label)) {
        matched.push(econ);
        seen.add(econ.label);
      }
    }
  }
  return matched.length > 0 ? matched : [DEFAULT_LEAD_ECONOMICS];
}

/** Affluence multiplier — richer markets = higher lead prices */
function affluenceMultiplier(score: number): number {
  if (score >= 10) return 1.4;
  if (score >= 9) return 1.25;
  if (score >= 8) return 1.15;
  if (score >= 7) return 1.05;
  return 1.0;
}

export interface RevenueForecast {
  // Per-lead pricing
  avgLeadPrice: number;
  leadPriceRange: { low: number; high: number };
  // Pipeline
  totalClinics: number;
  qualifiedClinics: number;
  clinicsWithEmail: number;
  estimatedLeadsPerClinic: number; // monthly leads we'd deliver per clinic client
  // Revenue projections
  monthlyRevenue: number;
  quarterlyRevenue: number;
  annualRevenue: number;
  pipelineValue: number; // total if every qualified clinic converts
  // Conversion funnel
  projectedClients: number; // clinics that become paying clients
  conversionRate: number;
  // Per-service breakdown
  serviceBreakdown: { service: string; clinics: number; avgCPL: number; monthlyLeads: number; monthlyRevenue: number; patientLTV: number }[];
  // Market breakdown
  topMarkets: { market: string; clinics: number; projected: number; avgAffluence: number }[];
  // Patient economics (what the clinic gets)
  avgPatientLTV: number;
  avgCloseRate: number;
  roiForClinic: number; // how much the clinic makes per $1 spent on leads
  // Meta
  insights: string[];
  confidence: number;
}

export function generateRevenueForecast(
  contacts: CRMContact[],
  sentEmails: SentEmail[],
  _callHistory: { contactId: string; outcome?: string }[],
): RevenueForecast {
  const totalClinics = contacts.length;
  const qualified = contacts.filter(c => c.status === 'qualified').length;
  const withEmail = contacts.filter(c => c.decisionMaker?.email).length;
  const emailed = new Set(sentEmails.map(e => e.contactId)).size;
  const opened = sentEmails.filter(e => e.lastEvent === 'opened' || e.lastEvent === 'clicked').length;

  // ─── Per-service analysis across all contacts ───
  const serviceMap = new Map<string, { clinics: number; totalCPL: number; totalLTV: number; totalCloseRate: number }>();
  const allCPLs: number[] = [];
  const allLTVs: number[] = [];
  const allCloseRates: number[] = [];

  for (const contact of contacts) {
    const services = contact.clinic.services;
    const affluence = affluenceMultiplier(contact.clinic.marketZone.affluenceScore);
    const matched = matchServiceEconomics(services);

    for (const econ of matched) {
      const avgCPL = ((econ.cplLow + econ.cplHigh) / 2) * affluence;
      allCPLs.push(avgCPL);
      allLTVs.push(econ.patientLTV);
      allCloseRates.push(econ.closeRate);

      const cur = serviceMap.get(econ.label) || { clinics: 0, totalCPL: 0, totalLTV: 0, totalCloseRate: 0 };
      cur.clinics++;
      cur.totalCPL += avgCPL;
      cur.totalLTV += econ.patientLTV;
      cur.totalCloseRate += econ.closeRate;
      serviceMap.set(econ.label, cur);
    }
  }

  // Averages
  const avgLeadPrice = allCPLs.length > 0 ? Math.round(allCPLs.reduce((a, b) => a + b, 0) / allCPLs.length) : 200;
  const leadPriceLow = allCPLs.length > 0 ? Math.round(Math.min(...allCPLs)) : 75;
  const leadPriceHigh = allCPLs.length > 0 ? Math.round(Math.max(...allCPLs)) : 600;
  const avgPatientLTV = allLTVs.length > 0 ? Math.round(allLTVs.reduce((a, b) => a + b, 0) / allLTVs.length) : 5000;
  const avgCloseRate = allCloseRates.length > 0 ? allCloseRates.reduce((a, b) => a + b, 0) / allCloseRates.length : 0.30;

  // ─── Conversion funnel ───
  // Pipeline conversion: contact → emailed → opened → qualified → client
  // Realistic B2B cold outreach: ~15-25% of qualified leads become clients
  const clientConversionRate = qualified > 0 ? 0.22 : (emailed > 0 ? 0.08 : 0.05);
  const projectedClients = Math.max(1, Math.round(
    qualified > 0 ? qualified * clientConversionRate :
    withEmail > 0 ? withEmail * 0.12 :
    totalClinics * 0.05
  ));

  // ─── Revenue math ───
  // Each clinic client gets ~15-30 qualified patient leads/month from us
  const leadsPerClient = 20; // conservative mid-range
  const monthlyRevenuePerClient = leadsPerClient * avgLeadPrice;
  const monthlyRevenue = projectedClients * monthlyRevenuePerClient;

  // ─── Service breakdown ───
  const serviceBreakdown = Array.from(serviceMap.entries())
    .map(([service, data]) => {
      const avgCPL = Math.round(data.totalCPL / data.clinics);
      const avgLTV = Math.round(data.totalLTV / data.clinics);
      const monthlyLeads = leadsPerClient;
      return {
        service,
        clinics: data.clinics,
        avgCPL,
        monthlyLeads,
        monthlyRevenue: avgCPL * monthlyLeads,
        patientLTV: avgLTV,
      };
    })
    .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);

  // ─── Market breakdown ───
  const marketMap = new Map<string, { clinics: number; totalAffluence: number; qualified: number }>();
  for (const c of contacts) {
    const key = `${c.clinic.marketZone.city}, ${c.clinic.marketZone.state}`;
    const cur = marketMap.get(key) || { clinics: 0, totalAffluence: 0, qualified: 0 };
    cur.clinics++;
    cur.totalAffluence += c.clinic.marketZone.affluenceScore;
    if (c.status === 'qualified') cur.qualified++;
    marketMap.set(key, cur);
  }

  const topMarkets = Array.from(marketMap.entries())
    .map(([market, data]) => ({
      market,
      clinics: data.clinics,
      avgAffluence: Math.round((data.totalAffluence / data.clinics) * 10) / 10,
      projected: Math.round(Math.max(1, data.qualified > 0 ? data.qualified * clientConversionRate : data.clinics * 0.05) * monthlyRevenuePerClient),
    }))
    .sort((a, b) => b.projected - a.projected)
    .slice(0, 8);

  // ─── ROI for the clinic ───
  // Clinic pays us $X per lead, closes Y%, each patient worth $Z LTV
  // ROI = (closeRate × patientLTV) / leadPrice
  const roiForClinic = Math.round((avgCloseRate * avgPatientLTV) / avgLeadPrice * 10) / 10;

  // ─── Pipeline value ───
  // If every qualified clinic signs: qualified × 12 months × monthly revenue per client
  const pipelineValue = (qualified > 0 ? qualified : Math.round(withEmail * 0.15)) * monthlyRevenuePerClient * 12;

  // ─── Confidence ───
  let confidence = 25;
  if (totalClinics >= 10) confidence += 10;
  if (totalClinics >= 50) confidence += 10;
  if (withEmail >= 10) confidence += 10;
  if (emailed >= 5) confidence += 10;
  if (opened >= 3) confidence += 10;
  if (qualified >= 1) confidence += 15;
  if (qualified >= 5) confidence += 10;
  confidence = Math.min(95, confidence);

  // ─── Insights ───
  const insights: string[] = [];
  if (serviceBreakdown.length > 0) {
    const topSvc = serviceBreakdown[0];
    insights.push(`${topSvc.service} leads command $${topSvc.avgCPL}/lead — your highest-value service vertical`);
  }
  insights.push(`At $${avgLeadPrice}/lead × ${leadsPerClient} leads/mo, each clinic client is worth $${monthlyRevenuePerClient.toLocaleString()}/mo to Novalyte`);
  insights.push(`Clinics see ${roiForClinic}x ROI — every $1 they spend on leads generates $${roiForClinic.toFixed(2)} in patient lifetime value`);
  if (topMarkets.length > 0) {
    insights.push(`${topMarkets[0].market} (affluence ${topMarkets[0].avgAffluence}/10) is your highest-revenue market at $${(topMarkets[0].projected / 1000).toFixed(1)}k/mo projected`);
  }
  if (qualified > 0) {
    insights.push(`${qualified} qualified clinics × ${Math.round(clientConversionRate * 100)}% close rate = ${projectedClients} projected paying clients`);
  }
  if (opened > 0 && sentEmails.length > 0) {
    const openRate = Math.round((opened / sentEmails.length) * 100);
    insights.push(`${openRate}% email open rate — ${openRate >= 25 ? 'strong engagement, push for calls' : 'consider A/B testing subject lines'}`);
  }

  return {
    avgLeadPrice,
    leadPriceRange: { low: leadPriceLow, high: leadPriceHigh },
    totalClinics,
    qualifiedClinics: qualified,
    clinicsWithEmail: withEmail,
    estimatedLeadsPerClinic: leadsPerClient,
    monthlyRevenue,
    quarterlyRevenue: monthlyRevenue * 3,
    annualRevenue: monthlyRevenue * 12,
    pipelineValue,
    projectedClients,
    conversionRate: Math.round(clientConversionRate * 100),
    serviceBreakdown,
    topMarkets,
    avgPatientLTV,
    avgCloseRate: Math.round(avgCloseRate * 100),
    roiForClinic,
    insights,
    confidence,
  };
}

/* ═══════════════════════════════════════════════════════════════
   #8 — MULTI-TOUCH ATTRIBUTION
   ═══════════════════════════════════════════════════════════════ */

export interface TouchPoint {
  type: 'keyword_discovered' | 'clinic_discovered' | 'enriched' | 'email_sent' | 'email_opened' | 'called' | 'qualified';
  timestamp: Date;
  detail: string;
}

export interface AttributionReport {
  contactId: string;
  clinicName: string;
  market: string;
  journey: TouchPoint[];
  totalTouchPoints: number;
  daysInPipeline: number;
  currentStatus: string;
  firstTouch: string;
  lastTouch: string;
  conversionPath: string; // e.g. "keyword → discovery → email → call → qualified"
}

export function buildAttributionReport(
  contact: CRMContact,
  sentEmails: SentEmail[],
): AttributionReport {
  const journey: TouchPoint[] = [];
  const clinic = contact.clinic;

  // 1. Keyword discovery
  if (contact.keywordMatches.length > 0) {
    const earliest = contact.keywordMatches.reduce((a, b) =>
      new Date(a.timestamp) < new Date(b.timestamp) ? a : b
    );
    journey.push({
      type: 'keyword_discovered',
      timestamp: new Date(earliest.timestamp),
      detail: `Keyword "${earliest.keyword}" trending +${earliest.growthRate}% in ${clinic.marketZone.city}`,
    });
  }

  // 2. Clinic discovered
  journey.push({
    type: 'clinic_discovered',
    timestamp: new Date(clinic.discoveredAt),
    detail: `${clinic.name} discovered in ${clinic.address.city}, ${clinic.address.state}`,
  });

  // 3. Enrichment
  if (contact.decisionMaker?.enrichedAt) {
    journey.push({
      type: 'enriched',
      timestamp: new Date(contact.decisionMaker.enrichedAt),
      detail: `DM found: ${contact.decisionMaker.firstName} ${contact.decisionMaker.lastName} (${contact.decisionMaker.source})`,
    });
  }

  // 4. Emails
  const contactEmails = sentEmails.filter(e => e.contactId === contact.id);
  for (const em of contactEmails) {
    journey.push({
      type: 'email_sent',
      timestamp: new Date(em.sentAt),
      detail: `Email: "${em.subject}" → ${em.to}`,
    });
    if (em.lastEvent === 'opened' || em.lastEvent === 'clicked') {
      journey.push({
        type: 'email_opened',
        timestamp: new Date(em.lastEventAt),
        detail: `Email ${em.lastEvent}: "${em.subject}"`,
      });
    }
  }

  // 5. Calls (from activities)
  const callActivities = (contact.activities || []).filter(a => a.type === 'call_made');
  for (const act of callActivities) {
    journey.push({
      type: 'called',
      timestamp: new Date(act.timestamp),
      detail: act.description,
    });
  }

  // 6. Qualified
  if (contact.status === 'qualified') {
    const qualifiedAct = (contact.activities || []).find(a =>
      a.type === 'status_change' && a.metadata?.newStatus === 'qualified'
    );
    journey.push({
      type: 'qualified',
      timestamp: qualifiedAct ? new Date(qualifiedAct.timestamp) : new Date(contact.updatedAt),
      detail: 'Lead qualified',
    });
  }

  // Sort chronologically
  journey.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const firstTouch = journey[0];
  const lastTouch = journey[journey.length - 1];
  const daysInPipeline = firstTouch && lastTouch
    ? Math.max(1, Math.ceil((new Date(lastTouch.timestamp).getTime() - new Date(firstTouch.timestamp).getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  // Build conversion path
  const uniqueTypes = [...new Set(journey.map(t => t.type))];
  const typeLabels: Record<string, string> = {
    keyword_discovered: 'keyword',
    clinic_discovered: 'discovery',
    enriched: 'enriched',
    email_sent: 'email',
    email_opened: 'opened',
    called: 'call',
    qualified: 'qualified',
  };
  const conversionPath = uniqueTypes.map(t => typeLabels[t] || t).join(' → ');

  return {
    contactId: contact.id,
    clinicName: clinic.name,
    market: `${clinic.marketZone.city}, ${clinic.marketZone.state}`,
    journey,
    totalTouchPoints: journey.length,
    daysInPipeline,
    currentStatus: contact.status,
    firstTouch: firstTouch?.detail || 'N/A',
    lastTouch: lastTouch?.detail || 'N/A',
    conversionPath,
  };
}
