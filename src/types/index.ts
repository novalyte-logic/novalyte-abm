// Men's Health Keywords for tracking
export const MEN_HEALTH_KEYWORDS = [
  'TRT',
  'Testosterone Replacement Therapy',
  'IV Therapy',
  'ED Treatment',
  'Erectile Dysfunction',
  'Sexual Health',
  'Peptide Therapy',
  'GLP-1',
  'Semaglutide',
  'Tirzepatide',
  'Hair Loss Restoration',
  'Hair Transplant',
  'PRP Therapy',
  'Hormone Optimization',
  'Men\'s Wellness',
  'Low T',
  'HGH',
  'Bioidentical Hormones',
] as const;

export type MensHealthKeyword = typeof MEN_HEALTH_KEYWORDS[number];

// Keyword trend data
export interface KeywordTrend {
  id: string;
  keyword: MensHealthKeyword | string;
  location: MarketZone;
  trendScore: number; // 0-100
  searchVolume: number;
  growthRate: number; // percentage
  timestamp: Date;
  competitorActivity: 'low' | 'medium' | 'high';
}

// Market zones - affluent US cities
export interface MarketZone {
  id: string;
  city: string;
  state: string;
  metropolitanArea: string;
  medianIncome: number;
  population: number;
  affluenceScore: number; // 1-10
  coordinates: {
    lat: number;
    lng: number;
  };
}

// Pre-defined affluent markets
export const AFFLUENT_MARKETS: Omit<MarketZone, 'id'>[] = [
  { city: 'Atherton', state: 'CA', metropolitanArea: 'San Francisco Bay Area', medianIncome: 525000, population: 7500, affluenceScore: 10, coordinates: { lat: 37.4613, lng: -122.1976 } },
  { city: 'Beverly Hills', state: 'CA', metropolitanArea: 'Los Angeles', medianIncome: 165000, population: 34000, affluenceScore: 9, coordinates: { lat: 34.0736, lng: -118.4004 } },
  { city: 'Scottsdale', state: 'AZ', metropolitanArea: 'Phoenix', medianIncome: 95000, population: 260000, affluenceScore: 8, coordinates: { lat: 33.4942, lng: -111.9261 } },
  { city: 'Naples', state: 'FL', metropolitanArea: 'Naples-Marco Island', medianIncome: 92000, population: 22000, affluenceScore: 9, coordinates: { lat: 26.1420, lng: -81.7948 } },
  { city: 'Greenwich', state: 'CT', metropolitanArea: 'New York Metro', medianIncome: 185000, population: 63000, affluenceScore: 9, coordinates: { lat: 41.0262, lng: -73.6282 } },
  { city: 'Aspen', state: 'CO', metropolitanArea: 'Aspen', medianIncome: 125000, population: 7500, affluenceScore: 10, coordinates: { lat: 39.1911, lng: -106.8175 } },
  { city: 'Palm Beach', state: 'FL', metropolitanArea: 'West Palm Beach', medianIncome: 155000, population: 9000, affluenceScore: 10, coordinates: { lat: 26.7056, lng: -80.0364 } },
  { city: 'Malibu', state: 'CA', metropolitanArea: 'Los Angeles', medianIncome: 145000, population: 12000, affluenceScore: 9, coordinates: { lat: 34.0259, lng: -118.7798 } },
  { city: 'Paradise Valley', state: 'AZ', metropolitanArea: 'Phoenix', medianIncome: 220000, population: 14000, affluenceScore: 9, coordinates: { lat: 33.5428, lng: -111.9428 } },
  { city: 'The Woodlands', state: 'TX', metropolitanArea: 'Houston', medianIncome: 135000, population: 120000, affluenceScore: 8, coordinates: { lat: 30.1658, lng: -95.4613 } },
  { city: 'Coral Gables', state: 'FL', metropolitanArea: 'Miami', medianIncome: 115000, population: 50000, affluenceScore: 8, coordinates: { lat: 25.7215, lng: -80.2684 } },
  { city: 'Newport Beach', state: 'CA', metropolitanArea: 'Orange County', medianIncome: 155000, population: 85000, affluenceScore: 9, coordinates: { lat: 33.6189, lng: -117.9289 } },
];

// Enriched contact from Apollo/NPI/email intel
export interface EnrichedContact {
  name: string;
  title: string;
  role: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  confidence: number; // 0-100
  source: string;
  enrichedAt: string;
  emailVerified?: boolean;
  emailVerificationStatus?: 'valid' | 'invalid' | 'risky' | 'unknown';
}

// Clinic information
export interface Clinic {
  id: string;
  name: string;
  type: ClinicType;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  phone: string;
  email?: string;
  website?: string;
  googlePlaceId?: string;
  yelpId?: string;
  rating?: number;
  reviewCount?: number;
  // Optional cached manager / decision maker info
  managerName?: string;
  managerEmail?: string;
  // Optional cached owner / director info
  ownerName?: string;
  ownerEmail?: string;
  // All enriched decision makers (from Apollo, NPI, etc.)
  enrichedContacts?: EnrichedContact[];
  services: string[];
  marketZone: MarketZone;
  discoveredAt: Date;
  lastUpdated: Date;
}

export type ClinicType = 
  | 'mens_health_clinic'
  | 'hormone_clinic'
  | 'med_spa'
  | 'urology_practice'
  | 'anti_aging_clinic'
  | 'wellness_center'
  | 'aesthetic_clinic';

// Decision maker / contact
export interface DecisionMaker {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  title: string;
  role: DecisionMakerRole;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  confidence: number; // 0-100
  enrichedAt?: Date;
  source: DataSource;
  emailVerified?: boolean;
  emailVerificationStatus?: 'valid' | 'invalid' | 'risky' | 'unknown';
}

export type DecisionMakerRole = 
  | 'owner'
  | 'medical_director'
  | 'clinic_manager'
  | 'practice_administrator'
  | 'marketing_director'
  | 'operations_manager';

export type DataSource = 
  | 'apollo'
  | 'clearbit'
  | 'npi'
  | 'linkedin'
  | 'manual'
  | 'website_scrape'
  | 'ai-engine';

// CRM Contact - combined clinic + decision maker for outreach
export interface CRMContact {
  id: string;
  clinic: Clinic;
  decisionMaker?: DecisionMaker;
  status: ContactStatus;
  priority: Priority;
  score: number; // 0-100 based on keyword trends + affluence
  tags: string[];
  notes: string;
  keywordMatches: KeywordTrend[];
  activities: Activity[];
  createdAt: Date;
  updatedAt: Date;
  lastContactedAt?: Date;
  nextFollowUp?: Date;
}

// Activity log entry for CRM timeline
export interface Activity {
  id: string;
  type: 'email_sent' | 'call_made' | 'call_scheduled' | 'note_added' | 'status_change' | 'follow_up_set' | 'enriched';
  description: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export type ContactStatus = 
  | 'new'
  | 'researching'
  | 'ready_to_call'
  | 'call_scheduled'
  | 'called'
  | 'follow_up'
  | 'qualified'
  | 'not_interested'
  | 'no_answer'
  | 'wrong_number';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

// Voice call tracking
export interface VoiceCall {
  id: string;
  contactId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // seconds
  status: CallStatus;
  outcome?: CallOutcome;
  transcript?: string;
  recording_url?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  notes?: string;
  followUpRequired: boolean;
  followUpDate?: Date;
}

export type CallStatus = 
  | 'queued'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'voicemail';

export type CallOutcome = 
  | 'interested'
  | 'schedule_demo'
  | 'send_info'
  | 'not_interested'
  | 'callback_requested'
  | 'wrong_contact'
  | 'gatekeeper_block';

// Campaign for batch calling
export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  targetMarkets: MarketZone[];
  targetKeywords: string[];
  contacts: CRMContact[];
  script: string;
  startDate?: Date;
  endDate?: Date;
  stats: {
    totalContacts: number;
    called: number;
    connected: number;
    qualified: number;
    notInterested: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Dashboard metrics
export interface DashboardMetrics {
  totalClinics: number;
  totalContacts: number;
  contactsByStatus: Record<ContactStatus, number>;
  callsToday: number;
  callsThisWeek: number;
  conversionRate: number;
  topTrendingKeywords: KeywordTrend[];
  topMarkets: MarketZone[];
  recentCalls: VoiceCall[];
}
