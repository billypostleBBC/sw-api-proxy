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

Do not commit secret values.

Required SSM parameters for production:
1. `/proxy-api/<env>/DATABASE_URL`
2. `/proxy-api/<env>/KMS_KEY_ID`
3. `/proxy-api/<env>/SES_FROM_EMAIL`
4. `/proxy-api/<env>/APP_BASE_URL`
5. `/proxy-api/<env>/SESSION_SIGNING_KEY`
6. `/proxy-api/<env>/CLIENT_TICKET_SIGNING_KEY`
7. `/proxy-api/<env>/ADMIN_EMAIL_ALLOWLIST`
8. `/proxy-api/<env>/CORS_ALLOWED_ORIGINS`
9. Optional: `/proxy-api/<env>/OPENAI_BASE_URL` (only if not using default `https://api.openai.com`)

## App Runner configuration template

Use:
1. `infra/apprunner/service.template.json`
2. `infra/apprunner/update-service.template.json`

Replace placeholders only:
1. `<service-name>`
2. `<account-id>`
3. `<region>`
4. `<immutable-image-tag>`
5. `<apprunner-ecr-access-role>`
6. `<apprunner-instance-role>`
7. `<connector-name>`
8. `<connector-id>`
9. `<env>`

Important runtime notes:
1. Do not set `PORT` in App Runner env maps.
2. App Runner provides `PORT`; the app listens on `process.env.PORT`.
3. Health check is HTTP `GET /health`.

## Networking model (locked)

Target topology:
1. Public App Runner ingress over HTTPS.
2. VPC egress via App Runner VPC connector.
3. Private RDS is assumed and must be confirmed by infra.

Required network setup:
1. VPC connector attached to private subnets in at least two AZs.
2. Connector security group allows outbound to:
   - RDS PostgreSQL (`5432`)
   - required external/API destinations (OpenAI API)
   - required AWS APIs used by runtime (KMS, SES)
3. RDS security group allows inbound `5432` from the App Runner connector security group.

Outbound strategy when using VPC egress:
1. NAT gateway is required for public internet access (for example OpenAI API) unless a different approved egress path exists.
2. VPC endpoints can be used for AWS APIs as an infra optimization.

Infra decision required:
1. Final NAT vs endpoint mix.
2. Final subnet IDs/security group IDs/VPC connector ARN.
3. Confirmation of RDS reachability model.

Note:
1. App Runner image pull and runtime secret retrieval are App Runner-managed operations and are not routed through your VPC connector.

## Build and deploy flow

### 1) Build and push immutable image
```bash
export AWS_REGION="<region>"
export AWS_ACCOUNT_ID="<account-id>"
export ECR_REPO="proxy-api"
export IMAGE_TAG="$(git rev-parse --short HEAD)"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -f infra/Dockerfile -t "$ECR_REPO:$IMAGE_TAG" .
docker tag "$ECR_REPO:$IMAGE_TAG" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG"
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG"
```

### 2) Create service (first deploy)
```bash
cp infra/apprunner/service.template.json infra/apprunner/service.<env>.json
# Edit placeholders in infra/apprunner/service.<env>.json

aws apprunner create-service \
  --cli-input-json file://infra/apprunner/service.<env>.json
```

### 3) Update service (later deploys)
```bash
# Copy update template and edit placeholders.
cp infra/apprunner/update-service.template.json infra/apprunner/update-service.<env>.json

aws apprunner update-service \
  --cli-input-json file://infra/apprunner/update-service.<env>.json
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
2. Admin magic-link request endpoint returns expected status.
3. Proxy smoke path works with a valid tool token (`scripts/smoke-proxy.sh`).

Rollback:
1. Keep last-known-good immutable image tag.
2. Update App Runner service back to previous image tag.
3. Re-run smoke checks.

## Infra handoff checklist
1. ECR repo exists and deploy actor can push images.
2. App Runner service create/update permissions exist.
3. App Runner ECR access role ARN exists.
4. App Runner instance role ARN has runtime permissions:
   - `kms:Encrypt`, `kms:Decrypt`
   - `ses:SendEmail`
   - `ssm:GetParameter`, `ssm:GetParameters` (for SSM-backed runtime secrets)
5. SSM parameter paths/values exist for required runtime secrets.
6. VPC connector exists with approved subnets and security groups.
7. RDS security group allows inbound from App Runner connector SG.
8. Egress strategy for OpenAI/AWS APIs is confirmed.
9. Final `APP_BASE_URL`/domain and TLS setup are confirmed.
