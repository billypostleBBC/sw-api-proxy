# Tool Onboarding (Proxy-Backed OpenAI)

Use this runbook to onboard any server-side tool or backend relay to SW API Proxy with project-scoped OpenAI keys and tool bearer tokens.

## When to use this runbook

Use this when:
1. A tool needs OpenAI access through this proxy instead of holding a raw provider key itself.
2. You want per-project RPM and daily token caps enforced by the proxy.
3. You need a repeatable setup flow for project creation, key rotation, tool token minting, and smoke verification.

Do not use this when:
1. You are changing proxy architecture or adding non-MVP infrastructure.
2. You are trying to give a long-lived proxy token directly to an untrusted client.

## Required inputs

```bash
export BASE_URL="https://nnm7du2h7j.eu-west-2.awsapprunner.com"
export ADMIN_URL="$BASE_URL/admin"
export PROXY_BASE_URL="$BASE_URL/proxy/v1"
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
export TOOL_MODE="server" # server | browser | both
export OPENAI_API_KEY="sk-..."
```

Notes:
1. `BASE_URL` is the deployed service root.
2. `ADMIN_URL` is the admin dashboard URL. Current hosted value: `https://nnm7du2h7j.eu-west-2.awsapprunner.com/admin`.
3. `PROXY_BASE_URL` is the proxy root your tool will call. Current hosted value: `https://nnm7du2h7j.eu-west-2.awsapprunner.com/proxy/v1`.
4. `PROJECT_SLUG` should follow `<tool-slug>-<env>`.
5. `OPENAI_API_KEY` is the raw project OpenAI key that the proxy will encrypt and store.
6. Operators sign in with the plaintext shared admin password, even if production runtime is configured with `ADMIN_PASSWORD_HASH`.
7. Default cookie jar follows the actual script behavior: `${TMPDIR:-/tmp}/proxy-api-admin.cookie`.

## Fast manual option

Keep this path available while the admin dashboard UI is still being refined.

1. Open `$ADMIN_URL` in a browser.
2. Sign in with your allowlisted admin email and shared password.
3. Create or find the project.
4. Rotate the project OpenAI key.
5. Create or find the tool.
6. Mint a tool token and copy it immediately.
7. Run `scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"`.

## Preflight checks

```bash
test -n "$BASE_URL"
test -n "$ADMIN_EMAIL"
test -n "$ADMIN_PASSWORD"
test -n "$COOKIE_JAR"
test -n "$PROJECT_SLUG"
test -n "$PROJECT_NAME"
test -n "$ENVIRONMENT"
test -n "$OWNER_EMAIL"
test -n "$DAILY_TOKEN_CAP"
test -n "$RPM_CAP"
test -n "$TOOL_SLUG"
test -n "$TOOL_MODE"
test -n "$OPENAI_API_KEY"
```

```bash
command -v bash
command -v curl
command -v node
```

## Step 1: Admin auth

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL" "$COOKIE_JAR"
```

This creates or refreshes the admin session cookie jar used by the later steps.

## Step 2: Create or find project, set key, create or find tool, mint token

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
  --tool-mode "$TOOL_MODE" \
  --openai-api-key "$OPENAI_API_KEY"
```

Script behavior:
1. Finds the project by slug, or creates it.
2. Rotates or sets the active OpenAI key for that project.
3. Finds the tool by slug plus project, or creates it.
4. Mints a new tool token.

Expected output includes:
1. `project_id`
2. `project_slug`
3. `tool_id`
4. `tool_slug`
5. `token_expires_at`
6. `tool_token`

`tool_token` is shown once. Store it immediately in a server-side secret manager.

## Step 3: Store proxy config in secrets

```bash
export APP_NAME="<app-name>"
export PARAM_BASE="/$APP_NAME/$ENVIRONMENT"
export TOOL_TOKEN="<tool_token>"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_BASE_URL" \
  --type "SecureString" \
  --overwrite \
  --value "$PROXY_BASE_URL"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_API_KEY" \
  --type "SecureString" \
  --overwrite \
  --value "$TOOL_TOKEN"
```

## Step 4: Integrate the tool

Backend services should use:

```bash
OPENAI_BASE_URL="$PROXY_BASE_URL"
OPENAI_API_KEY=<tool bearer token>
```

Rules:
1. Keep the tool token server-side only.
2. Any untrusted client should call your backend relay, not the proxy directly with a long-lived token.
3. This proxy currently supports `POST /proxy/v1/responses`, `POST /proxy/v1/embeddings`, and `GET /proxy/v1/models`.

If your backend already uses the OpenAI SDK, point it at the proxy and use the tool token as the API key:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL
});
```

## Step 5: Smoke verification

Run the bundled smoke test:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

Optional embeddings check:

```bash
curl -s -X POST "$BASE_URL/proxy/v1/embeddings" \
  -H "Authorization: Bearer <tool_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "proxy smoke test"
  }'
```

Expected:
1. `models_check=passed`
2. `responses_check=passed`
3. Embeddings call returns `200` when your tool needs embeddings.

## Rotation runbook

Use this order only:
1. Mint a new tool token.
2. Update the consuming backend secret.
3. Deploy the backend with the new token.
4. Verify smoke checks and production traffic.
5. Revoke the old token.

Mint:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/<tool_id>/tokens"
```

Revoke:

```bash
curl -i -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/<tool_id>/tokens/<old_token_id>/revoke"
```

Do not revoke the old token before the new one is deployed and verified. This service fails closed.

## Failure checklist

If onboarding fails:
1. Confirm the admin email is allowlisted.
2. Confirm the admin password is correct for the environment.
3. Confirm the cookie jar path is the same one created by `scripts/admin-auth.sh`.
4. Confirm caps are numeric and positive.
5. Confirm the project has an active OpenAI key.

Common runtime responses:
1. `401 Missing or invalid bearer token`: wrong, expired, or revoked tool token.
2. `403 No active API key for project`: project key was not set or is inactive.
3. `403 token_cap_exceeded`: project daily token cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.
5. `502 upstream_error`: upstream OpenAI request failed.

## Completion checklist

Complete only when all are true:
1. Project exists with the expected slug and environment.
2. Active OpenAI key is set via `/admin/projects/:projectId/keys`.
3. Tool exists with the expected slug and mode.
4. Tool token is stored in server-side secrets.
5. Consuming backend reads `OPENAI_BASE_URL` and `OPENAI_API_KEY` from secrets, not code.
6. `scripts/smoke-proxy.sh` passes.
7. No plaintext provider key or tool token appears in repo files, logs, or client-side runtime.
