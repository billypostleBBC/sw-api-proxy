#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  cat <<'USAGE'
Usage:
  scripts/smoke-proxy.sh <base_url> <tool_token> [model]

Example:
  scripts/smoke-proxy.sh https://proxy.example.com tt.x.y gpt-4.1-mini
USAGE
  exit 1
fi

BASE_URL="$1"
TOOL_TOKEN="$2"
MODEL="${3:-gpt-4.1-mini}"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

MODELS_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X GET "$BASE_URL/proxy/v1/models" \
  -H "Authorization: Bearer $TOOL_TOKEN")

if [[ "$MODELS_STATUS" != "200" ]]; then
  echo "models_check=failed"
  echo "models_status=$MODELS_STATUS"
  cat "$BODY_FILE"
  exit 1
fi

echo "models_check=passed"

RESP_PAYLOAD=$(node -e 'const model=process.argv[1];process.stdout.write(JSON.stringify({model,input:"proxy smoke test"}));' "$MODEL")
RESP_STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/proxy/v1/responses" \
  -H "Authorization: Bearer $TOOL_TOKEN" \
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
