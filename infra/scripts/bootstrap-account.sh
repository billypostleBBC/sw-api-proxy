#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-west-2}"
PROJECT_NAME="${PROJECT_NAME:-proxy-api}"
RELAY_SERVICE_NAME="${RELAY_SERVICE_NAME:-relay-api}"
DB_INSTANCE_IDENTIFIER="${DB_INSTANCE_IDENTIFIER:-proxy-api-db}"
DB_NAME="${DB_NAME:-proxy_api}"
DB_USERNAME="${DB_USERNAME:-proxy_api_app}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t3.micro}"
DB_ALLOCATED_STORAGE="${DB_ALLOCATED_STORAGE:-20}"
DB_ENGINE_VERSION="${DB_ENGINE_VERSION:-}"
DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME:-proxy-api-db-subnets}"
APP_RUNNER_CONNECTOR_NAME="${APP_RUNNER_CONNECTOR_NAME:-proxy-api-vpc-connector-private}"
APP_RUNNER_CONNECTOR_SG_NAME="${APP_RUNNER_CONNECTOR_SG_NAME:-proxy-api-apprunner-egress-sg}"
DB_SECURITY_GROUP_NAME="${DB_SECURITY_GROUP_NAME:-proxy-api-db-sg}"
PRIVATE_ROUTE_TABLE_NAME="${PRIVATE_ROUTE_TABLE_NAME:-proxy-api-apprunner-private-rt}"
NAT_EIP_NAME="${NAT_EIP_NAME:-proxy-api-apprunner-nat-eip}"
NAT_GATEWAY_NAME="${NAT_GATEWAY_NAME:-proxy-api-apprunner-nat}"
KMS_ALIAS_NAME="${KMS_ALIAS_NAME:-alias/proxy-api}"
ECR_REPO="${ECR_REPO:-proxy-api}"
DEPLOY_SERVICES="${DEPLOY_SERVICES:-0}"
BUILD_AND_PUSH_IMAGE="${BUILD_AND_PUSH_IMAGE:-0}"
IMAGE_TAG="${IMAGE_TAG:-}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"
RELAY_EMAIL_DOMAIN_ALLOWLIST="${RELAY_EMAIL_DOMAIN_ALLOWLIST:-bbc.com}"
RELAY_SESSION_TTL_HOURS="${RELAY_SESSION_TTL_HOURS:-24}"
SESSION_TTL_HOURS="${SESSION_TTL_HOURS:-10}"
RATE_LIMIT_DEFAULT_RPM="${RATE_LIMIT_DEFAULT_RPM:-60}"
TOKEN_CAP_DEFAULT_DAILY="${TOKEN_CAP_DEFAULT_DAILY:-2000000}"
TOOL_TOKEN_TTL_DAYS="${TOOL_TOKEN_TTL_DAYS:-90}"
PROXY_CORS_ALLOWED_ORIGINS="${PROXY_CORS_ALLOWED_ORIGINS:-}"
RELAY_CORS_ALLOWED_ORIGINS="${RELAY_CORS_ALLOWED_ORIGINS:-*}"
ADMIN_EMAIL_ALLOWLIST="${ADMIN_EMAIL_ALLOWLIST:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}"
RELAY_PASSWORD="${RELAY_PASSWORD:-}"
RELAY_PASSWORD_HASH="${RELAY_PASSWORD_HASH:-}"
DATABASE_PASSWORD="${DATABASE_PASSWORD:-}"
VPC_ID="${VPC_ID:-}"
NAT_PUBLIC_SUBNET_ID="${NAT_PUBLIC_SUBNET_ID:-}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

aws_cli() {
  aws --region "$AWS_REGION" "$@"
}

require_value() {
  local name="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required value: $name" >&2
    exit 1
  fi
}

text_or_empty() {
  local value="$1"
  if [[ "$value" == "None" || "$value" == "null" ]]; then
    echo ""
  else
    echo "$value"
  fi
}

hash_sha256() {
  local input="$1"
  printf '%s' "$input" | shasum -a 256 | awk '{print $1}'
}

random_password() {
  openssl rand -base64 30 | tr -d '\n' | tr '/+' 'AB' | cut -c1-32
}

account_id() {
  aws_cli sts get-caller-identity --query 'Account' --output text
}

default_vpc_id() {
  aws_cli ec2 describe-vpcs \
    --filters "Name=isDefault,Values=true" \
    --query 'Vpcs[0].VpcId' \
    --output text
}

ensure_default_vpc() {
  local existing_vpc_id
  existing_vpc_id="$(text_or_empty "$(default_vpc_id)")"
  if [[ -n "$existing_vpc_id" ]]; then
    echo "$existing_vpc_id"
    return
  fi

  aws_cli ec2 create-default-vpc --query 'Vpc.VpcId' --output text
}

default_public_subnet_id() {
  local vpc_id="$1"
  local az="$2"

  aws_cli ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=default-for-az,Values=true" "Name=availability-zone,Values=$az" \
    --query 'Subnets[0].SubnetId' \
    --output text
}

ensure_default_public_subnet() {
  local vpc_id="$1"
  local az="$2"
  local subnet_id

  subnet_id="$(text_or_empty "$(default_public_subnet_id "$vpc_id" "$az")")"
  if [[ -n "$subnet_id" ]]; then
    echo "$subnet_id"
    return
  fi

  aws_cli ec2 create-default-subnet \
    --availability-zone "$az" \
    --query 'Subnet.SubnetId' \
    --output text
}

subnet_id_by_name() {
  local vpc_id="$1"
  local name="$2"

  aws_cli ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$name" \
    --query 'Subnets[0].SubnetId' \
    --output text
}

list_azs() {
  aws_cli ec2 describe-availability-zones \
    --filters "Name=region-name,Values=$AWS_REGION" "Name=state,Values=available" \
    --query 'AvailabilityZones[].ZoneName' \
    --output text
}

pick_private_cidrs() {
  local vpc_id="$1"
  local existing
  local cidrs=()
  local suffix

  existing="$(
    aws_cli ec2 describe-subnets \
      --filters "Name=vpc-id,Values=$vpc_id" \
      --query 'Subnets[].CidrBlock' \
      --output text
  )"

  for suffix in $(seq 240 253); do
    local cidr="172.31.${suffix}.0/24"
    if [[ " $existing " != *" $cidr "* ]]; then
      cidrs+=("$cidr")
    fi
    if [[ "${#cidrs[@]}" -eq 3 ]]; then
      printf '%s\n' "${cidrs[@]}"
      return
    fi
  done

  echo "Could not find three free /24 subnets in 172.31.0.0/16. Set VPC_ID to a clean VPC or extend this script." >&2
  exit 1
}

create_subnet() {
  local vpc_id="$1"
  local az="$2"
  local cidr="$3"
  local name="$4"

  aws_cli ec2 create-subnet \
    --vpc-id "$vpc_id" \
    --cidr-block "$cidr" \
    --availability-zone "$az" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$name},{Key=Project,Value=$PROJECT_NAME},{Key=ManagedBy,Value=codex}]" \
    --query 'Subnet.SubnetId' \
    --output text
}

ensure_private_subnet() {
  local vpc_id="$1"
  local az="$2"
  local cidr="$3"
  local name="$4"
  local subnet_id

  subnet_id="$(text_or_empty "$(subnet_id_by_name "$vpc_id" "$name")")"
  if [[ -n "$subnet_id" ]]; then
    echo "$subnet_id"
    return
  fi

  create_subnet "$vpc_id" "$az" "$cidr" "$name"
}

elastic_ip_allocation_id_by_name() {
  aws_cli ec2 describe-addresses \
    --filters "Name=tag:Name,Values=$NAT_EIP_NAME" \
    --query 'Addresses[0].AllocationId' \
    --output text
}

ensure_elastic_ip() {
  local allocation_id
  allocation_id="$(text_or_empty "$(elastic_ip_allocation_id_by_name)")"
  if [[ -n "$allocation_id" ]]; then
    echo "$allocation_id"
    return
  fi

  aws_cli ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAT_EIP_NAME},{Key=Project,Value=$PROJECT_NAME},{Key=ManagedBy,Value=codex}]" \
    --query 'AllocationId' \
    --output text
}

nat_gateway_id_by_name() {
  local vpc_id="$1"
  local rows

  rows="$(
    aws_cli ec2 describe-nat-gateways \
      --filter "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$NAT_GATEWAY_NAME" \
      --query 'NatGateways[*].[NatGatewayId,State]' \
      --output text
  )"

  awk '$2 == "available" { print $1; exit } $2 == "pending" { if (pending == "") pending = $1 } END { if (pending != "") print pending }' <<<"$rows"
}

ensure_nat_gateway() {
  local vpc_id="$1"
  local public_subnet_id="$2"
  local allocation_id="$3"
  local nat_gateway_id

  nat_gateway_id="$(text_or_empty "$(nat_gateway_id_by_name "$vpc_id")")"
  if [[ -n "$nat_gateway_id" ]]; then
    aws_cli ec2 wait nat-gateway-available --nat-gateway-ids "$nat_gateway_id"
    echo "$nat_gateway_id"
    return
  fi

  nat_gateway_id="$(
    aws_cli ec2 create-nat-gateway \
      --subnet-id "$public_subnet_id" \
      --allocation-id "$allocation_id" \
      --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$NAT_GATEWAY_NAME},{Key=Project,Value=$PROJECT_NAME},{Key=ManagedBy,Value=codex}]" \
      --query 'NatGateway.NatGatewayId' \
      --output text
  )"
  aws_cli ec2 wait nat-gateway-available --nat-gateway-ids "$nat_gateway_id"
  echo "$nat_gateway_id"
}

route_table_id_by_name() {
  local vpc_id="$1"

  aws_cli ec2 describe-route-tables \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=tag:Name,Values=$PRIVATE_ROUTE_TABLE_NAME" \
    --query 'RouteTables[0].RouteTableId' \
    --output text
}

ensure_private_route_table() {
  local vpc_id="$1"
  local nat_gateway_id="$2"
  local route_table_id
  local current_nat_gateway_id

  route_table_id="$(text_or_empty "$(route_table_id_by_name "$vpc_id")")"
  if [[ -z "$route_table_id" ]]; then
    route_table_id="$(
      aws_cli ec2 create-route-table \
        --vpc-id "$vpc_id" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PRIVATE_ROUTE_TABLE_NAME},{Key=Project,Value=$PROJECT_NAME},{Key=ManagedBy,Value=codex}]" \
        --query 'RouteTable.RouteTableId' \
        --output text
    )"
  fi

  current_nat_gateway_id="$(
    aws_cli ec2 describe-route-tables \
      --route-table-ids "$route_table_id" \
      --query 'RouteTables[0].Routes[*].[DestinationCidrBlock,NatGatewayId]' \
      --output text | awk '$1 == "0.0.0.0/0" && $2 != "None" { print $2; exit }'
  )"

  if [[ -z "$current_nat_gateway_id" ]]; then
    aws_cli ec2 create-route \
      --route-table-id "$route_table_id" \
      --destination-cidr-block 0.0.0.0/0 \
      --nat-gateway-id "$nat_gateway_id" >/dev/null
  elif [[ "$current_nat_gateway_id" != "$nat_gateway_id" ]]; then
    aws_cli ec2 replace-route \
      --route-table-id "$route_table_id" \
      --destination-cidr-block 0.0.0.0/0 \
      --nat-gateway-id "$nat_gateway_id" >/dev/null
  fi

  echo "$route_table_id"
}

associate_subnet_to_route_table() {
  local subnet_id="$1"
  local route_table_id="$2"
  local current_route_table_id
  local association_id

  current_route_table_id="$(text_or_empty "$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=association.subnet-id,Values=$subnet_id" \
      --query 'RouteTables[0].RouteTableId' \
      --output text
  )")"

  if [[ -z "$current_route_table_id" ]]; then
    aws_cli ec2 associate-route-table --subnet-id "$subnet_id" --route-table-id "$route_table_id" >/dev/null
    return
  fi

  if [[ "$current_route_table_id" == "$route_table_id" ]]; then
    return
  fi

  association_id="$(text_or_empty "$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=association.subnet-id,Values=$subnet_id" \
      --query "RouteTables[0].Associations[?SubnetId=='$subnet_id'][0].RouteTableAssociationId" \
      --output text
  )")"

  if [[ -z "$association_id" ]]; then
    aws_cli ec2 associate-route-table --subnet-id "$subnet_id" --route-table-id "$route_table_id" >/dev/null
  else
    aws_cli ec2 replace-route-table-association --association-id "$association_id" --route-table-id "$route_table_id" >/dev/null
  fi
}

security_group_id_by_name() {
  local vpc_id="$1"
  local name="$2"

  aws_cli ec2 describe-security-groups \
    --filters "Name=vpc-id,Values=$vpc_id" "Name=group-name,Values=$name" \
    --query 'SecurityGroups[0].GroupId' \
    --output text
}

ensure_security_group() {
  local vpc_id="$1"
  local name="$2"
  local description="$3"
  local group_id

  group_id="$(text_or_empty "$(security_group_id_by_name "$vpc_id" "$name")")"
  if [[ -n "$group_id" ]]; then
    echo "$group_id"
    return
  fi

  aws_cli ec2 create-security-group \
    --group-name "$name" \
    --description "$description" \
    --vpc-id "$vpc_id" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$name},{Key=Project,Value=$PROJECT_NAME},{Key=ManagedBy,Value=codex}]" \
    --query 'GroupId' \
    --output text
}

authorize_ingress_from_security_group() {
  local group_id="$1"
  local source_group_id="$2"
  local port="$3"
  local err

  if ! err="$(
    aws_cli ec2 authorize-security-group-ingress \
      --group-id "$group_id" \
      --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,UserIdGroupPairs=[{GroupId=$source_group_id,Description=Managed by codex}]" \
      2>&1 >/dev/null
  )"; then
    if [[ "$err" != *"InvalidPermission.Duplicate"* ]]; then
      echo "$err" >&2
      exit 1
    fi
  fi
}

db_subnet_group_exists() {
  local output
  if output="$(aws_cli rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" --query 'DBSubnetGroups[0].DBSubnetGroupName' --output text 2>/dev/null)"; then
    text_or_empty "$output"
  else
    echo ""
  fi
}

ensure_db_subnet_group() {
  local subnet_a_id="$1"
  local subnet_b_id="$2"
  local subnet_c_id="$3"

  if [[ -n "$(db_subnet_group_exists)" ]]; then
    echo "$DB_SUBNET_GROUP_NAME"
    return
  fi

  aws_cli rds create-db-subnet-group \
    --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
    --db-subnet-group-description "Private DB subnets for $PROJECT_NAME" \
    --subnet-ids "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" >/dev/null

  echo "$DB_SUBNET_GROUP_NAME"
}

db_instance_exists() {
  local output
  if output="$(aws_cli rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" --query 'DBInstances[0].DBInstanceIdentifier' --output text 2>/dev/null)"; then
    text_or_empty "$output"
  else
    echo ""
  fi
}

ensure_db_instance() {
  local db_subnet_group_name="$1"
  local db_security_group_id="$2"
  local database_password="$3"
  local create_args=()

  if [[ -n "$(db_instance_exists)" ]]; then
    aws_cli rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
    return
  fi

  create_args=(
    rds create-db-instance
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
    --db-instance-class "$DB_INSTANCE_CLASS"
    --engine postgres
    --allocated-storage "$DB_ALLOCATED_STORAGE"
    --storage-type gp3
    --master-username "$DB_USERNAME"
    --master-user-password "$database_password"
    --db-name "$DB_NAME"
    --db-subnet-group-name "$db_subnet_group_name"
    --vpc-security-group-ids "$db_security_group_id"
    --no-publicly-accessible
    --backup-retention-period 7
    --no-multi-az
    --deletion-protection
    --copy-tags-to-snapshot
    --tags "Key=Project,Value=$PROJECT_NAME" "Key=ManagedBy,Value=codex"
  )

  if [[ -n "$DB_ENGINE_VERSION" ]]; then
    create_args+=(--engine-version "$DB_ENGINE_VERSION")
  fi

  aws_cli "${create_args[@]}" >/dev/null

  aws_cli rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
}

db_endpoint() {
  aws_cli rds describe-db-instances \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text
}

ensure_vpc_connector() {
  local subnet_a_id="$1"
  local subnet_b_id="$2"
  local subnet_c_id="$3"
  local connector_sg_id="$4"
  local connector_arn

  connector_arn="$(text_or_empty "$(
    aws_cli apprunner list-vpc-connectors \
      --query "VpcConnectors[?VpcConnectorName=='$APP_RUNNER_CONNECTOR_NAME'].VpcConnectorArn | [0]" \
      --output text
  )")"

  if [[ -z "$connector_arn" ]]; then
    connector_arn="$(
      aws_cli apprunner create-vpc-connector \
        --vpc-connector-name "$APP_RUNNER_CONNECTOR_NAME" \
        --subnets "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" \
        --security-groups "$connector_sg_id" \
        --tags "Key=Project,Value=$PROJECT_NAME" "Key=ManagedBy,Value=codex" \
        --query 'VpcConnector.VpcConnectorArn' \
        --output text
    )"
  fi

  while true; do
    local status
    status="$(text_or_empty "$(
      aws_cli apprunner list-vpc-connectors \
        --query "VpcConnectors[?VpcConnectorName=='$APP_RUNNER_CONNECTOR_NAME'].Status | [0]" \
        --output text
    )")"
    if [[ "$status" == "ACTIVE" ]]; then
      echo "$connector_arn"
      return
    fi
    if [[ "$status" == "FAILED" || "$status" == "INACTIVE" ]]; then
      echo "App Runner VPC connector entered unexpected status: $status" >&2
      exit 1
    fi
    sleep 10
  done
}

role_exists() {
  local role_name="$1"
  local output
  if output="$(aws_cli iam get-role --role-name "$role_name" --query 'Role.Arn' --output text 2>/dev/null)"; then
    text_or_empty "$output"
  else
    echo ""
  fi
}

ensure_ecr_access_role() {
  local role_name="${PROJECT_NAME}-apprunner-ecr-access-role"
  local role_arn

  role_arn="$(role_exists "$role_name")"
  if [[ -z "$role_arn" ]]; then
    role_arn="$(
      aws_cli iam create-role \
        --role-name "$role_name" \
        --assume-role-policy-document '{
          "Version":"2012-10-17",
          "Statement":[
            {
              "Effect":"Allow",
              "Principal":{"Service":"build.apprunner.amazonaws.com"},
              "Action":"sts:AssumeRole"
            }
          ]
        }' \
        --query 'Role.Arn' \
        --output text
    )"
  fi

  aws_cli iam attach-role-policy \
    --role-name "$role_name" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null

  echo "$role_arn"
}

ensure_instance_role() {
  local account_id="$1"
  local kms_key_arn="$2"
  local role_name="${PROJECT_NAME}-apprunner-instance-role"
  local role_arn

  role_arn="$(role_exists "$role_name")"
  if [[ -z "$role_arn" ]]; then
    role_arn="$(
      aws_cli iam create-role \
        --role-name "$role_name" \
        --assume-role-policy-document '{
          "Version":"2012-10-17",
          "Statement":[
            {
              "Effect":"Allow",
              "Principal":{"Service":"tasks.apprunner.amazonaws.com"},
              "Action":"sts:AssumeRole"
            }
          ]
        }' \
        --query 'Role.Arn' \
        --output text
    )"
  fi

  aws_cli iam put-role-policy \
    --role-name "$role_name" \
    --policy-name "${PROJECT_NAME}-runtime-policy" \
    --policy-document "{
      \"Version\":\"2012-10-17\",
      \"Statement\":[
        {
          \"Effect\":\"Allow\",
          \"Action\":[\"ssm:GetParameter\",\"ssm:GetParameters\"],
          \"Resource\":[
            \"arn:aws:ssm:${AWS_REGION}:${account_id}:parameter/proxy-api/*\",
            \"arn:aws:ssm:${AWS_REGION}:${account_id}:parameter/relay-api/*\"
          ]
        },
        {
          \"Effect\":\"Allow\",
          \"Action\":[\"kms:Encrypt\",\"kms:Decrypt\",\"kms:DescribeKey\"],
          \"Resource\":\"${kms_key_arn}\"
        }
      ]
    }" >/dev/null

  echo "$role_arn"
}

ensure_kms_key() {
  local alias_name="$1"
  local alias_target
  alias_target="$(text_or_empty "$(
    aws_cli kms list-aliases \
      --query "Aliases[?AliasName=='$alias_name'].TargetKeyId | [0]" \
      --output text
  )")"

  if [[ -n "$alias_target" ]]; then
    aws_cli kms describe-key --key-id "$alias_name" --query 'KeyMetadata.Arn' --output text
    return
  fi

  local key_id
  key_id="$(
    aws_cli kms create-key \
      --description "KMS key for $PROJECT_NAME project key encryption" \
      --query 'KeyMetadata.KeyId' \
      --output text
  )"
  aws_cli kms create-alias --alias-name "$alias_name" --target-key-id "$key_id"
  aws_cli kms describe-key --key-id "$alias_name" --query 'KeyMetadata.Arn' --output text
}

ensure_ecr_repo() {
  local repo_uri
  repo_uri="$(text_or_empty "$(
    aws_cli ecr describe-repositories \
      --repository-names "$ECR_REPO" \
      --query 'repositories[0].repositoryUri' \
      --output text 2>/dev/null || true
  )")"
  if [[ -n "$repo_uri" ]]; then
    echo "$repo_uri"
    return
  fi

  aws_cli ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability IMMUTABLE \
    --query 'repository.repositoryUri' \
    --output text
}

put_ssm_parameter() {
  local name="$1"
  local value="$2"
  local type="${3:-SecureString}"

  aws_cli ssm put-parameter \
    --name "$name" \
    --type "$type" \
    --value "$value" \
    --overwrite >/dev/null
}

ssm_parameter_value() {
  local name="$1"
  local output

  if output="$(aws_cli ssm get-parameter --name "$name" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)"; then
    text_or_empty "$output"
  else
    echo ""
  fi
}

service_arn_by_name() {
  local service_name="$1"
  text_or_empty "$(
    aws_cli apprunner list-services \
      --query "ServiceSummaryList[?ServiceName=='$service_name'].ServiceArn | [0]" \
      --output text
  )"
}

service_url_by_arn() {
  local service_arn="$1"
  text_or_empty "$(
    aws_cli apprunner describe-service \
      --service-arn "$service_arn" \
      --query 'Service.ServiceUrl' \
      --output text
  )"
}

wait_for_service_running() {
  local service_arn="$1"

  while true; do
    local status
    status="$(text_or_empty "$(
      aws_cli apprunner describe-service \
        --service-arn "$service_arn" \
        --query 'Service.Status' \
        --output text
    )")"

    if [[ "$status" == "RUNNING" ]]; then
      return
    fi
    if [[ "$status" == "CREATE_FAILED" || "$status" == "DELETE_FAILED" || "$status" == "OPERATION_FAILED" ]]; then
      echo "App Runner service entered unexpected status: $status" >&2
      exit 1
    fi
    sleep 10
  done
}

build_and_push_image() {
  local account_id="$1"

  if [[ -z "$IMAGE_TAG" ]]; then
    IMAGE_TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)-amd64"
  fi

  aws_cli ecr get-login-password | docker login --username AWS --password-stdin "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  docker build --platform linux/amd64 -f infra/Dockerfile -t "${ECR_REPO}:${IMAGE_TAG}" .
  docker tag "${ECR_REPO}:${IMAGE_TAG}" "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
  docker push "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
}

write_proxy_service_json() {
  local file_path="$1"
  local account_id="$2"
  local access_role_arn="$3"
  local instance_role_arn="$4"
  local connector_arn="$5"
  local relay_public_base_url="$6"

  cat >"$file_path" <<EOF
{
  "ServiceName": "${PROJECT_NAME}",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "AWS_REGION": "${AWS_REGION}",
          "RELAY_PUBLIC_BASE_URL": "${relay_public_base_url}"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "/proxy-api/DATABASE_URL",
          "KMS_KEY_ID": "/proxy-api/KMS_KEY_ID",
          "ADMIN_PASSWORD_HASH": "/proxy-api/ADMIN_PASSWORD_HASH",
          "ADMIN_EMAIL_ALLOWLIST": "/proxy-api/ADMIN_EMAIL_ALLOWLIST",
          "CORS_ALLOWED_ORIGINS": "/proxy-api/CORS_ALLOWED_ORIGINS"
        }
      }
    },
    "AutoDeploymentsEnabled": false,
    "AuthenticationConfiguration": {
      "AccessRoleArn": "${access_role_arn}"
    }
  },
  "InstanceConfiguration": {
    "Cpu": "256",
    "Memory": "512",
    "InstanceRoleArn": "${instance_role_arn}"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  },
  "NetworkConfiguration": {
    "IngressConfiguration": {
      "IsPubliclyAccessible": true
    },
    "EgressConfiguration": {
      "EgressType": "VPC",
      "VpcConnectorArn": "${connector_arn}"
    },
    "IpAddressType": "IPV4"
  }
}
EOF
}

write_relay_service_json() {
  local file_path="$1"
  local account_id="$2"
  local access_role_arn="$3"
  local instance_role_arn="$4"
  local connector_arn="$5"

  cat >"$file_path" <<EOF
{
  "ServiceName": "${RELAY_SERVICE_NAME}",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "StartCommand": "node dist/relay-app.js",
        "RuntimeEnvironmentVariables": {
          "AWS_REGION": "${AWS_REGION}",
          "RELAY_EMAIL_DOMAIN_ALLOWLIST": "${RELAY_EMAIL_DOMAIN_ALLOWLIST}",
          "RELAY_SESSION_TTL_HOURS": "${RELAY_SESSION_TTL_HOURS}"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "/proxy-api/DATABASE_URL",
          "KMS_KEY_ID": "/proxy-api/KMS_KEY_ID",
          "RELAY_PASSWORD_HASH": "/relay-api/RELAY_PASSWORD_HASH",
          "CORS_ALLOWED_ORIGINS": "/relay-api/CORS_ALLOWED_ORIGINS"
        }
      }
    },
    "AutoDeploymentsEnabled": false,
    "AuthenticationConfiguration": {
      "AccessRoleArn": "${access_role_arn}"
    }
  },
  "InstanceConfiguration": {
    "Cpu": "256",
    "Memory": "512",
    "InstanceRoleArn": "${instance_role_arn}"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  },
  "NetworkConfiguration": {
    "IngressConfiguration": {
      "IsPubliclyAccessible": true
    },
    "EgressConfiguration": {
      "EgressType": "VPC",
      "VpcConnectorArn": "${connector_arn}"
    },
    "IpAddressType": "IPV4"
  }
}
EOF
}

create_or_update_service() {
  local service_name="$1"
  local file_path="$2"
  local existing_service_arn

  existing_service_arn="$(service_arn_by_name "$service_name")"
  if [[ -z "$existing_service_arn" ]]; then
    aws_cli apprunner create-service --cli-input-json "file://${file_path}" --query 'Service.ServiceArn' --output text
    return
  fi

  local update_file
  update_file="$(mktemp)"
  awk -v service_arn="$existing_service_arn" 'NR==1 { print "{\n  \"ServiceArn\": \"" service_arn "\","; next } { print }' "$file_path" >"$update_file"
  aws_cli apprunner update-service --cli-input-json "file://${update_file}" --query 'Service.ServiceArn' --output text
  rm -f "$update_file"
}

require_deploy_inputs() {
  if [[ "$DEPLOY_SERVICES" != "1" ]]; then
    return
  fi

  require_value "IMAGE_TAG when DEPLOY_SERVICES=1 and BUILD_AND_PUSH_IMAGE=0" "${IMAGE_TAG:-}"
  require_value "ADMIN_EMAIL_ALLOWLIST when DEPLOY_SERVICES=1" "$ADMIN_EMAIL_ALLOWLIST"

  if [[ -z "$ADMIN_PASSWORD" && -z "$ADMIN_PASSWORD_HASH" ]]; then
    echo "Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH before deploying services" >&2
    exit 1
  fi

  if [[ -z "$RELAY_PASSWORD" && -z "$RELAY_PASSWORD_HASH" ]]; then
    echo "Set RELAY_PASSWORD or RELAY_PASSWORD_HASH before deploying services" >&2
    exit 1
  fi
}

main() {
  local account
  local azs
  local az_a
  local az_b
  local az_c
  local private_cidrs_raw
  local cidr_a
  local cidr_b
  local cidr_c
  local subnet_a_id
  local subnet_b_id
  local subnet_c_id
  local allocation_id
  local nat_gateway_id
  local route_table_id
  local connector_sg_id
  local db_security_group_id
  local db_subnet_group_name
  local database_password
  local database_host
  local database_url
  local database_url_base
  local existing_database_url
  local kms_key_arn
  local access_role_arn
  local instance_role_arn
  local connector_arn
  local ecr_repo_uri
  local relay_service_json
  local proxy_service_json
  local relay_service_arn
  local proxy_service_arn
  local relay_service_url

  require_deploy_inputs

  account="$(account_id)"
  echo "Using account ${account} in ${AWS_REGION}"

  if [[ -z "$VPC_ID" ]]; then
    VPC_ID="$(ensure_default_vpc)"
  fi
  require_value "VPC_ID" "$VPC_ID"

  azs=($(list_azs))
  if [[ "${#azs[@]}" -lt 3 ]]; then
    echo "Need at least three AZs in ${AWS_REGION}" >&2
    exit 1
  fi
  az_a="${azs[0]}"
  az_b="${azs[1]}"
  az_c="${azs[2]}"

  if [[ -z "$NAT_PUBLIC_SUBNET_ID" ]]; then
    NAT_PUBLIC_SUBNET_ID="$(ensure_default_public_subnet "$VPC_ID" "$az_a")"
  fi
  require_value "NAT_PUBLIC_SUBNET_ID" "$NAT_PUBLIC_SUBNET_ID"

  private_cidrs_raw="$(pick_private_cidrs "$VPC_ID")"
  cidr_a="$(printf '%s\n' "$private_cidrs_raw" | sed -n '1p')"
  cidr_b="$(printf '%s\n' "$private_cidrs_raw" | sed -n '2p')"
  cidr_c="$(printf '%s\n' "$private_cidrs_raw" | sed -n '3p')"

  subnet_a_id="$(ensure_private_subnet "$VPC_ID" "$az_a" "$cidr_a" "${PROJECT_NAME}-apprunner-private-${az_a}")"
  subnet_b_id="$(ensure_private_subnet "$VPC_ID" "$az_b" "$cidr_b" "${PROJECT_NAME}-apprunner-private-${az_b}")"
  subnet_c_id="$(ensure_private_subnet "$VPC_ID" "$az_c" "$cidr_c" "${PROJECT_NAME}-apprunner-private-${az_c}")"

  allocation_id="$(ensure_elastic_ip)"
  nat_gateway_id="$(ensure_nat_gateway "$VPC_ID" "$NAT_PUBLIC_SUBNET_ID" "$allocation_id")"
  route_table_id="$(ensure_private_route_table "$VPC_ID" "$nat_gateway_id")"
  associate_subnet_to_route_table "$subnet_a_id" "$route_table_id"
  associate_subnet_to_route_table "$subnet_b_id" "$route_table_id"
  associate_subnet_to_route_table "$subnet_c_id" "$route_table_id"

  connector_sg_id="$(ensure_security_group "$VPC_ID" "$APP_RUNNER_CONNECTOR_SG_NAME" "App Runner VPC connector egress for ${PROJECT_NAME}")"
  db_security_group_id="$(ensure_security_group "$VPC_ID" "$DB_SECURITY_GROUP_NAME" "RDS ingress for ${PROJECT_NAME}")"
  authorize_ingress_from_security_group "$db_security_group_id" "$connector_sg_id" 5432

  db_subnet_group_name="$(ensure_db_subnet_group "$subnet_a_id" "$subnet_b_id" "$subnet_c_id")"
  existing_database_url="$(ssm_parameter_value "/proxy-api/DATABASE_URL")"
  if [[ -n "$(db_instance_exists)" ]]; then
    if [[ -n "$existing_database_url" ]]; then
      database_url="$existing_database_url"
    else
      require_value "DATABASE_PASSWORD when the DB already exists and /proxy-api/DATABASE_URL is missing" "$DATABASE_PASSWORD"
      database_host="$(db_endpoint)"
      database_url_base="postgres://${DB_USERNAME}:${DATABASE_PASSWORD}@${database_host}:5432/${DB_NAME}"
      database_url="${database_url_base}?sslmode=no-verify"
    fi
  else
    database_password="${DATABASE_PASSWORD:-$(random_password)}"
    database_url=""
  fi

  ensure_db_instance "$db_subnet_group_name" "$db_security_group_id" "$database_password"
  database_host="$(db_endpoint)"
  if [[ -z "$database_url" ]]; then
    database_url_base="postgres://${DB_USERNAME}:${database_password}@${database_host}:5432/${DB_NAME}"
    database_url="${database_url_base}?sslmode=no-verify"
  fi

  kms_key_arn="$(ensure_kms_key "$KMS_ALIAS_NAME")"
  access_role_arn="$(ensure_ecr_access_role)"
  instance_role_arn="$(ensure_instance_role "$account" "$kms_key_arn")"
  connector_arn="$(ensure_vpc_connector "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" "$connector_sg_id")"
  ecr_repo_uri="$(ensure_ecr_repo)"

  put_ssm_parameter "/proxy-api/DATABASE_URL" "$database_url"
  put_ssm_parameter "/proxy-api/KMS_KEY_ID" "$KMS_ALIAS_NAME" "String"

  if [[ -n "$OPENAI_BASE_URL" ]]; then
    put_ssm_parameter "/proxy-api/OPENAI_BASE_URL" "$OPENAI_BASE_URL"
  fi

  if [[ -n "$ADMIN_EMAIL_ALLOWLIST" ]]; then
    put_ssm_parameter "/proxy-api/ADMIN_EMAIL_ALLOWLIST" "$ADMIN_EMAIL_ALLOWLIST"
  fi
  if [[ -n "$PROXY_CORS_ALLOWED_ORIGINS" ]]; then
    put_ssm_parameter "/proxy-api/CORS_ALLOWED_ORIGINS" "$PROXY_CORS_ALLOWED_ORIGINS"
  fi
  if [[ -n "$RELAY_CORS_ALLOWED_ORIGINS" ]]; then
    put_ssm_parameter "/relay-api/CORS_ALLOWED_ORIGINS" "$RELAY_CORS_ALLOWED_ORIGINS"
  fi
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD_HASH="$(hash_sha256 "$ADMIN_PASSWORD")"
  fi
  if [[ -n "$ADMIN_PASSWORD_HASH" ]]; then
    put_ssm_parameter "/proxy-api/ADMIN_PASSWORD_HASH" "$ADMIN_PASSWORD_HASH"
  fi
  if [[ -n "$RELAY_PASSWORD" ]]; then
    RELAY_PASSWORD_HASH="$(hash_sha256 "$RELAY_PASSWORD")"
  fi
  if [[ -n "$RELAY_PASSWORD_HASH" ]]; then
    put_ssm_parameter "/relay-api/RELAY_PASSWORD_HASH" "$RELAY_PASSWORD_HASH"
  fi

  if [[ "$BUILD_AND_PUSH_IMAGE" == "1" ]]; then
    build_and_push_image "$account"
  fi

  if [[ "$DEPLOY_SERVICES" == "1" ]]; then
    relay_service_json="$(mktemp)"
    proxy_service_json="$(mktemp)"

    write_relay_service_json "$relay_service_json" "$account" "$access_role_arn" "$instance_role_arn" "$connector_arn"
    relay_service_arn="$(create_or_update_service "$RELAY_SERVICE_NAME" "$relay_service_json")"
    wait_for_service_running "$relay_service_arn"
    relay_service_url="https://$(service_url_by_arn "$relay_service_arn")"

    write_proxy_service_json "$proxy_service_json" "$account" "$access_role_arn" "$instance_role_arn" "$connector_arn" "$relay_service_url"
    proxy_service_arn="$(create_or_update_service "$PROJECT_NAME" "$proxy_service_json")"
    wait_for_service_running "$proxy_service_arn"

    rm -f "$relay_service_json" "$proxy_service_json"
  fi

  cat <<EOF
account_id=${account}
aws_region=${AWS_REGION}
vpc_id=${VPC_ID}
nat_public_subnet_id=${NAT_PUBLIC_SUBNET_ID}
private_subnet_a_id=${subnet_a_id}
private_subnet_b_id=${subnet_b_id}
private_subnet_c_id=${subnet_c_id}
nat_gateway_id=${nat_gateway_id}
private_route_table_id=${route_table_id}
apprunner_connector_sg_id=${connector_sg_id}
db_security_group_id=${db_security_group_id}
db_subnet_group_name=${db_subnet_group_name}
db_instance_identifier=${DB_INSTANCE_IDENTIFIER}
db_endpoint=${database_host}
kms_key_alias=${KMS_ALIAS_NAME}
kms_key_arn=${kms_key_arn}
ecr_repository_uri=${ecr_repo_uri}
apprunner_access_role_arn=${access_role_arn}
apprunner_instance_role_arn=${instance_role_arn}
apprunner_vpc_connector_arn=${connector_arn}
ssm_database_url=/proxy-api/DATABASE_URL
ssm_kms_key_id=/proxy-api/KMS_KEY_ID
ssm_admin_password_hash=/proxy-api/ADMIN_PASSWORD_HASH
ssm_admin_email_allowlist=/proxy-api/ADMIN_EMAIL_ALLOWLIST
ssm_proxy_cors_allowed_origins=/proxy-api/CORS_ALLOWED_ORIGINS
ssm_relay_password_hash=/relay-api/RELAY_PASSWORD_HASH
ssm_relay_cors_allowed_origins=/relay-api/CORS_ALLOWED_ORIGINS
deploy_services=${DEPLOY_SERVICES}
build_and_push_image=${BUILD_AND_PUSH_IMAGE}
image_tag=${IMAGE_TAG}
EOF
}

main "$@"
