# AWS Deployment Notes (MVP)

## Required AWS resources
- VPC with private subnets for ECS and RDS.
- RDS PostgreSQL with encryption + backups enabled.
- KMS key for API key encryption/decryption.
- SES identity/domain verification for sending magic links.
- ECS Fargate service behind ALB + ACM TLS cert.
- SSM Parameter Store entries for runtime secrets.
- CloudWatch log group `/ecs/proxy-api`.

## Minimal rollout flow
1. Build and push image to ECR.
2. Register task definition from `infra/ecs-task-definition.json`.
3. Create ECS service with desired count `2`.
4. Attach service to ALB target group (HTTPS listener).
5. Set security groups:
   - ALB inbound 443 from corp network.
   - ECS inbound from ALB only.
   - ECS outbound to RDS/KMS/SES/SSM.
6. Run smoke test against `/health` and admin auth endpoints.

## IAM task role permissions
- `kms:Decrypt`, `kms:Encrypt` on KMS key.
- `ses:SendEmail` on SES identity.
- `ssm:GetParameter`, `ssm:GetParameters` on app parameters.
