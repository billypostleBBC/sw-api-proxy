# Tool Onboarding (Proxy + Shared Relay)

Use this runbook to onboard any tool to this codebase.

There are now two supported runtime paths:
1. Trusted server tools call the proxy directly with a tool bearer token.
2. Distributed clients call the shared relay with a relay bearer token minted per tool.

Model selection rule:
1. The proxy and relay do not choose a model for the caller.
2. Each caller must send the OpenAI model it wants to use for the endpoint it is calling.

## When to use which path

Use the shared relay when:
1. The tool is distributed to other people's machines.
2. You want one relay-scoped bearer token per tool instead of proxy credentials in the client.
3. The tool only needs `responses`.

Use the direct proxy path when:
1. The caller runs only on infrastructure you control.
2. The caller needs `responses`, `embeddings`, or `models`.
3. You can keep the tool token server-side.

Do not use the direct proxy path for plugins, browser apps, or desktop apps you distribute.

## Operator bootstrap inputs

These values are needed only while creating or updating the project/tool in admin:

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

## Agent-facing runtime contract

An agent must decide the runtime path first. The required credentials are different.

### Distributed client or distributed-agent app through the shared relay

Fetch or derive exactly these values:
1. `RELAY_BASE_URL`
2. `RELAY_RESPONSES_URL`
3. `RELAY_BEARER_TOKEN`
4. The OpenAI `model` value the caller will send on each request

Use them like this:
1. Call `POST $RELAY_RESPONSES_URL` with `Authorization: Bearer $RELAY_BEARER_TOKEN`.
2. Do not send admin credentials, relay password hashes, or raw OpenAI keys.

### Trusted server tool through the proxy

Fetch or derive exactly these values:
1. `PROXY_BASE_URL`
2. `PROXY_BEARER_TOKEN`
3. The OpenAI `model` value the caller will send on each request

Use them like this:
1. Call `POST $PROXY_BASE_URL/responses`, `POST $PROXY_BASE_URL/embeddings`, or `GET $PROXY_BASE_URL/models`.
2. Send `Authorization: Bearer $PROXY_BEARER_TOKEN` on every request.

### Onboarding-only values that must not live in a shipped client

These are for admin/bootstrap work, not normal runtime:
1. `ADMIN_EMAIL`
2. `ADMIN_PASSWORD`
3. `OPENAI_API_KEY`

### Values agents must never fetch into a tool runtime

Do not use these in a consuming tool:
1. `RELAY_PASSWORD_HASH`
2. `ADMIN_PASSWORD_HASH`
3. Raw project OpenAI keys in any distributed client
4. Proxy tool tokens (`tt...`) in any distributed client

Reason:
1. `RELAY_PASSWORD_HASH` is only for temporary legacy login compatibility on `relay-api`.
2. Distributed clients now authenticate with relay tokens, not shared relay passwords.
3. The proxy and relay store only token hashes server-side so callers do not need deployment secrets.

## Where each runtime value comes from

Agents should treat this list as the source-of-truth mapping.

1. `PROXY_BASE_URL`
   Source: derive from `BASE_URL` as `$BASE_URL/proxy/v1`.
2. `RELAY_BASE_URL`
   Source: environment-level relay host, currently `https://5z97x9cmtm.eu-west-2.awsapprunner.com` in production.
3. `RELAY_RESPONSES_URL`
   Source: returned by `POST /admin/tools` and `POST /admin/tools/:toolId/relay-tokens`, or shown in the admin dashboard tools table.
   Fallback: derive as `$RELAY_BASE_URL/v1/tools/$TOOL_SLUG/responses` when the relay base and slug are known.
4. `PROXY_BEARER_TOKEN`
   Source: returned once by `POST /admin/tools/:toolId/tokens`.
   Required handling: store it immediately in the consuming server's secret store; do not commit it or ship it to clients.
5. `RELAY_BEARER_TOKEN`
   Source: returned once by `POST /admin/tools/:toolId/relay-tokens`.
   Required handling: store it immediately in the consuming tool's secret store or runtime config; do not commit it.
6. `ADMIN_EMAIL`
   Source: operator/admin credential for onboarding only.
7. `ADMIN_PASSWORD`
   Source: operator/admin credential for onboarding only.
8. `OPENAI_API_KEY`
   Source: raw OpenAI project key supplied during project key rotation only.

## Recommended secret retrieval pattern for agents

This repo manages `proxy-api` and `relay-api`. It does not manage the secret namespace of every consuming tool.

For any new tool, store tool-side runtime values in that tool's own secret store, then fetch them at startup or deploy time. If the tool runs on AWS, use SSM Parameter Store or Secrets Manager under the tool's own namespace.

Recommended tool-side names:
1. `PROXY_BASE_URL`
2. `PROXY_BEARER_TOKEN`
3. `RELAY_BASE_URL`
4. `RELAY_RESPONSES_URL`
5. `RELAY_BEARER_TOKEN`

Example AWS SSM fetch pattern for a server tool:

```bash
export TOOL_SECRET_PREFIX="/storyworks-alt-text"

export PROXY_BASE_URL="$(aws ssm get-parameter \
  --name "$TOOL_SECRET_PREFIX/PROXY_BASE_URL" \
  --query 'Parameter.Value' \
  --output text)"

export PROXY_BEARER_TOKEN="$(aws ssm get-parameter \
  --name "$TOOL_SECRET_PREFIX/PROXY_BEARER_TOKEN" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)"
```

Example AWS SSM fetch pattern for a distributed client backend or agent host:

```bash
export TOOL_SECRET_PREFIX="/storyworks-alt-text"

export RELAY_BASE_URL="$(aws ssm get-parameter \
  --name "$TOOL_SECRET_PREFIX/RELAY_BASE_URL" \
  --query 'Parameter.Value' \
  --output text)"

export RELAY_RESPONSES_URL="$(aws ssm get-parameter \
  --name "$TOOL_SECRET_PREFIX/RELAY_RESPONSES_URL" \
  --query 'Parameter.Value' \
  --output text)"

export RELAY_BEARER_TOKEN="$(aws ssm get-parameter \
  --name "$TOOL_SECRET_PREFIX/RELAY_BEARER_TOKEN" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)"
```

Do not fetch these App Runner deployment parameters into a tool:
1. `/relay-api/RELAY_PASSWORD_HASH`
2. `/proxy-api/ADMIN_PASSWORD_HASH`
3. `/proxy-api/DATABASE_URL`
4. `/proxy-api/KMS_KEY_ID`

## Current production environment

The shared relay is already deployed in production.

Use these production roots:
1. Proxy/admin root: `https://nnm7du2h7j.eu-west-2.awsapprunner.com`
2. Relay root: `https://5z97x9cmtm.eu-west-2.awsapprunner.com`

For new production tools:
1. Do not deploy another relay service.
2. Create the tool in admin.
3. Use the derived relay URL from the admin response or dashboard.
4. Treat that relay URL as a protected route, not as access by itself.
5. Mint a relay token for the tool and send it as bearer auth to that relay URL.
6. The derived URL format is `https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/<tool-slug>/responses`.

## Relay URL authentication dependency

This is the implementation detail people are missing:
1. The derived relay URL is only a stable address for one tool.
2. It is not a secret.
3. It is not a token.
4. It does not bypass bearer auth.

Why this exists:
1. Distributed clients run on other people's machines, so proxy tokens and raw OpenAI keys still do not belong there.
2. Relay tokens are scoped to relay use only and do not work on `/proxy/*`.
3. The relay route fails closed. If the bearer token is missing, invalid, revoked, or expired, the request is denied.

What implementers must build:
1. Mint a relay token for the tool from the admin dashboard or `POST /admin/tools/:toolId/relay-tokens`.
2. Store that relay token in the tool's secure runtime config.
3. Send `Authorization: Bearer rt.<id>.<secret>` on every call to the tool's relay URL.
4. When the relay returns `401 Missing or invalid bearer token`, rotate or re-copy the relay token and retry.

What implementers must not assume:
1. Copying the relay URL into a plugin, desktop app, browser app, or agent config does not make requests work.
2. A proxy tool token from `/admin/tools/:toolId/tokens` is not the right auth primitive for distributed clients.
3. Admin auth and relay auth are separate. Logging into the admin dashboard does not authenticate client traffic.
4. `RELAY_PASSWORD_HASH` is not a client credential and should never be hard-coded into the tool.

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
7. Mint a relay token if this is a distributed client.
8. Do not ship a distributed client that only knows the URL.
9. Mint a proxy token only if this is a trusted server tool.

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

If you are onboarding a distributed client, you can ignore `tool_token` and mint a relay token separately. The relay URL derived from `TOOL_SLUG` is only the destination path after authentication succeeds.

After onboarding:
1. For trusted server tools, store `PROXY_BASE_URL` and `PROXY_BEARER_TOKEN` in the tool's secret store.
2. For distributed tools, store `RELAY_BASE_URL`, `RELAY_RESPONSES_URL`, and `RELAY_BEARER_TOKEN` in the tool's secret store or operator-controlled runtime config.
3. Do not store `RELAY_PASSWORD_HASH` in the tool.

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

Mint relay token:

```bash
curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/admin/tools/456/relay-tokens"
```

Response:

```json
{
  "token": "rt.<id>.<secret>",
  "expiresAt": "2026-06-01T09:00:00.000Z",
  "relayResponsesUrl": "https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/storyworks-alt-text/responses"
}
```

## Path A: Distributed clients through the shared relay

Authentication sequence for distributed clients:
1. Obtain the tool-specific relay URL from admin.
2. Mint the relay token with `POST /admin/tools/:toolId/relay-tokens`.
3. Store that relay token in the distributed tool's runtime config.
4. Call the tool-specific relay URL with `Authorization: Bearer <relay_token>`.

### Client generation call

```bash
export RELAY_BEARER_TOKEN="rt.<id>.<secret>"
export RELAY_RESPONSES_URL="https://5z97x9cmtm.eu-west-2.awsapprunner.com/v1/tools/storyworks-alt-text/responses"

curl -s -X POST "$RELAY_RESPONSES_URL" \
  -H "Authorization: Bearer $RELAY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"<responses_model>",
    "input":"Return one sentence saying relay connectivity is working."
  }'
```

Rules:
1. Do not put proxy bearer tokens in distributed clients.
2. Do not point distributed clients at `localhost` in production.
3. The shared relay currently exposes only `POST /v1/tools/:toolSlug/responses`.
4. A relay URL without a relay token is expected to fail with `401 Missing or invalid bearer token`.
5. Relay tokens are relay-only credentials and do not work on `/proxy/*`.
6. Legacy `POST /v1/auth/login` support is temporary compatibility only.

## Path B: Trusted server tools through the proxy

Store the tool token server-side only.

```bash
export PROXY_BEARER_TOKEN="tt.<id>.<secret>"

curl -s -X POST "$PROXY_BASE_URL/responses" \
  -H "Authorization: Bearer $PROXY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"<responses_model>",
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
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "<responses_model>"
```

Relay smoke:

```bash
export RELAY_BASE_URL="https://5z97x9cmtm.eu-west-2.awsapprunner.com"
export RELAY_BEARER_TOKEN="rt.<id>.<secret>"

curl -s -X POST "$RELAY_BASE_URL/v1/tools/$TOOL_SLUG/responses" \
  -H "Authorization: Bearer $RELAY_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"<responses_model>",
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
1. Legacy compatibility only: update `RELAY_PASSWORD_HASH` on the `relay-api` service.
2. Deploy `relay-api`.
3. Verify `POST /v1/auth/login` only if older distributed tools still depend on it.

Relay tokens:
1. Mint new relay token.
2. Update the distributed tool with the new token.
3. Run relay smoke verification.
4. Revoke the old relay token.

## Common runtime failures

Proxy:
1. `401 Missing or invalid bearer token`: wrong, expired, or revoked tool token.
2. `403 No active API key for project`: project key missing or inactive.
3. `403 token_cap_exceeded`: project daily cap reached.
4. `429 rate_limit_exceeded`: project RPM cap reached.

Relay:
1. `401 Missing or invalid bearer token`: missing, invalid, revoked, or expired relay token.
2. Legacy compatibility only: `401 Invalid relay credentials`: wrong relay password or non-allowed email domain.
3. `404 Tool not found`: slug does not match a tool.
4. `403 Tool is inactive`: tool exists but is disabled.
5. `403 Project is inactive`: project exists but is disabled.

## Completion checklist

Complete only when all are true:
1. Project exists with the expected slug and environment.
2. Active OpenAI key is set for the project.
3. Tool exists with the expected slug.
4. Distributed clients use the derived relay URL plus a relay token.
5. Trusted server tools store the tool token in server-side secrets only.
6. Distributed-client tools store `RELAY_BEARER_TOKEN`, not `RELAY_PASSWORD_HASH`.
7. Proxy smoke passes for any server tool path.
8. Relay responses smoke passes for any distributed-client path.
