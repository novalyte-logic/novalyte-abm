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

    // Return ALL men's clinics (not just hot/warm) and carry scored fields when available.
    // This keeps the platform complete for men's health while still preserving verification signals.
    const [prospects] = await bq.query(`
      WITH score_ranked AS (
        SELECT
          cs.*,
          ROW_NUMBER() OVER (
            PARTITION BY cs.clinic_id
            ORDER BY cs.propensity_score DESC, cs.scored_at DESC
          ) AS rn
        FROM \`${GCP_PROJECT}.${DATASET}.clinic_scores\` cs
      ),
      clinic_base AS (
        SELECT
          c.clinic_id,
          c.name,
          c.city,
          c.state,
          c.phone,
          c.email,
          c.affluence_score,
          c.services,
          c.dm_email,
          c.dm_name,
          c.dm_title,
          c.dm_source,
          c.email_verification_status,
          c.dm_confidence,
          c.email_verified,
          c.website,
          c.rating,
          c.review_count,
          c.type
        FROM \`${GCP_PROJECT}.${DATASET}.clinics\` c
        WHERE
          LOWER(COALESCE(c.type, '')) LIKE '%men%'
          OR LOWER(COALESCE(c.name, '')) LIKE '%men%'
      ),
      merged AS (
        SELECT
          cb.clinic_id,
          cb.name,
          cb.city,
          cb.state,
          cb.phone,
          cb.email,
          cb.affluence_score,
          cb.services,
          cb.dm_email,
          cb.dm_name,
          cb.dm_title,
          cb.dm_source,
          cb.email_verification_status,
          cb.dm_confidence,
          cb.email_verified,
          cb.website,
          cb.rating,
          cb.review_count,
          COALESCE(sr.propensity_score, 0.0) AS propensity_score,
          COALESCE(
            sr.propensity_tier,
            CASE
              WHEN COALESCE(sr.propensity_score, 0.0) >= 0.7 THEN 'hot'
              WHEN COALESCE(sr.propensity_score, 0.0) >= 0.4 THEN 'warm'
              ELSE 'cold'
            END
          ) AS propensity_tier
        FROM clinic_base cb
        LEFT JOIN score_ranked sr
          ON cb.clinic_id = sr.clinic_id
          AND sr.rn = 1
      )
      SELECT * FROM merged
      ORDER BY propensity_score DESC, name ASC
      LIMIT 2500
    `);

    const counts = { hot: 0, warm: 0, cold: 0 };
    prospects.forEach((p) => {
      if (p.propensity_tier === 'hot') counts.hot += 1;
      else if (p.propensity_tier === 'warm') counts.warm += 1;
      else counts.cold += 1;
    });

    const [verificationSummaryResult] = await bq.query(`
      SELECT
        COUNT(*) AS total,
        COUNTIF(email_verified = TRUE) AS verified,
        COUNTIF(email_verification_status = 'risky') AS risky,
        COUNTIF(email_verification_status = 'invalid') AS invalid,
        COUNTIF(dm_email IS NULL) AS missing_dm_email
      FROM \`${GCP_PROJECT}.${DATASET}.clinics\`
      WHERE
        NOT converted
        AND (
          LOWER(COALESCE(type, '')) LIKE '%men%'
          OR LOWER(COALESCE(name, '')) LIKE '%men%'
        )
    `);
    const verificationSummary = verificationSummaryResult[0] || {};
    
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
        website: p.website || null,
        rating: Number(p.rating) || null,
        review_count: Number(p.review_count) || 0,
        dm_email: p.dm_email || null,
        dm_name: p.dm_name || null,
        dm_title: p.dm_title || null,
        dm_source: p.dm_source || null,
        email_verification_status: p.email_verification_status || null,
        dm_confidence: Number(p.dm_confidence) || 0,
        email_verified: !!p.email_verified,
        propensity_score: Number(p.propensity_score) || 0,
        propensity_tier: p.propensity_tier,
        affluence_score: Number(p.affluence_score) || 0,
        services: p.services || [],
        is_duplicate: p.is_duplicate || false,
      })),
      verification: {
        total: Number(verificationSummary.total || 0),
        verified: Number(verificationSummary.verified || 0),
        risky: Number(verificationSummary.risky || 0),
        invalid: Number(verificationSummary.invalid || 0),
        missing_dm_email: Number(verificationSummary.missing_dm_email || 0),
      },
    });
  } catch (error) {
    console.error('Scoring error:', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});
