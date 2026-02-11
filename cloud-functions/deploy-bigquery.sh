#!/bin/bash
# Deploy BigQuery ML Pipeline Cloud Functions
# Project: warp-486714
# Region: us-central1

set -e

PROJECT_ID="warp-486714"
REGION="us-central1"
SUPABASE_URL="https://zatsxsaetybdyzhxbnnj.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphdHN4c2FldHliZHl6aHhibm5qIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQ2MDExMiwiZXhwIjoyMDg2MDM2MTEyfQ.7tDKpMkqPfjbehLxBRwqng59NhyODA8MltX-LADIC4U"

echo "🚀 Deploying BigQuery ML Pipeline Cloud Functions..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Deploy bigquery-sync
echo "📦 Deploying bigquery-sync..."
cd bigquery-sync
gcloud functions deploy bigquery-sync \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=bigquerySyncHandler \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=$SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_KEY \
  --project=$PROJECT_ID \
  --memory=512MB \
  --timeout=540s
cd ..
echo "✅ bigquery-sync deployed"
echo ""

# Deploy bigquery-train
echo "📦 Deploying bigquery-train..."
cd bigquery-train
gcloud functions deploy bigquery-train \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=bigqueryTrainHandler \
  --trigger-http \
  --allow-unauthenticated \
  --project=$PROJECT_ID \
  --memory=512MB \
  --timeout=540s
cd ..
echo "✅ bigquery-train deployed"
echo ""

# Deploy bigquery-score
echo "📦 Deploying bigquery-score..."
cd bigquery-score
gcloud functions deploy bigquery-score \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=bigqueryScoreHandler \
  --trigger-http \
  --allow-unauthenticated \
  --project=$PROJECT_ID \
  --memory=512MB \
  --timeout=540s
cd ..
echo "✅ bigquery-score deployed"
echo ""

echo "🎉 All Cloud Functions deployed successfully!"
echo ""
echo "URLs:"
echo "  Sync:  https://$REGION-$PROJECT_ID.cloudfunctions.net/bigquery-sync"
echo "  Train: https://$REGION-$PROJECT_ID.cloudfunctions.net/bigquery-train"
echo "  Score: https://$REGION-$PROJECT_ID.cloudfunctions.net/bigquery-score"
echo ""
echo "Next steps:"
echo "  1. Create BigQuery dataset: bq --project_id=$PROJECT_ID mk --dataset --location=US novalyte_intelligence"
echo "  2. Run schema.sql in BigQuery console"
echo "  3. Test pipeline from AI Engine dashboard"
