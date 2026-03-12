# SW API Proxy: How To Use

This guide covers two tasks:
1. Add or rotate an OpenAI API key for a project.
2. Point tools at this proxy so tools never handle raw OpenAI keys.

## Focused runbooks

Use these when you need a narrower operational guide:
1. Repeatable template for onboarding any tool: `tool-onboarding-template.md`
2. Alt-text Generator migration runbook: `alt-text-generator-onboarding.md`
3. Key provisioning + rotation SOP: `proxy-key-provisioning.md`

## Prerequisites

1. Proxy is running and reachable over HTTPS (required for session cookies).
2. Your admin email is in `ADMIN_EMAIL_ALLOWLIST`.
3. You have the shared `ADMIN_PASSWORD` value for this environment.
4. You know the proxy base URL.

```bash
export BASE_URL="https://proxy.example.com"
export ADMIN_EMAIL="admin1@bbc.co.uk"
export ADMIN_PASSWORD="<shared-admin-password>"
```

## Fastest Manual Path: Browser Admin To Smoke Test

1. Open `$BASE_URL/admin` in a browser.
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
6. In `Mint tool token`:
   - Enter the tool ID.
   - Mint the token and copy it immediately. It is only shown once.
7. Run the smoke test:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

If you prefer CLI instead of the browser dashboard, use the API flow below.

## Step 1: Sign In As Admin (CLI)

```bash
curl -i -c admin.cookies -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
```

Expected response: `{"ok":true}`

## Step 2: Create Or Reuse A Project

If you already have the project ID, skip to Step 3.

Create a project:

```bash
curl -s -b admin.cookies -X POST "$BASE_URL/admin/projects" \
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
curl -s -b admin.cookies "$BASE_URL/admin/projects?slug=storyworks-prod"
```

## Step 3: Add Or Rotate OpenAI API Key

```bash
export PROJECT_ID="123"
export OPENAI_API_KEY="sk-..."

curl -i -b admin.cookies -X POST "$BASE_URL/admin/projects/$PROJECT_ID/keys" \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"openai\",\"apiKey\":\"$OPENAI_API_KEY\"}"
```

Expected response: `{"ok":true}`

Behavior in this codebase:
1. New key becomes active immediately.
2. Previous active key is marked inactive.
3. Key is encrypted via KMS before storage.
4. Raw key is never returned from API.

## Step 4: Create A Tool And Issue A Tool Token (Server/Backend Tools)

1. Create tool:

```bash
curl -s -b admin.cookies -X POST "$BASE_URL/admin/tools" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "storyworks-ai-assistant",
    "projectId": 123,
    "mode": "server"
  }'
```

Response: `{"id":456}`

2. Issue tool bearer token:

```bash
export TOOL_ID="456"

curl -s -b admin.cookies -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens"
```

Response includes a long-lived token and expiry:

```json
{"token":"tt.<id>.<secret>","expiresAt":"2026-05-01T10:00:00.000Z"}
```

Store this token server-side only (for example in your tool's env vars).

If the tool already exists, look it up via the admin API:

```bash
curl -s -b admin.cookies "$BASE_URL/admin/tools?slug=storyworks-ai-assistant&projectId=$PROJECT_ID"
```

## Step 5: Point A Server Tool To The Proxy

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
  baseURL: `${process.env.BASE_URL}/proxy/v1`
});
```

`responses` example:

```bash
curl -s -X POST "$PROXY_BASE_URL/responses" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": "Return one sentence saying proxy connectivity is working."
  }'
```

`embeddings` example:

```bash
curl -s -X POST "$PROXY_BASE_URL/embeddings" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
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
3. Revoke a token:

```bash
export OLD_TOOL_TOKEN="tt.<id>.<secret>"
export TOKEN_ID="$(printf '%s' "$OLD_TOOL_TOKEN" | cut -d '.' -f2)"

curl -i -b admin.cookies -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens/$TOKEN_ID/revoke"
```

## Quick Failure Checklist

1. `401 Missing or invalid bearer token`: wrong/expired tool token.
2. `403 No active API key for project`: key not set for that project.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.
5. Browser CORS errors: missing origin in `CORS_ALLOWED_ORIGINS`.
