import axios from 'axios';
import { Clinic, DecisionMaker, DecisionMakerRole, DataSource } from '../types';
import { emailIntelService } from './emailIntelService';
import { supabase } from '../lib/supabase';

interface ApolloSearchResponse {
  people?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    title: string;
    email?: string;
    email_status?: string;
    linkedin_url?: string;
    phone_numbers?: Array<{
      raw_number: string;
      sanitized_number: string;
      type: string;
    }>;
    organization?: {
      id: string;
      name: string;
      website_url: string;
      primary_domain: string;
    };
    seniority?: string;
    departments?: string[];
  }>;
}

export class EnrichmentService {
  private apolloKeys: string[];
  private currentKeyIndex: number;
  private exhaustedKeys: Set<number>;
  private clearbitApiKey: string;
  private revenueBaseKey: string;

  constructor(apolloKey?: string, clearbitKey?: string) {
    const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
    
    // Support multiple Apollo keys via comma-separated VITE_APOLLO_API_KEYS
    const keysStr = metaEnv?.VITE_APOLLO_API_KEYS || '';
    const singleKey = apolloKey || metaEnv?.VITE_APOLLO_API_KEY || '';
    
    // Parse comma-separated keys, deduplicate, filter empties
    const allKeys = [...new Set(
      [singleKey, ...keysStr.split(',').map((k: string) => k.trim())]
        .filter(Boolean)
    )];
    
    this.apolloKeys = allKeys;
    this.currentKeyIndex = 0;
    this.exhaustedKeys = new Set();
    this.clearbitApiKey = clearbitKey || metaEnv?.VITE_CLEARBIT_API_KEY || '';
    this.revenueBaseKey = metaEnv?.VITE_REVENUEBASE_API_KEY || '';
    
    if (this.apolloKeys.length > 1) {
      console.log(`[Apollo] ${this.apolloKeys.length} API keys loaded for rotation`);
    }
  }

  /** Get the current active Apollo key, or empty if all exhausted */
  private get apolloApiKey(): string {
    if (this.exhaustedKeys.size >= this.apolloKeys.length) return '';
    // Find next non-exhausted key starting from current index
    for (let i = 0; i < this.apolloKeys.length; i++) {
      const idx = (this.currentKeyIndex + i) % this.apolloKeys.length;
      if (!this.exhaustedKeys.has(idx)) {
        this.currentKeyIndex = idx;
        return this.apolloKeys[idx];
      }
    }
    return '';
  }

  /** Mark current key as exhausted and rotate to next */
  private rotateApolloKey(): boolean {
    this.exhaustedKeys.add(this.currentKeyIndex);
    const remaining = this.apolloKeys.length - this.exhaustedKeys.size;
    if (remaining > 0) {
      // Move to next available key
      for (let i = 1; i <= this.apolloKeys.length; i++) {
        const idx = (this.currentKeyIndex + i) % this.apolloKeys.length;
        if (!this.exhaustedKeys.has(idx)) {
          this.currentKeyIndex = idx;
          console.log(`[Apollo] Key ${this.exhaustedKeys.size}/${this.apolloKeys.length} exhausted — rotated to key #${idx + 1} (${remaining} remaining)`);
          return true;
        }
      }
    }
    console.warn('[Apollo] All API keys exhausted — falling back to NPI/email intel');
    return false;
  }

  /**
   * Find decision makers at a clinic
   */
  async findDecisionMakers(clinic: Clinic): Promise<DecisionMaker[]> {
    const decisionMakers: DecisionMaker[] = [];

    // Try Apollo.io first
    if (this.apolloApiKey) {
      const apolloResults = await this.searchApollo(clinic);
      decisionMakers.push(...apolloResults);
    }

    // If no results from Apollo, try the public NPI Registry
    if (decisionMakers.length === 0) {
      const npiResults = await this.searchNPI(clinic);
      decisionMakers.push(...npiResults);

      // If we found emails, try a Clearbit enrichment pass to fill missing fields
      for (const dm of decisionMakers) {
        if (dm.email && this.clearbitApiKey) {
          const extra = await this.enrichWithClearbit(dm.email);
          if (extra) {
            dm.firstName = dm.firstName || extra.firstName || dm.firstName;
            dm.lastName = dm.lastName || extra.lastName || dm.lastName;
            dm.title = dm.title || extra.title || dm.title;
            dm.linkedInUrl = dm.linkedInUrl || extra.linkedInUrl || dm.linkedInUrl;
            dm.confidence = Math.max(dm.confidence || 0, extra.title ? 90 : 80);
            dm.enrichedAt = new Date();
            dm.source = 'clearbit' as DataSource;
          }
        }
      }
    }

    // If still nothing, try broader NPI search by city/state + healthcare taxonomy
    if (decisionMakers.length === 0 && clinic.address?.city) {
      const broadNpi = await this.searchNPIBroad(clinic);
      decisionMakers.push(...broadNpi);
    }

    // If still nothing, use Gemini + RevenueBase email intelligence pipeline
    if (decisionMakers.length === 0) {
      const emailCandidates = await emailIntelService.findAndVerifyEmails(clinic);
      if (emailCandidates.length > 0) {
        // ONLY use personal (non-generic) emails as decision makers
        // Generic emails (info@, contact@, office@) are useless for reaching real people
        const GENERIC_PREFIXES = ['info', 'contact', 'office', 'admin', 'frontdesk', 'hello', 'support', 'help', 'reception', 'appointments', 'billing', 'marketing', 'sales', 'hr', 'noreply', 'no-reply', 'webmaster', 'mail'];
        const isGeneric = (email: string) => GENERIC_PREFIXES.includes(email.split('@')[0].toLowerCase());

        const personalCandidates = emailCandidates.filter(c => !c.isGeneric && !isGeneric(c.email));
        const topPersonal = personalCandidates
          .filter(c => !(c.verified && c.verificationStatus === 'invalid'))
          .slice(0, 3);

        for (const candidate of topPersonal) {
          const nameParts = (candidate.personName || '').split(' ');
          const verifiedLabel = candidate.verified
            ? ` [${candidate.verificationStatus}]`
            : '';

          decisionMakers.push({
            id: `email-intel-${clinic.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            clinicId: clinic.id,
            firstName: nameParts[0] || 'Unknown',
            lastName: nameParts.slice(1).join(' ') || 'Contact',
            title: (candidate.personTitle || 'Decision Maker') + verifiedLabel,
            role: this.inferRole(candidate.personTitle || ''),
            email: candidate.email,
            phone: clinic.phone || undefined,
            linkedInUrl: undefined,
            confidence: candidate.confidence,
            enrichedAt: new Date(),
            source: (candidate.source === 'exa_scrape' ? 'website_scrape' : candidate.source === 'gemini_extract' ? 'website_scrape' : 'manual') as DataSource,
            // `emailVerified` means deliverable/valid (safe to outreach). Status carries risky/invalid/unknown.
            emailVerified: candidate.verificationStatus === 'valid',
            emailVerificationStatus: candidate.verificationStatus || 'unknown',
          });
        }
      }
    }

    // Last resort: create a contact entry from the clinic phone so the CRM is never empty
    if (decisionMakers.length === 0 && clinic.phone) {
      decisionMakers.push({
        id: `phone-${clinic.id}-${Date.now()}`,
        clinicId: clinic.id,
        firstName: 'Front',
        lastName: 'Desk',
        title: 'Clinic Front Desk — call to reach decision maker',
        role: 'clinic_manager' as DecisionMakerRole,
        email: undefined,
        phone: clinic.phone,
        linkedInUrl: undefined,
        confidence: 20,
        enrichedAt: new Date(),
        source: 'manual' as DataSource,
      });
    }

    // ── Verify all emails via RevenueBase before returning ──
    await this.verifyEmails(decisionMakers);

    return decisionMakers;
  }

  /**
   * Fetch NPI Registry results.
   * In browsers, the public NPI API can be blocked by CORS; we attempt a Supabase Edge Function proxy first.
   */
  private async npiGet(params: Record<string, any>): Promise<any> {
    // Prefer Supabase Edge Function proxy if available (avoids browser CORS failures).
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('npi-proxy', {
          body: { params },
        });
        if (!error && data) return data;
      } catch {
        // Fall back to direct request below.
      }
    }

    const response = await axios.get('https://npiregistry.cms.hhs.gov/api/', { params });
    return response.data;
  }

  /**
   * Verify all decision maker emails via RevenueBase
   * Marks each DM with emailVerified + emailVerificationStatus
   * Adjusts confidence scores based on verification result
   */
  private async verifyEmails(dms: DecisionMaker[]): Promise<void> {
    if (!this.revenueBaseKey) return;
    const withEmail = dms.filter(d => {
      if (!d.email) return false;
      // Only verify if we don't already have a non-unknown status.
      const status = (d.emailVerificationStatus || 'unknown').toLowerCase();
      if (status && status !== 'unknown') return false;
      return true;
    });
    if (!withEmail.length) return;

    const verifyOne = async (dm: DecisionMaker) => {
      try {
        const response = await axios.post(
          'https://api.revenuebase.ai/v1/process-email',
          { email: dm.email },
          { headers: { 'x-key': this.revenueBaseKey, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        const data = response.data;
        const raw = (data.status || data.result || data.verification_status || '').toLowerCase();
        if (raw === 'valid' || raw === 'deliverable' || raw === 'safe' || raw === 'verified') {
          dm.emailVerificationStatus = 'valid';
          dm.emailVerified = true;
          dm.confidence = Math.min(dm.confidence + 20, 99);
        } else if (raw === 'invalid' || raw === 'undeliverable' || raw === 'bounce') {
          dm.emailVerificationStatus = 'invalid';
          dm.emailVerified = false;
          dm.confidence = Math.max(dm.confidence - 30, 5);
        } else if (raw === 'risky' || raw === 'catch-all' || raw === 'catch_all' || raw === 'accept_all') {
          dm.emailVerificationStatus = 'risky';
          dm.emailVerified = false;
          dm.confidence = Math.min(dm.confidence + 5, 80);
        } else {
          dm.emailVerificationStatus = 'unknown';
          dm.emailVerified = false;
        }
      } catch (err: any) {
        if (err?.response?.status === 422 || err?.response?.status === 400) {
          dm.emailVerified = false;
          dm.emailVerificationStatus = 'invalid';
          dm.confidence = Math.max(dm.confidence - 30, 5);
        } else {
          dm.emailVerified = false;
          dm.emailVerificationStatus = 'unknown';
        }
      }
    };

    // Verify in parallel batches of 3
    for (let i = 0; i < withEmail.length; i += 3) {
      await Promise.all(withEmail.slice(i, i + 3).map(verifyOne));
    }

    // Re-sort: verified valid first, then by confidence
    dms.sort((a, b) => {
      const aV = a.emailVerificationStatus === 'valid' ? 100 : a.emailVerificationStatus === 'risky' ? 50 : 0;
      const bV = b.emailVerificationStatus === 'valid' ? 100 : b.emailVerificationStatus === 'risky' ? 50 : 0;
      if (aV !== bV) return bV - aV;
      return b.confidence - a.confidence;
    });
  }

  /**
   * Search Apollo.io for decision makers
   * Uses domain-based search when website is available (more accurate),
   * falls back to org name search.
   * Automatically rotates API keys on 403/429 errors.
   */
  private async searchApollo(clinic: Clinic): Promise<DecisionMaker[]> {
    const apiKey = this.apolloApiKey;
    if (!apiKey) return [];

    try {
      const searchBody: any = {
        person_titles: [
          'Owner', 'Founder', 'CEO', 'President', 'Principal',
          'Medical Director', 'Chief Medical Officer',
          'Clinic Manager', 'Office Manager', 'Practice Manager',
          'Practice Administrator',
          'Director of Operations', 'Operations Manager',
          'Marketing Director', 'Marketing Manager',
          'Partner',
        ],
        per_page: 10,
      };

      // Prefer domain-based search (much more accurate)
      if (clinic.website) {
        try {
          const url = new URL(clinic.website.startsWith('http') ? clinic.website : `https://${clinic.website}`);
          const domain = url.hostname.replace(/^www\./, '');
          searchBody.q_organization_domains = domain;
        } catch {
          searchBody.q_organization_name = clinic.name;
        }
      } else {
        searchBody.q_organization_name = clinic.name;
      }

      // Add location filter for better accuracy
      if (clinic.address?.city && clinic.address?.state) {
        searchBody.person_locations = [`${clinic.address.city}, ${clinic.address.state}`];
      }

      const response = await axios.post<ApolloSearchResponse>(
        'https://api.apollo.io/v1/mixed_people/search',
        searchBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
        }
      );

      const people = response.data.people || [];
      
      return people
        .filter(person => person.first_name && person.last_name)
        .map(person => {
          // Find best phone: prefer mobile/direct, then any
          const directDial = person.phone_numbers?.find(pn => pn.type === 'mobile' || pn.type === 'direct')
            || person.phone_numbers?.[0];

          // Confidence based on email verification status
          let confidence = 60;
          if (person.email) {
            confidence = person.email_status === 'verified' ? 95 : person.email_status === 'guessed' ? 70 : 65;
          }

          const apolloEmailStatus = String(person.email_status || '').toLowerCase();
          const emailVerificationStatus =
            apolloEmailStatus === 'verified'
              ? 'valid'
              : 'unknown';

          return {
            id: `dm-${person.id}`,
            clinicId: clinic.id,
            firstName: person.first_name,
            lastName: person.last_name,
            title: person.title || '',
            role: this.inferRole(person.title || ''),
            email: person.email,
            phone: directDial?.sanitized_number || directDial?.raw_number || undefined,
            linkedInUrl: person.linkedin_url,
            confidence,
            enrichedAt: new Date(),
            source: 'apollo' as DataSource,
            // Apollo's `email_status=verified` is treated as deliverable/valid.
            emailVerified: emailVerificationStatus === 'valid',
            emailVerificationStatus,
          };
        })
        // Sort: owners first, then by confidence
        .sort((a, b) => {
          const rolePriority: Record<string, number> = {
            owner: 0, medical_director: 1, clinic_manager: 2,
            practice_administrator: 3, marketing_director: 4, operations_manager: 5,
          };
          const rDiff = (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9);
          if (rDiff !== 0) return rDiff;
          return b.confidence - a.confidence;
        });
    } catch (error: any) {
      const status = error?.response?.status;
      // 403 = forbidden (credits exhausted), 429 = rate limited
      if (status === 403 || status === 429) {
        console.warn(`[Apollo] Key exhausted/rate-limited (${status}), attempting rotation...`);
        if (this.rotateApolloKey()) {
          // Retry with the next key
          return this.searchApollo(clinic);
        }
      }
      console.error(`Error searching Apollo for ${clinic.name}:`, error);
      return [];
    }
  }

  /**
   * Enrich a contact with additional data from Clearbit
   */
  async enrichWithClearbit(email: string): Promise<Partial<DecisionMaker> | null> {
    if (!this.clearbitApiKey || !email) return null;

    try {
      const response = await axios.get(
        `https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${this.clearbitApiKey}`,
          },
        }
      );

      const data = response.data;
      
      return {
        firstName: data.person?.name?.givenName,
        lastName: data.person?.name?.familyName,
        title: data.person?.employment?.title,
        linkedInUrl: data.person?.linkedin?.handle 
          ? `https://linkedin.com/in/${data.person.linkedin.handle}`
          : undefined,
      };
    } catch (error) {
      console.error(`Error enriching email ${email} with Clearbit:`, error);
      return null;
    }
  }

  /**
   * Search the public NPI Registry for organization/authorized official info
   */
  private async searchNPI(clinic: Clinic): Promise<DecisionMaker[]> {
    try {
      const params: any = {
        version: '2.1',
        limit: 10,
        organization_name: clinic.name,
      };

      if (clinic.address?.city) params.city = clinic.address.city;
      if (clinic.address?.state) params.state = clinic.address.state;

      const data = await this.npiGet(params);
      const results = data?.results || [];

      const dms: DecisionMaker[] = [];

      results.forEach((r: any, idx: number) => {
        const npi = r.number;
        const basic = r.basic || {};

        // Prefer authorized official when present (organization records)
        const authFirst = basic.authorized_official_first_name || basic.authorized_official_firstname || null;
        const authLast = basic.authorized_official_last_name || basic.authorized_official_lastname || null;
        const authTitle = basic.authorized_official_title || basic.authorized_official_function || '';
        const authEmail = basic.authorized_official_email || basic.authorized_official_contact_email || null;
        const authPhone = basic.authorized_official_telephone_number || null;

        if (authFirst || authLast) {
          const title = authTitle || '';
          dms.push({
            id: `npi-${npi || idx}`,
            clinicId: clinic.id,
            firstName: authFirst || '',
            lastName: authLast || '',
            title,
            role: this.inferRole(title),
            email: authEmail || undefined,
            phone: authPhone || undefined,
            linkedInUrl: undefined,
            confidence: authEmail ? 85 : 60,
            enrichedAt: new Date(),
            source: 'npi' as DataSource,
          });
          return;
        }

        // Fallback: individual provider record
        const first = basic.first_name || basic.firstname || null;
        const last = basic.last_name || basic.lastname || null;
        if (first || last) {
          const title = (r.taxonomies && r.taxonomies[0] && r.taxonomies[0].desc) || '';
          // Try to find a phone in addresses
          const addrPhone = (r.addresses && r.addresses[0] && r.addresses[0].telephone_number) || undefined;
          dms.push({
            id: `npi-${npi || idx}`,
            clinicId: clinic.id,
            firstName: first || '',
            lastName: last || '',
            title,
            role: this.inferRole(title),
            email: undefined,
            phone: addrPhone,
            linkedInUrl: undefined,
            confidence: 50,
            enrichedAt: new Date(),
            source: 'npi' as DataSource,
          });
        }
      });

      return dms;
    } catch (error) {
      console.error(`Error searching NPI for ${clinic.name}:`, error);
      return [];
    }
  }

  /**
   * Broader NPI search — search by taxonomy (healthcare provider type) + location
   * when exact org name match fails
   */
  private async searchNPIBroad(clinic: Clinic): Promise<DecisionMaker[]> {
    try {
      // Search for individual providers near this clinic's location
      // using healthcare taxonomy codes common in men's health
      const taxonomySearches = [
        { taxonomy_description: 'Internal Medicine', enumeration_type: 'NPI-1' },
        { taxonomy_description: 'Urology', enumeration_type: 'NPI-1' },
        { taxonomy_description: 'Family Medicine', enumeration_type: 'NPI-1' },
      ];

      for (const search of taxonomySearches) {
        try {
          const params: any = {
            version: '2.1',
            limit: 5,
            city: clinic.address.city,
            state: clinic.address.state,
            ...search,
          };

          const data = await this.npiGet(params);
          const results = data?.results || [];

          if (results.length > 0) {
            const dms: DecisionMaker[] = [];
            for (const r of results.slice(0, 3)) {
              const basic = r.basic || {};
              const first = basic.first_name || basic.authorized_official_first_name || '';
              const last = basic.last_name || basic.authorized_official_last_name || '';
              if (!first && !last) continue;

              const title = (r.taxonomies?.[0]?.desc) || 'Healthcare Provider';
              const addrPhone = r.addresses?.[0]?.telephone_number || undefined;

              dms.push({
                id: `npi-broad-${r.number || Math.random().toString(36).slice(2)}`,
                clinicId: clinic.id,
                firstName: first,
                lastName: last,
                title,
                role: this.inferRole(title),
                email: undefined,
                phone: addrPhone,
                linkedInUrl: undefined,
                confidence: 35,
                enrichedAt: new Date(),
                source: 'npi' as DataSource,
              });
            }
            if (dms.length > 0) return dms;
          }
        } catch {
          // continue to next taxonomy
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Infer decision maker role from job title
   */
  private inferRole(title: string): DecisionMakerRole {
    const titleLower = title.toLowerCase();

    if (titleLower.includes('owner') || titleLower.includes('founder') || titleLower.includes('ceo')) {
      return 'owner';
    }
    if (titleLower.includes('medical director') || titleLower.includes('physician') || titleLower.includes('doctor')) {
      return 'medical_director';
    }
    if (titleLower.includes('clinic manager') || titleLower.includes('office manager')) {
      return 'clinic_manager';
    }
    if (titleLower.includes('administrator') || titleLower.includes('practice admin')) {
      return 'practice_administrator';
    }
    if (titleLower.includes('marketing')) {
      return 'marketing_director';
    }
    if (titleLower.includes('operations') || titleLower.includes('ops')) {
      return 'operations_manager';
    }

    return 'clinic_manager'; // Default
  }
}

export const enrichmentService = new EnrichmentService();
