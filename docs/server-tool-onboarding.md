# Server Tool Onboarding

This runbook onboards a server-side tool to the proxy using project-scoped keys and tool bearer tokens.

## Naming standard

Create one project per product and environment:
- Project slug format: `<tool-slug>-<env>`
- Example: `story-assistant-prod`

## Prerequisites

- A running proxy base URL (example: `https://proxy.example.com`)
- Admin password configured in proxy (`ADMIN_PASSWORD_HASH`)
- OpenAI key for the target project/environment
- `bash`, `curl`, and `node` available locally

## Step 1: Admin auth

```bash
scripts/admin-auth.sh https://proxy.example.com
```

This creates a cookie jar (default: `/tmp/proxy-api-admin.cookie`) after successful password login.

## Step 2: Create/find project, set key, create/find tool, mint token

```bash
scripts/onboard-server-tool.sh \
  --base-url https://proxy.example.com \
  --cookie-jar /tmp/proxy-api-admin.cookie \
  --project-slug story-assistant-prod \
  --project-name "Story Assistant" \
  --environment prod \
  --owner-email owner@bbc.co.uk \
  --daily-token-cap 2000000 \
  --rpm-cap 60 \
  --tool-slug story-assistant-server \
  --tool-mode server
```

Script behavior:
- Finds the project by slug, or creates it
- Rotates/sets the active OpenAI key for that project
- Finds the tool by slug+project, or creates it
- Mints a new tool token

Script output:
- `project_id`
- `project_slug`
- `tool_id`
- `tool_slug`
- `token_expires_at`
- `tool_token` (printed once in command output)

## Step 3: Smoke test proxy access with the tool token

```bash
scripts/smoke-proxy.sh https://proxy.example.com <tool_token> gpt-4.1-mini
```

This checks:
- `GET /proxy/v1/models`
- `POST /proxy/v1/responses`

## Tool integration contract

Set these environment variables in each server-side client tool:

```bash
OPENAI_BASE_URL=https://<proxy-host>/proxy/v1
OPENAI_API_KEY=<tool bearer token>
```

Use the existing OpenAI SDK/client in the tool with this base URL + API key override.

## Token rotation rule

1. Mint a new tool token.
2. Deploy tool config with the new token.
3. Verify traffic is healthy.
4. Revoke old token via `POST /admin/tools/:toolId/tokens/:tokenId/revoke`.

Do not revoke before deploy, or the tool will fail closed.
