# App Runner Deployment Checklist (MVP)

Use this checklist for both `proxy-api` and `relay-api`.

## 1) Prerequisites
1. ECR repository exists for `proxy-api`.
2. App Runner service role ARNs are available:
   - ECR access role
   - Instance runtime role
3. VPC connector exists and is approved for target subnets/security groups.
4. RDS connectivity from connector SG to DB SG/port is in place.
5. App Runner API access works for this principal in `eu-west-2`.
6. Target App Runner service name is known.

## 2) Service-specific config

### `proxy-api`
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/proxy-api/ADMIN_PASSWORD_HASH`
4. `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
5. `/proxy-api/CORS_ALLOWED_ORIGINS`
6. Runtime var `RELAY_PUBLIC_BASE_URL`

### `relay-api`
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/relay-api/RELAY_PASSWORD_HASH`
4. `/relay-api/CORS_ALLOWED_ORIGINS`
5. Runtime var `RELAY_EMAIL_DOMAIN_ALLOWLIST`
6. Runtime var `RELAY_SESSION_TTL_HOURS`

## 3) Build and publish
1. Build image from `infra/Dockerfile`.
2. Build explicitly for `linux/amd64`.
3. Tag with an immutable tag such as `<timestamp>-<git-sha>-amd64`.
4. Do not deploy mutable tags such as `latest`.
5. Push to ECR.

## 4) Deploy

### `proxy-api`
1. Use `infra/apprunner/service.template.json` for first deploy.
2. Use `infra/apprunner/update-service.template.json` for later deploys.

### `relay-api`
1. Use `infra/apprunner/relay.service.template.json` for first deploy.
2. Use `infra/apprunner/relay.update-service.template.json` for later deploys.

For both:
1. Fill placeholders only.
2. Confirm `AutoDeploymentsEnabled=false`.

## 5) Post-deploy smoke checks

### `proxy-api`
1. `GET /health` returns `200` and `{"ok":true}`.
2. Admin login endpoint responds as expected.
3. `scripts/smoke-proxy.sh <base_url> <tool_token> [model]` passes.
4. `/admin/tools` returns derived `relayResponsesUrl` values when `RELAY_PUBLIC_BASE_URL` is set.

### `relay-api`
1. `GET /health` returns `200` and `{"ok":true}`.
2. `POST /v1/auth/login` succeeds for an allowed email and the shared relay password.
3. `POST /v1/tools/:toolSlug/responses` succeeds with a valid relay session token.

## 6) Observability checks
1. Review App Runner Logs tab for startup/runtime errors.
2. Review CloudWatch `/aws/apprunner/...` logs for deployment and app output.

## 7) Rollback
1. Identify last-known-good immutable image tag.
2. Update the affected App Runner service image identifier back to that tag.
3. Re-run the smoke checks for that service.
4. Keep failed tag for investigation.
