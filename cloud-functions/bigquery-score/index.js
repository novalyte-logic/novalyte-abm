const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');

const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';

const bq = new BigQuery({ projectId: GCP_PROJECT });

functions.http('bigqueryScoreHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    console.log('Reading clinic scores...');
    
    // Get tier counts from clinic_scores table (deduplicated)
    const [countResults] = await bq.query(`
      SELECT propensity_tier, COUNT(*) as count
      FROM (
        SELECT clinic_id, propensity_tier
        FROM \`${GCP_PROJECT}.${DATASET}.clinic_scores\`
        WHERE propensity_tier IS NOT NULL
        GROUP BY clinic_id, propensity_tier
      )
      GROUP BY propensity_tier
    `);
    const counts = { hot: 0, warm: 0, cold: 0 };
    countResults.forEach(row => { counts[row.propensity_tier] = Number(row.count); });
    
    // Get top prospects (hot + warm, deduplicated)
    const [prospects] = await bq.query(`
      SELECT clinic_id, name, city, state, phone, email,
        MAX(propensity_score) as propensity_score, propensity_tier,
        MAX(affluence_score) as affluence_score, ANY_VALUE(services) as services
      FROM \`${GCP_PROJECT}.${DATASET}.clinic_scores\`
      WHERE propensity_tier IN ('hot', 'warm')
      GROUP BY clinic_id, name, city, state, phone, email, propensity_tier
      ORDER BY propensity_score DESC
      LIMIT 50
    `);
    
    console.log(`Found ${prospects.length} top prospects (${counts.hot} hot, ${counts.warm} warm, ${counts.cold} cold)`);
    
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
        phone: p.phone || null,
        email: p.email || null,
        propensity_score: Number(p.propensity_score) || 0,
        propensity_tier: p.propensity_tier,
        affluence_score: Number(p.affluence_score) || 0,
        services: p.services || [],
      })),
    });
  } catch (error) {
    console.error('Scoring error:', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});
