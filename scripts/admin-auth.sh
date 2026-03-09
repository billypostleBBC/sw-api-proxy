#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  cat <<'USAGE'
Usage:
  scripts/admin-auth.sh <base_url> [cookie_jar_path]

Example:
  scripts/admin-auth.sh https://proxy.example.com
USAGE
  exit 1
fi

BASE_URL="$1"
COOKIE_JAR="${2:-${TMPDIR:-/tmp}/proxy-api-admin.cookie}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_PASSWORD" ]]; then
  read -r -s -p "Admin password: " ADMIN_PASSWORD
  echo
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "Admin password is required."
  exit 1
fi

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

read -r -s -p "Admin password: " ADMIN_PASSWORD
echo

LOGIN_PAYLOAD=$(node -e 'const [email,password]=process.argv.slice(1); process.stdout.write(JSON.stringify({email,password}));' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")

LOGIN_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_JAR" \
  --data "$LOGIN_PAYLOAD")

if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "Failed to login as admin (HTTP $LOGIN_STATUS)."
  cat "$BODY_FILE"
  exit 1
fi

echo "Admin session established."
echo "cookie_jar=$COOKIE_JAR"
