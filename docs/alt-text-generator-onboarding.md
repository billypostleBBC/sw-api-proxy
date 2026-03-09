# Alt-text Generator Onboarding (Proxy-Backed OpenAI)

This runbook is the source of truth for integrating Alt-text Generator with SW API Proxy.

## 1) Architecture Decision (Locked For MVP)

Use backend relay mode only:
1. Plugin calls your relay, not proxy endpoints directly.
2. Relay calls `POST /proxy/v1/responses` using a long-lived tool token.
3. Plugin never sees long-lived proxy credentials.

Why this approach:
1. Fastest path to production with current code.
2. Keeps token rotation simple.
3. Avoids browser-side proxy auth/CORS complexity during migration.

## 2) If You Already Minted A Tool Token (Start Here)

Use this first for local verification before plugin integration:

```bash
export BASE_URL="https://proxy.example.com"
export TOOL_TOKEN="tt.<id>.<secret>"

scripts/smoke-proxy.sh "$BASE_URL" "$TOOL_TOKEN" "gpt-4.1-mini"
```

Success output must include:
1. `models_check=passed`
2. `responses_check=passed`
3. `smoke_status=passed`

If this fails, fix proxy config/token first. Do not start plugin integration until smoke passes.

## 3) One-Time Bootstrap (Only If You Need New Project/Token)

Prereqs:
1. Use HTTPS base URL for admin script flow (admin cookie is `Secure`).
2. Admin email must be in `ADMIN_EMAIL_ALLOWLIST`.

```bash
export BASE_URL="https://proxy.example.com"
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

```bash
scripts/admin-auth.sh "$BASE_URL" "$COOKIE_JAR"
```

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

Save these outputs securely:
1. `project_id`
2. `tool_id`
3. `tool_token` (shown once)
4. `token_expires_at`

Then run smoke test from section 2.

## 4) Relay Integration Contract (What The Other Codex Thread Should Build)

Relay environment variables:

```bash
OPENAI_BASE_URL=https://<proxy-host>/proxy/v1
OPENAI_API_KEY=tt.<id>.<secret>
```

Rules:
1. `OPENAI_API_KEY` is the proxy tool token, not a raw OpenAI key.
2. Relay keeps this token server-side only.
3. Plugin sends generation requests to relay only.
4. Relay forwards one request to `POST /responses` per plugin action.

Minimal relay request shape (pass-through to proxy):

```json
{
  "model": "gpt-4.1-mini",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Write concise alt text in plain English." },
        { "type": "input_image", "image_url": "data:image/png;base64,..." }
      ]
    }
  ]
}
```

## 5) Plugin Migration Scope

Required changes:
1. Remove direct Gemini API calls.
2. Remove stored provider key behavior from plugin state/client storage.
3. Call relay endpoint for alt-text generation.
4. Keep current UX for loading/success/failure.

Explicitly out of scope for this migration:
1. Queues, retries, caching, or background workers.
2. Multi-provider switching.
3. Plugin-side long-lived token handling.

## 6) Error Handling Contract

Relay should pass clear failures back to plugin:
1. `401 unauthorized`: relay token invalid/expired.
2. `403 forbidden` with `No active API key for project`: project key missing.
3. `403 token_cap_exceeded`: daily cap reached.
4. `429 rate_limit_exceeded`: RPM cap reached; retry after ~60s.
5. `502 upstream_error`: OpenAI upstream failed (include status/details in relay logs/response metadata).

## 7) Secret Storage (Deployment)

Store proxy connection values in secret manager (example: AWS SSM):

```bash
export PARAM_BASE="/alt-text-generator/prod"
export TOOL_TOKEN="tt.<id>.<secret>"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_BASE_URL" \
  --type "SecureString" \
  --overwrite \
  --value "https://proxy.example.com/proxy/v1"

aws ssm put-parameter \
  --name "$PARAM_BASE/OPENAI_API_KEY" \
  --type "SecureString" \
  --overwrite \
  --value "$TOOL_TOKEN"
```

## 8) Definition Of Done

Migration is complete only when:
1. `scripts/smoke-proxy.sh` passes with the live token.
2. Plugin generates alt text through relay -> proxy path.
3. No provider keys or proxy tokens are stored client-side.
4. Old token is revoked only after new token is deployed and verified.
