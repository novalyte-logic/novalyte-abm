const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';

const bq = new BigQuery({ projectId: GCP_PROJECT });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

functions.http('bigquerySyncHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    console.log('Starting Supabase → BigQuery sync...');
    
    // Fetch clinics
    const { data: clinics, error: clinicsError } = await supabase.from('clinics').select('*');
    if (clinicsError) throw clinicsError;
    
    // Fetch markets
    const { data: markets } = await supabase.from('markets').select('*');
    const marketMap = new Map(markets.map(m => [m.id, m]));
    
    // Fetch contacts to mark in_crm
    const { data: contacts } = await supabase.from('contacts').select('clinic_id');
    const inCRM = new Set(contacts.map(c => c.clinic_id));
    
    // Fetch activities for engagement history
    const { data: activities } = await supabase.from('activities').select('*');
    const engagementMap = new Map();
    activities.forEach(a => {
      const cid = a.contact_id;
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
    
    // Map clinics to BigQuery rows
    const clinicRows = clinics.map(c => {
      const market = marketMap.get(c.market_id) || {};
      const eng = engagementMap.get(c.id) || {};
      return {
        clinic_id: c.id, name: c.name, type: c.type,
        street: c.street, city: c.city, state: c.state, zip: c.zip,
        phone: c.phone, email: c.email, website: c.website,
        rating: c.rating, review_count: c.review_count, google_place_id: c.google_place_id,
        services: c.services || [],
        market_city: market.city, market_state: market.state,
        affluence_score: market.affluence_score, median_income: market.median_income, market_population: market.population,
        manager_name: c.manager_name, manager_email: c.manager_email,
        owner_name: c.owner_name, owner_email: c.owner_email,
        enriched_contacts: c.enriched_contacts,
        discovered_at: c.discovered_at, last_updated: c.last_updated,
        in_crm: inCRM.has(c.id),
        outreach_count: eng.outreach_count || 0, last_outreach_date: eng.last_outreach_date,
        response_count: eng.response_count || 0, last_response_date: eng.last_response_date,
        calls_count: eng.calls_count || 0, emails_sent: eng.emails_sent || 0, emails_opened: eng.emails_opened || 0,
        converted: inCRM.has(c.id), conversion_date: inCRM.has(c.id) ? c.last_updated : null,
        propensity_score: null, propensity_tier: null, last_scored_at: null,
      };
    });
    
    // Fetch leads
    const { data: leads, error: leadsError } = await supabase.from('leads').select('*');
    if (leadsError) throw leadsError;
    
    const leadRows = leads.map(l => ({
      lead_id: l.id, created_at: l.created_at,
      name: l.name, email: l.email, phone: l.phone, zip_code: l.zip_code,
      treatment: l.treatment, match_score: l.match_score, urgency: l.urgency, eligibility_status: l.eligibility_status,
      geo_city: l.geo_city, geo_state: l.geo_state, geo_zip: l.geo_zip,
      utm_source: l.utm_source, utm_medium: l.utm_medium, utm_campaign: l.utm_campaign, utm_term: l.utm_term,
      gclid: l.gclid, referrer: l.referrer, device_type: l.device_type,
      status: l.status, assigned_clinic: l.assigned_clinic, follow_up_date: l.follow_up_date,
      analysis_result: l.analysis_result, answers_raw: l.answers_raw,
    }));
    
    // Delete existing data (full refresh)
    await bq.dataset(DATASET).table('clinics').delete({ ignoreNotFound: true }).catch(() => {});
    await bq.dataset(DATASET).table('patient_leads').delete({ ignoreNotFound: true }).catch(() => {});
    
    // Insert new data
    await bq.dataset(DATASET).table('clinics').insert(clinicRows, { skipInvalidRows: true, ignoreUnknownValues: true });
    await bq.dataset(DATASET).table('patient_leads').insert(leadRows, { skipInvalidRows: true, ignoreUnknownValues: true });
    
    console.log(`✅ Synced ${clinicRows.length} clinics and ${leadRows.length} leads`);
    
    res.status(200).json({
      success: true,
      clinicsSynced: clinicRows.length,
      leadsSynced: leadRows.length,
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
