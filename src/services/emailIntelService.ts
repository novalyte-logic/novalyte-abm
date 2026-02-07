import axios from 'axios';
import { Clinic } from '../types';
import { vertexAI } from './vertexAI';

const getEnv = (key: string): string => {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
  return metaEnv?.[key] || '';
};

export interface EmailCandidate {
  email: string;
  source: 'exa_scrape' | 'gemini_extract' | 'pattern_guess' | 'personal_pattern';
  confidence: number;
  verified?: boolean;
  verificationStatus?: 'valid' | 'invalid' | 'risky' | 'unknown';
  personName?: string;
  personTitle?: string;
  isGeneric?: boolean; // true for info@, contact@, etc.
  raw?: any;
}

export interface PersonFound {
  name: string;
  title: string;
  email?: string;
  source: string;
}

const GENERIC_PREFIXES = ['info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help', 'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'careers', 'jobs', 'noreply', 'no-reply', 'webmaster', 'mail'];

function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0].toLowerCase();
  return GENERIC_PREFIXES.includes(prefix);
}

function extractDomain(website: string): string | null {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    const domain = url.hostname.replace(/^www\./, '');
    const skip = ['facebook.com', 'yelp.com', 'google.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'healthgrades.com', 'zocdoc.com', 'vitals.com', 'webmd.com', 'yellowpages.com', 'bbb.org'];
    if (skip.some(d => domain.includes(d))) return null;
    return domain;
  } catch { return null; }
}

/**
 * Generate personal email patterns from a real name + domain
 */
function generatePersonalEmails(firstName: string, lastName: string, domain: string): EmailCandidate[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l || !domain) return [];

  return [
    { email: `${f}@${domain}`, source: 'personal_pattern', confidence: 65, personName: `${firstName} ${lastName}`, isGeneric: false },
    { email: `${f}.${l}@${domain}`, source: 'personal_pattern', confidence: 60, personName: `${firstName} ${lastName}`, isGeneric: false },
    { email: `${f}${l}@${domain}`, source: 'personal_pattern', confidence: 55, personName: `${firstName} ${lastName}`, isGeneric: false },
    { email: `${f[0]}${l}@${domain}`, source: 'personal_pattern', confidence: 50, personName: `${firstName} ${lastName}`, isGeneric: false },
    { email: `dr.${l}@${domain}`, source: 'personal_pattern', confidence: 45, personName: `${firstName} ${lastName}`, isGeneric: false },
    { email: `${l}@${domain}`, source: 'personal_pattern', confidence: 40, personName: `${firstName} ${lastName}`, isGeneric: false },
  ];
}

export class EmailIntelService {
  private revenueBaseKey: string;
  private exaKey: string;

  constructor() {
    this.revenueBaseKey = getEnv('VITE_REVENUEBASE_API_KEY');
    this.exaKey = getEnv('VITE_EXA_API_KEY');
  }

  /**
   * Main pipeline: find real people → generate personal emails → verify
   * Returns personal emails first, generic emails last
   */
  async findAndVerifyEmails(clinic: Clinic): Promise<EmailCandidate[]> {
    const candidates: EmailCandidate[] = [];
    const people: PersonFound[] = [];
    let exaContent = '';

    // Step 1: Exa — find real people (LinkedIn, staff pages, about pages)
    if (this.exaKey) {
      try {
        const exa = await this.searchPeopleWithExa(clinic);
        people.push(...exa.people);
        candidates.push(...exa.emails);
        exaContent = exa.content;
      } catch (err) {
        console.warn('Exa search failed:', err);
      }
    }

    // Step 2: Gemini (via Vertex AI) — analyze Exa content to find more people + extract emails
    if (vertexAI.isConfigured) {
      try {
        const gemini = await this.extractPeopleWithGemini(clinic, exaContent, people);
        // Add new people
        for (const p of gemini.people) {
          if (!people.some(ep => ep.name.toLowerCase() === p.name.toLowerCase())) {
            people.push(p);
          }
        }
        // Add new emails
        const existing = new Set(candidates.map(c => c.email.toLowerCase()));
        for (const e of gemini.emails) {
          if (!existing.has(e.email.toLowerCase())) {
            candidates.push(e);
            existing.add(e.email.toLowerCase());
          }
        }
      } catch (err) {
        console.warn('Gemini extraction failed:', err);
      }
    }

    // Step 3: Generate personal email patterns from found people + clinic domain
    const domain = clinic.website ? extractDomain(clinic.website) : null;
    if (domain && people.length > 0) {
      const existing = new Set(candidates.map(c => c.email.toLowerCase()));
      for (const person of people) {
        const parts = person.name.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const firstName = parts[0];
        const lastName = parts[parts.length - 1];
        const personalEmails = generatePersonalEmails(firstName, lastName, domain);
        for (const pe of personalEmails) {
          pe.personTitle = person.title;
          if (!existing.has(pe.email)) {
            candidates.push(pe);
            existing.add(pe.email);
          }
        }
      }
    }

    // Step 4: Add generic fallbacks (low priority)
    if (domain) {
      const existing = new Set(candidates.map(c => c.email.toLowerCase()));
      const generics = [
        { email: `info@${domain}`, confidence: 25 },
        { email: `contact@${domain}`, confidence: 20 },
        { email: `office@${domain}`, confidence: 15 },
      ];
      for (const g of generics) {
        if (!existing.has(g.email)) {
          candidates.push({ email: g.email, source: 'pattern_guess', confidence: g.confidence, isGeneric: true, personTitle: 'General' });
        }
      }
    }

    // Step 5: Verify top personal (non-generic) candidates with RevenueBase
    if (this.revenueBaseKey) {
      const personalCandidates = candidates.filter(c => !c.isGeneric && !isGenericEmail(c.email));
      const toVerify = personalCandidates.slice(0, 6);
      // Also verify the top generic as fallback
      const topGeneric = candidates.find(c => c.isGeneric || isGenericEmail(c.email));
      if (topGeneric) toVerify.push(topGeneric);

      await this.verifyWithRevenueBase(toVerify);
    }

    // Sort: verified valid personal → verified risky personal → high confidence personal → generic
    candidates.sort((a, b) => {
      const aGeneric = a.isGeneric || isGenericEmail(a.email);
      const bGeneric = b.isGeneric || isGenericEmail(b.email);
      // Personal always before generic
      if (!aGeneric && bGeneric) return -1;
      if (aGeneric && !bGeneric) return 1;
      // Verified valid first
      const aValid = a.verified && a.verificationStatus === 'valid' ? 200 : 0;
      const bValid = b.verified && b.verificationStatus === 'valid' ? 200 : 0;
      const aRisky = a.verified && a.verificationStatus === 'risky' ? 100 : 0;
      const bRisky = b.verified && b.verificationStatus === 'risky' ? 100 : 0;
      return (bValid + bRisky + b.confidence) - (aValid + aRisky + a.confidence);
    });

    return candidates;
  }

  /**
   * Exa — search for real people at the clinic (LinkedIn, staff pages, bios)
   */
  private async searchPeopleWithExa(clinic: Clinic): Promise<{ people: PersonFound[]; emails: EmailCandidate[]; content: string }> {
    const people: PersonFound[] = [];
    const emails: EmailCandidate[] = [];
    let content = '';

    const queries = [
      `"${clinic.name}" owner OR founder OR "medical director" OR doctor ${clinic.address.city} ${clinic.address.state}`,
      `site:linkedin.com "${clinic.name}" ${clinic.address.city}`,
      `"${clinic.name}" team OR staff OR providers OR about`,
    ];

    for (const query of queries) {
      try {
        const response = await axios.post(
          'https://api.exa.ai/search',
          {
            query,
            numResults: 5,
            type: 'auto',
            contents: {
              text: { maxCharacters: 3000 },
              highlights: {
                query: 'owner founder director manager doctor MD email',
                numSentences: 5,
                highlightsPerUrl: 5,
              },
            },
          },
          {
            headers: { 'x-api-key': this.exaKey, 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        );

        for (const result of (response.data?.results || [])) {
          const text = (result.text || '') + ' ' + (result.highlights || []).join(' ');
          content += text + '\n';

          // Extract real emails
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const found = text.match(emailRegex) || [];
          for (const email of found) {
            const lower = email.toLowerCase();
            if (lower.includes('example.com') || lower.includes('sentry') || lower.includes('wixpress') || lower.includes('schema.org')) continue;
            if (emails.some(e => e.email === lower)) continue;

            const generic = isGenericEmail(lower);
            const nameCtx = this.extractNameNearEmail(text, email);
            emails.push({
              email: lower,
              source: 'exa_scrape',
              confidence: generic ? 30 : 80,
              personName: nameCtx.name || undefined,
              personTitle: nameCtx.title || undefined,
              isGeneric: generic,
            });
          }

          // Extract people from text (names with titles)
          const personPatterns = [
            /(?:Dr\.?\s+)([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(?:MD|DO|NP|PA|MBA|PhD|FACP|FACOG|FACS)/g,
            /(?:Dr\.?\s+)([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
            /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*(?:,\s*)?(?:Owner|Founder|Medical Director|Director|CEO|Manager|Administrator|Partner)/gi,
          ];

          for (const pattern of personPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
              const name = match[1].trim();
              if (name.length < 5 || name.length > 40) continue;
              if (people.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;

              // Find title near the name
              const nameIdx = text.indexOf(name);
              const ctx = text.slice(Math.max(0, nameIdx - 50), nameIdx + name.length + 100);
              const titleMatch = ctx.match(/(?:Owner|Founder|Medical Director|Clinic Manager|Director|CEO|Partner|Physician|Doctor|Administrator|NP|PA|Nurse Practitioner)/i);

              people.push({
                name,
                title: titleMatch ? titleMatch[0] : 'Provider',
                source: result.url?.includes('linkedin') ? 'linkedin' : 'website',
              });
            }
          }
        }

        // If we found people, don't burn credits on more queries
        if (people.length >= 2) break;
      } catch (err) {
        console.warn(`Exa query failed:`, err);
      }
    }

    return { people: people.slice(0, 5), emails: emails.slice(0, 5), content };
  }

  private extractNameNearEmail(text: string, email: string): { name: string; title: string } {
    const idx = text.indexOf(email);
    if (idx === -1) return { name: '', title: '' };
    const ctx = text.slice(Math.max(0, idx - 200), idx + email.length + 200);
    const nameMatch = ctx.match(/(?:Dr\.?\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/);
    const titleMatch = ctx.match(/(Owner|Founder|Medical Director|Clinic Manager|Director|CEO|Partner|Administrator|Manager)/i);
    return { name: nameMatch?.[1] || '', title: titleMatch?.[1] || '' };
  }

  /**
   * Vertex AI (Gemini) — analyze Exa-scraped content + generate smart guesses for people/emails
   */
  private async extractPeopleWithGemini(
    clinic: Clinic,
    exaContent: string,
    existingPeople: PersonFound[]
  ): Promise<{ people: PersonFound[]; emails: EmailCandidate[] }> {
    const people: PersonFound[] = [];
    const emails: EmailCandidate[] = [];

    const domain = clinic.website ? extractDomain(clinic.website) : null;
    const existingNames = existingPeople.map(p => p.name.toLowerCase());

    const prompt = exaContent
      ? `You are an expert at finding real people who work at medical clinics.

Analyze the following scraped web content about "${clinic.name}" located in ${clinic.address.city}, ${clinic.address.state}.

SCRAPED CONTENT:
${exaContent.slice(0, 6000)}

TASK: Extract ALL real people mentioned who work at or own this clinic. For each person found, provide:
- name: their full name
- title: their job title or role (Owner, Medical Director, Clinic Manager, Doctor, NP, PA, etc.)
- email: their email if explicitly mentioned (NOT generic emails like info@ or contact@)

Also look for any email addresses that belong to specific individuals (not generic).

${existingPeople.length > 0 ? `Already found: ${existingPeople.map(p => p.name).join(', ')} — find ADDITIONAL people if possible.` : ''}

Respond ONLY with valid JSON:
{"people": [{"name": "First Last", "title": "Title", "email": "email@domain.com or null"}]}`
      : `You are an expert at finding decision makers at medical clinics.

Clinic: "${clinic.name}"
Location: ${clinic.address.city}, ${clinic.address.state}
${clinic.phone ? `Phone: ${clinic.phone}` : ''}
${domain ? `Website domain: ${domain}` : ''}
Services: ${clinic.services.slice(0, 5).join(', ')}

Based on your knowledge of how medical clinics are typically structured, generate likely names and titles of people who would be decision makers at this type of clinic. Focus on:
- Owner/Founder (often a doctor — use "Dr." prefix)
- Medical Director
- Practice Manager/Administrator

${domain ? `If you can guess likely email patterns for the domain ${domain}, include them.` : ''}

Respond ONLY with valid JSON:
{"people": [{"name": "First Last", "title": "Title", "email": "email@domain.com or null"}]}`;

    try {
      const parsed = await vertexAI.generateJSON<{ people: Array<{ name: string; title?: string; email?: string | null }> }>({
        prompt,
        model: 'gemini-2.0-flash',
        temperature: 0.3,
        maxOutputTokens: 1024,
      });

      const foundPeople = parsed?.people || [];

      for (const p of foundPeople) {
        if (!p.name || typeof p.name !== 'string') continue;
        const name = p.name.replace(/^Dr\.?\s*/i, '').trim();
        if (name.length < 3 || name.length > 50) continue;
        if (existingNames.includes(name.toLowerCase())) continue;

        const title = p.title || 'Provider';
        people.push({ name, title, email: undefined, source: 'gemini' });

        // If Gemini found a specific email for this person
        if (p.email && typeof p.email === 'string' && p.email.includes('@') && !isGenericEmail(p.email)) {
          emails.push({
            email: p.email.toLowerCase(),
            source: 'gemini_extract',
            confidence: exaContent ? 70 : 40,
            personName: name,
            personTitle: title,
            isGeneric: false,
          });
        }

        // Generate personal email patterns from Gemini-found names
        if (domain) {
          const parts = name.split(/\s+/);
          if (parts.length >= 2) {
            const personalEmails = generatePersonalEmails(parts[0], parts[parts.length - 1], domain);
            for (const pe of personalEmails) {
              pe.personTitle = title;
              if (exaContent) pe.confidence = Math.min(pe.confidence + 10, 80);
              emails.push(pe);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Vertex AI / Gemini extraction failed:', err);
    }

    return { people, emails };
  }

  /**
   * RevenueBase — verify email addresses
   * POST https://api.revenuebase.ai/v1/process-email with x-key header
   */
  private async verifyWithRevenueBase(candidates: EmailCandidate[]): Promise<void> {
    if (!this.revenueBaseKey || candidates.length === 0) return;

    const verifyOne = async (candidate: EmailCandidate) => {
      try {
        const response = await axios.post(
          'https://api.revenuebase.ai/v1/process-email',
          { email: candidate.email },
          {
            headers: {
              'x-key': this.revenueBaseKey,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        const data = response.data;
        candidate.verified = true;

        // Interpret response — RevenueBase returns status/result fields
        const status = (data.status || data.result || data.verification_status || '').toLowerCase();
        if (status === 'valid' || status === 'deliverable' || status === 'safe') {
          candidate.verificationStatus = 'valid';
          candidate.confidence = Math.min(candidate.confidence + 30, 99);
        } else if (status === 'invalid' || status === 'undeliverable' || status === 'bounce') {
          candidate.verificationStatus = 'invalid';
          candidate.confidence = Math.max(candidate.confidence - 40, 5);
        } else if (status === 'risky' || status === 'catch-all' || status === 'catch_all' || status === 'accept_all') {
          candidate.verificationStatus = 'risky';
          candidate.confidence = Math.min(candidate.confidence + 10, 75);
        } else {
          candidate.verificationStatus = 'unknown';
        }

        candidate.raw = data;
      } catch (err: any) {
        // 422/400 often means invalid email format
        if (err?.response?.status === 422 || err?.response?.status === 400) {
          candidate.verified = true;
          candidate.verificationStatus = 'invalid';
          candidate.confidence = 5;
        } else {
          console.warn(`RevenueBase verification failed for ${candidate.email}:`, err?.message);
          candidate.verified = false;
          candidate.verificationStatus = 'unknown';
        }
      }
    };

    // Verify in parallel batches of 3 to avoid rate limits
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      await Promise.all(batch.map(verifyOne));
    }
  }

  /**
   * Check RevenueBase credit balance
   */
  async getCredits(): Promise<{ credits: number } | null> {
    if (!this.revenueBaseKey) return null;
    try {
      const response = await axios.get('https://api.revenuebase.ai/v1/credits', {
        headers: { 'x-key': this.revenueBaseKey },
        timeout: 10000,
      });
      return response.data;
    } catch (err) {
      console.warn('Failed to fetch RevenueBase credits:', err);
      return null;
    }
  }
}

export const emailIntelService = new EmailIntelService();