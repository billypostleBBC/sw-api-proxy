#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Configure ACM TLS + ALB listeners + Route53 alias for an existing ALB.

Required:
  --alb-arn ARN               Existing ALB ARN.
  --target-group-arn ARN      Existing ALB target group ARN for app traffic.
  --domain-name NAME          Friendly domain to point at ALB (e.g. api.example.com).
  --hosted-zone-id ID         Route53 hosted zone ID that owns --domain-name.

Optional:
  --cert-domain NAME          ACM certificate domain. Defaults to --domain-name.
  --region REGION             AWS region. Defaults to AWS_REGION, then AWS_DEFAULT_REGION.

Example:
  ./infra/configure-alb-https-route53.sh \
    --alb-arn arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/proxy/abc123 \
    --target-group-arn arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/proxy-tg/def456 \
    --domain-name api.storyworks.example \
    --hosted-zone-id Z0123456789ABCDEF
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

trim_trailing_dot() {
  local value="$1"
  echo "${value%.}"
}

ALB_ARN=""
TARGET_GROUP_ARN=""
DOMAIN_NAME=""
ROUTE53_HOSTED_ZONE_ID=""
CERT_DOMAIN=""
AWS_REGION_INPUT="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
TLS_POLICY="ELBSecurityPolicy-TLS13-1-2-2021-06"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alb-arn)
      ALB_ARN="${2:-}"
      shift 2
      ;;
    --target-group-arn)
      TARGET_GROUP_ARN="${2:-}"
      shift 2
      ;;
    --domain-name)
      DOMAIN_NAME="${2:-}"
      shift 2
      ;;
    --hosted-zone-id)
      ROUTE53_HOSTED_ZONE_ID="${2:-}"
      shift 2
      ;;
    --cert-domain)
      CERT_DOMAIN="${2:-}"
      shift 2
      ;;
    --region)
      AWS_REGION_INPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ALB_ARN" || -z "$TARGET_GROUP_ARN" || -z "$DOMAIN_NAME" || -z "$ROUTE53_HOSTED_ZONE_ID" ]]; then
  echo "Missing required arguments."
  usage
  exit 1
fi

if [[ -z "$CERT_DOMAIN" ]]; then
  CERT_DOMAIN="$DOMAIN_NAME"
fi

if [[ -z "$AWS_REGION_INPUT" ]]; then
  echo "Region not set. Pass --region or set AWS_REGION/AWS_DEFAULT_REGION."
  exit 1
fi

require_cmd aws

echo "Using region: $AWS_REGION_INPUT"
echo "Ensuring ACM certificate exists for: $CERT_DOMAIN"

CERT_ARN="$(aws acm list-certificates \
  --region "$AWS_REGION_INPUT" \
  --certificate-statuses ISSUED \
  --query "CertificateSummaryList[?DomainName=='$CERT_DOMAIN'].CertificateArn | [0]" \
  --output text)"

if [[ "$CERT_ARN" == "None" || -z "$CERT_ARN" ]]; then
  CERT_ARN="$(aws acm list-certificates \
    --region "$AWS_REGION_INPUT" \
    --certificate-statuses PENDING_VALIDATION \
    --query "CertificateSummaryList[?DomainName=='$CERT_DOMAIN'].CertificateArn | [0]" \
    --output text)"
fi

if [[ "$CERT_ARN" == "None" || -z "$CERT_ARN" ]]; then
  IDEMPOTENCY_TOKEN="$(echo "$CERT_DOMAIN" | tr -cd '[:alnum:]' | head -c 32)"
  if [[ -z "$IDEMPOTENCY_TOKEN" ]]; then
    IDEMPOTENCY_TOKEN="proxycerttoken"
  fi
  CERT_ARN="$(aws acm request-certificate \
    --region "$AWS_REGION_INPUT" \
    --domain-name "$CERT_DOMAIN" \
    --validation-method DNS \
    --idempotency-token "$IDEMPOTENCY_TOKEN" \
    --query CertificateArn \
    --output text)"
  echo "Requested new ACM certificate: $CERT_ARN"
else
  echo "Found existing ACM certificate: $CERT_ARN"
fi

echo "Upserting ACM DNS validation records into Route53 zone: $ROUTE53_HOSTED_ZONE_ID"
RESOURCE_RECORDS=""
for attempt in $(seq 1 12); do
  RESOURCE_RECORDS="$(aws acm describe-certificate \
    --region "$AWS_REGION_INPUT" \
    --certificate-arn "$CERT_ARN" \
    --query "Certificate.DomainValidationOptions[?ResourceRecord!=null].ResourceRecord.[Name,Type,Value]" \
    --output text)"
  if [[ -n "$RESOURCE_RECORDS" ]]; then
    break
  fi
  sleep 5
done

if [[ -z "$RESOURCE_RECORDS" ]]; then
  echo "ACM validation records are not available yet. Re-run in ~1 minute."
  exit 1
fi

VALIDATION_BATCH_FILE="$(mktemp)"
{
  echo '{"Comment":"ACM DNS validation","Changes":['
  FIRST=true
  while IFS=$'\t' read -r rr_name rr_type rr_value; do
    if [[ -z "${rr_name:-}" || "$rr_name" == "None" ]]; then
      continue
    fi
    rr_name="$(trim_trailing_dot "$rr_name")"
    rr_value="$(trim_trailing_dot "$rr_value")"
    if [[ "$FIRST" == false ]]; then
      echo ','
    fi
    FIRST=false
    printf '{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"%s","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}' \
      "$rr_name" "$rr_type" "$rr_value"
  done <<< "$RESOURCE_RECORDS"
  echo ']}'
} > "$VALIDATION_BATCH_FILE"

if ! grep -q '"ResourceRecordSet"' "$VALIDATION_BATCH_FILE"; then
  rm -f "$VALIDATION_BATCH_FILE"
  echo "No valid ACM DNS records found to upsert."
  exit 1
fi

aws route53 change-resource-record-sets \
  --hosted-zone-id "$ROUTE53_HOSTED_ZONE_ID" \
  --change-batch "file://$VALIDATION_BATCH_FILE" >/dev/null
rm -f "$VALIDATION_BATCH_FILE"

echo "Waiting for ACM certificate validation (can take several minutes)..."
aws acm wait certificate-validated \
  --region "$AWS_REGION_INPUT" \
  --certificate-arn "$CERT_ARN"
echo "Certificate is validated."

echo "Configuring ALB HTTPS listener (443) -> target group"
LISTENER_443_ARN="$(aws elbv2 describe-listeners \
  --region "$AWS_REGION_INPUT" \
  --load-balancer-arn "$ALB_ARN" \
  --query "Listeners[?Port==\`443\`].ListenerArn | [0]" \
  --output text)"

if [[ "$LISTENER_443_ARN" == "None" || -z "$LISTENER_443_ARN" ]]; then
  aws elbv2 create-listener \
    --region "$AWS_REGION_INPUT" \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTPS \
    --port 443 \
    --ssl-policy "$TLS_POLICY" \
    --certificates "CertificateArn=$CERT_ARN" \
    --default-actions "Type=forward,TargetGroupArn=$TARGET_GROUP_ARN" >/dev/null
  echo "Created HTTPS listener on 443."
else
  aws elbv2 modify-listener \
    --region "$AWS_REGION_INPUT" \
    --listener-arn "$LISTENER_443_ARN" \
    --protocol HTTPS \
    --port 443 \
    --ssl-policy "$TLS_POLICY" \
    --certificates "CertificateArn=$CERT_ARN" \
    --default-actions "Type=forward,TargetGroupArn=$TARGET_GROUP_ARN" >/dev/null
  echo "Updated existing HTTPS listener on 443."
fi

echo "Configuring ALB HTTP listener (80) -> redirect 443"
LISTENER_80_ARN="$(aws elbv2 describe-listeners \
  --region "$AWS_REGION_INPUT" \
  --load-balancer-arn "$ALB_ARN" \
  --query "Listeners[?Port==\`80\`].ListenerArn | [0]" \
  --output text)"

REDIRECT_ACTION='Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'

if [[ "$LISTENER_80_ARN" == "None" || -z "$LISTENER_80_ARN" ]]; then
  aws elbv2 create-listener \
    --region "$AWS_REGION_INPUT" \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions "$REDIRECT_ACTION" >/dev/null
  echo "Created HTTP listener on 80 with HTTPS redirect."
else
  aws elbv2 modify-listener \
    --region "$AWS_REGION_INPUT" \
    --listener-arn "$LISTENER_80_ARN" \
    --protocol HTTP \
    --port 80 \
    --default-actions "$REDIRECT_ACTION" >/dev/null
  echo "Updated existing HTTP listener on 80 with HTTPS redirect."
fi

echo "Upserting Route53 alias record: $DOMAIN_NAME -> ALB"
ALB_DNS_NAME="$(aws elbv2 describe-load-balancers \
  --region "$AWS_REGION_INPUT" \
  --load-balancer-arns "$ALB_ARN" \
  --query "LoadBalancers[0].DNSName" \
  --output text)"
ALB_ZONE_ID="$(aws elbv2 describe-load-balancers \
  --region "$AWS_REGION_INPUT" \
  --load-balancer-arns "$ALB_ARN" \
  --query "LoadBalancers[0].CanonicalHostedZoneId" \
  --output text)"

ALIAS_BATCH_FILE="$(mktemp)"
cat > "$ALIAS_BATCH_FILE" <<EOF
{
  "Comment": "Alias friendly domain to ALB",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$DOMAIN_NAME",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "$ALB_ZONE_ID",
          "DNSName": "dualstack.$ALB_DNS_NAME",
          "EvaluateTargetHealth": false
        }
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$DOMAIN_NAME",
        "Type": "AAAA",
        "AliasTarget": {
          "HostedZoneId": "$ALB_ZONE_ID",
          "DNSName": "dualstack.$ALB_DNS_NAME",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
EOF

aws route53 change-resource-record-sets \
  --hosted-zone-id "$ROUTE53_HOSTED_ZONE_ID" \
  --change-batch "file://$ALIAS_BATCH_FILE" >/dev/null
rm -f "$ALIAS_BATCH_FILE"

echo "Done."
echo "Certificate ARN: $CERT_ARN"
echo "Friendly domain: $DOMAIN_NAME"
echo "ALB DNS target: dualstack.$ALB_DNS_NAME"
