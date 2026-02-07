import axios from 'axios';
import { CRMContact, VoiceCall, CallStatus, CallOutcome } from '../types';

interface VapiCallResponse {
  id: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  transcript?: string;
  recordingUrl?: string;
}

interface BlandAICallResponse {
  call_id: string;
  status: string;
  call_length?: number;
  transcript?: string;
  recording_url?: string;
}

// Default script template for men's health clinic outreach
const DEFAULT_SCRIPT = `
Hi, this is {{agent_name}} calling from Novalyte AI. 

I'm reaching out to {{clinic_name}} because we've noticed strong growth in demand for {{service_area}} services in your area.

We work with men's health clinics to help them grow their patient base through intelligent marketing and lead generation.

Would {{decision_maker_name}} be available for a brief conversation about how we can help bring more patients to your clinic?

[If available] Great! I'd love to schedule a quick 15-minute call to discuss how we've helped similar clinics increase their patient volume by 30-40%.

[If not available] No problem. When would be a good time to reach them? I can also send over some information via email.

[If not interested] I understand. Before I go, would it be helpful if I sent over a case study showing results from a similar clinic in your area?

Thank you for your time!
`;

export class VoiceAgentService {
  private vapiApiKey: string;
  private blandApiKey: string;
  private agentId: string;

  constructor(vapiKey?: string, blandKey?: string) {
    this.vapiApiKey = vapiKey || import.meta.env.VITE_VAPI_API_KEY || '';
    this.blandApiKey = blandKey || import.meta.env.VITE_BLAND_AI_API_KEY || '';
    this.agentId = 'novalyte-abm-agent';
  }

  /**
   * Initiate a call to a CRM contact using Vapi
   */
  async initiateCallVapi(contact: CRMContact, script?: string): Promise<VoiceCall> {
    const callScript = script || this.buildScript(contact);

    try {
      const response = await axios.post<VapiCallResponse>(
        'https://api.vapi.ai/call/phone',
        {
          assistantId: this.agentId,
          phoneNumberId: import.meta.env.VITE_VAPI_PHONE_NUMBER_ID,
          customer: {
            number: contact.clinic.phone,
            name: contact.decisionMaker 
              ? `${contact.decisionMaker.firstName} ${contact.decisionMaker.lastName}`
              : contact.clinic.name,
          },
          assistantOverrides: {
            firstMessage: callScript,
            model: {
              provider: 'openai',
              model: 'gpt-4',
              messages: [
                {
                  role: 'system',
                  content: `You are a professional sales representative for Novalyte AI, calling men's health clinics. Be friendly, professional, and concise. Your goal is to schedule a demo or send information. The clinic is ${contact.clinic.name} in ${contact.clinic.address.city}.`,
                },
              ],
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.vapiApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        id: response.data.id,
        contactId: contact.id,
        agentId: this.agentId,
        startTime: new Date(response.data.createdAt),
        status: this.mapVapiStatus(response.data.status),
        followUpRequired: false,
      };
    } catch (error) {
      console.error(`Error initiating Vapi call to ${contact.clinic.name}:`, error);
      throw error;
    }
  }

  /**
   * Initiate a call using Bland AI
   */
  async initiateCallBland(contact: CRMContact, script?: string): Promise<VoiceCall> {
    const callScript = script || this.buildScript(contact);

    try {
      const response = await axios.post<BlandAICallResponse>(
        'https://api.bland.ai/v1/calls',
        {
          phone_number: contact.clinic.phone,
          task: callScript,
          voice: 'maya', // Professional female voice
          reduce_latency: true,
          wait_for_greeting: true,
          record: true,
          max_duration: 300, // 5 minutes max
          metadata: {
            contact_id: contact.id,
            clinic_name: contact.clinic.name,
          },
        },
        {
          headers: {
            Authorization: this.blandApiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      return {
        id: response.data.call_id,
        contactId: contact.id,
        agentId: this.agentId,
        startTime: new Date(),
        status: 'queued',
        followUpRequired: false,
      };
    } catch (error) {
      console.error(`Error initiating Bland call to ${contact.clinic.name}:`, error);
      throw error;
    }
  }

  /**
   * Get call status and details
   */
  async getCallStatus(callId: string, provider: 'vapi' | 'bland' = 'vapi'): Promise<Partial<VoiceCall>> {
    try {
      if (provider === 'vapi') {
        const response = await axios.get<VapiCallResponse>(
          `https://api.vapi.ai/call/${callId}`,
          {
            headers: {
              Authorization: `Bearer ${this.vapiApiKey}`,
            },
          }
        );

        return {
          status: this.mapVapiStatus(response.data.status),
          endTime: response.data.endedAt ? new Date(response.data.endedAt) : undefined,
          transcript: response.data.transcript,
          recording_url: response.data.recordingUrl,
        };
      } else {
        const response = await axios.get<BlandAICallResponse>(
          `https://api.bland.ai/v1/calls/${callId}`,
          {
            headers: {
              Authorization: this.blandApiKey,
            },
          }
        );

        return {
          status: this.mapBlandStatus(response.data.status),
          duration: response.data.call_length,
          transcript: response.data.transcript,
          recording_url: response.data.recording_url,
        };
      }
    } catch (error) {
      console.error(`Error getting call status for ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Analyze call transcript to determine outcome
   */
  analyzeCallOutcome(transcript: string): { outcome: CallOutcome; followUpRequired: boolean; sentiment: 'positive' | 'neutral' | 'negative' } {
    const transcriptLower = transcript.toLowerCase();

    // Check for positive outcomes
    if (transcriptLower.includes('schedule') || transcriptLower.includes('demo') || transcriptLower.includes('meeting')) {
      return { outcome: 'schedule_demo', followUpRequired: true, sentiment: 'positive' };
    }
    if (transcriptLower.includes('send') && (transcriptLower.includes('info') || transcriptLower.includes('email'))) {
      return { outcome: 'send_info', followUpRequired: true, sentiment: 'positive' };
    }
    if (transcriptLower.includes('interested') && !transcriptLower.includes('not interested')) {
      return { outcome: 'interested', followUpRequired: true, sentiment: 'positive' };
    }
    if (transcriptLower.includes('call back') || transcriptLower.includes('callback')) {
      return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral' };
    }

    // Check for negative outcomes
    if (transcriptLower.includes('not interested') || transcriptLower.includes('no thank')) {
      return { outcome: 'not_interested', followUpRequired: false, sentiment: 'negative' };
    }
    if (transcriptLower.includes('wrong number') || transcriptLower.includes('wrong person')) {
      return { outcome: 'wrong_contact', followUpRequired: false, sentiment: 'neutral' };
    }

    return { outcome: 'callback_requested', followUpRequired: true, sentiment: 'neutral' };
  }

  /**
   * Build personalized call script
   */
  private buildScript(contact: CRMContact): string {
    let script = DEFAULT_SCRIPT;

    script = script.replace('{{agent_name}}', 'Sarah');
    script = script.replace('{{clinic_name}}', contact.clinic.name);
    script = script.replace(
      '{{service_area}}',
      contact.keywordMatches.length > 0 
        ? contact.keywordMatches[0].keyword 
        : "men's health"
    );
    script = script.replace(
      '{{decision_maker_name}}',
      contact.decisionMaker 
        ? `${contact.decisionMaker.firstName} ${contact.decisionMaker.lastName}`
        : 'the clinic owner or manager'
    );

    return script;
  }

  private mapVapiStatus(status: string): CallStatus {
    const statusMap: Record<string, CallStatus> = {
      'queued': 'queued',
      'ringing': 'ringing',
      'in-progress': 'in_progress',
      'completed': 'completed',
      'failed': 'failed',
      'no-answer': 'no_answer',
      'busy': 'no_answer',
    };
    return statusMap[status] || 'queued';
  }

  private mapBlandStatus(status: string): CallStatus {
    const statusMap: Record<string, CallStatus> = {
      'queued': 'queued',
      'ringing': 'ringing',
      'in-progress': 'in_progress',
      'completed': 'completed',
      'failed': 'failed',
      'no-answer': 'no_answer',
      'voicemail': 'voicemail',
    };
    return statusMap[status] || 'queued';
  }
}

export const voiceAgentService = new VoiceAgentService();
