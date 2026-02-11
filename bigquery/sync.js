#!/usr/bin/env node
/**
 * Supabase → BigQuery Sync Script
 * Syncs clinics and leads from Supabase to BigQuery for ML/analytics
 * Run: node bigquery/sync.js
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';

const bq = new BigQuery({ projectId: GCP_PROJECT });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncClinics() {
  console.log('📊 Syncing clinics from Supabase to BigQuery...');
  
  const { data: clinics, error } = await supabase.from('clinics').select(`
    id, name, type, street, city, state, zip, phone, email, website,
    rating, review_count, google_place_id, services,
    market_id, manager_name, manager_email, owner_name, owner_email,
    enriched_contacts, discovered_at, last_updated
  `);
  
  if (error) throw error;
  
  // Get markets for context
  const { data: markets } = await supabase.from('markets').select('*');
  const marketMap = new Map(markets.map(m => [m.id, m]));
  
  // Get CRM contacts to mark clinics as in_crm
  const { data: contacts } = await supabase.from('contacts').select('clinic_id');
  const inCRM = new Set(contacts.map(c => c.clinic_id));
  
  // Get engagement history from activities
  const { data: activities } = await supabase.from('activities').select('*');
  const engagementMap = new Map();
  activities.forEach(a => {
    const cid = a.contact_id; // This is actually clinic_id in our schema
    if (!engagementMap.has(cid)) {
      engagementMap.set(cid, {
        outreach_count: 0, response_count: 0, calls_count: 0,
        emails_sent: 0, emails_opened: 0, last_outreach_date: null, last_response_date: null
      });
    }
    const eng = engagementMap.get(cid);
    if (a.type === 'email_sent') { eng.emails_sent++; eng.outreach_count++; eng.last_outreach_date = a.timestamp; }
    if (a.type === 'email_opened') eng.emails_opened++;
    if (a.type === 'call_completed') { eng.calls_count++; eng.outreach_count++; eng.last_outreach_date = a.timestamp; }
    if (a.type === 'response_received') { eng.response_count++; eng.last_response_date = a.timestamp; }
  });
  
  const rows = clinics.map(c => {
    const market = marketMap.get(c.market_id) || {};
    const eng = engagementMap.get(c.id) || {};
    return {
      clinic_id: c.id,
      name: c.name,
      type: c.type,
      street: c.street,
      city: c.city,
      state: c.state,
      zip: c.zip,
      phone: c.phone,
      email: c.email,
      website: c.website,
      rating: c.rating,
      review_count: c.review_count,
      google_place_id: c.google_place_id,
      services: c.services || [],
      market_city: market.city,
      market_state: market.state,
      affluence_score: market.affluence_score,
      median_income: market.median_income,
      market_population: market.population,
      manager_name: c.manager_name,
      manager_email: c.manager_email,
      owner_name: c.owner_name,
      owner_email: c.owner_email,
      enriched_contacts: c.enriched_contacts,
      discovered_at: c.discovered_at,
      last_updated: c.last_updated,
      in_crm: inCRM.has(c.id),
      outreach_count: eng.outreach_count || 0,
      last_outreach_date: eng.last_outreach_date,
      response_count: eng.response_count || 0,
      last_response_date: eng.last_response_date,
      calls_count: eng.calls_count || 0,
      emails_sent: eng.emails_sent || 0,
      emails_opened: eng.emails_opened || 0,
      converted: inCRM.has(c.id), // Simplified: in CRM = converted
      conversion_date: inCRM.has(c.id) ? c.last_updated : null,
      propensity_score: null, // Will be computed by ML
      propensity_tier: null,
      last_scored_at: null,
    };
  });
  
  await bq.dataset(DATASET).table('clinics').insert(rows, { skipInvalidRows: true, ignoreUnknownValues: true });
  console.log(`✅ Synced ${rows.length} clinics to BigQuery`);
}

async function syncLeads() {
  console.log('📊 Syncing patient leads from Supabase to BigQuery...');
  
  const { data: leads, error } = await supabase.from('leads').select('*');
  if (error) throw error;
  
  const rows = leads.map(l => ({
    lead_id: l.id,
    created_at: l.created_at,
    name: l.name,
    email: l.email,
    phone: l.phone,
    zip_code: l.zip_code,
    treatment: l.treatment,
    match_score: l.match_score,
    urgency: l.urgency,
    eligibility_status: l.eligibility_status,
    geo_city: l.geo_city,
    geo_state: l.geo_state,
    geo_zip: l.geo_zip,
    utm_source: l.utm_source,
    utm_medium: l.utm_medium,
    utm_campaign: l.utm_campaign,
    utm_term: l.utm_term,
    gclid: l.gclid,
    referrer: l.referrer,
    device_type: l.device_type,
    status: l.status,
    assigned_clinic: l.assigned_clinic,
    follow_up_date: l.follow_up_date,
    analysis_result: l.analysis_result,
    answers_raw: l.answers_raw,
  }));
  
  await bq.dataset(DATASET).table('patient_leads').insert(rows, { skipInvalidRows: true, ignoreUnknownValues: true });
  console.log(`✅ Synced ${rows.length} leads to BigQuery`);
}

async function computeMarketIntelligence() {
  console.log('📊 Computing market intelligence...');
  
  const query = `
    INSERT INTO \`warp-486714.novalyte_intelligence.market_intelligence\`
    (market_id, city, state, population, median_income, affluence_score,
     clinic_count, clinic_density, lead_count_30d, lead_count_90d, avg_match_score,
     trt_demand, glp1_demand, peptides_demand, longevity_demand, sexual_demand,
     supply_demand_ratio, market_opportunity_score, last_updated)
    
    WITH market_clinics AS (
      SELECT market_city as city, market_state as state, COUNT(*) as clinic_count,
             AVG(affluence_score) as affluence_score, AVG(median_income) as median_income,
             AVG(market_population) as population
      FROM \`warp-486714.novalyte_intelligence.clinics\`
      WHERE market_city IS NOT NULL
      GROUP BY market_city, market_state
    ),
    market_leads AS (
      SELECT geo_city as city, geo_state as state,
             COUNTIF(created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) as lead_count_30d,
             COUNTIF(created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)) as lead_count_90d,
             AVG(match_score) as avg_match_score,
             COUNTIF(treatment = 'trt') as trt_demand,
             COUNTIF(treatment = 'glp1') as glp1_demand,
             COUNTIF(treatment = 'peptides') as peptides_demand,
             COUNTIF(treatment = 'longevity') as longevity_demand,
             COUNTIF(treatment = 'sexual') as sexual_demand
      FROM \`warp-486714.novalyte_intelligence.patient_leads\`
      WHERE geo_city IS NOT NULL
      GROUP BY geo_city, geo_state
    )
    
    SELECT
      CONCAT(COALESCE(c.city, l.city), '-', COALESCE(c.state, l.state)) as market_id,
      COALESCE(c.city, l.city) as city,
      COALESCE(c.state, l.state) as state,
      CAST(c.population AS INT64) as population,
      CAST(c.median_income AS INT64) as median_income,
      c.affluence_score,
      c.clinic_count,
      CASE WHEN c.population > 0 THEN (c.clinic_count / c.population) * 100000 ELSE 0 END as clinic_density,
      COALESCE(l.lead_count_30d, 0) as lead_count_30d,
      COALESCE(l.lead_count_90d, 0) as lead_count_90d,
      l.avg_match_score,
      COALESCE(l.trt_demand, 0) as trt_demand,
      COALESCE(l.glp1_demand, 0) as glp1_demand,
      COALESCE(l.peptides_demand, 0) as peptides_demand,
      COALESCE(l.longevity_demand, 0) as longevity_demand,
      COALESCE(l.sexual_demand, 0) as sexual_demand,
      CASE WHEN c.clinic_count > 0 THEN COALESCE(l.lead_count_30d, 0) / c.clinic_count ELSE 0 END as supply_demand_ratio,
      -- Opportunity score: high demand + low supply + high affluence
      (COALESCE(l.lead_count_30d, 0) * c.affluence_score) / GREATEST(c.clinic_count, 1) as market_opportunity_score,
      CURRENT_TIMESTAMP() as last_updated
    FROM market_clinics c
    FULL OUTER JOIN market_leads l ON c.city = l.city AND c.state = l.state
    WHERE COALESCE(c.city, l.city) IS NOT NULL;
  `;
  
  await bq.query(query);
  console.log('✅ Market intelligence computed');
}

async function main() {
  try {
    console.log('🚀 Starting Supabase → BigQuery sync...\n');
    
    // Truncate tables first (full refresh for now)
    await bq.dataset(DATASET).table('clinics').delete({ ignoreNotFound: true });
    await bq.dataset(DATASET).table('patient_leads').delete({ ignoreNotFound: true });
    await bq.dataset(DATASET).table('market_intelligence').delete({ ignoreNotFound: true });
    
    // Recreate from schema
    console.log('📋 Creating tables from schema...');
    const schema = require('fs').readFileSync(__dirname + '/schema.sql', 'utf8');
    // Note: BigQuery doesn't support multi-statement SQL via API, so tables must exist
    // Run: bq query --use_legacy_sql=false < bigquery/schema.sql
    
    await syncClinics();
    await syncLeads();
    await computeMarketIntelligence();
    
    console.log('\n✅ Sync complete! Data ready for ML training.');
    console.log('📊 Next: Run propensity scoring model');
  } catch (err) {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  }
}

main();
