import type { CRMContact } from '../types';
import type { SentEmail } from './resendService';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const getEnv = (key: string): string => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
  return metaEnv?.[key] || '';
};

/**
 * SMTP send service via backend HTTP function (never send SMTP creds from the browser).
 *
 * Configure with:
 * - VITE_SMTP_SEND_FUNCTION_URL=https://REGION-PROJECT.cloudfunctions.net/smtpSendHandler
 */
export class SmtpSendService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getEnv('VITE_SMTP_SEND_FUNCTION_URL');
  }

  get isConfigured() {
    // Prefer Supabase Edge Function if Supabase is configured; otherwise fallback to direct URL.
    return (isSupabaseConfigured && !!supabase) || !!this.baseUrl;
  }

  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    contactId: string;
    clinicName: string;
    market: string;
    tags?: { name: string; value: string }[];
  }): Promise<SentEmail> {
    // Primary: Supabase Edge Function (recommended)
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke('smtp-send', { body: params });
      if (error) throw new Error(error.message || 'SMTP send failed');
      if (!data?.ok) throw new Error(data?.error || 'SMTP send failed');
      const from = String(data?.from || 'SMTP Sender');
      const id = String(data?.id || `smtp-${Date.now()}`);
      return {
        id,
        contactId: params.contactId,
        to: params.to,
        from,
        subject: params.subject,
        clinicName: params.clinicName,
        market: params.market,
        sentAt: new Date(),
        lastEvent: 'sent',
        lastEventAt: new Date(),
        openCount: 0,
        clickCount: 0,
        provider: 'smtp',
      };
    }

    // Fallback: direct HTTP function URL
    if (!this.baseUrl) throw new Error('SMTP send is not configured (Supabase or VITE_SMTP_SEND_FUNCTION_URL)');
    const resp = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) throw new Error(data?.error || `SMTP send failed (${resp.status})`);

    const from = String(data?.from || 'SMTP Sender');
    const id = String(data?.id || `smtp-${Date.now()}`);

    return {
      id,
      contactId: params.contactId,
      to: params.to,
      from,
      subject: params.subject,
      clinicName: params.clinicName,
      market: params.market,
      sentAt: new Date(),
      lastEvent: 'sent',
      lastEventAt: new Date(),
      openCount: 0,
      clickCount: 0,
      provider: 'smtp',
    };
  }

  async sendAIPersonalized(
    contact: CRMContact,
    toEmail: string,
    aiEmail: { subject: string; html: string; text?: string },
    sequenceStep: 'intro' | 'follow_up' | 'breakup',
  ): Promise<SentEmail> {
    const result = await this.sendEmail({
      to: toEmail,
      subject: aiEmail.subject,
      html: aiEmail.html,
      text: aiEmail.text,
      contactId: contact.id,
      clinicName: contact.clinic.name,
      market: `${contact.clinic.marketZone.city}, ${contact.clinic.marketZone.state}`,
      tags: [
        { name: 'template', value: `ai-${sequenceStep}` },
        { name: 'ai_generated', value: 'true' },
      ],
    });
    return { ...result, sequenceStep, aiGenerated: true };
  }
}

export const smtpSendService = new SmtpSendService();
