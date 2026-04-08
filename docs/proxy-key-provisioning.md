# Proxy Key Provisioning Guide

This guide covers creating, rotating, and storing project key material for both runtime paths:
1. Proxy tokens for trusted server-side tools.
2. Relay tokens for distributed clients.

Distributed clients should use the shared relay URL exposed by `/admin/tools` and a relay token minted from `POST /admin/tools/:toolId/relay-tokens`. They should not use proxy tokens.

Model selection rule:
1. SW API Proxy does not choose a model.
2. The caller must send the OpenAI model it wants to use on each request.

## 1) What is being provisioned

Server tools need:
1. OpenAI project key on proxy via `POST /admin/projects/:projectId/keys`.
2. Proxy token for trusted server tool access via `POST /admin/tools/:toolId/tokens`.

Distributed clients need:
1. OpenAI project key on proxy via `POST /admin/projects/:projectId/keys`.
2. Relay token for distributed relay access via `POST /admin/tools/:toolId/relay-tokens`.

Important:
1. Raw OpenAI key is encrypted via KMS by proxy and not returned.
2. Proxy and relay tokens are returned once at mint time; store them immediately in the right secret store.

## 2) Script-first flow (primary)

Set inputs:

```bash
export BASE_URL="https://proxy.example.com"
export ADMIN_EMAIL="admin@bbc.co.uk"
export ADMIN_PASSWORD="<shared-admin-password>"
export COOKIE_JAR="${TMPDIR:-/tmp}/proxy-api-admin.cookie"

export PROJECT_SLUG="<tool-slug>-prod"
export PROJECT_NAME="<Project Name>"
export ENVIRONMENT="prod"
export OWNER_EMAIL="owner@bbc.co.uk"
export DAILY_TOKEN_CAP="2000000"
export RPM_CAP="60"
export TOOL_SLUG="<tool-slug>-relay"
export OPENAI_API_KEY="sk-..."
```

Step A: Admin auth

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL" "$COOKIE_JAR"
```

Step B: Bootstrap project, key, tool, proxy token

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
  --tool-mode "server" \
  --openai-api-key "$OPENAI_API_KEY"
```

Step C: Smoke check

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "<responses_model>"
```

## 3) API fallback flow (secondary)

Use this if scripts cannot run in your environment.

Sign in as admin and store cookie:

```bash
curl -i -c "$COOKIE_JAR" -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
```

Find project by slug (or create if not found):

```bash
curl -s -b "$COOKIE_JAR" \
  "$BASE_URL/admin/projects?slug=$PROJECT_SLUG"
```

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"<tool-slug>-prod",
    "name":"<Project Name>",
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

curl -i -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/projects/$PROJECT_ID/keys" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\"}"
```

Find tool by slug + project (or create if not found):

```bash
curl -s -b "$COOKIE_JAR" \
  "$BASE_URL/admin/tools?slug=<tool-slug>-relay&projectId=$PROJECT_ID"
```

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"<tool-slug>-relay",
    "projectId":123,
    "mode":"server"
  }'
```

Mint proxy token:

```bash
export TOOL_ID="456"

curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens"
```

Smoke check:

```bash
curl -s -X GET "$BASE_URL/proxy/v1/models" \
  -H "Authorization: Bearer <tool_token>"

curl -s -X POST "$BASE_URL/proxy/v1/responses" \
  -H "Authorization: Bearer <tool_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<responses_model>","input":"proxy smoke test"}'
```

Distributed client relay-token mint:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/$TOOL_ID/relay-tokens"
```

Relay smoke check:

```bash
curl -s -X POST "https://relay.example.com/v1/tools/<tool-slug>/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<responses_model>","input":"relay smoke test"}'
```

## 4) SSM storage pattern

Recommended parameter names for server tools:
1. `/<app-name>/<env>/OPENAI_BASE_URL`
2. `/<app-name>/<env>/OPENAI_API_KEY`

Write parameters:

```bash
export APP_NAME="<app-name>"
export PARAM_BASE="/$APP_NAME/$ENVIRONMENT"
export TOOL_TOKEN="tt.<id>.<secret>"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_BASE_URL" \
  --type "SecureString" \
  --overwrite \
  --value "$BASE_URL/proxy/v1"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_API_KEY" \
  --type "SecureString" \
  --overwrite \
  --value "$TOOL_TOKEN"
```

Recommended parameter names for distributed clients or their controlled host:
1. `/<app-name>/<env>/RELAY_BASE_URL`
2. `/<app-name>/<env>/RELAY_RESPONSES_URL`
3. `/<app-name>/<env>/RELAY_BEARER_TOKEN`

## 5) Rotation SOP

Proxy-token rotation sequence:
1. Mint new proxy token.
2. Deploy backend relay or server tool with new token.
3. Run smoke verification against proxy.
4. Revoke old token by token ID.

Revoke command:

```bash
export OLD_TOOL_TOKEN="tt.<id>.<secret>"
export TOKEN_ID="$(printf '%s' "$OLD_TOOL_TOKEN" | cut -d '.' -f2)"

curl -i -b "$COOKIE_JAR" -X POST \
  "$BASE_URL/admin/tools/$TOOL_ID/tokens/$TOKEN_ID/revoke"
```

Relay-token rotation sequence:
1. Mint new relay token.
2. Update the distributed client or its controlled host with the new token.
3. Run relay smoke verification.
4. Revoke old relay token by token ID.

Relay revoke command:

```bash
export OLD_RELAY_TOKEN="rt.<id>.<secret>"
export RELAY_TOKEN_ID="$(printf '%s' "$OLD_RELAY_TOKEN" | cut -d '.' -f2)"

curl -i -b "$COOKIE_JAR" -X POST \
  "$BASE_URL/admin/tools/$TOOL_ID/relay-tokens/$RELAY_TOKEN_ID/revoke"
```

## 6) Common failures and fixes

Error format from proxy/relay is consistent:
1. `{ "error": "<code>", "message": "<text>", "details": { ... } }`

Common responses:
1. `401 unauthorized` + `Missing or invalid bearer token`
   - Fix: verify token value, header format, token scope, token status/expiry.
2. `403 forbidden` + `No active API key for project`
   - Fix: set active project key via `/admin/projects/:projectId/keys`.
3. `403 token_cap_exceeded`
   - Fix: increase `dailyTokenCap` for project or wait for next day.
4. `429 rate_limit_exceeded`
   - Fix: lower request burst, increase project RPM cap, retry after 60s.
5. `502 upstream_error`
   - Fix: inspect upstream status/details payload and model/request shape.
6. `403 forbidden` + `Relay token does not match tool`
   - Fix: use the relay token minted for that exact tool slug.

## 7) Audit trail notes

Operational visibility exists in:
1. `audit_logs` table for admin actions such as:
   - `project.key.rotated`
   - `tool.token.created`
   - `tool.token.revoked`
   - `tool.relay_token.created`
   - `tool.relay_token.revoked`
2. `usage_events` table for proxy calls (`/v1/models`, `/v1/responses`, `/v1/embeddings`).
3. `GET /admin/usage` endpoint for aggregated usage retrieval by admin session.
