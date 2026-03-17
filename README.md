# Proxy API (OpenAI Proxy + Shared Relay)

MVP TypeScript services for securely routing OpenAI requests to internal tools and distributed clients.

## Features
- KMS-encrypted OpenAI key storage per project.
- Admin auth via allowlisted email + shared password.
- Shared relay auth via BBC Studios (`@bbc.com`) email + shared password with daily bearer sessions.
- Tool auth via long-lived hashed tokens.
- Proxy endpoints:
  - `POST /proxy/v1/responses`
  - `POST /proxy/v1/embeddings`
  - `GET /proxy/v1/models`
- Relay endpoints:
  - `POST /v1/auth/login`
  - `POST /v1/tools/:toolSlug/responses`
- Rate and cap enforcement per project.
- Usage and audit logs in Postgres.

## Quick start
1. Install dependencies:
   - `npm install`
2. Configure env:
   - `cp .env.example .env`
3. Run locally:
   - `npm run dev`
   - `npm run dev:relay`

On startup, DB migrations run automatically.

## Local preview database
Use this when you want a disposable local Postgres for dashboard/UI preview without touching AWS:
1. Start the container:
   - `./scripts/dev-postgres.sh start`
2. Copy the preview env if you want to customize it:
   - `cp .env.preview.example .env.preview.local`
3. Launch the admin preview app:
   - `./scripts/run-preview-admin.sh`

Defaults:
1. Local Postgres runs in Docker on `localhost:54329`.
2. Preview admin login uses:
   - email: `admin@bbc.co.uk`
   - password: `preview-admin-password`
3. Rotate-key and real proxy calls still require valid AWS/OpenAI credentials; the dashboard shell, project/tool CRUD, token mint/revoke, usage views, and delete flows work against the local preview DB.

## Build and test
- Build: `npm run build`
- Tests: `npm test`

## Dependency installs
- Dependencies are not committed.
- Local development: run `npm install`.
- CI/clean installs: use `npm ci` to install exactly from `package-lock.json` and fail if lockfile and manifest drift.

## How to use
- Admin dashboard and CLI operator guide: `docs/how-to-use.md`
- Repeatable onboarding runbook for any tool: `docs/tool-onboarding.md`
- Key provisioning and rotation guide: `docs/proxy-key-provisioning.md`

## Core endpoints
### Admin auth
- `POST /admin/auth/login`

### Admin management
- `POST /admin/projects`
- `POST /admin/projects/:projectId/keys`
- `POST /admin/tools`
- `POST /admin/tools/:toolId/tokens`
- `POST /admin/tools/:toolId/tokens/:tokenId/revoke`
- `GET /admin/usage`

### Proxy
- `POST /proxy/v1/responses`
- `POST /proxy/v1/embeddings`
- `GET /proxy/v1/models`

### Relay
- `POST /v1/auth/login`
- `POST /v1/tools/:toolSlug/responses`

## Deployment
Primary deployment (App Runner):
- `infra/README.md`
- `infra/apprunner/service.template.json`
- `infra/apprunner/update-service.template.json`
- `infra/apprunner/relay.service.template.json`
- `infra/apprunner/relay.update-service.template.json`
- `docs/deployment-checklist.md`
- `infra/Dockerfile`

Historical deployment artifacts remain under `infra/legacy/ecs/` for audit reference only.
