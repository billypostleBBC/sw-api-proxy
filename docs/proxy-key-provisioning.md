# Proxy Key Provisioning Guide

This guide covers creating, rotating, and storing project key material and tool tokens for backend relay tools.

## 1) What is being provisioned

Two different credentials are involved:
1. OpenAI project key on proxy via `POST /admin/projects/:projectId/keys`.
2. Tool token for backend relay via `POST /admin/tools/:toolId/tokens`.

Important:
1. Raw OpenAI key is encrypted via KMS by proxy and not returned.
2. Tool token is returned once at mint time; store it immediately in a secret manager.

## 2) Script-first flow (primary)

Set inputs:

```bash
export BASE_URL="https://proxy.example.com"
export ADMIN_EMAIL="admin@bbc.co.uk"
export ADMIN_PASSWORD="<shared-admin-password>"
export COOKIE_JAR="/tmp/proxy-api-admin.cookie"

export PROJECT_SLUG="alt-text-generator-prod"
export PROJECT_NAME="Alt Text Generator"
export ENVIRONMENT="prod"
export OWNER_EMAIL="owner@bbc.co.uk"
export DAILY_TOKEN_CAP="2000000"
export RPM_CAP="60"
export TOOL_SLUG="alt-text-generator-relay"
```

Step A: Admin auth

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL" "$COOKIE_JAR"
```

Step B: Bootstrap project, key, tool, token

```bash
scripts/onboard-server-tool.sh \
  --base-url "$BASE_URL" \
  --cookie-jar "$COOKIE_JAR" \
  --project-slug "$PROJECT_SLUG" \
  --project-name "$PROJECT_NAME" \
  --environment "$ENVIRONMENT" \
  --owner-email "$OWNER_EMAIL" \
  --daily-token-cap "$DAILY_TOKEN_CAP" \
  --rpm-cap "$RPM_CAP" \
  --tool-slug "$TOOL_SLUG" \
  --tool-mode "server"
```

Step C: Smoke check

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

## 3) API fallback flow (secondary)

Use this if scripts cannot run in your environment.

Sign in as admin and store cookie:

```bash
curl -i -c admin.cookies -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
```

Find project by slug (or create if not found):

```bash
curl -s -b admin.cookies \
  "$BASE_URL/admin/projects?slug=$PROJECT_SLUG"
```

```bash
curl -s -b admin.cookies -X POST "$BASE_URL/admin/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"alt-text-generator-prod",
    "name":"Alt Text Generator",
    "environment":"prod",
    "ownerEmail":"owner@bbc.co.uk",
    "dailyTokenCap":2000000,
    "rpmCap":60
  }'
```

Set or rotate active project OpenAI key:

```bash
export PROJECT_ID="123"
export OPENAI_API_KEY="sk-..."

curl -i -b admin.cookies -X POST "$BASE_URL/admin/projects/$PROJECT_ID/keys" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\"}"
```

Find tool by slug + project (or create if not found):

```bash
curl -s -b admin.cookies \
  "$BASE_URL/admin/tools?slug=alt-text-generator-relay&projectId=$PROJECT_ID"
```

```bash
curl -s -b admin.cookies -X POST "$BASE_URL/admin/tools" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"alt-text-generator-relay",
    "projectId":123,
    "mode":"server"
  }'
```

Mint tool token:

```bash
export TOOL_ID="456"

curl -s -b admin.cookies -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens"
```

Smoke check:

```bash
curl -s -X GET "$BASE_URL/proxy/v1/models" \
  -H "Authorization: Bearer <tool_token>"

curl -s -X POST "$BASE_URL/proxy/v1/responses" \
  -H "Authorization: Bearer <tool_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1-mini","input":"proxy smoke test"}'
```

## 4) SSM storage pattern

Recommended parameter names:
1. `/alt-text-generator/prod/OPENAI_BASE_URL`
2. `/alt-text-generator/prod/OPENAI_API_KEY`

Write parameters:

```bash
aws ssm put-parameter \
  --name "/alt-text-generator/prod/OPENAI_BASE_URL" \
  --type "SecureString" \
  --overwrite \
  --value "https://proxy.example.com/proxy/v1"

aws ssm put-parameter \
  --name "/alt-text-generator/prod/OPENAI_API_KEY" \
  --type "SecureString" \
  --overwrite \
  --value "tt.<id>.<secret>"
```

## 5) Rotation SOP

Use this sequence:
1. Mint new tool token.
2. Deploy backend relay with new token.
3. Run smoke verification against proxy.
4. Revoke old token by token ID.

Revoke command:

```bash
export OLD_TOOL_TOKEN="tt.<id>.<secret>"
export TOKEN_ID="$(printf '%s' "$OLD_TOOL_TOKEN" | cut -d '.' -f2)"

curl -i -b admin.cookies -X POST \
  "$BASE_URL/admin/tools/$TOOL_ID/tokens/$TOKEN_ID/revoke"
```

## 6) Common failures and fixes

Error format from proxy is consistent:
1. `{ "error": "<code>", "message": "<text>", "details": { ... } }`

Common responses:
1. `401 unauthorized` + `Missing or invalid bearer token`
   - Fix: verify token value, header format, token status/expiry.
2. `403 forbidden` + `No active API key for project`
   - Fix: set active project key via `/admin/projects/:projectId/keys`.
3. `403 token_cap_exceeded`
   - Fix: increase `dailyTokenCap` for project or wait for next day.
4. `429 rate_limit_exceeded`
   - Fix: lower request burst, increase project RPM cap, retry after 60s.
5. `502 upstream_error`
   - Fix: inspect upstream status/details payload and model/request shape.

## 7) Audit trail notes

Operational visibility exists in:
1. `audit_logs` table for admin actions such as:
   - `project.key.rotated`
   - `tool.token.created`
   - `tool.token.revoked`
2. `usage_events` table for proxy calls (`/v1/models`, `/v1/responses`, `/v1/embeddings`).
3. `GET /admin/usage` endpoint for aggregated usage retrieval by admin session.
