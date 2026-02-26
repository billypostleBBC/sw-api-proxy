#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/onboard-server-tool.sh \
    --base-url <url> \
    --cookie-jar <path> \
    --project-slug <slug> \
    --project-name <name> \
    --environment <env> \
    --owner-email <email> \
    --daily-token-cap <int> \
    --rpm-cap <int> \
    --tool-slug <slug> \
    [--tool-mode server|browser|both] \
    [--openai-api-key <key>]

Example:
  scripts/onboard-server-tool.sh \
    --base-url https://proxy.example.com \
    --cookie-jar /tmp/proxy-api-admin.cookie \
    --project-slug story-assistant-prod \
    --project-name "Story Assistant" \
    --environment prod \
    --owner-email owner@bbc.co.uk \
    --daily-token-cap 2000000 \
    --rpm-cap 60 \
    --tool-slug story-assistant-server \
    --tool-mode server
USAGE
}

die() {
  echo "$1" >&2
  exit 1
}

BASE_URL=""
COOKIE_JAR=""
PROJECT_SLUG=""
PROJECT_NAME=""
ENVIRONMENT=""
OWNER_EMAIL=""
DAILY_TOKEN_CAP=""
RPM_CAP=""
TOOL_SLUG=""
TOOL_MODE="server"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --cookie-jar)
      COOKIE_JAR="$2"
      shift 2
      ;;
    --project-slug)
      PROJECT_SLUG="$2"
      shift 2
      ;;
    --project-name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --owner-email)
      OWNER_EMAIL="$2"
      shift 2
      ;;
    --daily-token-cap)
      DAILY_TOKEN_CAP="$2"
      shift 2
      ;;
    --rpm-cap)
      RPM_CAP="$2"
      shift 2
      ;;
    --tool-slug)
      TOOL_SLUG="$2"
      shift 2
      ;;
    --tool-mode)
      TOOL_MODE="$2"
      shift 2
      ;;
    --openai-api-key)
      OPENAI_API_KEY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$BASE_URL" ]] || die "Missing --base-url"
[[ -n "$COOKIE_JAR" ]] || die "Missing --cookie-jar"
[[ -n "$PROJECT_SLUG" ]] || die "Missing --project-slug"
[[ -n "$PROJECT_NAME" ]] || die "Missing --project-name"
[[ -n "$ENVIRONMENT" ]] || die "Missing --environment"
[[ -n "$OWNER_EMAIL" ]] || die "Missing --owner-email"
[[ -n "$DAILY_TOKEN_CAP" ]] || die "Missing --daily-token-cap"
[[ -n "$RPM_CAP" ]] || die "Missing --rpm-cap"
[[ -n "$TOOL_SLUG" ]] || die "Missing --tool-slug"
[[ -f "$COOKIE_JAR" ]] || die "Cookie jar does not exist: $COOKIE_JAR (run scripts/admin-auth.sh first)"

if [[ "$TOOL_MODE" != "server" && "$TOOL_MODE" != "browser" && "$TOOL_MODE" != "both" ]]; then
  die "--tool-mode must be one of: server, browser, both"
fi

if [[ -z "$OPENAI_API_KEY" ]]; then
  read -r -s -p "OpenAI API key for project $PROJECT_SLUG: " OPENAI_API_KEY
  echo
fi
[[ -n "$OPENAI_API_KEY" ]] || die "OpenAI API key is required"

RESPONSE_STATUS=""
RESPONSE_BODY=""

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

request() {
  local method="$1"
  local url="$2"
  local data="${3-}"
  local body_file

  body_file=$(mktemp)
  if [[ -n "$data" ]]; then
    RESPONSE_STATUS=$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -b "$COOKIE_JAR" \
      -c "$COOKIE_JAR" \
      --data "$data")
  else
    RESPONSE_STATUS=$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" \
      -b "$COOKIE_JAR" \
      -c "$COOKIE_JAR")
  fi

  RESPONSE_BODY=$(cat "$body_file")
  rm -f "$body_file"
}

extract_project_id() {
  node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8")||"{}");const p=Array.isArray(data.projects)?data.projects[0]:null;if(!p||p.id==null)process.exit(1);process.stdout.write(String(p.id));'
}

extract_tool_id() {
  node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8")||"{}");const t=Array.isArray(data.tools)?data.tools[0]:null;if(!t||t.id==null)process.exit(1);process.stdout.write(String(t.id));'
}

PROJECT_QUERY_SLUG=$(urlencode "$PROJECT_SLUG")
request "GET" "$BASE_URL/admin/projects?slug=$PROJECT_QUERY_SLUG"
[[ "$RESPONSE_STATUS" == "200" ]] || die "Failed to query projects (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

PROJECT_ID=""
PROJECT_ID=$(printf '%s' "$RESPONSE_BODY" | extract_project_id || true)

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_PAYLOAD=$(node -e 'const [slug,name,env,owner,daily,rpm]=process.argv.slice(1);process.stdout.write(JSON.stringify({slug,name,environment:env,ownerEmail:owner,dailyTokenCap:Number(daily),rpmCap:Number(rpm)}));' \
    "$PROJECT_SLUG" "$PROJECT_NAME" "$ENVIRONMENT" "$OWNER_EMAIL" "$DAILY_TOKEN_CAP" "$RPM_CAP")

  request "POST" "$BASE_URL/admin/projects" "$PROJECT_PAYLOAD"
  [[ "$RESPONSE_STATUS" == "201" ]] || die "Failed to create project (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

  request "GET" "$BASE_URL/admin/projects?slug=$PROJECT_QUERY_SLUG"
  [[ "$RESPONSE_STATUS" == "200" ]] || die "Failed to re-query project (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"
  PROJECT_ID=$(printf '%s' "$RESPONSE_BODY" | extract_project_id || true)
  [[ -n "$PROJECT_ID" ]] || die "Project created but could not resolve project id"
fi

KEY_PAYLOAD=$(node -e 'const key=process.argv[1];process.stdout.write(JSON.stringify({provider:"openai",apiKey:key}));' "$OPENAI_API_KEY")
request "POST" "$BASE_URL/admin/projects/$PROJECT_ID/keys" "$KEY_PAYLOAD"
[[ "$RESPONSE_STATUS" == "201" ]] || die "Failed to set project key (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

TOOL_QUERY_SLUG=$(urlencode "$TOOL_SLUG")
request "GET" "$BASE_URL/admin/tools?slug=$TOOL_QUERY_SLUG&projectId=$PROJECT_ID"
[[ "$RESPONSE_STATUS" == "200" ]] || die "Failed to query tools (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

TOOL_ID=""
TOOL_ID=$(printf '%s' "$RESPONSE_BODY" | extract_tool_id || true)

if [[ -z "$TOOL_ID" ]]; then
  TOOL_PAYLOAD=$(node -e 'const [slug,projectId,mode]=process.argv.slice(1);process.stdout.write(JSON.stringify({slug,projectId:Number(projectId),mode}));' \
    "$TOOL_SLUG" "$PROJECT_ID" "$TOOL_MODE")

  request "POST" "$BASE_URL/admin/tools" "$TOOL_PAYLOAD"
  [[ "$RESPONSE_STATUS" == "201" ]] || die "Failed to create tool (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

  request "GET" "$BASE_URL/admin/tools?slug=$TOOL_QUERY_SLUG&projectId=$PROJECT_ID"
  [[ "$RESPONSE_STATUS" == "200" ]] || die "Failed to re-query tool (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"
  TOOL_ID=$(printf '%s' "$RESPONSE_BODY" | extract_tool_id || true)
  [[ -n "$TOOL_ID" ]] || die "Tool created but could not resolve tool id"
fi

request "POST" "$BASE_URL/admin/tools/$TOOL_ID/tokens"
[[ "$RESPONSE_STATUS" == "201" ]] || die "Failed to mint tool token (HTTP $RESPONSE_STATUS): $RESPONSE_BODY"

TOOL_TOKEN=$(printf '%s' "$RESPONSE_BODY" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8")||"{}");if(!data.token)process.exit(1);process.stdout.write(String(data.token));' || true)
TOKEN_EXPIRES_AT=$(printf '%s' "$RESPONSE_BODY" | node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8")||"{}");if(!data.expiresAt)process.exit(1);process.stdout.write(String(data.expiresAt));' || true)

[[ -n "$TOOL_TOKEN" ]] || die "Token minted but token value missing"
[[ -n "$TOKEN_EXPIRES_AT" ]] || die "Token minted but expiry missing"

echo "project_id=$PROJECT_ID"
echo "project_slug=$PROJECT_SLUG"
echo "tool_id=$TOOL_ID"
echo "tool_slug=$TOOL_SLUG"
echo "token_expires_at=$TOKEN_EXPIRES_AT"
echo "tool_token=$TOOL_TOKEN"
