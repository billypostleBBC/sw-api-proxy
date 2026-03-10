# Alt-text Generator Onboarding (Gemini -> Proxy-Backed OpenAI)

This runbook onboards Alt-text Generator to SW API Proxy and defines migration constraints for a backend-relay architecture.

## 1) Scope and architecture decision

This onboarding is fixed to backend relay mode:
1. Plugin does not call proxy directly with long-lived token.
2. Existing backend relay holds proxy token.

Rationale:
1. Keeps long-lived credentials out of plugin bundle/runtime.
2. Matches fail-closed security posture in this proxy.
3. Keeps token rotation operationally simple.

## 2) Current state snapshot

Current Alt-text Generator behavior (from plugin repo scan):
1. Plugin calls Gemini endpoint directly: `https://generativelanguage.googleapis.com/...`.
2. Plugin persists Gemini API key in `figma.clientStorage` (`geminiApiKey`).
3. Plugin model defaults to `gemini-2.5-flash`.

## 3) Target state

Target behavior after migration:
1. Backend relay calls proxy `POST /proxy/v1/responses`.
2. Plugin calls backend relay endpoint only.
3. Backend relay reads `OPENAI_BASE_URL` and `OPENAI_API_KEY` from server-side secrets.

## 4) One-time proxy onboarding commands

Set required variables:

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
export TOOL_MODE="server"
```

Admin auth:

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL" "$COOKIE_JAR"
```

Project + key + tool + token bootstrap:

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
  --tool-mode "$TOOL_MODE"
```

Save command output. You need:
1. `project_id`
2. `tool_id`
3. `tool_token`
4. `token_expires_at`

Smoke check with new token:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

## 5) Store outputs in SSM

Store proxy config values as secure parameters:

```bash
export PARAM_BASE="/alt-text-generator/prod"
export TOOL_TOKEN="<tool_token>"

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

## 6) Backend relay config contract

Backend relay must use:

```bash
OPENAI_BASE_URL=https://<proxy>/proxy/v1
OPENAI_API_KEY=<tool_token>
```

Contract notes:
1. `OPENAI_API_KEY` is the proxy tool token (`tt.<id>.<secret>`), not a raw OpenAI key.
2. Relay can use OpenAI SDK with base URL override, or direct `fetch`.
3. Relay should return user-actionable errors when proxy returns `401`, `403`, or `429`.

## 7) Gemini -> proxy migration checklist (docs-level tasks)

1. Remove user-pasted provider key dependency from plugin UX.
2. Route generation requests through backend relay.
3. Keep functional parity for output contract and failure messaging.

Recommended execution order:
1. Add relay endpoint that accepts image/context payload from plugin.
2. Wire relay endpoint to proxy `POST /proxy/v1/responses`.
3. Update plugin to call relay instead of Gemini direct endpoint.
4. Remove Gemini key validation/storage UI states from plugin.
5. QA output format and node write-back behavior remains stable.

## 8) Acceptance checklist

Accept migration only when all pass:
1. `GET /proxy/v1/models` check passes via `scripts/smoke-proxy.sh`.
2. `POST /proxy/v1/responses` check passes via `scripts/smoke-proxy.sh`.
3. Plugin still writes alt text outputs through backend path.
4. Existing skip/failure handling remains understandable for designers.
5. Proxy project caps and auth enforcement are active in runtime.

## 9) Security checklist

1. No provider keys in plugin UI/client storage.
2. No proxy token in plugin bundle.
3. No proxy token committed to repo config files.
4. Token rotation runbook tested before go-live.
5. Old tokens revoked only after new token deployment is confirmed healthy.
