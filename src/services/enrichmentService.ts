import axios from 'axios';
import { Clinic, DecisionMaker, DecisionMakerRole, DataSource } from '../types';

interface ApolloPersonResponse {
  person?: {
    id: string;
    first_name: string;
    last_name: string;
    title: string;
    email: string;
    linkedin_url: string;
    organization?: {
      name: string;
    };
  };
}

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
    this.apolloApiKey = apolloKey || import.meta.env.VITE_APOLLO_API_KEY || '';
    this.clearbitApiKey = clearbitKey || import.meta.env.VITE_CLEARBIT_API_KEY || '';
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

    // If no results, try other methods
    if (decisionMakers.length === 0 && clinic.website) {
      // Could add website scraping logic here
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
