#!/bin/bash
# Deploy Novalyte ABM to Cloud Run via Cloud Build (local invocation).
#
# Prereqs:
# - gcloud authenticated to the target project
# - .env contains VITE_* values (or export them in your shell)
#
# Notes:
# - Cloud Build substitutions use comma-separated KEY=VALUE pairs; commas must be escaped as \\,.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-warp-486714}"
REGION="${REGION:-us-central1}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "❌ gcloud not found. Install the Google Cloud SDK first."
  exit 1
fi

if [ ! -f cloudbuild.yaml ]; then
  echo "❌ cloudbuild.yaml not found in repo root."
  exit 1
fi

read_env_var() {
  local key="$1"
  local val=""

  # Prefer process env
  if [ -n "${!key:-}" ]; then
    val="${!key}"
  fi

  # Fallback to .env if present (first match wins)
  if [ -z "${val}" ] && [ -f .env ]; then
    # shellcheck disable=SC2002
    val="$(cat .env | sed -n "s/^${key}=//p" | head -n 1 || true)"
  fi

  # Strip surrounding quotes if present
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"

  echo -n "${val}"
}

escape_subst_value() {
  local v="$1"
  # Escape backslash first, then commas (Cloud Build substitutions delimiter).
  v="${v//\\/\\\\}"
  v="${v//,/\\,}"
  # Escape equals (Cloud Build uses KEY=VALUE pairs).
  v="${v//=/\\=}"
  # Remove newlines
  v="${v//$'\n'/}"
  echo -n "${v}"
}

# Custom substitution keys referenced in cloudbuild.yaml.
keys=(
  VITE_GEMINI_API_KEY
  VITE_GOOGLE_PLACES_API_KEY
  VITE_EXA_API_KEY
  VITE_REVENUEBASE_API_KEY
  VITE_SERPAPI_KEY
  VITE_GCP_PROJECT_ID
  VITE_GCP_LOCATION
  VITE_VAPI_API_KEY
  VITE_VAPI_PUBLIC_KEY
  VITE_VAPI_PHONE_NUMBER_ID
  VITE_VAPI_PHONE_NUMBER
  VITE_VAPI_ASSISTANT_ID
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  VITE_SUPABASE_SERVICE_ROLE_KEY
  VITE_RESEND_API_KEY
  VITE_APOLLO_API_KEY
  VITE_APOLLO_API_KEYS
  VITE_BEDROCK_API_KEY
  VITE_AWS_REGION
  VITE_LEADMAGIC_API_KEY
  VITE_SLACK_WEBHOOK_URL
)

substitutions=""
for k in "${keys[@]}"; do
  raw="$(read_env_var "${k}")"
  # gcloud --substitutions is extremely strict; values with lists (commas/brackets) often break parsing.
  # The app can run fine with the single-key variant.
  if [ "${k}" = "VITE_APOLLO_API_KEYS" ]; then
    raw=""
  fi
  esc="$(escape_subst_value "${raw}")"
  # Cloud Build requires user-defined substitutions to start with underscore.
  pair="_${k}=${esc}"
  if [ -z "${substitutions}" ]; then
    substitutions="${pair}"
  else
    substitutions="${substitutions},${pair}"
  fi
done

echo "→ Submitting build to Cloud Build (project=${PROJECT_ID}, region=${REGION})..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --config=cloudbuild.yaml \
  --substitutions="${substitutions}"
