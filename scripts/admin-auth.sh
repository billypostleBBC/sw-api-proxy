#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  cat <<'USAGE'
Usage:
  scripts/admin-auth.sh <base_url> <admin_email> [cookie_jar_path]

Example:
  scripts/admin-auth.sh https://proxy.example.com admin@bbc.co.uk
USAGE
  exit 1
fi

BASE_URL="$1"
ADMIN_EMAIL="$2"
COOKIE_JAR="${3:-${TMPDIR:-/tmp}/proxy-api-admin.cookie}"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

REQ_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/admin/auth/magic-link/request" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$ADMIN_EMAIL\"}")

if [[ "$REQ_STATUS" != "204" ]]; then
  echo "Failed to request admin magic link (HTTP $REQ_STATUS)."
  cat "$BODY_FILE"
  exit 1
fi

echo "Magic link requested for $ADMIN_EMAIL."
read -r -p "Paste magic-link token from email: " MAGIC_TOKEN

VERIFY_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/admin/auth/magic-link/verify" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_JAR" \
  --data "{\"token\":\"$MAGIC_TOKEN\"}")

if [[ "$VERIFY_STATUS" != "200" ]]; then
  echo "Failed to verify admin magic link (HTTP $VERIFY_STATUS)."
  cat "$BODY_FILE"
  exit 1
fi

echo "Admin session established."
echo "cookie_jar=$COOKIE_JAR"
