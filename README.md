# Proxy API (OpenAI Key Proxy)

MVP TypeScript service for securely proxying OpenAI requests to internal tools.

## Features
- KMS-encrypted OpenAI key storage per project.
- Admin auth via allowlisted email + shared password.
- Tool auth via long-lived hashed tokens.
- Proxy endpoints:
  - `POST /proxy/v1/responses`
  - `POST /proxy/v1/embeddings`
  - `GET /proxy/v1/models`
- Rate and cap enforcement per project.
- Usage and audit logs in Postgres.

## Quick start
1. Install dependencies:
   - `npm install`
2. Configure env:
   - `cp .env.example .env`
3. Run locally:
   - `npm run dev`

On startup, DB migrations run automatically.

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

## Deployment
Primary deployment (App Runner):
- `infra/README.md`
- `infra/apprunner/service.template.json`
- `infra/apprunner/update-service.template.json`
- `docs/deployment-checklist.md`
- `infra/Dockerfile`

Historical deployment artifacts remain under `infra/legacy/ecs/` for audit reference only.
