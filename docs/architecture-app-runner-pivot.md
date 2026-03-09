# Architecture Note: ECS to App Runner Pivot (MVP)

## Why this pivot
This service is an internal MVP proxy/relay. App Runner reduces operational overhead compared with ECS/ALB while preserving the existing Fastify application and security model.

## What stays the same
1. Single Fastify service process.
2. Existing auth model (admin/user magic links, sessions, tool tokens, client tickets).
3. Existing proxy endpoints and DB schema behavior.
4. KMS encryption for stored OpenAI keys.
5. SES usage for sending magic-link emails.

## What changes
1. Deployment control plane moves from ECS artifacts to App Runner service config.
2. Production runtime secrets source is locked to SSM Parameter Store via App Runner RuntimeEnvironmentSecrets.
3. Network posture is public App Runner ingress with VPC connector egress for private RDS access.
4. Deployment flow is manual image push to ECR plus explicit App Runner service update.

## Startup and health
1. App Runner health check uses HTTP `/health`.
2. App startup includes DB migrations before listening.
3. Failed DB connectivity/migrations should fail deployment.

## Operational baseline
1. Logs are reviewed via App Runner Logs and CloudWatch `/aws/apprunner/...` groups.
2. Deployments are verified with `/health`, auth, and proxy smoke checks.
3. Rollback is image-tag based: update service to the prior known-good immutable tag.

## Non-goals for this migration
1. No new auth systems.
2. No queues/retries/caching framework additions.
3. No broad platform abstractions.
