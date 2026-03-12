# AWS App Runner Deployment Notes (MVP)

This is the primary deployment runbook for this repository.

## Deployment model (locked)
1. Build a container image from `infra/Dockerfile`.
2. Push an immutable image tag to ECR.
3. Run an explicit App Runner service update to deploy that tag.

Defaults for this MVP:
1. Manual deployment only.
2. `AutoDeploymentsEnabled=false`.
3. No implicit deploy-on-commit behavior.

## Production config and secrets (locked)

Production source of truth:
1. App Runner `RuntimeEnvironmentSecrets` from AWS SSM Parameter Store.

Local development:
1. Plain env vars / `.env` are acceptable.
2. `ADMIN_PASSWORD` (plaintext) is accepted locally; production should use `ADMIN_PASSWORD_HASH`.

Do not commit secret values.

Required parameter names for this codebase:
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/proxy-api/ADMIN_PASSWORD_HASH`
4. `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
5. `/proxy-api/CORS_ALLOWED_ORIGINS`
6. Optional: `/proxy-api/OPENAI_BASE_URL`

## App Runner configuration templates

Use:
1. `infra/apprunner/service.template.json`
2. `infra/apprunner/update-service.template.json`
3. `infra/scripts/ensure-apprunner-vpc-egress.sh`

Important runtime notes:
1. Do not set `PORT` in App Runner env maps.
2. App Runner provides `PORT`; the app listens on `process.env.PORT`.
3. Health check is HTTP `GET /health`.

## Networking model

App Runner runtime should:
1. Use VPC egress through the configured App Runner connector.
2. Reach OpenAI over outbound internet egress.
3. Reach RDS over the approved DB security group and port.
4. Reach KMS through AWS-managed networking or a VPC endpoint, depending on your environment design.
5. Keep image pulls and runtime secret retrieval on the App Runner-managed path, not through the VPC connector.

MVP trade-off:
1. A single NAT keeps cost and setup low, but it is a single-AZ failure domain for outbound internet egress.

Future hardening:
1. Move RDS to a private-only posture once you are ready to touch DB networking.
2. Replace the single NAT with one NAT per AZ if you need zonal resilience more than lower MVP cost.

## Build and deploy flow

### 0) Ensure VPC egress resources exist
```bash
./infra/scripts/ensure-apprunner-vpc-egress.sh
```

### 1) Build and push immutable image
```bash
export AWS_REGION="eu-west-2"
export AWS_ACCOUNT_ID="<aws-account-id>"
export ECR_REPO="proxy-api"
export IMAGE_TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)-amd64"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build --platform linux/amd64 -f infra/Dockerfile -t "$ECR_REPO:$IMAGE_TAG" .
docker tag "$ECR_REPO:$IMAGE_TAG" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG"
```

Why this is locked:
1. `linux/amd64` is required because the previous ARM-built image failed on App Runner with `exec format error`.
2. Immutable tags are required so each App Runner deploy points at one exact artifact and rollback can target a known-good image.
3. Do not reuse `latest` for deployment.

### 2) Create service (first deploy)
```bash
cp infra/apprunner/service.template.json infra/apprunner/service.current.json
# Fill placeholders in infra/apprunner/service.current.json

aws apprunner create-service \
  --cli-input-json file://infra/apprunner/service.current.json
```

### 3) Update service (later deploys)
```bash
cp infra/apprunner/update-service.template.json infra/apprunner/update-service.current.json
# Fill placeholders in infra/apprunner/update-service.current.json

aws apprunner update-service \
  --cli-input-json file://infra/apprunner/update-service.current.json
```

## Startup and health behavior
1. Production command is `npm start` (`node dist/app.js`).
2. App binds `0.0.0.0` and `process.env.PORT`.
3. Boot runs DB migrations before the server starts listening.
4. If DB connectivity or migrations fail, startup fails and deployment should be treated as failed.

## Observability and rollback

Observability:
1. First view: App Runner service Logs tab.
2. CloudWatch log groups are under `/aws/apprunner/...` (service and application streams).

Post-deploy smoke checks:
1. `GET /health` returns `200` and `{"ok":true}`.
2. Admin login endpoint returns expected status.
3. Proxy smoke path works with a valid tool token (`scripts/smoke-proxy.sh`).

Rollback:
1. Keep last-known-good immutable image tag.
2. Update App Runner service back to previous image tag.
3. Re-run smoke checks.

## Notes
1. Optional `/proxy-api/OPENAI_BASE_URL` can stay unset if the default `https://api.openai.com` is intended.
2. Historical migration notes are archived under `docs/archive/`.
