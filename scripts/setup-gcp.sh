#!/bin/bash
# ─── Novalyte GCP / Vertex AI Setup ───
# Run this script to enable Vertex AI and get an access token.
# Usage: bash scripts/setup-gcp.sh

set -e

PROJECT_ID="warp-486714"
REGION="us-central1"

echo "═══ Novalyte GCP Setup ═══"
echo ""

# 1. Set project
echo "→ Setting project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# 2. Enable Vertex AI API
echo "→ Enabling Vertex AI API..."
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID"

# 3. Also enable Generative Language API (Gemini) as fallback
echo "→ Enabling Generative Language API..."
gcloud services enable generativelanguage.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true

# 4. Enable Cloud Resource Manager (needed for some operations)
echo "→ Enabling Cloud Resource Manager..."
gcloud services enable cloudresourcemanager.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true

# 5. Get access token
echo "→ Generating access token..."
TOKEN=$(gcloud auth print-access-token)

if [ -z "$TOKEN" ]; then
  echo "✗ Failed to get access token. Run: gcloud auth login"
  exit 1
fi

echo ""
echo "✓ Vertex AI enabled on project $PROJECT_ID"
echo "✓ Access token generated"
echo ""

# 6. Update .env file
if [ -f .env ]; then
  # Replace the access token line
  if grep -q "VITE_GCP_ACCESS_TOKEN=" .env; then
    sed -i '' "s|VITE_GCP_ACCESS_TOKEN=.*|VITE_GCP_ACCESS_TOKEN=$TOKEN|" .env
    echo "✓ Updated VITE_GCP_ACCESS_TOKEN in .env"
  else
    echo "VITE_GCP_ACCESS_TOKEN=$TOKEN" >> .env
    echo "✓ Added VITE_GCP_ACCESS_TOKEN to .env"
  fi
else
  echo "⚠ No .env file found — add this to your .env:"
  echo "  VITE_GCP_ACCESS_TOKEN=$TOKEN"
fi

echo ""
echo "═══ Setup Complete ═══"
echo ""
echo "Your Vertex AI endpoint:"
echo "  https://$REGION-aiplatform.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/publishers/google/models/gemini-2.0-flash:generateContent"
echo ""
echo "Note: Access tokens expire after ~1 hour."
echo "To refresh, run: gcloud auth print-access-token"
echo "Or re-run this script: bash scripts/setup-gcp.sh"
