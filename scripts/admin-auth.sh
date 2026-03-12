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
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_PASSWORD" ]]; then
  read -r -s -p "Admin password: " ADMIN_PASSWORD
  echo
fi
[[ -n "$ADMIN_PASSWORD" ]] || {
  echo "Admin password is required."
  exit 1
}

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

LOGIN_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_JAR" \
  --data "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "Failed to sign in as admin (HTTP $LOGIN_STATUS)."
  cat "$BODY_FILE"
  exit 1
fi

echo "Admin session established."
echo "cookie_jar=$COOKIE_JAR"
