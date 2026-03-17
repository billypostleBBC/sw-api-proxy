# SW API Proxy: Admin Dashboard Guide

This guide explains how to use the web admin dashboard at:

- `https://<your-proxy-host>/admin`

Use this when you want to manage projects, OpenAI keys, tools, tool tokens, and usage without calling admin APIs manually.

## What the dashboard can do

1. Sign in/out with admin session cookies.
2. Create projects.
3. Rotate active OpenAI key for a project.
4. Create tools.
5. Mint and revoke tool tokens.
6. Soft-delete projects and tools (deactivate).
7. View recent usage events with filters.

## Prerequisites

1. Your email is in `ADMIN_EMAIL_ALLOWLIST`.
2. You know the shared `ADMIN_PASSWORD`.
3. Proxy is reachable over HTTPS (required for secure admin cookie).
4. You have the OpenAI key for the project you are setting up.

## Sign in

1. Open `/admin`.
2. Enter:
   - Admin email
   - Password
3. Click `Sign in`.

If login succeeds you land on `Proxy Admin Dashboard`.

If login fails:
1. Check email is allowlisted.
2. Check password matches `ADMIN_PASSWORD`.
3. Confirm you are on the correct environment URL (dev/stage/prod).

## Dashboard layout

The page has 3 sections:

1. `Projects`
2. `Tools & Tokens`
3. `Usage`

Top-right actions:
1. `Help` opens the in-page admin guide.
2. `Refresh all` reloads projects/tools/usage tables.
3. `Sign out` clears `admin_session` cookie.

## Projects section

### Create project

Use `Create project` form with:
1. `slug` (must be unique)
2. `name`
3. `environment` (for example `dev`, `staging`, `prod`)
4. `owner email`
5. `RPM cap` (positive integer)
6. `Daily token cap` (positive integer)

Click `Create project`.

Notes:
1. Duplicate `slug` fails due DB uniqueness.
2. Caps are enforced by proxy on requests to `/proxy/v1/*`.
3. The projects table hides inactive projects by default. Use `Show inactive` to include them.

### Rotate project API key

Use `Rotate project API key` with:
1. `project id`
2. `OpenAI API key` (`sk-...`)

Click `Rotate key`.

Behavior:
1. New key becomes active immediately.
2. Previous key for that project is set inactive.
3. Raw key is never returned by API.

### Delete project (soft)

Use the `Delete` action in the Projects table.

Behavior:
1. Project status becomes `inactive`.
2. All tools under the project become `inactive`.
3. All tokens for those tools are revoked.
4. Usage history remains visible in the Usage table.

## Tools & Tokens section

### Create tool

Use `Create tool` with:
1. `tool slug` (must be unique)
2. `project id` (existing project)
3. `mode`:
   - `server`
   - `browser`
   - `both`

Click `Create tool`.

Notes:
1. The tools table hides inactive tools by default. Use `Show inactive` to include them.

### Mint tool token

Use `Mint tool token` with:
1. `tool id`

Click `Mint token`.

Important:
1. Token is displayed once in the warning panel.
2. Store it immediately in your secret manager.
3. Token format is `tt.<id>.<secret>`.
4. Expiry is shown in the panel (`TOOL_TOKEN_TTL_DAYS`, default 90 days).

### Token list & revoke

Use the token list panel to revoke tokens without pasting secrets.

Flow:
1. Select `Tokens` from the tool row you want to inspect.
2. The panel shows token IDs and status (active/revoked).
3. Click `Revoke` to deactivate a token.

Notes:
1. Raw token material is never shown after minting.

### Delete tool (soft)

Use the `Delete` action in the Tools table.

Behavior:
1. Tool status becomes `inactive`.
2. All tokens for that tool are revoked.
3. Usage history remains visible in the Usage table.

## Usage section

Use filters to narrow recent usage rows:
1. `project id` (optional)
2. `from` datetime (optional)
3. `to` datetime (optional)

Actions:
1. `Apply filters` reloads filtered data.
2. `Reset` clears filters and reloads.

Usage table shows:
1. Request metadata (endpoint, model, status, latency)
2. Token counts (input/output)
3. Estimated cost

Notes:
1. The admin usage endpoint returns up to 1000 rows per request.
2. Datetimes are entered in local browser time, then sent as ISO timestamps.
3. The first column `#` is the usage event number (not project/tool ID).

## Recommended first-time flow

For a new tool, do this in order:

1. Create project.
2. Rotate project API key.
3. Create tool.
4. Mint tool token.
5. Store token in backend secret storage.
6. Test with `scripts/smoke-proxy.sh`.

## Common problems

1. `Admin session required`
   - Session expired or missing cookie. Sign in again.
2. `Invalid project payload` / `Invalid tool payload`
   - One or more fields are missing or not valid types.
3. `invalid input syntax for type bigint/integer`
   - `project id` or `tool id` is wrong.
4. Duplicate key errors
   - `project.slug` or `tool.slug` already exists.

## What this dashboard does not do (MVP)

1. Edit existing project caps/name/owner.
2. Hard-delete projects or tools (deletes are soft only).
3. Show raw OpenAI keys.
4. Manage non-OpenAI providers.
