# App Runner Deployment Checklist (MVP)

## 1) Prerequisites
1. ECR repository exists for `proxy-api`.
2. App Runner service role ARNs are available:
   - ECR access role
   - Instance runtime role
3. Required SSM parameters exist:
   - `/proxy-api/DATABASE_URL`
   - `/proxy-api/KMS_KEY_ID`
   - `/proxy-api/ADMIN_PASSWORD_HASH`
   - `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
   - `/proxy-api/CORS_ALLOWED_ORIGINS`
4. VPC connector exists and is approved for target subnets/security groups.
5. RDS connectivity from connector SG to DB SG/port is in place.
6. App Runner API access works for this principal in `eu-west-2`.
7. Target App Runner service name is known.

## 2) Build and publish
1. Build image from `infra/Dockerfile`.
2. Build explicitly for `linux/amd64`.
3. Tag with an immutable tag such as `<timestamp>-<git-sha>-amd64`.
4. Do not deploy mutable tags such as `latest`.
5. Push to ECR.

## 3) Deploy
1. Copy `infra/apprunner/service.template.json` to env-specific file.
2. Fill placeholders only.
3. First deploy: `aws apprunner create-service --cli-input-json file://...`.
4. Later deploys: copy `infra/apprunner/update-service.template.json` and run `aws apprunner update-service --cli-input-json file://...`.
5. Confirm `AutoDeploymentsEnabled=false`.

## 4) Post-deploy smoke checks
1. `GET /health` returns `200` and `{"ok":true}`.
2. Admin login endpoint responds as expected.
3. `scripts/smoke-proxy.sh <base_url> <tool_token> [model]` passes.

## 5) Observability checks
1. Review App Runner Logs tab for startup/runtime errors.
2. Review CloudWatch `/aws/apprunner/...` logs for deployment and app output.

## 6) Rollback
1. Identify last-known-good immutable image tag.
2. Update App Runner service image identifier back to that tag.
3. Re-run smoke checks.
4. Keep failed tag for investigation; do not reuse mutable tags.

## 7) Infra decisions to confirm
1. Final RDS reachability posture (currently discovered as `PubliclyAccessible=true`).
2. Whether to keep the single-AZ NAT as an MVP trade-off or add one NAT per AZ later.
