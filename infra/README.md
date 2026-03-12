# AWS App Runner Deployment Notes (MVP)

This repository now deploys two services from the same image:
1. `proxy-api` for admin + tool-token proxy traffic.
2. `relay-api` for distributed-client relay traffic.

## Deployment model (locked)
1. Build one container image from `infra/Dockerfile`.
2. Push one immutable image tag to ECR.
3. Deploy that same tag to whichever service needs updating.

Defaults for this MVP:
1. Manual deployment only.
2. `AutoDeploymentsEnabled=false`.
3. No implicit deploy-on-commit behavior.

## Production config and secrets (locked)

Production source of truth:
1. App Runner `RuntimeEnvironmentSecrets` from AWS SSM Parameter Store.

Local development:
1. Plain env vars / `.env` are acceptable.
2. `ADMIN_PASSWORD` is accepted locally for the proxy service.
3. `RELAY_PASSWORD` is accepted locally for the relay service.

Do not commit secret values.

## Required parameters by service

### `proxy-api`
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/proxy-api/ADMIN_PASSWORD_HASH`
4. `/proxy-api/ADMIN_EMAIL_ALLOWLIST`
5. `/proxy-api/CORS_ALLOWED_ORIGINS`
6. Optional runtime var: `RELAY_PUBLIC_BASE_URL`
7. Optional secret: `/proxy-api/OPENAI_BASE_URL`

### `relay-api`
1. `/proxy-api/DATABASE_URL`
2. `/proxy-api/KMS_KEY_ID`
3. `/relay-api/RELAY_PASSWORD_HASH`
4. `/relay-api/CORS_ALLOWED_ORIGINS`
5. Runtime var: `RELAY_EMAIL_DOMAIN_ALLOWLIST`
6. Runtime var: `RELAY_SESSION_TTL_HOURS`
7. Optional secret: `/proxy-api/OPENAI_BASE_URL`

The relay intentionally reuses the proxy database and KMS parameters.

IAM requirement:
1. The App Runner instance role must be able to read both `arn:aws:ssm:...:parameter/proxy-api*` and `arn:aws:ssm:...:parameter/relay-api*`.
2. If the runtime role only allows `/proxy-api/*`, `relay-api` will fail during startup before health checks pass.

## App Runner configuration templates

Use:
1. `infra/apprunner/service.template.json`
2. `infra/apprunner/update-service.template.json`
3. `infra/apprunner/relay.service.template.json`
4. `infra/apprunner/relay.update-service.template.json`
5. `infra/scripts/ensure-apprunner-vpc-egress.sh`

Important runtime notes:
1. Do not set `PORT` in App Runner env maps.
2. App Runner provides `PORT`; both services listen on `process.env.PORT`.
3. Health check is HTTP `GET /health`.
4. `proxy-api` uses the image default command (`node dist/app.js`).
5. `relay-api` sets `StartCommand` to `node dist/relay-app.js`.

## Networking model

App Runner runtime should:
1. Use VPC egress through the configured App Runner connector.
2. Reach OpenAI over outbound internet egress.
3. Reach RDS over the approved DB security group and port.
4. Reach KMS through AWS-managed networking or a VPC endpoint, depending on your environment design.
5. Keep image pulls and runtime secret retrieval on the App Runner-managed path, not through the VPC connector.

MVP trade-off:
1. A single NAT keeps cost and setup low, but it is a single-AZ failure domain for outbound internet egress.

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
1. `linux/amd64` is required because App Runner rejected prior ARM images.
2. Immutable tags are required so each deploy points at one exact artifact.
3. Do not deploy `latest`.

### 2) Create service (first deploy)

Proxy:
```bash
cp infra/apprunner/service.template.json infra/apprunner/service.current.json
# Fill placeholders in infra/apprunner/service.current.json
aws apprunner create-service --cli-input-json file://infra/apprunner/service.current.json
```

Relay:
```bash
cp infra/apprunner/relay.service.template.json infra/apprunner/relay.service.current.json
# Fill placeholders in infra/apprunner/relay.service.current.json
aws apprunner create-service --cli-input-json file://infra/apprunner/relay.service.current.json
```

### 3) Update service (later deploys)

Proxy:
```bash
cp infra/apprunner/update-service.template.json infra/apprunner/update-service.current.json
# Fill placeholders in infra/apprunner/update-service.current.json
aws apprunner update-service --cli-input-json file://infra/apprunner/update-service.current.json
```

Relay:
```bash
cp infra/apprunner/relay.update-service.template.json infra/apprunner/relay.update-service.current.json
# Fill placeholders in infra/apprunner/relay.update-service.current.json
aws apprunner update-service --cli-input-json file://infra/apprunner/relay.update-service.current.json
```

## Startup and health behavior
1. `proxy-api` production command is `npm start` (`node dist/app.js`).
2. `relay-api` production command is `npm run start:relay` (`node dist/relay-app.js` via `StartCommand`).
3. Both services bind `0.0.0.0` and `process.env.PORT`.
4. Both run DB migrations before listening.
5. If DB connectivity or migrations fail, startup fails and deployment should be treated as failed.

## Post-deploy verification

### `proxy-api`
1. `GET /health` returns `200` and `{"ok":true}`.
2. Admin login works.
3. `scripts/smoke-proxy.sh` passes with a valid tool token.
4. `RELAY_PUBLIC_BASE_URL` points at the current `relay-api` URL.

### `relay-api`
1. `GET /health` returns `200` and `{"ok":true}`.
2. `POST /v1/auth/login` returns a session token for an allowed email + password.
3. `POST /v1/tools/:toolSlug/responses` succeeds with a valid relay session and active tool.
4. `CORS_ALLOWED_ORIGINS="*"` allows any origin until you are ready to replace it with a comma-separated allowlist.

## Observability and rollback

Observability:
1. First view: App Runner Logs tab.
2. CloudWatch log groups are under `/aws/apprunner/...`.

Rollback:
1. Keep the last-known-good immutable image tag.
2. Update the affected App Runner service back to that tag.
3. Re-run service-specific smoke checks.

## Notes
1. `RELAY_PUBLIC_BASE_URL` is not secret; set it on `proxy-api` so admin responses can derive tool relay URLs.
2. `relay-api` does not store tool bearer tokens. It resolves tools by slug against the shared database.
3. Production relay root is currently `https://5z97x9cmtm.eu-west-2.awsapprunner.com`.
4. Production relay CORS is currently temporary wildcard `*`.
5. Historical migration notes remain under `docs/archive/`.
