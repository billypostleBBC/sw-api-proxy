# Proxy API (OpenAI Key Proxy)

MVP TypeScript service for securely proxying OpenAI requests to internal tools.

## Features
- KMS-encrypted OpenAI key storage per project.
- Admin auth via allowlisted email + shared password.
- Tool-token-backed short-lived client ticket issuance.
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

## How to use
- Step-by-step setup and integration guide: `docs/how-to-use.md`
- Admin dashboard guide (web UI): `docs/admin-dashboard.md`
- Repeatable onboarding template for any tool: `docs/tool-onboarding-template.md`
- Alt-text Generator migration runbook: `docs/alt-text-generator-onboarding.md`
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

### Ticket auth
- `POST /auth/client-ticket`

### Proxy
- `POST /proxy/v1/responses`
- `POST /proxy/v1/embeddings`
- `GET /proxy/v1/models`

## Deployment
See:
- `infra/README.md`
- `infra/ecs-task-definition.json`
- `infra/Dockerfile`
