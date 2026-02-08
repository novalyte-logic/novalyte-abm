import axios, { AxiosError } from 'axios';
import { CRMContact, VoiceCall, CallStatus, CallOutcome } from '../types';

/* ─── Vapi API Types ─── */

interface VapiCallPayload {
  assistantId?: string;
  phoneNumberId: string;
  customer: { number: string; name?: string };
  assistantOverrides?: {
    firstMessage?: string;
    variableValues?: Record<string, string>;
    model?: {
      provider: string;
      model: string;
      messages: { role: string; content: string }[];
      temperature?: number;
      maxTokens?: number;
    };
    voice?: { provider: string; voiceId: string; speed?: number };
    endCallFunctionEnabled?: boolean;
    endCallMessage?: string;
    silenceTimeoutSeconds?: number;
    maxDurationSeconds?: number;
    backgroundSound?: string;
    hipaaEnabled?: boolean;
    analysisPlan?: {
      summaryPrompt?: string;
      successEvaluationPrompt?: string;
      successEvaluationRubric?: string;
      structuredDataPrompt?: string;
      structuredDataSchema?: Record<string, any>;
    };
  };
}

interface VapiCallResponse {
  id: string;
  orgId: string;
  type: string;
  status: string;
  phoneNumberId: string;
  assistantId: string;
  customer: { number: string; name?: string };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  transcript?: string;
  recordingUrl?: string;
  summary?: string;
  cost?: number;
  costBreakdown?: Record<string, number>;
  messages?: Array<{ role: string; message: string; time: number }>;
  analysis?: {
    summary?: string;
    successEvaluation?: string;
    structuredData?: Record<string, any>;
  };
}

/* ─── Config ─── */

const VAPI_BASE = 'https://api.vapi.ai';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_CONCURRENT_CALLS = 5;
const CALL_SPACING_MS = 8000; // 8s between batch calls — Vapi rate limit safety
const MAX_CALL_DURATION_SECONDS = 300; // 5 min max per call
const SILENCE_TIMEOUT_SECONDS = 20; // hang up after 20s silence

/* ─── Business Hours (Eastern Time) ─── */

const BUSINESS_HOURS = {
  start: 9,  // 9 AM
  end: 17,   // 5 PM
  days: [1, 2, 3, 4, 5], // Mon-Fri
};

/* ─── DNC Registry (in-memory, synced from store) ─── */

const dncSet = new Set<string>();

export class VoiceAgentService {
  private apiKey: string;
  private phoneNumberId: string;
  private assistantId: string;
  private phoneNumber: string;
  private activeCallCount = 0;

  constructor() {
    this.apiKey = import.meta.env.VITE_VAPI_API_KEY || '';
    this.phoneNumberId = import.meta.env.VITE_VAPI_PHONE_NUMBER_ID || '';
    this.assistantId = import.meta.env.VITE_VAPI_ASSISTANT_ID || '';
    this.phoneNumber = import.meta.env.VITE_VAPI_PHONE_NUMBER || '';
  }

  get isConfigured(): boolean {
    return !!(this.apiKey && this.phoneNumberId && this.assistantId);
  }

  private get headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /* ═══════════════════════════════════════════════════════════
     BUSINESS HOURS CHECK
     ═══════════════════════════════════════════════════════════ */

  isWithinBusinessHours(timezone = 'America/New_York'): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
        weekday: 'short',
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const dayName = parts.find(p => p.type === 'weekday')?.value || '';
      const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
      const dayNum = dayMap[dayName] ?? new Date().getDay();
      return BUSINESS_HOURS.days.includes(dayNum) && hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
    } catch {
      return true; // fail open
    }
  }

  getNextBusinessWindow(timezone = 'America/New_York'): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: true, weekday: 'long',
      });
      return `Next window: Mon-Fri ${BUSINESS_HOURS.start}AM-${BUSINESS_HOURS.end > 12 ? BUSINESS_HOURS.end - 12 : BUSINESS_HOURS.end}PM (${timezone}). Current: ${formatter.format(now)}`;
    } catch {
      return 'Mon-Fri 9AM-5PM ET';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DNC (Do Not Call) MANAGEMENT
     ═══════════════════════════════════════════════════════════ */

  addToDnc(phone: string) {
    dncSet.add(this.normalizePhone(phone));
  }

  removeFromDnc(phone: string) {
    dncSet.delete(this.normalizePhone(phone));
  }

  isOnDnc(phone: string): boolean {
    return dncSet.has(this.normalizePhone(phone));
  }

  get dncCount(): number {
    return dncSet.size;
  }

  /* ═══════════════════════════════════════════════════════════
     OUTBOUND CALL — Production-grade
     ═══════════════════════════════════════════════════════════ */

  async initiateCall(contact: CRMContact, customFirstMessage?: string): Promise<VoiceCall> {
    if (!contact.clinic.phone) throw new Error('No phone number for this clinic');
    if (!this.isConfigured) throw new Error('Vapi not configured — check API keys');

    const phone = this.normalizePhone(contact.clinic.phone);

    // DNC check
    if (this.isOnDnc(phone)) {
      throw new Error(`${contact.clinic.name} is on the Do Not Call list`);
    }

    // Concurrency guard
    if (this.activeCallCount >= MAX_CONCURRENT_CALLS) {
      throw new Error(`Max concurrent calls (${MAX_CONCURRENT_CALLS}) reached — wait for active calls to finish`);
    }

    const dm = contact.decisionMaker;
    const clinic = contact.clinic;
    const dmName = dm ? `${dm.firstName} ${dm.lastName}`.trim() : '';

    const firstMessage = customFirstMessage || this.buildFirstMessage(contact);
    const systemPrompt = this.buildSystemPrompt(contact);

    const payload: VapiCallPayload = {
      assistantId: this.assistantId,
      phoneNumberId: this.phoneNumberId,
      customer: {
        number: phone,
        name: dmName || clinic.name,
      },
      assistantOverrides: {
        firstMessage,
        variableValues: {
          clinic_name: clinic.name,
          decision_maker: dmName || 'the practice owner or manager',
          city: clinic.address.city,
          state: clinic.address.state,
          services: clinic.services.slice(0, 3).join(', ') || "men's health services",
          market_income: `${(clinic.marketZone.medianIncome / 1000).toFixed(0)}k`,
          affluence_score: `${clinic.marketZone.affluenceScore}/10`,
        },
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 300,
          messages: [{ role: 'system', content: systemPrompt }],
        },
        silenceTimeoutSeconds: SILENCE_TIMEOUT_SECONDS,
        maxDurationSeconds: MAX_CALL_DURATION_SECONDS,
        endCallFunctionEnabled: true,
        endCallMessage: "Thank you for your time. Have a great day!",
        backgroundSound: 'office',
        hipaaEnabled: true,
        analysisPlan: {
          summaryPrompt: 'Summarize this sales call in 2-3 sentences. Include: who answered, their interest level, any next steps agreed upon, and any objections raised.',
          successEvaluationPrompt: 'Evaluate if this call was successful. A successful call means: the decision maker was reached AND they expressed interest OR agreed to a follow-up. A partially successful call means: reached a gatekeeper who took a message, or the DM asked for info to be sent. An unsuccessful call means: no answer, wrong number, or flat rejection.',
          successEvaluationRubric: 'NumericScale',
          structuredDataPrompt: 'Extract the following from the call transcript.',
          structuredDataSchema: {
            type: 'object',
            properties: {
              reached_decision_maker: { type: 'boolean', description: 'Whether the actual decision maker was reached' },
              interest_level: { type: 'string', enum: ['high', 'medium', 'low', 'none'], description: 'How interested the prospect seemed' },
              next_step: { type: 'string', enum: ['demo_scheduled', 'send_info', 'callback', 'none', 'dnc'], description: 'Agreed next step' },
              callback_time: { type: 'string', description: 'If callback requested, when (e.g. "Tuesday afternoon")' },
              objections: { type: 'array', items: { type: 'string' }, description: 'Any objections raised' },
              gatekeeper_name: { type: 'string', description: 'Name of gatekeeper if one was encountered' },
              email_captured: { type: 'string', description: 'Any email address mentioned during the call' },
              competitor_mentioned: { type: 'string', description: 'Any competitor names mentioned' },
            },
          },
        },
      },
    };

    this.activeCallCount++;
    try {
      const response = await this.apiCallWithRetry<VapiCallResponse>(
        () => axios.post(`${VAPI_BASE}/call/phone`, payload, { headers: this.headers })
      );

      return {
        id: response.data.id,
        contactId: contact.id,
        agentId: this.assistantId,
        startTime: new Date(response.data.createdAt),
        status: this.mapStatus(response.data.status),
        followUpRequired: false,
      };
    } catch (err) {
      this.activeCallCount = Math.max(0, this.activeCallCount - 1);
      throw err;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     MANUAL DIAL
     ═══════════════════════════════════════════════════════════ */

  async dialManualCall(phoneNumber: string, recipientName?: string): Promise<VoiceCall> {
    if (!this.isConfigured) throw new Error('Vapi not configured — check API keys');
    const phone = this.normalizePhone(phoneNumber);
    if (phone.length < 11) throw new Error('Invalid phone number — need at least 10 digits');
    if (this.isOnDnc(phone)) throw new Error('This number is on the Do Not Call list');

    const firstMessage = recipientName
      ? `Hi ${recipientName}, this is Sarah from Novalyte. How are you today?`
      : `Hi, this is Sarah from Novalyte. How are you today?`;

    const payload: VapiCallPayload = {
      assistantId: this.assistantId,
      phoneNumberId: this.phoneNumberId,
      customer: { number: phone, name: recipientName || 'Manual Dial' },
      assistantOverrides: {
        firstMessage,
        silenceTimeoutSeconds: SILENCE_TIMEOUT_SECONDS,
        maxDurationSeconds: MAX_CALL_DURATION_SECONDS,
        endCallFunctionEnabled: true,
        endCallMessage: "Thank you for your time. Have a great day!",
        hipaaEnabled: true,
      },
    };

    const response = await this.apiCallWithRetry<VapiCallResponse>(
      () => axios.post(`${VAPI_BASE}/call/phone`, payload, { headers: this.headers })
    );

    return {
      id: response.data.id,
      contactId: `manual-${Date.now()}`,
      agentId: this.assistantId,
      startTime: new Date(response.data.createdAt),
      status: this.mapStatus(response.data.status),
      followUpRequired: false,
    };
  }

  /* ═══════════════════════════════════════════════════════════
     TEST CONNECTION
     ═══════════════════════════════════════════════════════════ */

  async testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number; assistantName?: string; phoneNumbers?: number }> {
    const start = Date.now();
    try {
      const [assistant, phones] = await Promise.all([
        axios.get(`${VAPI_BASE}/assistant/${this.assistantId}`, { headers: this.headers }),
        axios.get(`${VAPI_BASE}/phone-number`, { headers: this.headers }).catch(() => ({ data: [] })),
      ]);
      const latency = Date.now() - start;
      return {
        ok: true,
        message: `Connected — assistant "${assistant.data.name || assistant.data.id}" ready`,
        latencyMs: latency,
        assistantName: assistant.data.name || assistant.data.id,
        phoneNumbers: Array.isArray(phones.data) ? phones.data.length : 0,
      };
    } catch (err: any) {
      const latency = Date.now() - start;
      const msg = err.response?.status === 401 ? 'Invalid API key — check VITE_VAPI_API_KEY' :
                  err.response?.status === 404 ? 'Assistant not found — check VITE_VAPI_ASSISTANT_ID' :
                  err.response?.status === 429 ? 'Rate limited — try again in a moment' :
                  err.message || 'Connection failed';
      return { ok: false, message: msg, latencyMs: latency };
    }
  }

  /* ═══════════════════════════════════════════════════════════
     CONFIG GETTERS
     ═══════════════════════════════════════════════════════════ */

  get config() {
    return {
      apiKey: this.apiKey ? `${this.apiKey.slice(0, 8)}...${this.apiKey.slice(-4)}` : '',
      apiKeySet: !!this.apiKey,
      phoneNumberId: this.phoneNumberId,
      phoneNumberIdSet: !!this.phoneNumberId,
      assistantId: this.assistantId,
      assistantIdSet: !!this.assistantId,
      phoneNumber: this.phoneNumber,
      phoneNumberSet: !!this.phoneNumber,
      maxConcurrent: MAX_CONCURRENT_CALLS,
      callSpacingMs: CALL_SPACING_MS,
      maxDurationSec: MAX_CALL_DURATION_SECONDS,
    };
  }

  /* ═══════════════════════════════════════════════════════════
     CALL STATUS & DETAILS
     ═══════════════════════════════════════════════════════════ */

  async getCall(callId: string): Promise<VapiCallResponse> {
    const { data } = await this.apiCallWithRetry<VapiCallResponse>(
      () => axios.get(`${VAPI_BASE}/call/${callId}`, { headers: this.headers })
    );
    return data;
  }

  async getCallStatus(callId: string): Promise<Partial<VoiceCall>> {
    const data = await this.getCall(callId);
    const status = this.mapStatus(data.status);

    // Decrement active count when call ends
    if (status === 'completed' || status === 'failed' || status === 'no_answer') {
      this.activeCallCount = Math.max(0, this.activeCallCount - 1);
    }

    // Auto-add to DNC if prospect said "don't call" / "remove me"
    if (data.analysis?.structuredData?.next_step === 'dnc' && data.customer?.number) {
      this.addToDnc(data.customer.number);
    }

    return {
      status,
      endTime: data.endedAt ? new Date(data.endedAt) : undefined,
      transcript: data.transcript,
      recording_url: data.recordingUrl,
      notes: data.analysis?.summary || data.summary,
      duration: data.startedAt && data.endedAt
        ? Math.round((new Date(data.endedAt).getTime() - new Date(data.startedAt).getTime()) / 1000)
        : undefined,
    };
  }

  async listCalls(limit = 50): Promise<VapiCallResponse[]> {
    const { data } = await this.apiCallWithRetry<VapiCallResponse[]>(
      () => axios.get(`${VAPI_BASE}/call?limit=${limit}`, { headers: this.headers })
    );
    return data;
  }

  /* ═══════════════════════════════════════════════════════════
     CALL OUTCOME ANALYSIS — Uses Vapi structured data first,
     falls back to keyword analysis
     ═══════════════════════════════════════════════════════════ */

  analyzeCallOutcome(transcript: string, vapiAnalysis?: VapiCallResponse['analysis']): {
    outcome: CallOutcome;
    followUpRequired: boolean;
    sentiment: 'positive' | 'neutral' | 'negative';
    summary: string;
    structuredData?: Record<string, any>;
  } {
    // Prefer Vapi's AI-powered structured analysis when available
    if (vapiAnalysis?.structuredData) {
      const sd = vapiAnalysis.structuredData;
      const outcome = this.mapStructuredOutcome(sd);
      const sentiment = this.mapInterestToSentiment(sd.interest_level);
      return {
        outcome,
        followUpRequired: outcome !== 'not_interested' && outcome !== 'wrong_contact',
        sentiment,
        summary: vapiAnalysis.summary || 'Call completed — see structured data',
        structuredData: sd,
      };
    }

    // Fallback: keyword-based analysis
    return this.analyzeTranscriptKeywords(transcript, vapiAnalysis?.summary);
  }

  private mapStructuredOutcome(sd: Record<string, any>): CallOutcome {
    if (sd.next_step === 'demo_scheduled') return 'schedule_demo';
    if (sd.next_step === 'send_info') return 'send_info';
    if (sd.next_step === 'callback') return 'callback_requested';
    if (sd.next_step === 'dnc') return 'not_interested';
    if (sd.interest_level === 'high') return 'interested';
    if (sd.interest_level === 'medium') return 'send_info';
    if (sd.interest_level === 'none' || sd.interest_level === 'low') {
      if (!sd.reached_decision_maker) return 'gatekeeper_block';
      return 'not_interested';
    }
    return 'callback_requested';
  }

  private mapInterestToSentiment(level?: string): 'positive' | 'neutral' | 'negative' {
    if (level === 'high' || level === 'medium') return 'positive';
    if (level === 'low') return 'neutral';
    if (level === 'none') return 'negative';
    return 'neutral';
  }

  private analyzeTranscriptKeywords(transcript: string, summary?: string): {
    outcome: CallOutcome;
    followUpRequired: boolean;
    sentiment: 'positive' | 'neutral' | 'negative';
    summary: string;
  } {
    const t = (transcript || '').toLowerCase();

    // Positive signals
    if (t.includes('schedule') || t.includes('demo') || t.includes('meeting') || t.includes('appointment') || t.includes('calendar')) {
      return { outcome: 'schedule_demo', followUpRequired: true, sentiment: 'positive', summary: summary || 'Prospect agreed to schedule a meeting/demo' };
    }
    if ((t.includes('send') || t.includes('email')) && (t.includes('info') || t.includes('details') || t.includes('brochure') || t.includes('case study'))) {
      return { outcome: 'send_info', followUpRequired: true, sentiment: 'positive', summary: summary || 'Prospect requested more information via email' };
    }
    if (/\binterested\b/.test(t) && !/not interested|aren't interested|not really interested/.test(t)) {
      return { outcome: 'interested', followUpRequired: true, sentiment: 'positive', summary: summary || 'Prospect expressed interest' };
    }

    // Negative signals
    if (/not interested|no thank|don't call|remove|stop calling|do not call|take me off/.test(t)) {
      return { outcome: 'not_interested', followUpRequired: false, sentiment: 'negative', summary: summary || 'Prospect declined — not interested' };
    }
    if (/wrong number|wrong person|no one by that name|doesn't work here/.test(t)) {
      return { outcome: 'wrong_contact', followUpRequired: false, sentiment: 'neutral', summary: summary || 'Wrong number or contact not found' };
    }

    // Neutral signals
    if (/call back|callback|call again|try again|busy right now|in a meeting|not available/.test(t)) {
      return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: summary || 'Prospect requested a callback' };
    }
    if (/voicemail|leave a message|beep|after the tone/.test(t)) {
      return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: summary || 'Reached voicemail — follow up needed' };
    }
    if (/receptionist|front desk|hold|transfer|let me check|one moment/.test(t)) {
      return { outcome: 'gatekeeper_block', followUpRequired: true, sentiment: 'neutral', summary: summary || 'Reached gatekeeper — try again for decision maker' };
    }

    return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: summary || 'Call completed — review transcript for details' };
  }

  /* ═══════════════════════════════════════════════════════════
     SCRIPT BUILDERS — Production conversation design
     ═══════════════════════════════════════════════════════════ */

  buildFirstMessage(contact: CRMContact): string {
    const dm = contact.decisionMaker;
    const clinic = contact.clinic;
    const topService = clinic.services[0] || "men's health";
    const city = clinic.address.city;

    // Personalized opener when we have the decision maker
    if (dm && dm.firstName) {
      return `Hi, is this ${dm.firstName}? ... Great, this is Sarah from Novalyte. I'm reaching out because I noticed ${clinic.name} offers ${topService} services in ${city}, and we've been helping similar clinics attract more high-intent patients. Do you have just two minutes?`;
    }

    // Gatekeeper path — ask for the right person
    return `Hi, this is Sarah from Novalyte calling for ${clinic.name}. I have some market data about patient demand for ${topService} in ${city} that I think the practice owner or manager would find valuable. Could I speak with them briefly?`;
  }

  buildSystemPrompt(contact: CRMContact): string {
    const c = contact.clinic;
    const dm = contact.decisionMaker;
    const market = c.marketZone;
    const services = c.services.slice(0, 5).join(', ') || "men's health services";
    const topKeyword = contact.keywordMatches?.[0];
    const hasBeenContacted = contact.activities?.some(a => a.type === 'call_made' || a.type === 'email_sent');

    return `You are Sarah, a warm and professional business development representative for Novalyte AI. You specialize in helping men's health clinics grow their patient base through data-driven marketing.

CURRENT CALL TARGET:
- Clinic: ${c.name}
- Location: ${c.address.city}, ${c.address.state}
- Services: ${services}
- Rating: ${c.rating ? `${Number(c.rating).toFixed(1)}/5 (${c.reviewCount || 0} reviews)` : 'Not rated yet'}
- Market Affluence: ${market.affluenceScore}/10 (Median Income: $${(market.medianIncome / 1000).toFixed(0)}k)
${dm ? `- Decision Maker: ${dm.firstName} ${dm.lastName}, ${dm.role.replace(/_/g, ' ')}` : '- Decision Maker: Unknown — you need to identify them'}
${topKeyword ? `- Market Insight: "${topKeyword.keyword}" searches are up ${topKeyword.growthRate}% in their area` : ''}
${hasBeenContacted ? '- NOTE: This clinic has been contacted before. Reference that you spoke/emailed previously.' : ''}

CONVERSATION FLOW:
1. OPENING (10 seconds): Introduce yourself, confirm you're speaking with the right person
2. HOOK (15 seconds): Share ONE specific data point about their market — keyword growth, patient demand, or competitor activity
3. VALUE PROP (20 seconds): Briefly explain how Novalyte helps clinics capture this demand
4. ASK (10 seconds): Request a 15-minute follow-up call or offer to send a market report
5. CLOSE: Confirm next steps, thank them for their time

GATEKEEPER STRATEGY:
- Be polite and professional: "I have some market research about patient demand in ${c.address.city} that I think [owner/manager] would find valuable"
- If asked what it's about: "We help men's health clinics grow their patient base. I have some data specific to their market I'd like to share"
- If they offer to take a message: Accept gracefully, leave your name (Sarah), company (Novalyte), and callback number
- Ask for the decision maker's name and best time to reach them

OBJECTION HANDLING:
- "Not interested": "I completely understand. Would it be helpful if I just emailed over a quick market snapshot for ${c.address.city}? No commitment at all."
- "We're too busy": "I totally get it. When would be a better time for a 2-minute call? I can work around your schedule."
- "We already have a marketing company": "That's great! We actually complement existing marketing — we focus specifically on patient intent data. Happy to show how in a quick call."
- "How much does it cost?": "Great question — it really depends on your goals and market. That's exactly what I'd love to cover in a quick 15-minute call. Would [suggest a time] work?"
- "Send me an email": "Absolutely! What's the best email to reach you at?" (capture the email)
- "Don't call again": "I apologize for the inconvenience. I'll remove you from our list right away. Have a great day."

CRITICAL RULES:
- Keep responses SHORT — 1-2 sentences max. This is a phone call, not a presentation.
- Sound natural and conversational, never robotic or scripted
- Listen actively — acknowledge what they say before responding
- NEVER be pushy. If they say no twice, thank them and end the call gracefully.
- If they say "don't call" or "remove me", immediately agree and end the call politely
- Use natural filler words occasionally ("sure", "absolutely", "of course")
- Mirror their energy — if they're rushed, be concise; if they're chatty, be warmer
- NEVER make up statistics or claims. Only reference the data points provided above.
- Maximum call target: 2-3 minutes. If you've been talking for 2+ minutes, start wrapping up.
- If you capture an email address, repeat it back to confirm spelling`;
  }

  /* ═══════════════════════════════════════════════════════════
     BATCH CALLING — Rate-limited, business-hours aware
     ═══════════════════════════════════════════════════════════ */

  validateBatchReady(contacts: CRMContact[]): {
    ready: CRMContact[];
    skipped: { contact: CRMContact; reason: string }[];
    warnings: string[];
  } {
    const ready: CRMContact[] = [];
    const skipped: { contact: CRMContact; reason: string }[] = [];
    const warnings: string[] = [];

    if (!this.isConfigured) {
      warnings.push('Vapi is not configured — check API keys in settings');
    }

    if (!this.isWithinBusinessHours()) {
      warnings.push(`Outside business hours. ${this.getNextBusinessWindow()}`);
    }

    for (const c of contacts) {
      if (!c.clinic.phone) {
        skipped.push({ contact: c, reason: 'No phone number' });
        continue;
      }
      const phone = this.normalizePhone(c.clinic.phone);
      if (this.isOnDnc(phone)) {
        skipped.push({ contact: c, reason: 'On Do Not Call list' });
        continue;
      }
      if (c.status === 'not_interested') {
        skipped.push({ contact: c, reason: 'Marked as not interested' });
        continue;
      }
      if (c.status === 'wrong_number') {
        skipped.push({ contact: c, reason: 'Wrong number' });
        continue;
      }
      // Check if called in last 24 hours
      if (c.lastContactedAt) {
        const hoursSince = (Date.now() - new Date(c.lastContactedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          skipped.push({ contact: c, reason: `Called ${Math.round(hoursSince)}h ago — wait 24h` });
          continue;
        }
      }
      ready.push(c);
    }

    return { ready, skipped, warnings };
  }

  get batchConfig() {
    return {
      maxConcurrent: MAX_CONCURRENT_CALLS,
      callSpacingMs: CALL_SPACING_MS,
      maxDurationSec: MAX_CALL_DURATION_SECONDS,
      businessHours: BUSINESS_HOURS,
      isBusinessHours: this.isWithinBusinessHours(),
      nextWindow: this.getNextBusinessWindow(),
      activeCalls: this.activeCallCount,
      dncCount: this.dncCount,
    };
  }

  /* ═══════════════════════════════════════════════════════════
     API CALL WITH RETRY
     ═══════════════════════════════════════════════════════════ */

  private async apiCallWithRetry<T>(fn: () => Promise<{ data: T }>, retries = MAX_RETRIES): Promise<{ data: T }> {
    let lastError: any;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const status = (err as AxiosError)?.response?.status;

        // Don't retry client errors (except 429 rate limit)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw this.formatApiError(err);
        }

        // Rate limited — wait longer
        if (status === 429) {
          const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5');
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Server error or network error — retry with backoff
        if (i < retries) {
          await this.sleep(RETRY_DELAY_MS * Math.pow(2, i));
        }
      }
    }
    throw this.formatApiError(lastError);
  }

  private formatApiError(err: any): Error {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const body = err.response?.data;
      const msg = typeof body === 'object' ? (body?.message || body?.error || JSON.stringify(body)) : body;
      if (status === 401) return new Error('Vapi authentication failed — check your API key');
      if (status === 402) return new Error('Vapi billing issue — check your Vapi account balance');
      if (status === 404) return new Error('Vapi resource not found — check assistant/phone IDs');
      if (status === 429) return new Error('Vapi rate limit hit — slow down batch calling');
      return new Error(`Vapi API error (${status}): ${msg}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /* ═══════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════ */

  normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(cleaned)) cleaned = `+1${cleaned}`;
    if (/^1\d{10}$/.test(cleaned)) cleaned = `+${cleaned}`;
    if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;
    return cleaned;
  }

  private mapStatus(status: string): CallStatus {
    const map: Record<string, CallStatus> = {
      queued: 'queued',
      ringing: 'ringing',
      'in-progress': 'in_progress',
      forwarding: 'in_progress',
      ended: 'completed',
      completed: 'completed',
      failed: 'failed',
      'no-answer': 'no_answer',
      busy: 'no_answer',
    };
    return map[status] || 'queued';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const voiceAgentService = new VoiceAgentService();
