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
3. AWS KMS + SES are configured for this environment.
4. You know the proxy base URL.

```bash
export BASE_URL="https://proxy.example.com"
export ADMIN_EMAIL="admin1@bbc.co.uk"
```

## Step 1: Sign In As Admin (Magic Link)

1. Request an admin magic link:

```bash
curl -i -X POST "$BASE_URL/admin/auth/magic-link/request" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\"}"
```

2. Open the email and copy the `token` query param from the link.
3. Verify the token and store the admin session cookie:

```bash
export ADMIN_MAGIC_TOKEN="ml.***"

curl -i -c admin.cookies -X POST "$BASE_URL/admin/auth/magic-link/verify" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$ADMIN_MAGIC_TOKEN\"}"
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

If you need to look up existing IDs (no list endpoint in MVP), query Postgres:

```bash
psql "$DATABASE_URL" -c "SELECT id, slug, status FROM projects ORDER BY id;"
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

## Step 6: Browser Tools (Short-Lived Client Tickets)

Use this flow when the browser calls proxy directly.

Important:
1. Add the tool origin to `CORS_ALLOWED_ORIGINS`.
2. Browser must include credentials for `/auth/client-ticket`.
3. Ticket TTL is short (default 5 minutes), so request fresh tickets regularly.
4. Session cookie is `SameSite=Lax`, so browser ticket exchange should be same-site with the proxy domain (for example `*.bbc.co.uk`).

1. Create tool with `mode` set to `browser` or `both`.
2. Start user login:

```bash
export USER_EMAIL="someone@bbc.co.uk"

curl -i -X POST "$BASE_URL/auth/magic-link/request" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\"}"
```

3. Copy `token` from the magic-link URL, then verify it to set `user_session` cookie:

```bash
export USER_MAGIC_TOKEN="ml.***"

curl -i -c user.cookies -X POST "$BASE_URL/auth/magic-link/verify" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$USER_MAGIC_TOKEN\"}"
```

4. Exchange session for ticket:

```bash
curl -s -b user.cookies -X POST "$BASE_URL/auth/client-ticket" \
  -H "Content-Type: application/json" \
  -d '{"toolSlug":"storyworks-ai-assistant"}'
```

Response:

```json
{"ticket":"<jwt>","expiresInMinutes":5}
```

5. Use ticket as bearer for `/proxy/v1/*`.

Browser example:

```ts
const apiBase = "https://proxy.example.com";

const ticketRes = await fetch(`${apiBase}/auth/client-ticket`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ toolSlug: "storyworks-ai-assistant" })
});

const { ticket } = await ticketRes.json();

const responseRes = await fetch(`${apiBase}/proxy/v1/responses`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ticket}`
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    input: "Say hello from a browser-authenticated client."
  })
});
```

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

1. `401 Missing or invalid bearer token`: wrong/expired tool token or ticket.
2. `403 No active API key for project`: key not set for that project.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.
5. Browser CORS errors: missing origin in `CORS_ALLOWED_ORIGINS`.
