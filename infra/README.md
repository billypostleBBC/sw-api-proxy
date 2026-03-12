# AWS App Runner Deployment Notes (MVP)

This is the primary deployment runbook for this repository.

## Discovery snapshot (read-only, 2026-03-12)
1. Account: `445816555466`
2. Region: `eu-west-2`
3. Caller identity: `arn:aws:iam::445816555466:root`
4. VPC: `vpc-02283c1aa7bf8781a` (default)
5. Public subnets in VPC:
   - `subnet-0ac8cc526388c2cb1` (`eu-west-2a`)
   - `subnet-0483a1ada953354fe` (`eu-west-2b`)
   - `subnet-0f1ca0b3dfeaf1090` (`eu-west-2c`)
6. Private App Runner subnets:
   - `subnet-0b9c5467ca5d4e10d` (`proxy-api-apprunner-private-euw2a`, `172.31.48.0/24`)
   - `subnet-0433d150dab8110ff` (`proxy-api-apprunner-private-euw2b`, `172.31.49.0/24`)
   - `subnet-01d16179b82b3e4e6` (`proxy-api-apprunner-private-euw2c`, `172.31.50.0/24`)
7. Private route table: `rtb-01309a1efb4be0198` with `0.0.0.0/0 -> nat-086ce5ac36b7f4b08`
8. KMS interface endpoint: `vpce-0cf9b18049a9d8968`
9. RDS instance: `proxy-api-db` (`postgres`, endpoint `proxy-api-db.crmcgymui2np.eu-west-2.rds.amazonaws.com:5432`, `PubliclyAccessible=true`)

## App Runner discovery status
App Runner read APIs are now accessible in `eu-west-2` for this account.

Current discovery result:
1. `list-services`:
   - `proxy-api` (`RUNNING`, `nnm7du2h7j.eu-west-2.awsapprunner.com`)
2. `list-vpc-connectors`:
   - `proxy-api-vpc-connector-private` is `ACTIVE` and is the intended runtime connector.

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

Read-only discovery result (names only):
1. Found:
   - `/proxy-api/DATABASE_URL`
   - `/proxy-api/KMS_KEY_ID`
   - `/proxy-api/ADMIN_PASSWORD_HASH`
   - `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
   - `/proxy-api/CORS_ALLOWED_ORIGINS`
2. Missing:
   - `/proxy-api/OPENAI_BASE_URL`

## App Runner configuration templates

Use:
1. `infra/apprunner/service.template.json`
2. `infra/apprunner/update-service.template.json`
3. `infra/scripts/ensure-apprunner-vpc-egress.sh`

Values already filled from discovery:
1. Account ID: `445816555466`
2. Region: `eu-west-2`
3. ECR URI prefix: `445816555466.dkr.ecr.eu-west-2.amazonaws.com/proxy-api`
4. Service name: `proxy-api`
5. Selected immutable image tag: `20260312-101627-adminhash-amd64`
6. ECR access role ARN: `arn:aws:iam::445816555466:role/proxy-api-apprunner-ecr-access-role`
7. Instance role ARN: `arn:aws:iam::445816555466:role/proxy-api-apprunner-instance-role`
8. VPC connector ARN: `arn:aws:apprunner:eu-west-2:445816555466:vpcconnector/proxy-api-vpc-connector-private/1/6a796c78d4ca44e6aed6785f74151185`

Still required:
1. Choose the next immutable image tag for each deployment.

Important runtime notes:
1. Do not set `PORT` in App Runner env maps.
2. App Runner provides `PORT`; the app listens on `process.env.PORT`.
3. Health check is HTTP `GET /health`.

## Networking model (current deployed state)

Current discovered state:
1. App Runner runtime egress stays on `VPC`.
2. The active connector target is the dedicated private subnet set:
   - `subnet-0b9c5467ca5d4e10d`
   - `subnet-0433d150dab8110ff`
   - `subnet-01d16179b82b3e4e6`
3. OpenAI egress is routed through NAT gateway `nat-086ce5ac36b7f4b08`.
4. KMS calls stay inside the VPC through interface endpoint `vpce-0cf9b18049a9d8968`.
5. Dedicated App Runner connector SG `sg-0ae81d6b4d0bc0cdd` is allowed into both RDS SGs on `5432`.
6. RDS remains public for now; this fix restores runtime pathing without changing the DB posture.

MVP trade-off:
1. NAT is single-AZ in `eu-west-2a`. That is the simplest viable fix and keeps cost down, but it is a single-AZ failure domain for outbound internet egress.

Future hardening:
1. Move RDS to a private-only posture once you are ready to touch DB networking.
2. Replace the single NAT with one NAT per AZ if you need zonal resilience more than lower MVP cost.

Note:
1. App Runner image pull and runtime secret retrieval are App Runner-managed operations and are not routed through your VPC connector.

## Build and deploy flow

### 0) Ensure VPC egress resources exist
```bash
./infra/scripts/ensure-apprunner-vpc-egress.sh
```

### 1) Build and push immutable image
```bash
export AWS_REGION="eu-west-2"
export AWS_ACCOUNT_ID="445816555466"
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
1. None for the current App Runner runtime path.
2. Optional `/proxy-api/OPENAI_BASE_URL` is still unset (safe if default `https://api.openai.com` is intended).
