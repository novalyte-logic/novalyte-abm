/**
 * Apollo.io Enrichment Service
 * Finds decision makers (owner, practice manager, medical director)
 * with verified business emails and direct phone numbers.
 *
 * Endpoints used:
 *   POST /v1/mixed_people/search  — find people at a company
 *   POST /v1/people/match         — enrich a specific person
 *   POST /v1/organizations/enrich — enrich a company by domain
 */

import { DecisionMaker, DecisionMakerRole } from '../types';
import { v4 as uuid } from 'uuid';

const APOLLO_API_KEY = (import.meta as any).env?.VITE_APOLLO_API_KEY || '';
const APOLLO_BASE = 'https://api.apollo.io';

// ─── Types ───

export interface ApolloPersonResult {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string; // 'verified' | 'guessed' | etc.
  phone_numbers?: Array<{ raw_number: string; sanitized_number: string; type: string }>;
  linkedin_url: string;
  organization?: {
    id: string;
    name: string;
    website_url: string;
    primary_domain: string;
  };
  seniority: string;
  departments: string[];
}

export interface ApolloOrgResult {
  id: string;
  name: string;
  website_url: string;
  primary_domain: string;
  phone: string;
  industry: string;
  estimated_num_employees: number;
  linkedin_url: string;
  city: string;
  state: string;
}

export interface EnrichmentResult {
  decisionMakers: DecisionMaker[];
  orgData?: ApolloOrgResult;
  creditsUsed: number;
  error?: string;
}

// ─── Role mapping ───

const TITLE_TO_ROLE: Array<{ pattern: RegExp; role: DecisionMakerRole }> = [
  { pattern: /owner|founder|ceo|president|principal/i, role: 'owner' },
  { pattern: /medical director|chief medical|cmo/i, role: 'medical_director' },
  { pattern: /practice manager|office manager|clinic manager/i, role: 'clinic_manager' },
  { pattern: /practice admin|administrator/i, role: 'practice_administrator' },
  { pattern: /marketing|growth|brand/i, role: 'marketing_director' },
  { pattern: /operations|ops director|coo/i, role: 'operations_manager' },
];

function inferRole(title: string): DecisionMakerRole {
  for (const { pattern, role } of TITLE_TO_ROLE) {
    if (pattern.test(title)) return role;
  }
  return 'clinic_manager';
}

function confidenceFromEmail(status: string): number {
  if (status === 'verified') return 95;
  if (status === 'guessed') return 60;
  return 40;
}

// ─── API helpers ───

async function apolloPost<T>(endpoint: string, body: Record<string, any>): Promise<T> {
  const resp = await fetch(`${APOLLO_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': APOLLO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Apollo API ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ─── Public API ───

export function isApolloConfigured(): boolean {
  return !!APOLLO_API_KEY;
}

/**
 * Search for decision makers at a clinic by company name + domain.
 * Uses Apollo's mixed_people/search endpoint.
 * Targets: owners, medical directors, practice managers.
 */
export async function enrichClinicDecisionMakers(
  clinicId: string,
  clinicName: string,
  domain?: string,
  city?: string,
  state?: string,
): Promise<EnrichmentResult> {
  if (!APOLLO_API_KEY) {
    return { decisionMakers: [], creditsUsed: 0, error: 'Apollo API key not configured' };
  }

  try {
    // Step 1: Search for people at this organization
    const searchBody: Record<string, any> = {
      per_page: 10,
      person_titles: [
        'Owner', 'Founder', 'CEO', 'President',
        'Medical Director', 'Chief Medical Officer',
        'Practice Manager', 'Office Manager', 'Clinic Manager',
        'Practice Administrator',
        'Marketing Director', 'Marketing Manager',
        'Operations Manager', 'Operations Director',
      ],
    };

    // Prefer domain-based search (more accurate), fall back to name
    if (domain) {
      searchBody.q_organization_domains = domain;
    } else {
      searchBody.q_organization_name = clinicName;
    }

    // Add location filter if available
    if (city && state) {
      searchBody.person_locations = [`${city}, ${state}`];
    }

    const searchResult = await apolloPost<{ people: ApolloPersonResult[] }>(
      '/v1/mixed_people/search',
      searchBody,
    );

    const people = searchResult.people || [];
    let creditsUsed = 1;

    // Step 2: Map to DecisionMaker objects
    const decisionMakers: DecisionMaker[] = people
      .filter(p => p.first_name && p.last_name)
      .map(p => {
        const directDial = p.phone_numbers?.find(pn => pn.type === 'mobile' || pn.type === 'direct')
          || p.phone_numbers?.[0];

        return {
          id: uuid(),
          clinicId,
          firstName: p.first_name,
          lastName: p.last_name,
          title: p.title || '',
          role: inferRole(p.title || ''),
          email: p.email || undefined,
          phone: directDial?.sanitized_number || directDial?.raw_number || undefined,
          linkedInUrl: p.linkedin_url || undefined,
          confidence: confidenceFromEmail(p.email_status),
          enrichedAt: new Date(),
          source: 'apollo' as const,
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

    // Step 3: Optionally enrich the organization for extra data
    let orgData: ApolloOrgResult | undefined;
    if (domain) {
      try {
        const orgResult = await apolloPost<{ organization: ApolloOrgResult }>(
          '/v1/organizations/enrich',
          { domain },
        );
        orgData = orgResult.organization;
        creditsUsed++;
      } catch {
        // Non-critical — org enrichment is bonus data
      }
    }

    return { decisionMakers, orgData, creditsUsed };
  } catch (err: any) {
    console.error('[Apollo] Enrichment failed:', err.message);
    return { decisionMakers: [], creditsUsed: 0, error: err.message };
  }
}

/**
 * Enrich a single person by name + company.
 * Useful when you already know who you're looking for.
 */
export async function enrichPerson(
  firstName: string,
  lastName: string,
  companyDomain?: string,
  companyName?: string,
): Promise<ApolloPersonResult | null> {
  if (!APOLLO_API_KEY) return null;

  try {
    const body: Record<string, any> = {
      first_name: firstName,
      last_name: lastName,
    };
    if (companyDomain) body.organization_domain = companyDomain;
    if (companyName) body.organization_name = companyName;

    const result = await apolloPost<{ person: ApolloPersonResult }>(
      '/v1/people/match',
      body,
    );
    return result.person || null;
  } catch (err: any) {
    console.error('[Apollo] Person match failed:', err.message);
    return null;
  }
}

/**
 * Extract domain from a website URL.
 * e.g. "https://www.gamadayhealth.com/locations/miami" → "gamadayhealth.com"
 */
export function extractDomain(websiteUrl: string): string | undefined {
  if (!websiteUrl) return undefined;
  try {
    const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
