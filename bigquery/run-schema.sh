#!/bin/bash
# Run BigQuery schema creation via REST API
set -e

TOKEN=$(/opt/homebrew/bin/gcloud auth print-access-token)
PROJECT="warp-486714"
API="https://bigquery.googleapis.com/bigquery/v2/projects/$PROJECT/jobs"

run_query() {
  local desc="$1"
  local query="$2"
  echo "Running: $desc..."
  
  local payload=$(python3 -c "
import json
q = '''$query'''
print(json.dumps({'configuration':{'query':{'query':q,'useLegacySql':False}}}))" 2>/dev/null)
  
  local result=$(curl -s -X POST "$API" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  local state=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('state','UNKNOWN'))" 2>/dev/null)
  local err=$(echo "$result" | python3 -c "import sys,json; e=json.load(sys.stdin).get('status',{}).get('errorResult'); print(e.get('message','') if e else '')" 2>/dev/null)
  
  if [ -n "$err" ]; then
    echo "  ⚠ $err"
  else
    echo "  ✅ $state"
  fi
}

echo "Creating BigQuery tables for novalyte_intelligence..."
echo ""

# 1. Clinics table
run_query "clinics table" "CREATE TABLE IF NOT EXISTS \`$PROJECT.novalyte_intelligence.clinics\` (clinic_id STRING NOT NULL, name STRING NOT NULL, type STRING, street STRING, city STRING, state STRING, zip STRING, phone STRING, email STRING, website STRING, rating FLOAT64, review_count INT64, google_place_id STRING, services ARRAY<STRING>, market_city STRING, market_state STRING, affluence_score FLOAT64, median_income INT64, market_population INT64, manager_name STRING, manager_email STRING, owner_name STRING, owner_email STRING, enriched_contacts JSON, discovered_at TIMESTAMP, last_updated TIMESTAMP, in_crm BOOL, outreach_count INT64 DEFAULT 0, last_outreach_date TIMESTAMP, response_count INT64 DEFAULT 0, last_response_date TIMESTAMP, calls_count INT64 DEFAULT 0, emails_sent INT64 DEFAULT 0, emails_opened INT64 DEFAULT 0, converted BOOL DEFAULT FALSE, conversion_date TIMESTAMP, propensity_score FLOAT64, propensity_tier STRING, last_scored_at TIMESTAMP)"

# 2. Patient leads table
run_query "patient_leads table" "CREATE TABLE IF NOT EXISTS \`$PROJECT.novalyte_intelligence.patient_leads\` (lead_id STRING NOT NULL, created_at TIMESTAMP NOT NULL, name STRING, email STRING, phone STRING, zip_code STRING, treatment STRING, match_score INT64, urgency STRING, eligibility_status STRING, geo_city STRING, geo_state STRING, geo_zip STRING, utm_source STRING, utm_medium STRING, utm_campaign STRING, utm_term STRING, gclid STRING, referrer STRING, device_type STRING, status STRING, assigned_clinic STRING, follow_up_date TIMESTAMP, analysis_result JSON, answers_raw JSON)"

# 3. Lead-clinic matches table
run_query "lead_clinic_matches table" "CREATE TABLE IF NOT EXISTS \`$PROJECT.novalyte_intelligence.lead_clinic_matches\` (match_id STRING NOT NULL, lead_id STRING NOT NULL, clinic_id STRING NOT NULL, match_score FLOAT64, distance_miles FLOAT64, treatment_match BOOL, capacity_available BOOL, routed BOOL DEFAULT FALSE, routed_at TIMESTAMP, contacted BOOL DEFAULT FALSE, contacted_at TIMESTAMP, converted BOOL DEFAULT FALSE, converted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP())"

# 4. Market intelligence table
run_query "market_intelligence table" "CREATE TABLE IF NOT EXISTS \`$PROJECT.novalyte_intelligence.market_intelligence\` (market_id STRING NOT NULL, city STRING NOT NULL, state STRING NOT NULL, population INT64, median_income INT64, affluence_score FLOAT64, clinic_count INT64, clinic_density FLOAT64, lead_count_30d INT64, lead_count_90d INT64, avg_match_score FLOAT64, trt_demand INT64, glp1_demand INT64, peptides_demand INT64, longevity_demand INT64, sexual_demand INT64, supply_demand_ratio FLOAT64, market_opportunity_score FLOAT64, last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP())"

# 5. Training view
run_query "training view" "CREATE OR REPLACE VIEW \`$PROJECT.novalyte_intelligence.clinic_conversion_training\` AS SELECT c.clinic_id, c.type, c.rating, c.review_count, c.affluence_score, c.median_income, c.market_population, ARRAY_LENGTH(c.services) as service_count, c.outreach_count, c.response_count, c.calls_count, c.emails_sent, c.emails_opened, CASE WHEN c.emails_sent > 0 THEN c.emails_opened / c.emails_sent ELSE 0 END as email_open_rate, CASE WHEN c.outreach_count > 0 THEN c.response_count / c.outreach_count ELSE 0 END as response_rate, c.converted as label, TIMESTAMP_DIFF(c.conversion_date, c.discovered_at, DAY) as days_to_convert FROM \`$PROJECT.novalyte_intelligence.clinics\` c WHERE c.outreach_count > 0"

echo ""
echo "✅ All BigQuery tables created!"
