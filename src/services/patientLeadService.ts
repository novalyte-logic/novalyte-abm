/**
 * Patient Lead Service — queries the `leads` table directly from the master Supabase.
 * Leads are written by intel-landing (ads.novalyte.io) and read here in the ABM dashboard.
 */
import { supabase } from '../lib/supabase';
import axios from 'axios';

export interface PatientLead {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  zip_code: string;
  source: string;
  treatment: string;
  // TRT
  trt_primary_concern: string | null;
  trt_energy_levels: string | null;
  trt_previous_therapy: string | null;
  // GLP-1
  glp1_weight_goal: string | null;
  glp1_previous_medications: string | null;
  glp1_metabolic_indicators: string | null;
  // Peptides
  peptide_optimization_area: string | null;
  peptide_injectable_experience: string | null;
  // Longevity
  longevity_success_definition: string | null;
  longevity_diagnostics_interest: string | null;
  // Sexual
  sexual_primary_concern: string | null;
  sexual_duration: string | null;
  // Common
  financial_readiness: string | null;
  timeline: string | null;
  // AI
  analysis_result: any | null;
  match_score: number | null;
  urgency: string | null;
  eligibility_status: string | null;
  // Management
  status: string;
  notes: string | null;
  assigned_clinic: string | null;
  answers_raw: Record<string, any> | null;
  // Tracking
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  // Enhancements
  device_type: string | null;
  contact_preference: string[] | null;
  voice_transcript: string | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'assigned' | 'converted' | 'disqualified';

// ─── Labels ───

const TREATMENT_LABELS: Record<string, string> = {
  trt: 'Testosterone Optimization (TRT)',
  glp1: 'Medical Weight Loss (GLP-1)',
  peptides: 'Peptide Therapy',
  longevity: 'Longevity & Anti-Aging',
  sexual: 'Sexual Wellness',
  general: 'General Assessment',
};

const TREATMENT_SHORT: Record<string, string> = {
  trt: 'TRT', glp1: 'GLP-1', peptides: 'Peptides',
  longevity: 'Longevity', sexual: 'Sexual Wellness', general: 'General',
};

const LEAD_PRICES: Record<string, string> = {
  trt: '$150–300', glp1: '$75–150', peptides: '$125–250',
  sexual: '$100–200', longevity: '$125–225',
};

export function getTreatmentLabel(t: string) { return TREATMENT_LABELS[t] || t; }
export function getTreatmentShort(t: string) { return TREATMENT_SHORT[t] || t; }
export function getLeadPrice(t: string) { return LEAD_PRICES[t] || '—'; }

// ─── Human-readable answer mapping ───
// Maps raw answer values to the labels the patient actually saw

const ANSWER_LABELS: Record<string, Record<string, string>> = {
  // TRT
  trt_primary_concern: { fatigue: 'Chronic Fatigue & Low Energy', muscle_loss: 'Loss of Muscle & Strength', libido: 'Low Libido & Drive', brain_fog: 'Brain Fog & Poor Focus' },
  trt_energy_levels: { critical: 'Consistently low, difficult to get through the day', declining: 'Declining noticeably over the last 1-3 years', optimization: 'Average, but wants peak performance' },
  trt_previous_therapy: { current: 'Currently on TRT', past: 'Previously on TRT', new: 'First assessment — never used TRT' },
  // GLP-1
  glp1_weight_goal: { light_loss: 'Lose 10-20 lbs (Optimization)', moderate_loss: 'Lose 20-50 lbs (Significant)', heavy_loss: 'Lose 50+ lbs (Major)' },
  glp1_previous_medications: { naive: 'Never tried GLP-1', current: 'Currently taking GLP-1', stopped: 'Stopped due to side effects/cost' },
  glp1_metabolic_indicators: { diabetes: 'Pre-diabetes or Type 2 Diabetes', cardio: 'High Cholesterol or Blood Pressure', none: 'None — just excess weight' },
  // Peptides
  peptide_optimization_area: { recovery: 'Injury Repair & Joint Recovery (BPC-157)', cognitive: 'Cognitive Function & Nootropics', aesthetic: 'Skin Health & Anti-Aging (GHK-Cu)', hgh: 'Growth Hormone Optimization (Sermorelin)' },
  peptide_injectable_experience: { experienced: 'Experienced with injectables', willing: 'No, but willing to learn', needle_averse: 'Prefers creams/orals only' },
  // Longevity
  longevity_success_definition: { lifespan: 'Extending Lifespan (Living Longer)', healthspan: 'Extending Healthspan (Living Better)', prevention: 'Disease Prevention (Cancer/Alzheimers)' },
  longevity_diagnostics_interest: { advanced: 'Wants the most advanced diagnostics', moderate: 'Open if recommended by doctor', basic: 'Standard bloodwork only' },
  // Sexual
  sexual_primary_concern: { ed: 'Erectile Quality / Performance', libido: 'Libido / Desire', anxiety: 'Performance Anxiety' },
  sexual_duration: { recent: 'Less than 6 months', chronic: '6 months to 2 years', long_term: '2+ years' },
  // Common
  financial_readiness: { high_tier: 'Prioritizes quality over cost', mid_tier: 'Budget of $300-500/month', insurance: 'Insurance-covered only' },
  timeline: { immediate: 'Immediately / Within 7 days', soon: 'Within 30 days', researching: 'Just researching' },
};

export function getAnswerLabel(field: string, value: string | null): string {
  if (!value) return '—';
  return ANSWER_LABELS[field]?.[value] || value;
}

// ─── Question labels per treatment ───

interface QAItem { question: string; field: string; }

const TREATMENT_QUESTIONS: Record<string, QAItem[]> = {
  trt: [
    { question: 'Primary Concern', field: 'trt_primary_concern' },
    { question: 'Energy Levels', field: 'trt_energy_levels' },
    { question: 'Previous TRT Experience', field: 'trt_previous_therapy' },
  ],
  glp1: [
    { question: 'Weight Loss Goal', field: 'glp1_weight_goal' },
    { question: 'Previous GLP-1 Medications', field: 'glp1_previous_medications' },
    { question: 'Metabolic Indicators', field: 'glp1_metabolic_indicators' },
  ],
  peptides: [
    { question: 'Optimization Area', field: 'peptide_optimization_area' },
    { question: 'Injectable Experience', field: 'peptide_injectable_experience' },
  ],
  longevity: [
    { question: 'Longevity Goal', field: 'longevity_success_definition' },
    { question: 'Diagnostics Interest', field: 'longevity_diagnostics_interest' },
  ],
  sexual: [
    { question: 'Primary Concern', field: 'sexual_primary_concern' },
    { question: 'Duration of Concern', field: 'sexual_duration' },
  ],
};

export function getQuestionnaireForLead(lead: PatientLead): { question: string; answer: string }[] {
  const items = TREATMENT_QUESTIONS[lead.treatment] || [];
  const qa = items
    .map(item => ({
      question: item.question,
      answer: getAnswerLabel(item.field, (lead as any)[item.field]),
    }))
    .filter(item => item.answer !== '—');

  // Always add common questions
  if (lead.financial_readiness) {
    qa.push({ question: 'Financial Readiness', answer: getAnswerLabel('financial_readiness', lead.financial_readiness) });
  }
  if (lead.timeline) {
    qa.push({ question: 'Timeline to Start', answer: getAnswerLabel('timeline', lead.timeline) });
  }
  return qa;
}

// ─── Fetch ───

const ALL_COLUMNS = 'id,created_at,name,email,phone,zip_code,source,treatment,trt_primary_concern,trt_energy_levels,trt_previous_therapy,glp1_weight_goal,glp1_previous_medications,glp1_metabolic_indicators,peptide_optimization_area,peptide_injectable_experience,longevity_success_definition,longevity_diagnostics_interest,sexual_primary_concern,sexual_duration,financial_readiness,timeline,analysis_result,match_score,urgency,eligibility_status,status,notes,assigned_clinic,answers_raw,utm_source,utm_medium,utm_campaign,device_type,contact_preference,voice_transcript';

export async function fetchLeads(opts?: {
  status?: string;
  treatment?: string;
  limit?: number;
}): Promise<PatientLead[]> {
  if (!supabase) return [];

  // Try with all columns first, fall back to base columns if device/contact/voice don't exist yet
  let q = supabase
    .from('leads')
    .select(ALL_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200);

  if (opts?.status) q = q.eq('status', opts.status);
  if (opts?.treatment) q = q.eq('treatment', opts.treatment);

  let { data, error } = await q;

  // If select fails (missing columns), retry without device/contact/voice columns
  if (error) {
    console.warn('fetchLeads: retrying without device/contact/voice columns:', error.message);
    const BASE_COLUMNS = ALL_COLUMNS.replace(',device_type,contact_preference,voice_transcript', '');
    let q2 = supabase
      .from('leads')
      .select(BASE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.status) q2 = q2.eq('status', opts.status);
    if (opts?.treatment) q2 = q2.eq('treatment', opts.treatment);
    const retry = await q2;
    data = retry.data as any;
    error = retry.error;
  }

  if (error) { console.error('fetchLeads error:', error); return []; }
  return (data || []) as PatientLead[];
}

export async function updateLeadStatus(id: string, status: LeadStatus, notes?: string): Promise<boolean> {
  if (!supabase) return false;
  const updates: any = { status };
  if (notes !== undefined) updates.notes = notes;
  const { error } = await supabase.from('leads').update(updates).eq('id', id);
  if (error) { console.error('updateLeadStatus error:', error); return false; }
  return true;
}

export async function assignLeadToClinic(id: string, clinicName: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('leads').update({ assigned_clinic: clinicName, status: 'assigned' }).eq('id', id);
  if (error) { console.error('assignLead error:', error); return false; }
  return true;
}

export async function getLeadStats(): Promise<{
  total: number;
  byTreatment: Record<string, number>;
  byStatus: Record<string, number>;
  avgScore: number;
  qualified: number;
}> {
  const leads = await fetchLeads({ limit: 1000 });
  const byTreatment: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let scoreSum = 0, scoreCount = 0, qualified = 0;

  for (const l of leads) {
    byTreatment[l.treatment] = (byTreatment[l.treatment] || 0) + 1;
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    if (l.match_score) { scoreSum += l.match_score; scoreCount++; }
    if (l.eligibility_status === 'qualified') qualified++;
  }

  return { total: leads.length, byTreatment, byStatus, avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0, qualified };
}

// ─── Clinic Search (Google Places New API) ───

export interface NearbyClinic {
  id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
}

const PLACES_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY || '';
const GEOCODE_API_KEY = (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY || PLACES_API_KEY;

const PLACE_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount';

// Multiple search queries per treatment — broadest first, then specific
const TREATMENT_SEARCH_QUERIES: Record<string, string[]> = {
  trt: ["men's health clinic", 'testosterone clinic', 'TRT clinic', 'hormone therapy clinic'],
  glp1: ['medical weight loss clinic', 'weight loss doctor', 'semaglutide clinic'],
  peptides: ['regenerative medicine clinic', 'peptide therapy', "men's wellness clinic"],
  longevity: ['anti-aging clinic', 'longevity clinic', 'functional medicine clinic'],
  sexual: ["men's health clinic", 'ED clinic', 'sexual wellness clinic'],
  general: ["men's health clinic", 'wellness clinic', 'hormone clinic'],
};

// Geocode a zip code to lat/lng using Google Geocoding API
async function geocodeZip(zipCode: string): Promise<{ lat: number; lng: number } | null> {
  if (!GEOCODE_API_KEY) return null;
  try {
    const resp = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${zipCode}&key=${GEOCODE_API_KEY}`,
      { timeout: 5000 }
    );
    const loc = resp.data?.results?.[0]?.geometry?.location;
    if (loc) return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch {
    return null;
  }
}

// Single Places API search call
async function searchPlaces(query: string, coords?: { lat: number; lng: number }): Promise<NearbyClinic[]> {
  const body: any = { textQuery: query, maxResultCount: 10 };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 40000 },
    };
  }

  const resp = await axios.post(
    'https://places.googleapis.com/v1/places:searchText',
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': PLACES_API_KEY,
        'X-Goog-FieldMask': PLACE_FIELDS,
      },
      timeout: 10000,
    }
  );
  return (resp.data?.places || []).map((p: any): NearbyClinic => ({
    id: p.id,
    name: p.displayName?.text || 'Unknown',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || undefined,
    website: p.websiteUri || undefined,
    rating: p.rating,
    reviewCount: p.userRatingCount,
  }));
}

export async function searchClinicsNearZip(zipCode: string, treatment: string): Promise<NearbyClinic[]> {
  if (!PLACES_API_KEY || !zipCode) return [];

  // Step 1: Geocode the zip to get coordinates for locationBias
  const coords = await geocodeZip(zipCode);
  console.log('[Clinic Search] Zip:', zipCode, 'Coords:', coords, 'Treatment:', treatment);

  const queries = TREATMENT_SEARCH_QUERIES[treatment] || TREATMENT_SEARCH_QUERIES.general;
  const seen = new Set<string>();
  const allResults: NearbyClinic[] = [];

  // Step 2: Try each query until we have enough results
  for (const q of queries) {
    if (allResults.length >= 10) break;
    const searchText = coords ? q : `${q} near ${zipCode}`;
    try {
      const results = await searchPlaces(searchText, coords || undefined);
      for (const r of results) {
        const key = r.name.toLowerCase() + '|' + r.address.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(r);
        }
      }
      console.log(`[Clinic Search] "${searchText}" → ${results.length} results (total unique: ${allResults.length})`);
    } catch (err: any) {
      console.warn(`[Clinic Search] "${searchText}" failed:`, err?.response?.data?.error?.message || err.message);
    }
  }

  // Sort by rating (highest first), then by review count
  allResults.sort((a, b) => {
    const ratingDiff = (b.rating || 0) - (a.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;
    return (b.reviewCount || 0) - (a.reviewCount || 0);
  });

  return allResults.slice(0, 15);
}
