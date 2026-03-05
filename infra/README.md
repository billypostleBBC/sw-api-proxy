# AWS Deployment Notes (MVP)

## Required AWS resources
- VPC with private subnets for ECS and RDS.
- RDS PostgreSQL with encryption + backups enabled.
- KMS key for API key encryption/decryption.
- ECS Fargate service behind ALB + ACM TLS cert.
- SSM Parameter Store entries for runtime secrets.
- CloudWatch log group `/ecs/proxy-api`.

## Minimal rollout flow
1. Build and push image to ECR.
2. Register task definition from `infra/ecs-task-definition.json`.
3. Create ECS service with desired count `2`.
4. Configure ALB TLS + listeners + DNS:
   - `chmod +x infra/configure-alb-https-route53.sh`
   - `./infra/configure-alb-https-route53.sh --alb-arn <alb-arn> --target-group-arn <target-group-arn> --domain-name <friendly-domain> --hosted-zone-id <route53-zone-id> --region <aws-region>`
5. Attach service to ALB target group if not already attached.
6. Set security groups:
   - ALB inbound 443 from corp network.
   - ECS inbound from ALB only.
   - ECS outbound to RDS/KMS/SSM.
7. Run smoke test against `/health` and admin auth endpoints.

## IAM task role permissions
- `kms:Decrypt`, `kms:Encrypt` on KMS key.
- `ssm:GetParameter`, `ssm:GetParameters` on app parameters.

## Script notes: `configure-alb-https-route53.sh`
- Scope:
  - Requests/reuses ACM certificate for `--domain-name` (or `--cert-domain`).
  - Creates/updates ALB HTTPS listener on `443` forwarding to `--target-group-arn`.
  - Creates/updates ALB HTTP listener on `80` redirecting to `443` (`HTTP_301`).
  - Upserts Route53 alias `A` + `AAAA` records to the ALB.
- Required caller permissions:
  - `acm:ListCertificates`, `acm:RequestCertificate`, `acm:DescribeCertificate`
  - `route53:ChangeResourceRecordSets`
  - `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeListeners`
  - `elasticloadbalancing:CreateListener`, `elasticloadbalancing:ModifyListener`
- The script waits for ACM DNS validation to complete. First run can take several minutes.
