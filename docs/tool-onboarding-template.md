# Tool Onboarding Template (Proxy-Backed OpenAI)

Use this template to onboard a tool from direct model-provider calls to SW API Proxy with project-scoped OpenAI keys and tool bearer tokens.

## When to use this template

Use this template when:
1. A tool currently calls Gemini/OpenAI/another provider directly.
2. You want server-side key custody and project-level limits enforced by SW API Proxy.
3. You need a repeatable operator and agent runbook.

Do not use this template when:
1. The tool is intentionally browser-ticket based (`/auth/client-ticket`) and has no backend relay.
2. You are changing proxy architecture or adding non-MVP infrastructure.

## Inputs required before running

Set and confirm these standardized variables before running commands:

```bash
export BASE_URL="<BASE_URL>"
export ADMIN_EMAIL="<ADMIN_EMAIL>"

export PROJECT_SLUG="<PROJECT_SLUG>"
export PROJECT_NAME="<PROJECT_NAME>"
export ENV="<ENV>"
export OWNER_EMAIL="<OWNER_EMAIL>"
export DAILY_TOKEN_CAP="<DAILY_TOKEN_CAP>"
export RPM_CAP="<RPM_CAP>"

export TOOL_SLUG="<TOOL_SLUG>"
export TOOL_MODE="<TOOL_MODE>" # server | browser | both
```

Input notes:
1. `PROJECT_SLUG` format should be `<tool-slug>-<env>`.
2. `TOOL_MODE` should be `server` for backend relay patterns.
3. Caps must be positive integers.

## Agent execution contract

1. Do not proceed without required inputs.
2. Never print/store plaintext keys outside secure channels.
3. Stop on non-2xx and report exact failed step + remediation.

## Preflight checks

```bash
test -n "$BASE_URL"
test -n "$ADMIN_EMAIL"
test -n "$PROJECT_SLUG"
test -n "$PROJECT_NAME"
test -n "$ENV"
test -n "$OWNER_EMAIL"
test -n "$DAILY_TOKEN_CAP"
test -n "$RPM_CAP"
test -n "$TOOL_SLUG"
test -n "$TOOL_MODE"
```

Then verify local tooling:

```bash
command -v bash
command -v curl
command -v node
```

## Admin auth

Request and verify admin magic-link session cookie:

```bash
scripts/admin-auth.sh "$BASE_URL" "$ADMIN_EMAIL"
```

Default cookie jar created by script:
1. `/tmp/proxy-api-admin.cookie` (or `$TMPDIR/proxy-api-admin.cookie`)

## Project + key + tool bootstrap

Run onboarding script to:
1. Find/create project.
2. Set active OpenAI key for project.
3. Find/create tool.
4. Mint tool token.

```bash
scripts/onboard-server-tool.sh \
  --base-url "$BASE_URL" \
  --cookie-jar /tmp/proxy-api-admin.cookie \
  --project-slug "$PROJECT_SLUG" \
  --project-name "$PROJECT_NAME" \
  --environment "$ENV" \
  --owner-email "$OWNER_EMAIL" \
  --daily-token-cap "$DAILY_TOKEN_CAP" \
  --rpm-cap "$RPM_CAP" \
  --tool-slug "$TOOL_SLUG" \
  --tool-mode "$TOOL_MODE"
```

Expected output includes:
1. `project_id`
2. `tool_id`
3. `token_expires_at`
4. `tool_token` (shown once)

Capture output securely. Do not paste token into docs, chat, or code.

## Secret storage step (SSM-first)

Store base URL and tool token in AWS SSM Parameter Store as `SecureString`.

```bash
export APP_NAME="<tool-name>"
export PARAM_BASE="/$APP_NAME/$ENV"
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

## Tool integration contract

Backend relay services should set:

```bash
OPENAI_BASE_URL=https://<proxy-host>/proxy/v1
OPENAI_API_KEY=<tool bearer token>
```

Rules:
1. Keep token server-side only.
2. Plugin/browser should call backend relay, not proxy directly with long-lived token.
3. Supported proxy operations for this onboarding pattern: `POST /proxy/v1/responses` (optionally `GET /proxy/v1/models` for smoke checks).

## Smoke verification

Use minted tool token:

```bash
scripts/smoke-proxy.sh "$BASE_URL" "<tool_token>" "gpt-4.1-mini"
```

Expected:
1. `models_check=passed`
2. `responses_check=passed`
3. `smoke_status=passed`

## Rotation runbook

Use this order only:
1. Mint new token.
2. Deploy backend with new token.
3. Verify production traffic and smoke checks.
4. Revoke old token.

Mint token:

```bash
curl -s -b /tmp/proxy-api-admin.cookie -X POST \
  "$BASE_URL/admin/tools/<tool_id>/tokens"
```

Revoke old token:

```bash
curl -i -b /tmp/proxy-api-admin.cookie -X POST \
  "$BASE_URL/admin/tools/<tool_id>/tokens/<old_token_id>/revoke"
```

## Rollback and failure checklist

If rotation fails after deploy:
1. Roll back backend config to prior token.
2. Confirm old token is still active.
3. Re-run smoke check with old token.
4. Re-attempt mint/deploy/verify sequence.

If onboarding script fails:
1. Check admin cookie validity.
2. Check admin email allowlist.
3. Check payload inputs and caps are numeric.
4. Re-run failed step only after root cause is clear.

## Onboarding completion checklist

Complete only when all are true:
1. Project exists with expected slug/env.
2. Active project key set via `/admin/projects/:projectId/keys`.
3. Tool exists with expected slug/mode.
4. Tool token minted and stored in SSM.
5. Backend relay reads `OPENAI_BASE_URL` and `OPENAI_API_KEY` from secrets, not code.
6. `scripts/smoke-proxy.sh` passes.
7. No plaintext key/token appears in plugin UI, repo files, or logs.
