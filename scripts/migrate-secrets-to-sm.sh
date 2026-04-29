#!/usr/bin/env bash
# migrate-secrets-to-sm.sh — move Cloud Run inline env vars into Secret Manager.
#
# Run this ONCE per environment when you're ready to stop having
# `DATABASE_URL` etc. in plaintext in Cloud Run service config (visible
# to anyone with run.services.get).
#
# Safety:
#   - Reads existing inline values via `gcloud run services describe`
#   - Creates SM secrets only when missing; never overwrites existing
#     versions (would break drift between SM & inline)
#   - Updates the service in a single `gcloud run services update` call
#     so Cloud Run does one atomic revision
#   - DOES NOT rotate any value. If you want rotation, do it after this
#     script via `gcloud secrets versions add`.
#
# Requires:
#   - `gcloud` authenticated, default project = gameclaw-492005
#   - `jq`
#
# Usage:
#   bash scripts/migrate-secrets-to-sm.sh           # dry-run, prints plan
#   bash scripts/migrate-secrets-to-sm.sh --apply   # actually do it
#
set -euo pipefail

PROJECT="gameclaw-492005"
SERVICE="adex"
REGION="us-central1"
APPLY="${1:-}"

# Env vars to migrate. Add/remove as you grow the secret surface.
SECRETS_TO_MIGRATE=(
  DATABASE_URL
  AUTH_TOKEN_SECRET
  CRON_SECRET
  GOOGLE_ADS_CLIENT_SECRET
  ANTHROPIC_API_KEY
)

echo "Reading current Cloud Run service config…"
CONFIG=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format=json)

ALREADY_SECRETS=$(gcloud secrets list --project "$PROJECT" --format='value(name)')

echo ""
echo "Plan:"
echo "====="
UPDATE_PAIRS=()
REMOVE_VARS=()
for KEY in "${SECRETS_TO_MIGRATE[@]}"; do
  INLINE=$(echo "$CONFIG" | jq -r --arg k "$KEY" '.spec.template.spec.containers[0].env[]? | select(.name == $k and .value != null) | .value')
  if [ -z "$INLINE" ] || [ "$INLINE" = "null" ]; then
    echo "  - $KEY: not set inline → skip"
    continue
  fi
  if echo "$ALREADY_SECRETS" | grep -qx "$KEY"; then
    echo "  - $KEY: SM secret exists, will reference :latest (NOT updating SM value)"
  else
    echo "  - $KEY: SM secret missing, will create with current inline value"
  fi
  UPDATE_PAIRS+=("${KEY}=${KEY}:latest")
  REMOVE_VARS+=("$KEY")
done

if [ ${#UPDATE_PAIRS[@]} -eq 0 ]; then
  echo ""
  echo "Nothing to migrate."
  exit 0
fi

echo ""
echo "Cloud Run will:"
echo "  --remove-env-vars=$(IFS=,; echo "${REMOVE_VARS[*]}")"
echo "  --update-secrets=$(IFS=,; echo "${UPDATE_PAIRS[*]}")"

if [ "$APPLY" != "--apply" ]; then
  echo ""
  echo "Dry run. Re-run with --apply to commit."
  exit 0
fi

echo ""
echo "Applying…"
# Step 1: create missing secrets with inline values
for KEY in "${SECRETS_TO_MIGRATE[@]}"; do
  INLINE=$(echo "$CONFIG" | jq -r --arg k "$KEY" '.spec.template.spec.containers[0].env[]? | select(.name == $k and .value != null) | .value')
  [ -z "$INLINE" ] || [ "$INLINE" = "null" ] && continue
  if ! echo "$ALREADY_SECRETS" | grep -qx "$KEY"; then
    echo "  Creating SM secret $KEY…"
    printf '%s' "$INLINE" | gcloud secrets create "$KEY" --data-file=- --project "$PROJECT" >/dev/null
  fi
done

# Step 2: single atomic Cloud Run update
echo "  Updating Cloud Run service…"
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --remove-env-vars="$(IFS=,; echo "${REMOVE_VARS[*]}")" \
  --update-secrets="$(IFS=,; echo "${UPDATE_PAIRS[*]}")" \
  >/dev/null

echo ""
echo "Done. Verify with:"
echo "  gcloud run services describe $SERVICE --region $REGION --project $PROJECT --format='yaml(spec.template.spec.containers[0].env)'"
