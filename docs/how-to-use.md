# SW API Proxy: How To Use

This guide covers two tasks:
1. Add or rotate an OpenAI API key for a project.
2. Point server tools at the proxy and distributed clients at the shared relay so raw OpenAI keys stay server-side and each runtime gets the right token type.

Model selection rule:
1. SW API Proxy does not choose a model.
2. The caller must send the OpenAI model it wants to use for each request.

## Focused runbooks

Use these when you need a narrower operational guide:
1. Generic onboarding runbook for any tool: `tool-onboarding.md`
2. Agent-facing credential retrieval and runtime contract: see `tool-onboarding.md` sections `Agent-facing runtime contract`, `Where each runtime value comes from`, and `Recommended secret retrieval pattern for agents`
3. Key provisioning + rotation SOP: `proxy-key-provisioning.md`

## Prerequisites

1. Proxy is running and reachable over HTTPS (required for session cookies).
2. Your admin email is in `ADMIN_EMAIL_ALLOWLIST`.
3. You have the shared admin password for this environment.
4. You know the proxy base URL.
5. Production runtime may store `ADMIN_PASSWORD_HASH`, but operators still sign in with the plaintext shared password.

```bash
export BASE_URL="https://nnm7du2h7j.eu-west-2.awsapprunner.com"
export ADMIN_URL="$BASE_URL/admin"
export PROXY_BASE_URL="$BASE_URL/proxy/v1"
export RELAY_BASE_URL="https://relay.example.com"
export ADMIN_EMAIL="admin1@bbc.co.uk"
export ADMIN_PASSWORD="<shared-admin-password>"
export COOKIE_JAR="${TMPDIR:-/tmp}/proxy-api-admin.cookie"
```

Current hosted admin dashboard: `https://nnm7du2h7j.eu-west-2.awsapprunner.com/admin`

## Fastest Manual Path: Browser Admin To Smoke Test

Keep using this path while the admin UI is still being refined. It is the fastest operator flow for one-off setup, rotation, and smoke checks.

1. Open `$ADMIN_URL` in a browser.
2. Sign in with your allowlisted admin email and shared password.
3. In `Projects`:
   - Create a project if one does not already exist.
   - If it already exists, use the project ID shown in the table.
4. In `Rotate project API key`:
   - Enter the project ID.
   - Paste the OpenAI API key for that project.
5. In `Tools & Tokens`:
   - Create a tool if one does not already exist.
   - Use the tool ID shown in the tools table.
   - Copy the relay URL shown in the table if the tool is a distributed client.
6. In `Mint proxy token`:
   - Enter the tool ID only for trusted server tools.
   - Mint the token and copy it immediately. It is only shown once.
7. In `Mint relay token`:
   - Enter the tool ID for any distributed client.
   - Mint the token and copy it immediately. It is only shown once.
7. Run the smoke test:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "<responses_model>"
```

If you prefer CLI instead of the browser dashboard, use the API flow below.

## Step 1: Sign In As Admin (CLI)

```bash
curl -i -c "$COOKIE_JAR" -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
```

Expected response: `{"ok":true}`

## Step 2: Create Or Reuse A Project

If you already have the project ID, skip to Step 3.

Create a project:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "storyworks-prod",
    "name": "Storyworks Production",
    "environment": "prod",
    "ownerEmail": "owner@bbc.co.uk",
    "dailyTokenCap": 2000000,
    "rpmCap": 60
  }'
```

Response includes project ID: `{"id":123}`

If the project already exists, look it up via the admin API:

```bash
curl -s -b "$COOKIE_JAR" "$BASE_URL/admin/projects?slug=storyworks-prod"
```

## Step 3: Add Or Rotate OpenAI API Key

```bash
export PROJECT_ID="123"
export OPENAI_API_KEY="sk-..."

curl -i -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/projects/$PROJECT_ID/keys" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\"}"
```

Expected response: `{"ok":true}`

Behavior in this codebase:
1. New key becomes active immediately.
2. Previous active key is marked inactive.
3. Key is encrypted via KMS before storage.
4. Raw key is never returned from API.

## Step 4: Create A Tool

1. Create tool:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "storyworks-ai-assistant",
    "projectId": 123,
    "mode": "server"
  }'
```

Response when the shared relay URL is configured on the proxy service:

```json
{"id":456,"relayResponsesUrl":"https://relay.example.com/v1/tools/storyworks-ai-assistant/responses"}
```

If the tool already exists, look it up via the admin API:

```bash
curl -s -b "$COOKIE_JAR" "$BASE_URL/admin/tools?slug=storyworks-ai-assistant&projectId=$PROJECT_ID"
```

## Step 5: Choose runtime path

### Path A: Distributed client through shared relay

Mint relay bearer token:

```bash
export TOOL_ID="456"

curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/$TOOL_ID/relay-tokens"
```

Response includes a relay-scoped token and expiry:

```json
{"token":"rt.<id>.<secret>","expiresAt":"2026-05-01T10:00:00.000Z","relayResponsesUrl":"https://relay.example.com/v1/tools/storyworks-ai-assistant/responses"}
```

Call the tool-specific relay URL returned by admin:

```bash
curl -s -X POST "$RELAY_BASE_URL/v1/tools/storyworks-ai-assistant/responses" \
  -H "Authorization: Bearer <relay_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<responses_model>",
    "input": "Return one sentence saying relay connectivity is working."
  }'
```

### Path B: Trusted server tool through proxy

Mint tool bearer token:

```bash
export TOOL_ID="456"

curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens"
```

Response includes a long-lived token and expiry:

```json
{"token":"tt.<id>.<secret>","expiresAt":"2026-05-01T10:00:00.000Z"}
```

Store this token server-side only.

Point the server tool at the proxy:

Set in the tool:

```bash
export PROXY_BASE_URL="$BASE_URL/proxy/v1"
export PROXY_BEARER_TOKEN="tt.<id>.<secret>"
```

Call proxy endpoints with the tool token as bearer auth.

If your tool already uses the OpenAI SDK, point it at the proxy base and use the tool token as the `apiKey`:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.PROXY_BEARER_TOKEN,
  baseURL: process.env.PROXY_BASE_URL
});
```

`responses` example:

```bash
curl -s -X POST "$PROXY_BASE_URL/responses" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<responses_model>",
    "input": "Return one sentence saying proxy connectivity is working."
  }'
```

`embeddings` example:

```bash
curl -s -X POST "$PROXY_BASE_URL/embeddings" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<embedding_model>",
    "input": "BBC StoryWorks"
  }'
```

`models` example:

```bash
curl -s -X GET "$PROXY_BASE_URL/models" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN"
```

Supported proxy endpoints in MVP:
1. `POST /proxy/v1/responses`
2. `POST /proxy/v1/embeddings`
3. `GET /proxy/v1/models`

## Rotation And Revocation

1. Rotate OpenAI key: call `POST /admin/projects/:projectId/keys` again.
2. Rotate tool token:
   - Mint a new token (`POST /admin/tools/:toolId/tokens`).
   - Update the consuming tool secret.
   - Revoke old token.
3. Rotate relay token:
   - Mint a new token (`POST /admin/tools/:toolId/relay-tokens`).
   - Update the distributed client secret or runtime config.
   - Revoke old relay token.
4. Revoke a token:

```bash
export OLD_TOOL_TOKEN="tt.<id>.<secret>"
export TOKEN_ID="$(printf '%s' "$OLD_TOOL_TOKEN" | cut -d '.' -f2)"

curl -i -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens/$TOKEN_ID/revoke"
```

## Quick Failure Checklist

1. `401 Missing or invalid bearer token`: wrong/expired tool token.
2. `403 No active API key for project`: key not set for that project.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.
5. Browser or plugin CORS errors: missing origin in `CORS_ALLOWED_ORIGINS`.
6. Relay `401 Missing or invalid bearer token`: wrong, expired, or revoked relay token.

Legacy compatibility note:
1. `POST /v1/auth/login` still exists temporarily for tools that have not moved over yet.
2. New distributed-client onboarding should use relay tokens, not shared relay login.
