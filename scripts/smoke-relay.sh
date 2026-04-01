#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  cat <<'USAGE'
Usage:
  RELAY_PASSWORD=<shared-relay-password> scripts/smoke-relay.sh <relay_base_url> <email> <tool_slug> <model>

Example:
  RELAY_PASSWORD='***' scripts/smoke-relay.sh https://relay.example.com billy.postle@bbc.com figma-alt-text gpt-5-mini-2025-08-07
USAGE
  exit 1
fi

if [[ -z "${RELAY_PASSWORD:-}" ]]; then
  echo "login_check=failed"
  echo "message=Set RELAY_PASSWORD in the environment before running this script."
  exit 1
fi

BASE_URL="$1"
EMAIL="$2"
TOOL_SLUG="$3"
MODEL="$4"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

LOGIN_PAYLOAD=$(node -e 'const [email, password] = process.argv.slice(1); process.stdout.write(JSON.stringify({ email, password }));' \
  "$EMAIL" "$RELAY_PASSWORD")

LOGIN_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  --data "$LOGIN_PAYLOAD")

if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "login_check=failed"
  echo "login_status=$LOGIN_STATUS"
  cat "$BODY_FILE"
  exit 1
fi

TOKEN=$(node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const body = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!body.token || typeof body.token !== "string") {
    process.exit(1);
  }
  process.stdout.write(body.token);
' "$BODY_FILE") || {
  echo "login_check=failed"
  echo "message=Login succeeded but no relay bearer token was returned."
  cat "$BODY_FILE"
  exit 1
}

echo "login_check=passed"

RESP_PAYLOAD=$(node -e 'const model = process.argv[1]; process.stdout.write(JSON.stringify({ model, input: "relay smoke test" }));' "$MODEL")

RESP_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/v1/tools/$TOOL_SLUG/responses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "$RESP_PAYLOAD")

if [[ "$RESP_STATUS" != "200" ]]; then
  echo "responses_check=failed"
  echo "responses_status=$RESP_STATUS"
  cat "$BODY_FILE"
  exit 1
fi

echo "responses_check=passed"
echo "smoke_status=passed"
