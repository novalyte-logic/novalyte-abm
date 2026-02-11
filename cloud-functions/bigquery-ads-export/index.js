const functions = require('@google-cloud/functions-framework');
const { BigQuery } = require('@google-cloud/bigquery');

const GCP_PROJECT = 'warp-486714';
const DATASET = 'novalyte_intelligence';
const bq = new BigQuery({ projectId: GCP_PROJECT });

functions.http('bigqueryAdsExportHandler', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { format = 'json', tier = 'all', limit = 500 } = req.body || {};

    const tierFilter = tier === 'all'
      ? "cs.propensity_tier IN ('hot', 'warm', 'cold')"
      : `cs.propensity_tier = '${tier}'`;

    // Pull scored clinics with full data for ad generation
    const [rows] = await bq.query(`
      WITH deduped AS (
        SELECT
          cs.clinic_id, cs.name, cs.city, cs.state,
          cs.phone, cs.email, cs.propensity_tier,
          MAX(cs.propensity_score) as lead_score,
          MAX(cs.affluence_score) as affluence_score,
          ANY_VALUE(cs.services) as services,
          -- Pull extra data from clinics table
          MAX(c.website) as website,
          MAX(c.rating) as rating,
          MAX(c.review_count) as review_count,
          MAX(c.market_city) as market_city,
          MAX(c.market_state) as market_state,
          MAX(c.median_income) as median_income,
          MAX(c.market_population) as market_population,
          MAX(c.manager_name) as dm_name,
          MAX(c.manager_email) as dm_email
        FROM \`${GCP_PROJECT}.${DATASET}.clinic_scores\` cs
        LEFT JOIN \`${GCP_PROJECT}.${DATASET}.clinics\` c ON cs.clinic_id = c.clinic_id
        WHERE ${tierFilter}
        GROUP BY cs.clinic_id, cs.name, cs.city, cs.state, cs.phone, cs.email, cs.propensity_tier
      )
      SELECT * FROM deduped
      ORDER BY lead_score DESC
      LIMIT ${Math.min(Number(limit), 2000)}
    `);

    // Aggregate market-level stats for ad targeting
    const marketMap = new Map();
    rows.forEach(r => {
      const key = `${r.city}, ${r.state}`;
      if (!marketMap.has(key)) {
        marketMap.set(key, {
          market: key, city: r.city, state: r.state,
          clinic_count: 0, avg_lead_score: 0, avg_affluence: 0,
          top_services: new Map(), hot_count: 0, warm_count: 0,
          median_income: r.median_income, population: r.market_population,
        });
      }
      const m = marketMap.get(key);
      m.clinic_count++;
      m.avg_lead_score += Number(r.lead_score) || 0;
      m.avg_affluence += Number(r.affluence_score) || 0;
      if (r.propensity_tier === 'hot') m.hot_count++;
      if (r.propensity_tier === 'warm') m.warm_count++;
      (r.services || []).forEach(s => m.top_services.set(s, (m.top_services.get(s) || 0) + 1));
    });

    const markets = Array.from(marketMap.values()).map(m => ({
      ...m,
      avg_lead_score: +(m.avg_lead_score / m.clinic_count).toFixed(3),
      avg_affluence: +(m.avg_affluence / m.clinic_count).toFixed(1),
      top_services: Array.from(m.top_services.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([svc]) => svc),
    })).sort((a, b) => b.hot_count - a.hot_count || b.clinic_count - a.clinic_count);

    // Build response
    const clinics = rows.map(r => ({
      clinic_id: r.clinic_id,
      name: r.name,
      city: r.city,
      state: r.state,
      phone: r.phone || null,
      email: r.email || null,
      website: r.website || null,
      lead_score: Number(r.lead_score) || 0,
      tier: r.propensity_tier,
      affluence_score: Number(r.affluence_score) || 0,
      rating: Number(r.rating) || null,
      review_count: Number(r.review_count) || 0,
      services: r.services || [],
      dm_name: r.dm_name || null,
      dm_email: r.dm_email || null,
      median_income: Number(r.median_income) || null,
      population: Number(r.market_population) || null,
    }));

    if (format === 'csv') {
      // Google Ads Editor compatible CSV
      const header = 'Campaign,Ad Group,Headline 1,Headline 2,Headline 3,Description 1,Description 2,Final URL,Path 1,Path 2,Location Target,Clinic Name,City,State,Services,Lead Score,Tier,Affluence';
      const csvRows = clinics.map(c => {
        const svc = (c.services || []).slice(0, 2).join(' & ') || "Men's Health";
        const campaign = `Novalyte - ${c.state}`;
        const adGroup = `${c.city} - ${svc}`;
        const h1 = `${c.city} Men's Health`.slice(0, 30);
        const h2 = `${svc} Experts`.slice(0, 30);
        const h3 = 'Book Free Consult Today'.slice(0, 30);
        const d1 = `Explore ${svc.toLowerCase()} options at a top-rated clinic in ${c.city}. Schedule your consultation.`.slice(0, 90);
        const d2 = `Trusted by men in ${c.city}. Personalized treatment plans. Results-driven care.`.slice(0, 90);
        const url = 'https://ads.novalyte.io';
        return [campaign, adGroup, h1, h2, h3, d1, d2, url, 'mens-health', c.city.toLowerCase().replace(/\s+/g, '-'),
          `${c.city}, ${c.state}`, c.name, c.city, c.state, (c.services || []).join('; '),
          c.lead_score, c.tier, c.affluence_score
        ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',');
      });
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', 'attachment; filename=novalyte-ads-export.csv');
      res.status(200).send([header, ...csvRows].join('\n'));
      return;
    }

    // JSON format — full data for AI Studio
    res.status(200).json({
      success: true,
      exported_at: new Date().toISOString(),
      total_clinics: clinics.length,
      total_markets: markets.length,
      summary: {
        hot: clinics.filter(c => c.tier === 'hot').length,
        warm: clinics.filter(c => c.tier === 'warm').length,
        cold: clinics.filter(c => c.tier === 'cold').length,
        with_email: clinics.filter(c => c.email).length,
        with_website: clinics.filter(c => c.website).length,
        unique_services: [...new Set(clinics.flatMap(c => c.services))],
      },
      markets,
      clinics,
    });
  } catch (error) {
    console.error('Ads export error:', error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});
