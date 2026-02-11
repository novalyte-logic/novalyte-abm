# Novalyte BigQuery + Vertex AI Intelligence Pipeline

Complete ML-powered clinic propensity scoring system using BigQuery ML and Vertex AI.

## Architecture

```
Supabase (1,500+ clinics) 
    ↓
BigQuery (data warehouse)
    ↓
BigQuery ML (logistic regression)
    ↓
Propensity Scores (hot/warm/cold)
    ↓
Dashboard UI (top prospects)
```

## Components

1. **BigQuery Schema** (`schema.sql`) - Tables for clinics, leads, matches, market intelligence
2. **Cloud Functions** - 3 serverless functions for sync, train, score
3. **Dashboard UI** (`AIEngine.tsx`) - One-click pipeline execution
4. **Training Script** (`train_propensity_model.py`) - Reference implementation (optional)

## Setup Instructions

### 1. Create BigQuery Dataset

```bash
bq --project_id=warp-486714 mk --dataset --location=US novalyte_intelligence
```

### 2. Create Tables

Run `schema.sql` in BigQuery SQL Editor:
https://console.cloud.google.com/bigquery?project=warp-486714

Or via CLI:
```bash
bq query --project_id=warp-486714 --use_legacy_sql=false < schema.sql
```

### 3. Deploy Cloud Functions

```bash
cd cloud-functions
chmod +x deploy-bigquery.sh
./deploy-bigquery.sh
```

This deploys 3 functions:
- `bigquery-sync` - Syncs Supabase → BigQuery
- `bigquery-train` - Trains ML model
- `bigquery-score` - Scores all clinics

### 4. Test Pipeline

1. Open dashboard at https://intel.novalyte.io
2. Navigate to "AI Engine" in sidebar
3. Click "Run Pipeline"
4. Watch progress: Sync → Train → Score
5. Export top prospects as CSV

## How It Works

### Step 1: Data Sync
- Fetches all clinics from Supabase `clinics` table
- Fetches all leads from `leads` table
- Enriches with market data, engagement history, CRM status
- Inserts into BigQuery tables

### Step 2: Model Training
- Uses BigQuery ML `LOGISTIC_REG` model
- Training data: clinics with outreach history
- Features: rating, affluence, engagement metrics, market data
- Label: `converted` (boolean)
- Auto-balances classes, runs 50 iterations

### Step 3: Scoring
- Predicts conversion probability for all unconverted clinics
- Assigns tier: hot (≥70%), warm (≥40%), cold (<40%)
- Returns top 50 prospects not contacted in last 30 days

## Model Features

The ML model uses these features to predict conversion:
- Clinic type (med spa, wellness, etc.)
- Google rating & review count
- Market affluence score & median income
- Market population
- Service count (breadth of offerings)
- Outreach count, response count, calls, emails
- Email open rate, response rate

## Output

Top prospects include:
- Clinic name, location, contact info
- Propensity score (0-100%)
- Propensity tier (hot/warm/cold)
- Affluence score
- Services offered

Export as CSV for:
- Voice Agent bulk upload
- Email campaign targeting
- Sales team prioritization

## Performance

- Sync: ~30 seconds for 1,500 clinics
- Train: ~60 seconds (BigQuery ML is fast)
- Score: ~20 seconds
- Total: ~2 minutes end-to-end

## Cost Estimate

BigQuery pricing (on-demand):
- Storage: $0.02/GB/month (~$0.10/month for 5GB)
- Queries: $5/TB processed (~$0.05/run)
- ML training: $250/TB processed (~$0.25/run)

Cloud Functions:
- Free tier: 2M invocations/month
- Estimated: <$1/month

Total: ~$2-5/month

## Monitoring

Check Cloud Function logs:
```bash
gcloud functions logs read bigquery-sync --project=warp-486714 --limit=50
gcloud functions logs read bigquery-train --project=warp-486714 --limit=50
gcloud functions logs read bigquery-score --project=warp-486714 --limit=50
```

Check BigQuery jobs:
https://console.cloud.google.com/bigquery?project=warp-486714&page=jobs

## Troubleshooting

**Error: Dataset not found**
- Run: `bq mk --dataset --location=US novalyte_intelligence`

**Error: Table not found**
- Run `schema.sql` in BigQuery console

**Error: Model not found**
- Run training step first (it creates the model)

**Error: No training data**
- Ensure you have clinics with `outreach_count > 0` in Supabase
- Add some test outreach data if needed

**Error: Permission denied**
- Ensure Cloud Functions have BigQuery permissions
- Check IAM roles for service account

## Next Steps

1. **Automate**: Schedule daily runs via Cloud Scheduler
2. **Integrate**: Auto-load hot prospects into Voice Agent
3. **Refine**: Add more features (website quality, social presence)
4. **Expand**: Add lead-to-clinic matching predictions
5. **Monitor**: Track model accuracy over time, retrain monthly

## Files

- `schema.sql` - BigQuery table definitions
- `sync.js` - Node.js sync script (reference)
- `train_propensity_model.py` - Python training script (reference)
- `cloud-functions/bigquery-sync/` - Sync Cloud Function
- `cloud-functions/bigquery-train/` - Train Cloud Function
- `cloud-functions/bigquery-score/` - Score Cloud Function
- `cloud-functions/deploy-bigquery.sh` - Deployment script

## Support

Questions? Check:
- BigQuery ML docs: https://cloud.google.com/bigquery/docs/bqml-introduction
- Cloud Functions docs: https://cloud.google.com/functions/docs
- Supabase docs: https://supabase.com/docs
