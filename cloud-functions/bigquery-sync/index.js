const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';

const bq = new BigQuery({ projectId: GCP_PROJECT });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Paginate through ALL rows in a Supabase table (default limit is 1000)
async function fetchAll(table, select = '*') {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

functions.http('bigquerySyncHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    console.log('Starting Supabase → BigQuery sync (all rows)...');
    
    // Fetch ALL clinics (paginated)
    const clinics = await fetchAll('clinics');
    console.log(`Fetched ${clinics.length} clinics from Supabase`);
    
    // Fetch ALL markets
    const markets = await fetchAll('markets');
    const marketMap = new Map(markets.map(m => [m.id, m]));
    
    // Fetch contacts to mark in_crm
    const contacts = await fetchAll('contacts', 'clinic_id');
    const inCRM = new Set(contacts.map(c => c.clinic_id));
    
    // Fetch ALL decision makers for enrichment data
    const dms = await fetchAll('decision_makers');
    const dmByClinic = new Map();
    for (const dm of dms) {
      if (!dmByClinic.has(dm.clinic_id)) dmByClinic.set(dm.clinic_id, []);
      dmByClinic.get(dm.clinic_id).push(dm);
    }
    
    // Fetch activities for engagement history
    const activities = await fetchAll('activities');
    const engagementMap = new Map();
    (activities || []).forEach(a => {
      const cid = a.contact_id;
      if (!engagementMap.has(cid)) {
        engagementMap.set(cid, { outreach_count: 0, response_count: 0, calls_count: 0,
          emails_sent: 0, emails_opened: 0, last_outreach_date: null, last_response_date: null });
      }
      const eng = engagementMap.get(cid);
      if (a.type === 'email_sent') { eng.emails_sent++; eng.outreach_count++; eng.last_outreach_date = a.timestamp; }
      if (a.type === 'email_opened') eng.emails_opened++;
      if (a.type === 'call_completed') { eng.calls_count++; eng.outreach_count++; eng.last_outreach_date = a.timestamp; }
      if (a.type === 'response_received') { eng.response_count++; eng.last_response_date = a.timestamp; }
    });

    // Map clinics to BigQuery rows (include DM enrichment data)
    const clinicRows = clinics.map(c => {
      const market = marketMap.get(c.market_id) || {};
      const eng = engagementMap.get(c.id) || {};
      const clinicDMs = dmByClinic.get(c.id) || [];
      const bestDM = clinicDMs.find(d => d.email && d.email_verified) || clinicDMs.find(d => d.email) || clinicDMs[0];
      
      return {
        clinic_id: c.id, name: c.name, type: c.type || 'clinic',
        street: c.street || '', city: c.city || '', state: c.state || '', zip: c.zip || '',
        phone: c.phone || null,
        email: bestDM?.email || c.email || c.manager_email || c.owner_email || null,
        website: c.website || null,
        rating: c.rating != null ? Number(c.rating) : null,
        review_count: c.review_count != null ? Number(c.review_count) : null,
        google_place_id: c.google_place_id || null,
        services: c.services || [],
        market_city: market.city || null, market_state: market.state || null,
        affluence_score: market.affluence_score != null ? Number(market.affluence_score) : null,
        median_income: market.median_income != null ? Number(market.median_income) : null,
        market_population: market.population != null ? Number(market.population) : null,
        manager_name: bestDM ? `${bestDM.first_name} ${bestDM.last_name}` : (c.manager_name || null),
        manager_email: bestDM?.email || c.manager_email || null,
        owner_name: c.owner_name || null, owner_email: c.owner_email || null,
        enriched_contacts: null,
        discovered_at: c.discovered_at ? bq.timestamp(new Date(c.discovered_at)) : null,
        last_updated: c.last_updated ? bq.timestamp(new Date(c.last_updated)) : null,
        in_crm: inCRM.has(c.id),
        outreach_count: eng.outreach_count || 0,
        last_outreach_date: eng.last_outreach_date ? bq.timestamp(new Date(eng.last_outreach_date)) : null,
        response_count: eng.response_count || 0,
        last_response_date: eng.last_response_date ? bq.timestamp(new Date(eng.last_response_date)) : null,
        calls_count: eng.calls_count || 0, emails_sent: eng.emails_sent || 0, emails_opened: eng.emails_opened || 0,
        converted: inCRM.has(c.id),
        conversion_date: inCRM.has(c.id) && c.last_updated ? bq.timestamp(new Date(c.last_updated)) : null,
        propensity_score: null, propensity_tier: null, last_scored_at: null,
      };
    });
    
    // Fetch ALL leads (paginated)
    let leadRows = [];
    try {
      const leads = await fetchAll('leads');
      leadRows = leads.map(l => ({
        lead_id: l.id, created_at: l.created_at ? bq.timestamp(new Date(l.created_at)) : bq.timestamp(new Date()),
        name: l.name || null, email: l.email || null, phone: l.phone || null, zip_code: l.zip_code || null,
        treatment: l.treatment || null, match_score: l.match_score != null ? Number(l.match_score) : null,
        urgency: l.urgency || null, eligibility_status: l.eligibility_status || null,
        geo_city: l.geo_city || null, geo_state: l.geo_state || null, geo_zip: l.geo_zip || null,
        utm_source: l.utm_source || null, utm_medium: l.utm_medium || null,
        utm_campaign: l.utm_campaign || null, utm_term: l.utm_term || null,
        gclid: l.gclid || null, referrer: l.referrer || null, device_type: l.device_type || null,
        status: l.status || null, assigned_clinic: l.assigned_clinic || null,
        follow_up_date: l.follow_up_date ? bq.timestamp(new Date(l.follow_up_date)) : null,
        analysis_result: l.analysis_result ? JSON.stringify(l.analysis_result) : null,
        answers_raw: l.answers_raw ? JSON.stringify(l.answers_raw) : null,
      }));
    } catch (e) { console.warn('Leads fetch:', e.message); }
    
    console.log(`Mapped ${clinicRows.length} clinics (${dms.length} DMs) and ${leadRows.length} leads`);
    
    // Truncate then insert
    const dataset = bq.dataset(DATASET);
    try { await bq.query(`DELETE FROM \`${GCP_PROJECT}.${DATASET}.clinics\` WHERE TRUE`); } catch(e) {}
    try { await bq.query(`DELETE FROM \`${GCP_PROJECT}.${DATASET}.patient_leads\` WHERE TRUE`); } catch(e) {}
    
    // Insert clinics in batches
    if (clinicRows.length > 0) {
      for (let i = 0; i < clinicRows.length; i += 500) {
        const batch = clinicRows.slice(i, i + 500);
        try {
          await dataset.table('clinics').insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true });
        } catch (err) {
          if (err.errors) console.warn(`Clinic batch ${i} partial errors:`, JSON.stringify(err.errors.slice(0, 2)));
          else console.error(`Clinic batch ${i}:`, err.message);
        }
      }
    }
    
    // Insert leads in batches
    if (leadRows.length > 0) {
      for (let i = 0; i < leadRows.length; i += 500) {
        const batch = leadRows.slice(i, i + 500);
        try {
          await dataset.table('patient_leads').insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true });
        } catch (err) {
          if (err.errors) console.warn(`Lead batch ${i} partial errors:`, JSON.stringify(err.errors.slice(0, 2)));
          else console.error(`Lead batch ${i}:`, err.message);
        }
      }
    }
    
    console.log(`✅ Synced ${clinicRows.length} clinics and ${leadRows.length} leads`);
    
    res.status(200).json({
      success: true,
      clinicsSynced: clinicRows.length,
      leadsSynced: leadRows.length,
      decisionMakers: dms.length,
      enrichedWithEmail: dms.filter(d => d.email).length,
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});
