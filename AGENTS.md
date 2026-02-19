# AGENTS.md

## Authority
This document defines the operating scope and engineering rules for this repository.

Treat this file as project law.
If a request conflicts with this file, update this file first or do not implement the request.

## Repository Snapshot (as of 2026-02-19)
TypeScript Fastify service that proxies OpenAI API calls for internal tools with:
1. Admin + user magic-link auth.
2. Project/tool management with per-project limits.
3. Server-side encrypted OpenAI key storage (AWS KMS).
4. Usage + audit persistence in Postgres.
5. Optional AWS ECS deployment artifacts under `infra/`.

## In-Scope (Current MVP)
1. Maintain and extend the existing Fastify API in `src/`.
2. Keep OpenAI key material server-side only; never expose raw keys to clients.
3. Support current proxy endpoints only unless explicitly approved:
   - `POST /proxy/v1/responses`
   - `POST /proxy/v1/embeddings`
   - `GET /proxy/v1/models`
4. Support current auth flows:
   - Admin magic link: request + verify.
   - User magic link: request + verify.
   - User client ticket issuance for tool access.
   - Tool bearer tokens.
5. Enforce per-project RPM and daily token caps.
6. Persist operational data in existing tables (`projects`, `tools`, `tool_tokens`, `usage_events`, `audit_logs`, etc.).

## Out of Scope (Do Not Add Without Explicit Approval)
1. Queues, background workers, retry frameworks, caching layers.
2. Multi-provider proxy expansion beyond OpenAI.
3. Per-user API key ownership or client-managed secrets.
4. Complex architectural rewrites (DI containers, generic plugin frameworks).
5. Non-MVP infra additions (multi-region, event streaming, telemetry platforms).

## Codebase Rules
1. Source of truth is `src/`; `dist/` is build output.
2. Keep implementation explicit and local; avoid abstraction unless duplication is already blocking delivery.
3. Use Zod validation at request boundaries when adding/modifying endpoints.
4. Keep error payload shape consistent with `sendError`:
   - `{ error, message, details? }`
5. Preserve existing auth token primitives:
   - Opaque tokens for magic links/sessions/tool tokens.
   - JWT (HS256) for short-lived client tickets.
6. Preserve DB-first approach:
   - Additive schema changes via `src/db/migrations.ts`.
   - Keep data access in `src/db/repo.ts`.
7. Keep dependencies minimal and justified by immediate product need.

## Security Requirements
1. Never store or log plaintext OpenAI keys.
2. Keep secrets in env/secret manager only (`DATABASE_URL`, signing keys, AWS config, etc.).
3. Keep sensitive log redaction intact (auth headers, key payloads, cookies).
4. All auth/session/token checks must fail closed (invalid/missing token => deny).

## Testing Requirements
1. Keep `npm test` passing (Vitest).
2. Add/adjust tests when behavior changes in:
   - auth/token flows,
   - limit enforcement,
   - crypto/token utilities.
3. Prefer focused unit tests over heavy integration scaffolding for MVP speed.

## Deployment Constraints
1. Local dev and CI must work with `npm run dev`, `npm run build`, `npm test`.
2. AWS deployment assumptions remain:
   - ECS Fargate + ALB,
   - RDS Postgres,
   - KMS for encryption,
   - SES for magic-link email.
3. Do not introduce infrastructure that is not reflected in `infra/README.md` unless this file is updated first.

## Definition of Done
A change is complete only when:
1. It runs in the current TypeScript/Fastify app without breaking existing routes.
2. It stays within In-Scope and respects Out-of-Scope limits.
3. Security rules above remain true.
4. Tests pass or test gaps are explicitly called out.
5. Any scope shift is documented in this file.

## Change Control
Any meaningful requirement change must update this file in the same change set, including:
1. The relevant section(s) above.
2. A dated entry in `Change Log`.

### Change Log
- 2026-02-19: Replaced generic charter with repo-specific project law after full repo scan (Fastify + Postgres + AWS KMS/SES + OpenAI proxy).
