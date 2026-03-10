# AWS App Runner Deployment Notes (MVP)

This is the primary deployment runbook for this repository.

## Discovery snapshot (read-only, 2026-03-10)
1. Account: `445816555466`
2. Region: `eu-west-2`
3. Caller identity: `arn:aws:iam::445816555466:root`
4. VPC: `vpc-02283c1aa7bf8781a` (default)
5. Subnets in VPC:
   - `subnet-0ac8cc526388c2cb1` (`eu-west-2a`, public)
   - `subnet-0483a1ada953354fe` (`eu-west-2b`, public)
   - `subnet-0f1ca0b3dfeaf1090` (`eu-west-2c`, public)
6. RDS instance: `proxy-api-db` (`postgres`, endpoint `proxy-api-db.crmcgymui2np.eu-west-2.rds.amazonaws.com:5432`, `PubliclyAccessible=true`)

## App Runner discovery status
App Runner read APIs are now accessible in `eu-west-2` for this account.

Current discovery result:
1. `list-services`: no services found.
2. `list-vpc-connectors`: connector `proxy-api-vpc-connector` is present and `ACTIVE`.

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

Required parameter names for this codebase:
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/proxy-api/ADMIN_PASSWORD`
4. `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
5. `/proxy-api/CORS_ALLOWED_ORIGINS`
6. Optional: `/proxy-api/OPENAI_BASE_URL`

Read-only discovery result (names only):
1. Found:
   - `/proxy-api/DATABASE_URL`
   - `/proxy-api/KMS_KEY_ID`
   - `/proxy-api/CORS_ALLOWED_ORIGINS`
2. Missing:
   - `/proxy-api/ADMIN_PASSWORD`
   - `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
   - `/proxy-api/OPENAI_BASE_URL`

## App Runner configuration templates

Use:
1. `infra/apprunner/service.template.json`
2. `infra/apprunner/update-service.template.json`

Values already filled from discovery:
1. Account ID: `445816555466`
2. Region: `eu-west-2`
3. ECR URI prefix: `445816555466.dkr.ecr.eu-west-2.amazonaws.com/proxy-api`
4. Service name: `proxy-api`
5. Selected immutable image tag: `20260310-5e75be7`
6. ECR access role ARN: `arn:aws:iam::445816555466:role/proxy-api-apprunner-ecr-access-role`
7. Instance role ARN: `arn:aws:iam::445816555466:role/proxy-api-apprunner-instance-role`
8. VPC connector ARN: `arn:aws:apprunner:eu-west-2:445816555466:vpcconnector/proxy-api-vpc-connector/1/1226dce53f4646298d53cb10723fafce`

Still required:
1. `<service-id>` (for update template; available only after service creation)

Important runtime notes:
1. Do not set `PORT` in App Runner env maps.
2. App Runner provides `PORT`; the app listens on `process.env.PORT`.
3. Health check is HTTP `GET /health`.

## Networking model (current vs target)

Current discovered state:
1. Default VPC with public subnets and IGW route.
2. No NAT gateways.
3. No VPC endpoints.
4. RDS is currently public.

Target decision for App Runner:
1. Egress mode chosen: `VPC`.
2. Existing RDS SG rules already allow ECS SG `sg-08255fa7bfd47ceda`; the created connector uses that SG, so DB reachability is plausible.
3. With VPC egress, outbound access to public APIs (OpenAI and AWS public endpoints) needs NAT and/or VPC endpoints.

Infra decision required:
1. Whether to keep RDS public or migrate to private-subnet posture.
2. NAT and/or VPC endpoint strategy for VPC egress.

Note:
1. App Runner image pull and runtime secret retrieval are App Runner-managed operations and are not routed through your VPC connector.

## Build and deploy flow

### 1) Build and push immutable image
```bash
export AWS_REGION="eu-west-2"
export AWS_ACCOUNT_ID="445816555466"
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
cp infra/apprunner/service.template.json infra/apprunner/service.current.json
# Edit remaining placeholders in infra/apprunner/service.current.json

aws apprunner create-service \
  --cli-input-json file://infra/apprunner/service.current.json
```

### 3) Update service (later deploys)
```bash
cp infra/apprunner/update-service.template.json infra/apprunner/update-service.current.json
# Edit remaining placeholders in infra/apprunner/update-service.current.json

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

## Outstanding blockers
1. No App Runner service exists yet in `eu-west-2` (`ServiceSummaryList` is empty).
2. Required SSM parameters are missing: `ADMIN_PASSWORD`, `ADMIN_EMAIL_ALLOWLIST` (and optional `OPENAI_BASE_URL` if needed).
3. VPC egress is selected but the VPC currently has no NAT gateways and no VPC endpoints; runtime calls to OpenAI/KMS may fail until egress is addressed.
