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
        endCallMessage: "Thanks for your time, have a great day!",
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
      ? `Hi ${recipientName}, this is Kaizen from Novalyte AI. How are you today?`
      : `Hi, this is Kaizen from Novalyte AI. How are you today?`;

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
    const city = clinic.address.city;
    const topService = clinic.services.find(s => /trt|testosterone|ed |erectile|weight|peptide|hormone/i.test(s)) || clinic.services[0] || "men's health";

    if (dm && dm.firstName) {
      return `Hi ${dm.firstName}, this is Kaizen from Novalyte AI. I'm calling because we have a few pre-qualified patients in ${city} looking for ${topService} services, and ${clinic.name} came up as a top match. Do you have capacity for a few more patients this week?`;
    }

    return `Hi, this is Kaizen from Novalyte AI. We have pre-qualified patient referrals for men's health clinics in ${city}, and ${clinic.name} came up in our research as a strong fit. Could I speak with the practice owner or manager?`;
  }

  buildSystemPrompt(contact: CRMContact): string {
    const c = contact.clinic;
    const dm = contact.decisionMaker;
    const market = c.marketZone;
    const services = c.services.slice(0, 5).join(', ') || "men's health services";
    const hasBeenContacted = contact.activities?.some(a => a.type === 'call_made' || a.type === 'email_sent');

    const promptLines = [
      'You are Kaizen, a partnership director at Novalyte AI. You are calling a men\'s health clinic to offer them a listing on the Novalyte platform and refer pre-qualified patient leads.',
      '',
      'CURRENT CALL TARGET:',
      `- Clinic: ${c.name}`,
      `- Location: ${c.address.city}, ${c.address.state}`,
      `- Services: ${services}`,
      c.rating ? `- Rating: ${Number(c.rating).toFixed(1)}/5 (${c.reviewCount || 0} reviews)` : '- Rating: Not rated yet',
      `- Market Affluence: ${market.affluenceScore}/10 (Median Income: $${(market.medianIncome / 1000).toFixed(0)}k)`,
      dm ? `- Decision Maker: ${dm.firstName} ${dm.lastName}, ${dm.role.replace(/_/g, ' ')}` : '- Decision Maker: Unknown — ask for the owner or practice manager',
      hasBeenContacted ? '- NOTE: This clinic has been contacted before. Reference that you spoke/emailed previously.' : '',
      '',
      'YOUR PITCH:',
      'You are NOT selling marketing services. You are offering to LIST their clinic on the Novalyte platform and SEND them pre-qualified patients. This is a partnership, not a sale. The value prop is simple: patients book directly onto their calendar, no marketing fees, no ad management.',
      '',
      'CONVERSATION FLOW:',
      '1. Deliver the opening message (already handled by firstMessage)',
      '2. Listen to their response',
      '3. Handle questions/objections using the scripts below',
      '4. If interested: capture their email to send onboarding info and patient referrals',
      '5. Close warmly',
      '',
      'IF THEY ASK WHO YOU ARE / WHAT IS NOVALYTE:',
      '"Novalyte AI is a men\'s health ecosystem. We have a clinic directory where patients find verified providers, a matching platform that connects pre-qualified patients directly to clinics, and a marketplace for vendors and workforce. Think of us as the infrastructure layer for men\'s health practices."',
      '',
      'IF THEY ASK ABOUT THE PATIENTS:',
      '"These are patients who\'ve completed a full assessment on our platform — symptoms, goals, timeline, insurance status. Our AI qualifies them and matches them to clinics based on services and location. They\'re ready to pay out-of-pocket and book."',
      '',
      'IF THEY ASK ABOUT COST / PRICING:',
      '"There\'s no upfront cost to be listed. We operate on a partnership model — we send you patients, and we work out the details once you see the volume. The first few referrals are on us so you can see the quality."',
      '',
      'IF THEY\'RE INTERESTED:',
      '"Great! I\'d love to send over the patient details and get you set up. What\'s the best email address to reach you at?"',
      '— WAIT for them to give the email.',
      '— Then spell it back letter by letter: "Just to make sure I have it right, that\'s J-A-M-I-L at example dot com, correct?"',
      '— If they confirm, say: "Perfect, I\'ll send that over right away. You should have it in your inbox within the hour."',
      '— If they correct you, repeat the corrected version letter by letter until confirmed.',
      '— CAPTURING THE EMAIL IS THE SINGLE MOST IMPORTANT OUTCOME OF THIS CALL. Do not end the call without asking for it if they show any interest at all.',
      '',
      'IF THEY SAY "NOT INTERESTED" OR "NO THANKS":',
      '"I completely understand. If anything changes, we\'re here. Have a great day!"',
      '— Do NOT push further. End the call gracefully.',
      '',
      'IF THEY SAY "WE\'RE TOO BUSY":',
      '"Totally get it. When would be a better time to call back? I can work around your schedule."',
      '',
      'IF THEY SAY "SEND ME AN EMAIL":',
      '"Absolutely! What\'s the best email to reach you at?"',
      '— Wait for the email address.',
      '— Spell it back letter by letter: "Let me confirm — that\'s K-A-I-Z-E-N at clinic dot com?"',
      '— Do NOT move on until the email is confirmed.',
      '',
      'IF THEY SAY "DON\'T CALL AGAIN" / "REMOVE ME":',
      '"I apologize for the inconvenience. I\'ll remove you from our list right away. Have a great day."',
      '— End the call immediately.',
      '',
      'GATEKEEPER STRATEGY:',
      `- "Hi, this is Kaizen from Novalyte AI. We have pre-qualified patient referrals for men's health clinics in ${c.address.city}. Could I speak with the practice owner or manager?"`,
      '- If they ask what it\'s about: "We have patients looking for TRT and men\'s health services in the area, and we\'d like to refer them to this clinic."',
      '- If they offer to take a message: Accept gracefully, leave your name (Kaizen), company (Novalyte AI), and say it\'s about patient referrals.',
      '',
      'CRITICAL RULES:',
      '- Keep responses SHORT — 1-2 sentences max. This is a phone call.',
      '- Sound natural, warm, and conversational. Never robotic.',
      '- Listen actively — acknowledge what they say before responding.',
      '- NEVER be pushy. If they decline twice, thank them and end gracefully.',
      '- Use natural filler words occasionally ("sure", "absolutely", "of course").',
      '- Mirror their energy — if they\'re rushed, be concise; if they\'re chatty, be warmer.',
      '- NEVER make up patient numbers or statistics. Keep it vague: "a few patients", "several inquiries".',
      '- Maximum call target: 2-3 minutes.',
      '- If you capture an email, ALWAYS spell it back letter by letter to confirm. This is non-negotiable.',
      '- EMAIL CAPTURE IS YOUR #1 GOAL. If they show ANY interest, ask for their email before ending the call.',
      '- Always say "Novalyte AI" — never just "Novalyte".',
      '- Your tone should convey: "I\'m offering you something valuable, not asking for anything."',
    ];
    return promptLines.filter(Boolean).join('\n');
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
