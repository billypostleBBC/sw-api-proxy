# SW API Proxy: How To Use

This guide covers two tasks:
1. Add or rotate an OpenAI API key for a project.
2. Point tools at this proxy so tools never handle raw OpenAI keys.

## Focused runbooks

Use these when you need a narrower operational guide:
1. Admin dashboard (web UI) guide: `admin-dashboard.md`
2. Repeatable template for onboarding any tool: `tool-onboarding-template.md`
3. Alt-text Generator migration runbook: `alt-text-generator-onboarding.md`
4. Key provisioning + rotation SOP: `proxy-key-provisioning.md`

## Prerequisites

1. Proxy is running and reachable over HTTPS (required for session cookies).
2. Your admin email is in `ADMIN_EMAIL_ALLOWLIST`.
3. AWS KMS is configured for this environment.
4. You know the proxy base URL.

```bash
export BASE_URL="https://proxy.example.com"
```

## Step 1: Sign In As Admin (Password)

```bash
export ADMIN_PASSWORD="replace-with-your-admin-password"

curl -i -c admin.cookies -X POST "$BASE_URL/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
```

Expected response: `{"ok":true}`

## Step 2: Create Or Reuse A Project

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

## Step 4: Create A Tool And Issue A Tool Token

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

## Step 5: Point A Tool To The Proxy

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

## Step 6: Browser Tools (Short-Lived Client Tickets)

Use this flow when the browser needs a short-lived proxy credential.

Important:
1. Add the tool origin to `CORS_ALLOWED_ORIGINS`.
2. Mint tickets from your backend, not directly in browser code.
3. Keep the long-lived tool token server-side only.
4. Ticket TTL is short (default 5 minutes), so request fresh tickets regularly.

Mint a client ticket from your backend using the tool token:

```bash
curl -s -X POST "$BASE_URL/auth/client-ticket" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN"
```

Response:

```json
{"ticket":"<jwt>","expiresInMinutes":5}
```

Use ticket as bearer for `/proxy/v1/*` from browser code:

```ts
const apiBase = "https://proxy.example.com";
const ticket = await fetch("/api/proxy-ticket").then((res) => res.text());

const responseRes = await fetch(`${apiBase}/proxy/v1/responses`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ticket}`
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    input: "Say hello from browser with a short-lived ticket."
  })
});
```

## Rotation And Revocation

1. Rotate OpenAI key: call `POST /admin/projects/:projectId/keys` again.
2. Rotate tool token:
   - Mint a new token (`POST /admin/tools/:toolId/tokens`).
   - Update consuming tool secret.
   - Revoke old token.
3. Revoke a token:

```bash
export OLD_TOOL_TOKEN="tt.<id>.<secret>"
export TOKEN_ID="$(printf '%s' "$OLD_TOOL_TOKEN" | cut -d '.' -f2)"

curl -i -b admin.cookies -X POST "$BASE_URL/admin/tools/$TOOL_ID/tokens/$TOKEN_ID/revoke"
```

## Quick Failure Checklist

1. `401 Missing or invalid bearer token`: wrong/expired tool token or malformed auth header.
2. `403 No active API key for project`: key not set for that project.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.
