import axios from 'axios';
import { CRMContact, VoiceCall, CallStatus, CallOutcome } from '../types';

/* ─── Vapi API Types ─── */

interface VapiCallPayload {
  assistantId: string;
  phoneNumberId: string;
  customer: { number: string; name?: string };
  assistantOverrides?: {
    firstMessage?: string;
    variableValues?: Record<string, string>;
    model?: {
      provider: string;
      model: string;
      messages: { role: string; content: string }[];
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

export class VoiceAgentService {
  private apiKey: string;
  private phoneNumberId: string;
  private assistantId: string;
  private phoneNumber: string;

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

  /* ─── Outbound Call ─── */

  async initiateCall(contact: CRMContact, customFirstMessage?: string): Promise<VoiceCall> {
    if (!contact.clinic.phone) throw new Error('No phone number for this clinic');
    if (!this.isConfigured) throw new Error('Vapi not configured — check API keys');

    // Clean phone number — must be E.164
    const phone = this.normalizePhone(contact.clinic.phone);
    const dm = contact.decisionMaker;
    const clinicName = contact.clinic.name;
    const city = contact.clinic.address.city;
    const services = contact.clinic.services.slice(0, 3).join(', ') || "men's health services";
    const dmName = dm ? `${dm.firstName} ${dm.lastName}` : '';
    const market = contact.clinic.marketZone;

    // Build context-aware first message
    const firstMessage = customFirstMessage || this.buildFirstMessage(contact);

    // Build system prompt with full clinic context
    const systemPrompt = this.buildSystemPrompt(contact);

    const payload: VapiCallPayload = {
      assistantId: this.assistantId,
      phoneNumberId: this.phoneNumberId,
      customer: {
        number: phone,
        name: dmName || clinicName,
      },
      assistantOverrides: {
        firstMessage,
        variableValues: {
          clinic_name: clinicName,
          decision_maker: dmName || 'the practice owner or manager',
          city,
          services,
          market_income: `${(market.medianIncome / 1000).toFixed(0)}k`,
          affluence_score: `${market.affluenceScore}/10`,
        },
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }],
        },
      },
    };

    const response = await axios.post<VapiCallResponse>(
      `${VAPI_BASE}/call/phone`,
      payload,
      { headers: this.headers }
    );

    return {
      id: response.data.id,
      contactId: contact.id,
      agentId: this.assistantId,
      startTime: new Date(response.data.createdAt),
      status: this.mapStatus(response.data.status),
      followUpRequired: false,
    };
  }

  /* ─── Manual Dial (any number) ─── */

  async dialManualCall(phoneNumber: string, recipientName?: string): Promise<VoiceCall> {
    if (!this.isConfigured) throw new Error('Vapi not configured — check API keys');
    const phone = this.normalizePhone(phoneNumber);
    if (phone.length < 10) throw new Error('Invalid phone number');

    const firstMessage = recipientName
      ? `Hi ${recipientName}, this is Sarah from Novalyte. How are you today?`
      : `Hi, this is Sarah from Novalyte. How are you today?`;

    const payload: VapiCallPayload = {
      assistantId: this.assistantId,
      phoneNumberId: this.phoneNumberId,
      customer: { number: phone, name: recipientName || 'Manual Dial' },
      assistantOverrides: { firstMessage },
    };

    const response = await axios.post<VapiCallResponse>(
      `${VAPI_BASE}/call/phone`,
      payload,
      { headers: this.headers }
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

  /* ─── Test Connection ─── */

  async testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number; assistantName?: string }> {
    const start = Date.now();
    try {
      const { data } = await axios.get(`${VAPI_BASE}/assistant/${this.assistantId}`, { headers: this.headers });
      const latency = Date.now() - start;
      return { ok: true, message: 'Connected to Vapi API', latencyMs: latency, assistantName: data.name || data.id };
    } catch (err: any) {
      const latency = Date.now() - start;
      const msg = err.response?.status === 401 ? 'Invalid API key' :
                  err.response?.status === 404 ? 'Assistant not found' :
                  err.message || 'Connection failed';
      return { ok: false, message: msg, latencyMs: latency };
    }
  }

  /* ─── Config Getters (for UI display) ─── */

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
    };
  }

  /* ─── Get Call Details ─── */

  async getCall(callId: string): Promise<VapiCallResponse> {
    const { data } = await axios.get<VapiCallResponse>(
      `${VAPI_BASE}/call/${callId}`,
      { headers: this.headers }
    );
    return data;
  }

  /* ─── Poll Call Status ─── */

  async getCallStatus(callId: string): Promise<Partial<VoiceCall>> {
    const data = await this.getCall(callId);
    return {
      status: this.mapStatus(data.status),
      endTime: data.endedAt ? new Date(data.endedAt) : undefined,
      transcript: data.transcript,
      recording_url: data.recordingUrl,
      notes: data.analysis?.summary || data.summary,
    };
  }

  /* ─── List Recent Calls ─── */

  async listCalls(limit = 50): Promise<VapiCallResponse[]> {
    const { data } = await axios.get<VapiCallResponse[]>(
      `${VAPI_BASE}/call?limit=${limit}`,
      { headers: this.headers }
    );
    return data;
  }

  /* ─── Analyze Transcript ─── */

  analyzeCallOutcome(transcript: string): {
    outcome: CallOutcome;
    followUpRequired: boolean;
    sentiment: 'positive' | 'neutral' | 'negative';
    summary: string;
  } {
    const t = transcript.toLowerCase();

    // Positive signals
    if (t.includes('schedule') || t.includes('demo') || t.includes('meeting') || t.includes('appointment')) {
      return { outcome: 'schedule_demo', followUpRequired: true, sentiment: 'positive', summary: 'Prospect agreed to schedule a meeting/demo' };
    }
    if ((t.includes('send') || t.includes('email')) && (t.includes('info') || t.includes('details') || t.includes('brochure'))) {
      return { outcome: 'send_info', followUpRequired: true, sentiment: 'positive', summary: 'Prospect requested more information via email' };
    }
    if (t.includes('interested') && !t.includes('not interested') && !t.includes("aren't interested") && !t.includes("not really interested")) {
      return { outcome: 'interested', followUpRequired: true, sentiment: 'positive', summary: 'Prospect expressed interest' };
    }

    // Neutral signals
    if (t.includes('call back') || t.includes('callback') || t.includes('call again') || t.includes('try again') || t.includes('busy right now')) {
      return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: 'Prospect requested a callback at a later time' };
    }
    if (t.includes('voicemail') || t.includes('leave a message') || t.includes('not available')) {
      return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: 'Reached voicemail — follow up needed' };
    }

    // Negative signals
    if (t.includes('not interested') || t.includes('no thank') || t.includes('don\'t call') || t.includes('remove') || t.includes('stop calling')) {
      return { outcome: 'not_interested', followUpRequired: false, sentiment: 'negative', summary: 'Prospect declined — not interested' };
    }
    if (t.includes('wrong number') || t.includes('wrong person') || t.includes('no one by that name')) {
      return { outcome: 'wrong_contact', followUpRequired: false, sentiment: 'neutral', summary: 'Wrong number or contact not found' };
    }
    if (t.includes('gatekeeper') || t.includes('receptionist') || t.includes('not available') || t.includes('in a meeting')) {
      return { outcome: 'gatekeeper_block', followUpRequired: true, sentiment: 'neutral', summary: 'Blocked by gatekeeper — try again later' };
    }

    return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral', summary: 'Call completed — review transcript for details' };
  }

  /* ─── Script Builders ─── */

  buildFirstMessage(contact: CRMContact): string {
    const dm = contact.decisionMaker;
    const clinic = contact.clinic;
    const services = clinic.services.slice(0, 2).join(' and ') || "men's health services";
    const city = clinic.address.city;

    if (dm) {
      return `Hi ${dm.firstName}, this is Sarah from Novalyte. I'm reaching out because I noticed ${clinic.name} offers ${services} in ${city}, and we've been helping clinics like yours capture more high-intent patients. Do you have a quick minute?`;
    }
    return `Hi, this is Sarah from Novalyte calling for ${clinic.name}. We help men's health clinics in ${city} grow their patient base through data-driven marketing. Could I speak with the practice owner or manager?`;
  }

  buildSystemPrompt(contact: CRMContact): string {
    const c = contact.clinic;
    const dm = contact.decisionMaker;
    const market = c.marketZone;
    const services = c.services.join(', ') || "men's health services";
    const topKeyword = contact.keywordMatches?.[0];

    return `You are Sarah, a professional and friendly sales representative for Novalyte AI. You are calling ${c.name}, a ${c.type.replace(/_/g, ' ')} in ${c.address.city}, ${c.address.state}.

CLINIC CONTEXT:
- Name: ${c.name}
- Services: ${services}
- Rating: ${c.rating ? `${c.rating}/5 (${c.reviewCount || 0} reviews)` : 'Unknown'}
- Market: ${market.city}, ${market.state} (Affluence: ${market.affluenceScore}/10, Median Income: $${(market.medianIncome / 1000).toFixed(0)}k)
${dm ? `- Decision Maker: ${dm.firstName} ${dm.lastName} (${dm.role.replace(/_/g, ' ')})` : '- Decision Maker: Unknown — ask for the owner or practice manager'}
${topKeyword ? `- Trending keyword: "${topKeyword.keyword}" growing ${topKeyword.growthRate}% in their area` : ''}

YOUR GOAL:
1. Introduce yourself and Novalyte briefly
2. Mention a specific data point about their market (keyword growth, affluence, demand)
3. Ask if they'd be open to a 15-minute call to discuss how you can help
4. If interested: schedule a follow-up or offer to send a market report
5. If not interested: thank them and offer to send a case study

RULES:
- Be warm, professional, and concise — respect their time
- Never be pushy or aggressive
- If you reach a receptionist/gatekeeper, ask politely for the decision maker
- If they say they're busy, offer to call back at a better time
- Keep responses short — this is a phone call, not an email
- Use natural conversational language, not scripted-sounding phrases
- If asked about pricing, say you'd love to discuss that on a dedicated call
- Maximum call duration target: 2-3 minutes for initial outreach`;
  }

  /* ─── Helpers ─── */

  private normalizePhone(phone: string): string {
    // Strip everything except digits and leading +
    let cleaned = phone.replace(/[^\d+]/g, '');
    // If it's 10 digits (US), prepend +1
    if (/^\d{10}$/.test(cleaned)) cleaned = `+1${cleaned}`;
    // If it starts with 1 and is 11 digits, prepend +
    if (/^1\d{10}$/.test(cleaned)) cleaned = `+${cleaned}`;
    // Ensure it starts with +
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
}

export const voiceAgentService = new VoiceAgentService();
