import axios from 'axios';
import { Clinic, DecisionMaker, DecisionMakerRole, DataSource } from '../types';
import { emailIntelService } from './emailIntelService';

interface ApolloSearchResponse {
  people?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    title: string;
    email?: string;
    linkedin_url?: string;
  }>;
}

export class EnrichmentService {
  private apolloApiKey: string;
  private clearbitApiKey: string;

  constructor(apolloKey?: string, clearbitKey?: string) {
    const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
    this.apolloApiKey = apolloKey || metaEnv?.VITE_APOLLO_API_KEY || '';
    this.clearbitApiKey = clearbitKey || metaEnv?.VITE_CLEARBIT_API_KEY || '';
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

    return decisionMakers;
  }

  /**
   * Search Apollo.io for decision makers
   */
  private async searchApollo(clinic: Clinic): Promise<DecisionMaker[]> {
    try {
      // Search for people at the organization
      const response = await axios.post<ApolloSearchResponse>(
        'https://api.apollo.io/v1/mixed_people/search',
        {
          q_organization_name: clinic.name,
          person_titles: [
            'Owner',
            'Medical Director',
            'Clinic Manager',
            'Practice Administrator',
            'Director of Operations',
            'CEO',
            'Founder',
            'Partner',
          ],
          per_page: 10,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'x-api-key': this.apolloApiKey,
          },
        }
      );

      const people = response.data.people || [];
      
      return people.map(person => ({
        id: `dm-${person.id}`,
        clinicId: clinic.id,
        firstName: person.first_name,
        lastName: person.last_name,
        title: person.title,
        role: this.inferRole(person.title),
        email: person.email,
        linkedInUrl: person.linkedin_url,
        confidence: person.email ? 85 : 60,
        enrichedAt: new Date(),
        source: 'apollo' as DataSource,
      }));
    } catch (error) {
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

      const response = await axios.get('https://npiregistry.cms.hhs.gov/api/', { params });

      const results = response.data.results || [];

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

          const response = await axios.get('https://npiregistry.cms.hhs.gov/api/', { params });
          const results = response.data.results || [];

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
