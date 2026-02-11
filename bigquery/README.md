# Novalyte Intelligence Pipeline
## BigQuery + Vertex AI for Clinic Propensity Scoring

### What This Does

1. **Syncs data** from Supabase → BigQuery (clinics, leads, engagement history)
2. **Trains ML model** to predict which clinics are most likely to convert
3. **Scores all clinics** with propensity scores (0-1) and tiers (hot/warm/cold)
4. **Identifies top prospects** for Kaizen voice agent outreach
5. **Computes market intelligence** (supply/demand ratios, opportunity scores by city)

### Setup

```bash
# 1. Install dependencies
npm install @google-cloud/bigquery @supabase/supabase-js
pip3 install google-cloud-bigquery

# 2. Create BigQuery dataset and tables
bq --project_id=warp-486714 mk --dataset --location=US novalyte_intelligence
bq query --project_id=warp-486714 --use_legacy_sql=false < bigquery/schema.sql

# 3. Run initial sync
node bigquery/sync.js

# 4. Train propensity model
python3 bigquery/train_propensity_model.py
```

### Usage

**Daily sync** (run via cron or Cloud Scheduler):
```bash
node bigquery/sync.js && python3 bigquery/train_propensity_model.py
```

**Query top prospects** in BigQuery console:
```sql
SELECT
  name, city, state, phone, email,
  propensity_score, propensity_tier,
  affluence_score, services
FROM `warp-486714.novalyte_intelligence.clinics`
WHERE propensity_tier = 'hot'
  AND NOT converted
  AND (last_outreach_date IS NULL OR last_outreach_date < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
ORDER BY propensity_score DESC
LIMIT 100;
```

**Export for Voice Agent**:
```bash
bq extract --destination_format=CSV \
  'warp-486714:novalyte_intelligence.clinics' \
  gs://novalyte-exports/hot-prospects-$(date +%Y%m%d).csv
```

### What Gets Scored

The model learns from:
- Clinic type, rating, review count
- Market affluence, median income, population
- Number of services offered
- Outreach history (emails sent, opened, calls made)
- Response rate to previous outreach
- Whether clinic converted (in CRM)

### Propensity Tiers

- **Hot (≥70%)**: High likelihood to convert — prioritize for Kaizen calls
- **Warm (40-69%)**: Moderate likelihood — good for email sequences
- **Cold (<40%)**: Low likelihood — deprioritize or nurture long-term

### Market Intelligence

The `market_intelligence` table shows:
- Supply/demand ratio (leads per clinic)
- Market opportunity score (demand × affluence / supply)
- Treatment-specific demand by city
- Where to recruit new clinics (high demand, low supply)

### Integration with Dashboard

Add a "Propensity Score" column to the CRM and sort by it. Clinics with high scores get priority for outreach.

### Automation

Set up Cloud Scheduler to run sync + scoring daily:
```bash
gcloud scheduler jobs create http novalyte-intelligence-sync \
  --schedule="0 2 * * *" \
  --uri="https://YOUR_CLOUD_FUNCTION_URL/sync" \
  --http-method=POST
```
