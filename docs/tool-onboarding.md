# Tool Onboarding (Proxy + Shared Relay)

Use this runbook to onboard any tool to this codebase.

There are now two supported runtime paths:
1. Trusted server tools call the proxy directly with a tool bearer token.
2. Distributed clients call the shared relay with a short-lived relay session.

## When to use which path

Use the shared relay when:
1. The tool is distributed to other people's machines.
2. You do not want a long-lived tool token in the client bundle.
3. The tool only needs `responses`.

Use the direct proxy path when:
1. The caller runs only on infrastructure you control.
2. The caller needs `responses`, `embeddings`, or `models`.
3. You can keep the tool token server-side.

Do not use the direct proxy path for plugins, browser apps, or desktop apps you distribute.

## Required inputs

```bash
export BASE_URL="https://nnm7du2h7j.eu-west-2.awsapprunner.com"
export ADMIN_URL="$BASE_URL/admin"
export PROXY_BASE_URL="$BASE_URL/proxy/v1"
export ADMIN_EMAIL="<your-allowlisted-admin-email>"
export ADMIN_PASSWORD="<shared-admin-password>"
export COOKIE_JAR="${TMPDIR:-/tmp}/proxy-api-admin.cookie"

export PROJECT_SLUG="<tool-slug>-prod"
export PROJECT_NAME="<Project Name>"
export ENVIRONMENT="prod"
export OWNER_EMAIL="owner@bbc.co.uk"
export DAILY_TOKEN_CAP="2000000"
export RPM_CAP="60"

export TOOL_SLUG="<tool-slug>"
export TOOL_MODE="server"
export OPENAI_API_KEY="sk-..."
```

Notes:
1. `BASE_URL` is the proxy/admin service root.
2. `PROXY_BASE_URL` is always `$BASE_URL/proxy/v1`.
3. `TOOL_SLUG` is now the stable routing key for shared relay URLs.
4. `OPENAI_API_KEY` is the raw project OpenAI key that the proxy encrypts and stores.
5. `ADMIN_EMAIL` must be one of the allowlisted admin emails configured on `proxy-api`; it is not derived from the relay email-domain rule.
6. Operators still sign in with the plaintext shared admin password, even when production runtime uses `ADMIN_PASSWORD_HASH`.

## Current production environment

The shared relay is already deployed in production.

Use these production roots:
1. Proxy/admin root: `https://nnm7du2h7j.eu-west-2.awsapprunner.com`
2. Relay root: `https://5z97x9cmtm.eu-west-2.awsapprunner.com`

For new production tools:
1. Do not deploy another relay service.
2. Create the tool in admin.
3. Use the derived relay URL from the admin response or dashboard.
4. The derived URL format is `https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/<tool-slug>/responses`.

## Environment-wide prerequisite: deploy the shared relay once

The shared relay is one separate App Runner service for the whole environment, not one service per tool.

Complete this once per environment:
1. Deploy `relay-api` using `infra/apprunner/relay.service.template.json` or `infra/apprunner/relay.update-service.template.json`.
2. Set its runtime auth secrets:
   - `RELAY_PASSWORD_HASH`
   - `CORS_ALLOWED_ORIGINS`
3. Set its runtime vars:
   - `RELAY_EMAIL_DOMAIN_ALLOWLIST`
   - `RELAY_SESSION_TTL_HOURS`
4. Copy the public relay service URL.
5. Configure the proxy/admin service with `RELAY_PUBLIC_BASE_URL=<relay-service-url>`.

After that, every tool created in the admin dashboard will automatically expose:

```text
<RELAY_PUBLIC_BASE_URL>/v1/tools/<tool-slug>/responses
```

No per-tool relay deployment is required.

`CORS_ALLOWED_ORIGINS` can be either:
1. `*` to allow any browser origin for the moment.
2. A comma-separated allowlist when you want to lock it down later.

Current production relay setting is temporarily `*` while the final allowlist is being defined.

## Fast manual path

Use the admin dashboard when you want the smallest setup surface.

1. Open `$ADMIN_URL`.
2. Sign in with your allowlisted admin email and shared password.
3. Create or find the project.
4. Rotate the project OpenAI key.
5. Create or find the tool.
6. Copy the derived relay URL from the tools table if this is a distributed client.
7. Mint a tool token only if this is a trusted server tool.

## Script-first path

This script path is still server-tool oriented because it always mints a tool token.

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL" "$COOKIE_JAR"

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

Outputs include:
1. `project_id`
2. `tool_id`
3. `tool_token`
4. `token_expires_at`

If you are onboarding a distributed client, you can ignore `tool_token` and use the relay URL derived from `TOOL_SLUG`.

## Admin API responses you can rely on

Create tool:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"storyworks-alt-text",
    "projectId":123,
    "mode":"server"
  }'
```

Response when `RELAY_PUBLIC_BASE_URL` is configured:

```json
{
  "id": 456,
  "relayResponsesUrl": "https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/storyworks-alt-text/responses"
}
```

Mint token:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/456/tokens"
```

Response:

```json
{
  "token": "tt.<id>.<secret>",
  "expiresAt": "2026-06-01T09:00:00.000Z",
  "relayResponsesUrl": "https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/storyworks-alt-text/responses"
}
```

## Path A: Distributed clients through the shared relay

### Client login

Users sign in once per day:

```bash
export RELAY_BASE_URL="https://5z97x9cmtm.eu-west-2.awsapprunner.com"
export RELAY_PASSWORD="<shared-relay-password>"

curl -s -X POST "$RELAY_BASE_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email":"person@bbc.com",
    "password":"'"$RELAY_PASSWORD"'"
  }'
```

Success:

```json
{
  "token": "st.<id>.<secret>",
  "expiresAt": "2026-03-13T12:00:00.000Z"
}
```

### Client generation call

```bash
export RELAY_SESSION_TOKEN="st.<id>.<secret>"
export RELAY_RESPONSES_URL="https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/storyworks-alt-text/responses"

curl -s -X POST "$RELAY_RESPONSES_URL" \
  -H "Authorization: Bearer $RELAY_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4.1-mini",
    "input":"Return one sentence saying relay connectivity is working."
  }'
```

Rules:
1. Do not put tool bearer tokens in distributed clients.
2. Do not point distributed clients at `localhost` in production.
3. The shared relay currently exposes only `POST /v1/tools/:toolSlug/responses`.
4. Relay login accepts only email domains configured on `relay-api` via `RELAY_EMAIL_DOMAIN_ALLOWLIST`.

## Path B: Trusted server tools through the proxy

Store the tool token server-side only.

```bash
export PROXY_BEARER_TOKEN="tt.<id>.<secret>"

curl -s -X POST "$PROXY_BASE_URL/responses" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4.1-mini",
    "input":"Return one sentence saying proxy connectivity is working."
  }'
```

Supported proxy endpoints in MVP:
1. `POST /proxy/v1/responses`
2. `POST /proxy/v1/embeddings`
3. `GET /proxy/v1/models`

## Smoke verification

Proxy smoke:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

Relay smoke:

```bash
export RELAY_BASE_URL="https://5z97x9cmtm.eu-west-2.awsapprunner.com"
export RELAY_PASSWORD="<shared-relay-password>"

RELAY_SESSION_TOKEN="$(curl -s -X POST "$RELAY_BASE_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email":"person@bbc.com",
    "password":"'"$RELAY_PASSWORD"'"
  }' | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(data.token || "");')"

curl -s -X POST "$RELAY_BASE_URL/v1/tools/$TOOL_SLUG/responses" \
  -H "Authorization: Bearer $RELAY_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4.1-mini",
    "input":"Return one sentence saying relay smoke is working."
  }'
```

## Rotation rules

Server tool tokens:
1. Mint new tool token.
2. Deploy the consuming server with the new token.
3. Run proxy smoke verification.
4. Revoke the old token.

Relay shared password:
1. Update `RELAY_PASSWORD_HASH` on the `relay-api` service.
2. Deploy `relay-api`.
3. Verify `POST /v1/auth/login`.
4. Communicate the new shared relay password to users.

## Common runtime failures

Proxy:
1. `401 Missing or invalid bearer token`: wrong, expired, or revoked tool token.
2. `403 No active API key for project`: project key missing or inactive.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.

Relay:
1. `401 Invalid relay credentials`: wrong relay password or non-allowed email domain.
2. `401 Missing or invalid bearer token`: missing, invalid, or expired relay session.
3. `404 Tool not found`: slug does not match a tool.
4. `403 Tool is inactive`: tool exists but is disabled.
5. `403 Project is inactive`: project exists but is disabled.

## Completion checklist

Complete only when all are true:
1. Project exists with the expected slug and environment.
2. Active OpenAI key is set for the project.
3. Tool exists with the expected slug.
4. Distributed clients use the derived relay URL, not a tool token.
5. Trusted server tools store the tool token in server-side secrets only.
6. Proxy smoke passes for any server tool path.
7. Relay login and relay responses smoke pass for any distributed-client path.
