#!/bin/bash
# ─── Novalyte ABM — Cloud Run CI/CD Setup (Workload Identity Federation) ───
# No service account keys needed — GitHub authenticates via OIDC.
# Prerequisites: gcloud CLI authenticated as kaizen@novalyte.io

set -euo pipefail

PROJECT_ID="warp-486714"
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"
GITHUB_REPO="novalyte-logic/novalyte-abm"

echo "═══ Setting up Cloud Run deployment (Workload Identity Federation) ═══"
echo "  Project: ${PROJECT_ID} (${PROJECT_NUMBER})"
echo ""

# 1. Enable required APIs
echo "→ Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# 2. Create service account (skip if exists)
echo "→ Creating service account: ${SA_NAME}..."
gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" 2>/dev/null || \
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="GitHub Actions Deploy" \
    --project="${PROJECT_ID}"

# 3. Grant roles
echo "→ Granting IAM roles..."
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/storage.admin; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --quiet > /dev/null 2>&1
  echo "  ✓ ${ROLE}"
done

# 4. Create Workload Identity Pool
echo "→ Creating Workload Identity Pool..."
gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" 2>/dev/null || \
gcloud iam workload-identity-pools create "${POOL_NAME}" \
  --location="global" \
  --display-name="GitHub Actions Pool" \
  --project="${PROJECT_ID}"

# 5. Create OIDC Provider
echo "→ Creating OIDC Provider..."
gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
  --workload-identity-pool="${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" 2>/dev/null || \
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
  --workload-identity-pool="${POOL_NAME}" \
  --location="global" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
  --project="${PROJECT_ID}"

# 6. Allow GitHub to impersonate the service account
echo "→ Binding Workload Identity to service account..."
POOL_ID=$(gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --project="${PROJECT_ID}" --quiet > /dev/null 2>&1

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Workload Identity Federation configured!"
echo ""
echo "  Now add these GitHub repo secrets at:"
echo "  https://github.com/${GITHUB_REPO}/settings/secrets/actions"
echo ""
echo "  1. GCP_WIF_PROVIDER → ${WIF_PROVIDER}"
echo "  2. GCP_SA_EMAIL     → ${SA_EMAIL}"
echo ""
echo "  3. Add each VITE_* env var as a separate secret:"
echo "     VITE_GEMINI_API_KEY"
echo "     VITE_GOOGLE_PLACES_API_KEY"
echo "     VITE_EXA_API_KEY"
echo "     VITE_REVENUEBASE_API_KEY"
echo "     VITE_SERPAPI_KEY"
echo "     VITE_GCP_PROJECT_ID"
echo "     VITE_GCP_LOCATION"
echo "     VITE_VAPI_API_KEY"
echo "     VITE_VAPI_PUBLIC_KEY"
echo "     VITE_VAPI_PHONE_NUMBER_ID"
echo "     VITE_VAPI_PHONE_NUMBER"
echo "     VITE_VAPI_ASSISTANT_ID"
echo "     VITE_SUPABASE_URL"
echo "     VITE_SUPABASE_ANON_KEY"
echo "     VITE_SUPABASE_SERVICE_ROLE_KEY"
echo "     VITE_RESEND_API_KEY"
echo ""
echo "  4. Push to main → auto-deploys to Cloud Run 🚀"
echo "═══════════════════════════════════════════════════════════"
