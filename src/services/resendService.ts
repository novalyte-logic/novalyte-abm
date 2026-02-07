import axios from 'axios';
import { CRMContact } from '../types';

/* ─── Types ─── */

export type EmailEvent = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'delivery_delayed';

export interface SentEmail {
  id: string;                // Resend email ID
  contactId: string;         // CRM contact ID
  to: string;
  from: string;
  subject: string;
  clinicName: string;
  market: string;
  sentAt: Date;
  lastEvent: EmailEvent;
  lastEventAt: Date;
  openCount: number;
  clickCount: number;
  sequenceStep?: 'intro' | 'follow_up' | 'breakup';
  aiGenerated?: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: (c: CRMContact) => string;
  html: (c: CRMContact) => string;
}

/* ─── Config ─── */

const RESEND_BASE = 'https://api.resend.com';
const FROM_ADDRESS = 'Novalyte <outreach@novalyte.io>';

/* ─── Templates ─── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'intro-market-data',
    name: 'Intro — Market Data Hook',
    subject: (c) => `${c.clinic.name} — Untapped Patient Demand in ${c.clinic.marketZone.city}`,
    html: (c) => {
      const dm = c.decisionMaker;
      const clinic = c.clinic;
      const market = clinic.marketZone;
      const services = clinic.services.slice(0, 3).join(', ');
      const kw = c.keywordMatches[0];
      const greeting = dm ? `Hi ${esc(dm.firstName)}` : 'Hi there';
      const dataPoint = kw
        ? `Our data shows that <strong>"${esc(kw.keyword)}"</strong> searches are growing <strong>${kw.growthRate}%</strong> in your area — there's significant untapped patient demand.`
        : `With a median household income of <strong>$${(market.medianIncome / 1000).toFixed(0)}k</strong> in ${esc(market.city)}, there's strong demand for premium men's health services.`;
      return `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
  <p style="font-size:15px;line-height:1.7;">${greeting},</p>
  <p style="font-size:15px;line-height:1.7;">I came across <strong>${esc(clinic.name)}</strong> while researching ${services ? esc(services) + ' providers' : "men's health clinics"} in ${esc(market.city)}.</p>
  <p style="font-size:15px;line-height:1.7;">${dataPoint}</p>
  <p style="font-size:15px;line-height:1.7;">We help clinics like yours capture high-intent patients through data-driven marketing. Our clients typically see a <strong>30-40% increase</strong> in qualified patient inquiries within 90 days.</p>
  <p style="font-size:15px;line-height:1.7;">Would you be open to a quick 15-minute call this week to see if there's a fit?</p>
  <p style="font-size:15px;line-height:1.7;margin-top:24px;">Best,<br/><strong>Jamil</strong><br/><span style="color:#64748b;font-size:13px;">Novalyte · Men's Health Growth Platform</span></p>
</div>`;
    },
  },
  {
    id: 'follow-up-value',
    name: 'Follow-Up — Value Prop',
    subject: (c) => `Quick follow-up — ${c.clinic.marketZone.city} market insights for ${c.clinic.name}`,
    html: (c) => {
      const dm = c.decisionMaker;
      const clinic = c.clinic;
      const market = clinic.marketZone;
      const greeting = dm ? `Hi ${esc(dm.firstName)}` : 'Hi there';
      return `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
  <p style="font-size:15px;line-height:1.7;">${greeting},</p>
  <p style="font-size:15px;line-height:1.7;">I reached out last week about helping <strong>${esc(clinic.name)}</strong> capture more high-intent patients in ${esc(market.city)}.</p>
  <p style="font-size:15px;line-height:1.7;">I wanted to share a quick stat: clinics in markets with an affluence score of <strong>${market.affluenceScore}/10</strong> like ${esc(market.city)} are seeing <strong>2-3x higher patient lifetime value</strong> for men's health services.</p>
  <p style="font-size:15px;line-height:1.7;">We've helped similar clinics build predictable patient pipelines. Happy to share a free market report for your area — no strings attached.</p>
  <p style="font-size:15px;line-height:1.7;">Worth a quick chat?</p>
  <p style="font-size:15px;line-height:1.7;margin-top:24px;">Best,<br/><strong>Jamil</strong><br/><span style="color:#64748b;font-size:13px;">Novalyte · Men's Health Growth Platform</span></p>
</div>`;
    },
  },
  {
    id: 'breakup',
    name: 'Breakup — Last Touch',
    subject: (c) => `Closing the loop — ${c.clinic.name}`,
    html: (c) => {
      const dm = c.decisionMaker;
      const clinic = c.clinic;
      const greeting = dm ? `Hi ${esc(dm.firstName)}` : 'Hi there';
      return `<div style="font-family:Inter,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
  <p style="font-size:15px;line-height:1.7;">${greeting},</p>
  <p style="font-size:15px;line-height:1.7;">I've reached out a couple of times about helping <strong>${esc(clinic.name)}</strong> grow its patient base, and I don't want to be a bother.</p>
  <p style="font-size:15px;line-height:1.7;">If the timing isn't right, no worries at all. I'll close out my notes on this for now.</p>
  <p style="font-size:15px;line-height:1.7;">If things change down the road, feel free to reply to this email anytime — I'd be happy to help.</p>
  <p style="font-size:15px;line-height:1.7;margin-top:24px;">All the best,<br/><strong>Jamil</strong><br/><span style="color:#64748b;font-size:13px;">Novalyte · Men's Health Growth Platform</span></p>
</div>`;
    },
  },
];


/* ═══════════════════════════════════════════════════════════════
   RESEND SERVICE
   ═══════════════════════════════════════════════════════════════ */

export class ResendService {
  private apiKey: string;

  constructor() {
    this.apiKey = (import.meta as any).env?.VITE_RESEND_API_KEY || '';
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  private get headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /* ─── Send a single email ─── */
  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    contactId: string;
    clinicName: string;
    market: string;
    tags?: { name: string; value: string }[];
  }): Promise<SentEmail> {
    if (!this.isConfigured) throw new Error('Resend API key not configured');

    const { data } = await axios.post<{ id: string }>(
      `${RESEND_BASE}/emails`,
      {
        from: FROM_ADDRESS,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        tags: [
          { name: 'contact_id', value: params.contactId },
          { name: 'clinic', value: params.clinicName.slice(0, 256) },
          { name: 'market', value: params.market.slice(0, 256) },
          ...(params.tags || []),
        ],
      },
      { headers: this.headers }
    );

    return {
      id: data.id,
      contactId: params.contactId,
      to: params.to,
      from: FROM_ADDRESS,
      subject: params.subject,
      clinicName: params.clinicName,
      market: params.market,
      sentAt: new Date(),
      lastEvent: 'sent',
      lastEventAt: new Date(),
      openCount: 0,
      clickCount: 0,
    };
  }

  /* ─── Send using a template ─── */
  async sendTemplate(contact: CRMContact, templateId: string, toEmail: string): Promise<SentEmail> {
    const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);

    const subject = template.subject(contact);
    const html = template.html(contact);

    return this.sendEmail({
      to: toEmail,
      subject,
      html,
      contactId: contact.id,
      clinicName: contact.clinic.name,
      market: `${contact.clinic.marketZone.city}, ${contact.clinic.marketZone.state}`,
      tags: [{ name: 'template', value: templateId }],
    });
  }

  /* ─── Send AI-personalized email (Gemini-generated) ─── */
  async sendAIPersonalized(
    contact: CRMContact,
    toEmail: string,
    aiEmail: { subject: string; html: string },
    sequenceStep: 'intro' | 'follow_up' | 'breakup',
  ): Promise<SentEmail> {
    const result = await this.sendEmail({
      to: toEmail,
      subject: aiEmail.subject,
      html: aiEmail.html,
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

  /* ─── Batch send (up to 100/day target) ─── */
  async sendBatch(
    contacts: { contact: CRMContact; email: string; templateId: string }[],
    delayMs = 1000,
    onProgress?: (sent: number, total: number, result: SentEmail | null, error?: string) => void,
  ): Promise<{ sent: SentEmail[]; failed: { contactId: string; error: string }[] }> {
    const sent: SentEmail[] = [];
    const failed: { contactId: string; error: string }[] = [];

    for (let i = 0; i < contacts.length; i++) {
      const { contact, email, templateId } = contacts[i];
      try {
        const result = await this.sendTemplate(contact, templateId, email);
        sent.push(result);
        onProgress?.(i + 1, contacts.length, result);
      } catch (err: any) {
        const msg = err?.response?.data?.message || err.message || 'Unknown error';
        failed.push({ contactId: contact.id, error: msg });
        onProgress?.(i + 1, contacts.length, null, msg);
      }
      // Rate limit — Resend free tier is 100/day, 2/sec
      if (i < contacts.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return { sent, failed };
  }

  /* ─── Get email status (delivered, opened, bounced, etc.) ─── */
  async getEmailStatus(emailId: string): Promise<{
    id: string;
    lastEvent: EmailEvent;
    to: string[];
    subject: string;
    createdAt: string;
  }> {
    const { data } = await axios.get(`${RESEND_BASE}/emails/${emailId}`, { headers: this.headers });
    return {
      id: data.id,
      lastEvent: data.last_event as EmailEvent,
      to: data.to,
      subject: data.subject,
      createdAt: data.created_at,
    };
  }

  /* ─── Refresh statuses for a batch of sent emails ─── */
  async refreshStatuses(emails: SentEmail[]): Promise<SentEmail[]> {
    const updated: SentEmail[] = [];
    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < emails.length; i += 5) {
      const batch = emails.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async em => {
          try {
            const status = await this.getEmailStatus(em.id);
            const newEvent = status.lastEvent as EmailEvent;
            return {
              ...em,
              lastEvent: newEvent,
              lastEventAt: new Date(),
              openCount: newEvent === 'opened' || newEvent === 'clicked' ? em.openCount + 1 : em.openCount,
              clickCount: newEvent === 'clicked' ? em.clickCount + 1 : em.clickCount,
            };
          } catch {
            return em; // keep existing data on error
          }
        })
      );
      for (const r of results) {
        updated.push(r.status === 'fulfilled' ? r.value : emails[updated.length]);
      }
      if (i + 5 < emails.length) await new Promise(r => setTimeout(r, 500));
    }
    return updated;
  }
}

export const resendService = new ResendService();
