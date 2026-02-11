-- ═══════════════════════════════════════════════════════════════════════════════
-- Novalyte Intelligence BigQuery Schema
-- Dataset: novalyte_intelligence
-- Purpose: Clinic propensity scoring, lead-to-clinic matching, market intelligence
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Clinics Table ───
CREATE TABLE IF NOT EXISTS `warp-486714.novalyte_intelligence.clinics` (
  clinic_id STRING NOT NULL,
  name STRING NOT NULL,
  type STRING,
  
  -- Address
  street STRING,
  city STRING,
  state STRING,
  zip STRING,
  
  -- Contact
  phone STRING,
  email STRING,
  website STRING,
  
  -- Reputation
  rating FLOAT64,
  review_count INT64,
  google_place_id STRING,
  
  -- Services
  services ARRAY<STRING>,
  
  -- Market context
  market_city STRING,
  market_state STRING,
  affluence_score FLOAT64,
  median_income INT64,
  market_population INT64,
  
  -- Enrichment
  manager_name STRING,
  manager_email STRING,
  owner_name STRING,
  owner_email STRING,
  enriched_contacts JSON,
  
  -- Metadata
  discovered_at TIMESTAMP,
  last_updated TIMESTAMP,
  in_crm BOOL,
  
  -- Engagement history
  outreach_count INT64 DEFAULT 0,
  last_outreach_date TIMESTAMP,
  response_count INT64 DEFAULT 0,
  last_response_date TIMESTAMP,
  calls_count INT64 DEFAULT 0,
  emails_sent INT64 DEFAULT 0,
  emails_opened INT64 DEFAULT 0,
  
  -- Conversion
  converted BOOL DEFAULT FALSE,
  conversion_date TIMESTAMP,
  
  -- Computed scores (updated by ML pipeline)
  propensity_score FLOAT64,
  propensity_tier STRING, -- 'hot', 'warm', 'cold'
  last_scored_at TIMESTAMP
);

-- ─── 2. Patient Leads Table ───
CREATE TABLE IF NOT EXISTS `warp-486714.novalyte_intelligence.patient_leads` (
  lead_id STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  
  -- Contact
  name STRING,
  email STRING,
  phone STRING,
  zip_code STRING,
  
  -- Treatment
  treatment STRING,
  match_score INT64,
  urgency STRING,
  eligibility_status STRING,
  
  -- Geo
  geo_city STRING,
  geo_state STRING,
  geo_zip STRING,
  
  -- Attribution
  utm_source STRING,
  utm_medium STRING,
  utm_campaign STRING,
  utm_term STRING,
  gclid STRING,
  referrer STRING,
  device_type STRING,
  
  -- Engagement
  status STRING,
  assigned_clinic STRING,
  follow_up_date TIMESTAMP,
  
  -- Analysis
  analysis_result JSON,
  answers_raw JSON
);

-- ─── 3. Lead-to-Clinic Matches Table ───
CREATE TABLE IF NOT EXISTS `warp-486714.novalyte_intelligence.lead_clinic_matches` (
  match_id STRING NOT NULL,
  lead_id STRING NOT NULL,
  clinic_id STRING NOT NULL,
  
  -- Match quality
  match_score FLOAT64,
  distance_miles FLOAT64,
  treatment_match BOOL,
  capacity_available BOOL,
  
  -- Routing decision
  routed BOOL DEFAULT FALSE,
  routed_at TIMESTAMP,
  
  -- Outcome
  contacted BOOL DEFAULT FALSE,
  contacted_at TIMESTAMP,
  converted BOOL DEFAULT FALSE,
  converted_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ─── 4. Market Intelligence Table ───
CREATE TABLE IF NOT EXISTS `warp-486714.novalyte_intelligence.market_intelligence` (
  market_id STRING NOT NULL,
  city STRING NOT NULL,
  state STRING NOT NULL,
  
  -- Demographics
  population INT64,
  median_income INT64,
  affluence_score FLOAT64,
  
  -- Supply
  clinic_count INT64,
  clinic_density FLOAT64, -- clinics per 100k population
  
  -- Demand
  lead_count_30d INT64,
  lead_count_90d INT64,
  avg_match_score FLOAT64,
  
  -- Treatment breakdown
  trt_demand INT64,
  glp1_demand INT64,
  peptides_demand INT64,
  longevity_demand INT64,
  sexual_demand INT64,
  
  -- Opportunity
  supply_demand_ratio FLOAT64, -- leads per clinic
  market_opportunity_score FLOAT64,
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ─── 5. ML Training Data View ───
CREATE OR REPLACE VIEW `warp-486714.novalyte_intelligence.clinic_conversion_training` AS
SELECT
  c.clinic_id,
  c.type,
  c.rating,
  c.review_count,
  c.affluence_score,
  c.median_income,
  c.market_population,
  ARRAY_LENGTH(c.services) as service_count,
  c.outreach_count,
  c.response_count,
  c.calls_count,
  c.emails_sent,
  c.emails_opened,
  CASE WHEN c.emails_sent > 0 THEN c.emails_opened / c.emails_sent ELSE 0 END as email_open_rate,
  CASE WHEN c.outreach_count > 0 THEN c.response_count / c.outreach_count ELSE 0 END as response_rate,
  c.converted as label,
  TIMESTAMP_DIFF(c.conversion_date, c.discovered_at, DAY) as days_to_convert
FROM `warp-486714.novalyte_intelligence.clinics` c
WHERE c.outreach_count > 0; -- Only clinics we've contacted

-- ─── Indexes (via clustering) ───
-- BigQuery uses clustering instead of traditional indexes
-- Cluster clinics by propensity_tier, state, type for fast filtering
-- Cluster leads by status, treatment, geo_state for fast matching
