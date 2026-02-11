const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');

const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';
const MODEL_NAME = 'clinic_propensity_model';

const bq = new BigQuery({ projectId: GCP_PROJECT });

functions.http('bigqueryScoreHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    console.log('Scoring all clinics...');
    
    // Score all unconverted clinics
    const scoreQuery = `
      UPDATE \`${GCP_PROJECT}.${DATASET}.clinics\` c
      SET
        propensity_score = p.predicted_label_probs[OFFSET(1)].prob,
        propensity_tier = CASE
          WHEN p.predicted_label_probs[OFFSET(1)].prob >= 0.7 THEN 'hot'
          WHEN p.predicted_label_probs[OFFSET(1)].prob >= 0.4 THEN 'warm'
          ELSE 'cold'
        END,
        last_scored_at = CURRENT_TIMESTAMP()
      FROM (
        SELECT
          clinic_id,
          predicted_label_probs
        FROM ML.PREDICT(MODEL \`${GCP_PROJECT}.${DATASET}.${MODEL_NAME}\`, (
          SELECT
            clinic_id,
            type,
            rating,
            review_count,
            affluence_score,
            median_income,
            market_population,
            ARRAY_LENGTH(services) as service_count,
            outreach_count,
            response_count,
            calls_count,
            emails_sent,
            emails_opened,
            CASE WHEN emails_sent > 0 THEN emails_opened / emails_sent ELSE 0 END as email_open_rate,
            CASE WHEN outreach_count > 0 THEN response_count / outreach_count ELSE 0 END as response_rate
          FROM \`${GCP_PROJECT}.${DATASET}.clinics\`
          WHERE NOT converted
        ))
      ) p
      WHERE c.clinic_id = p.clinic_id;
    `;
    
    await bq.query(scoreQuery);
    console.log('✅ Clinics scored');
    
    // Get tier counts
    const countQuery = `
      SELECT
        propensity_tier,
        COUNT(*) as count
      FROM \`${GCP_PROJECT}.${DATASET}.clinics\`
      WHERE propensity_tier IS NOT NULL
      GROUP BY propensity_tier;
    `;
    
    const [countResults] = await bq.query(countQuery);
    const counts = { hot: 0, warm: 0, cold: 0 };
    countResults.forEach(row => {
      counts[row.propensity_tier] = row.count;
    });
    
    // Get top prospects (hot + warm, not recently contacted)
    const prospectsQuery = `
      SELECT
        clinic_id,
        name,
        city,
        state,
        phone,
        email,
        propensity_score,
        propensity_tier,
        affluence_score,
        services
      FROM \`${GCP_PROJECT}.${DATASET}.clinics\`
      WHERE propensity_tier IN ('hot', 'warm')
        AND NOT converted
        AND (last_outreach_date IS NULL OR last_outreach_date < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
      ORDER BY propensity_score DESC
      LIMIT 50;
    `;
    
    const [prospects] = await bq.query(prospectsQuery);
    
    console.log(`Found ${prospects.length} top prospects`);
    
    res.status(200).json({
      success: true,
      hotProspects: counts.hot,
      warmProspects: counts.warm,
      coldProspects: counts.cold,
      topProspects: prospects.map(p => ({
        clinic_id: p.clinic_id,
        name: p.name,
        city: p.city,
        state: p.state,
        phone: p.phone,
        email: p.email,
        propensity_score: p.propensity_score,
        propensity_tier: p.propensity_tier,
        affluence_score: p.affluence_score,
        services: p.services,
      })),
    });
  } catch (error) {
    console.error('Scoring error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
