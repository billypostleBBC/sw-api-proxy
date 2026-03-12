#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-west-2}"
VPC_ID="${VPC_ID:-vpc-02283c1aa7bf8781a}"
SERVICE_ARN="${SERVICE_ARN:-arn:aws:apprunner:eu-west-2:445816555466:service/proxy-api/ba479a74eee44410845a5e1eedb2ff59}"
DB_INSTANCE_IDENTIFIER="${DB_INSTANCE_IDENTIFIER:-proxy-api-db}"
NAT_PUBLIC_SUBNET_ID="${NAT_PUBLIC_SUBNET_ID:-subnet-0ac8cc526388c2cb1}"

PRIVATE_SUBNET_A_NAME="proxy-api-apprunner-private-euw2a"
PRIVATE_SUBNET_B_NAME="proxy-api-apprunner-private-euw2b"
PRIVATE_SUBNET_C_NAME="proxy-api-apprunner-private-euw2c"
PRIVATE_SUBNET_A_CIDR="172.31.48.0/24"
PRIVATE_SUBNET_B_CIDR="172.31.49.0/24"
PRIVATE_SUBNET_C_CIDR="172.31.50.0/24"

PRIVATE_ROUTE_TABLE_NAME="proxy-api-apprunner-private-rt"
NAT_EIP_NAME="proxy-api-apprunner-nat-eip"
NAT_GATEWAY_NAME="proxy-api-apprunner-nat"
KMS_ENDPOINT_SG_NAME="proxy-api-kms-vpce-sg"
KMS_ENDPOINT_NAME="proxy-api-kms-vpce"
APP_RUNNER_CONNECTOR_SG_NAME="proxy-api-apprunner-egress-sg"
APP_RUNNER_CONNECTOR_NAME="proxy-api-vpc-connector-private"

aws_cli() {
  aws --region "$AWS_REGION" "$@"
}

text_or_empty() {
  local value="$1"
  if [[ "$value" == "None" || "$value" == "null" ]]; then
    echo ""
  else
    echo "$value"
  fi
}

subnet_id_by_name() {
  local name="$1"
  local subnet_id
  subnet_id="$(
    aws_cli ec2 describe-subnets \
      --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=$name" \
      --query 'Subnets[0].SubnetId' \
      --output text
  )"
  text_or_empty "$subnet_id"
}

create_private_subnet() {
  local name="$1"
  local cidr="$2"
  local az="$3"

  aws_cli ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block "$cidr" \
    --availability-zone "$az" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$name},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
    --query 'Subnet.SubnetId' \
    --output text
}

ensure_private_subnet() {
  local name="$1"
  local cidr="$2"
  local az="$3"
  local subnet_id

  subnet_id="$(subnet_id_by_name "$name")"
  if [[ -n "$subnet_id" ]]; then
    echo "$subnet_id"
    return
  fi

  create_private_subnet "$name" "$cidr" "$az"
}

elastic_ip_allocation_id_by_name() {
  local name="$1"
  local allocation_id
  allocation_id="$(
    aws_cli ec2 describe-addresses \
      --filters "Name=tag:Name,Values=$name" \
      --query 'Addresses[0].AllocationId' \
      --output text
  )"
  text_or_empty "$allocation_id"
}

ensure_elastic_ip() {
  local allocation_id

  allocation_id="$(elastic_ip_allocation_id_by_name "$NAT_EIP_NAME")"
  if [[ -n "$allocation_id" ]]; then
    echo "$allocation_id"
    return
  fi

  aws_cli ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAT_EIP_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
    --query 'AllocationId' \
    --output text
}

nat_gateway_id_by_name() {
  local name="$1"
  local nat_gateway_rows
  local nat_gateway_id

  nat_gateway_rows="$(
    aws_cli ec2 describe-nat-gateways \
      --filter "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=$name" \
      --query 'NatGateways[*].[NatGatewayId,State]' \
      --output text
  )"
  nat_gateway_id="$(awk '$2 == "available" { print $1; exit }' <<<"$nat_gateway_rows")"
  if [[ -n "$nat_gateway_id" ]]; then
    echo "$nat_gateway_id"
    return
  fi

  nat_gateway_id="$(awk '$2 == "pending" { print $1; exit }' <<<"$nat_gateway_rows")"
  text_or_empty "$nat_gateway_id"
}

ensure_nat_gateway() {
  local allocation_id="$1"
  local nat_gateway_id

  nat_gateway_id="$(nat_gateway_id_by_name "$NAT_GATEWAY_NAME")"
  if [[ -n "$nat_gateway_id" ]]; then
    aws_cli ec2 wait nat-gateway-available --nat-gateway-ids "$nat_gateway_id"
    echo "$nat_gateway_id"
    return
  fi

  nat_gateway_id="$(
    aws_cli ec2 create-nat-gateway \
      --subnet-id "$NAT_PUBLIC_SUBNET_ID" \
      --allocation-id "$allocation_id" \
      --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$NAT_GATEWAY_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
      --query 'NatGateway.NatGatewayId' \
      --output text
  )"
  aws_cli ec2 wait nat-gateway-available --nat-gateway-ids "$nat_gateway_id"
  echo "$nat_gateway_id"
}

route_table_id_by_name() {
  local name="$1"
  local route_table_id
  route_table_id="$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=$name" \
      --query 'RouteTables[0].RouteTableId' \
      --output text
  )"
  text_or_empty "$route_table_id"
}

ensure_private_route_table() {
  local nat_gateway_id="$1"
  local route_table_id
  local current_nat_gateway_id

  route_table_id="$(route_table_id_by_name "$PRIVATE_ROUTE_TABLE_NAME")"
  if [[ -z "$route_table_id" ]]; then
    route_table_id="$(
      aws_cli ec2 create-route-table \
        --vpc-id "$VPC_ID" \
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PRIVATE_ROUTE_TABLE_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
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

  current_route_table_id="$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=association.subnet-id,Values=$subnet_id" \
      --query 'RouteTables[0].RouteTableId' \
      --output text
  )"
  current_route_table_id="$(text_or_empty "$current_route_table_id")"

  if [[ -z "$current_route_table_id" ]]; then
    aws_cli ec2 associate-route-table \
      --subnet-id "$subnet_id" \
      --route-table-id "$route_table_id" >/dev/null
    return
  fi

  if [[ "$current_route_table_id" == "$route_table_id" ]]; then
    return
  fi

  association_id="$(
    aws_cli ec2 describe-route-tables \
      --filters "Name=association.subnet-id,Values=$subnet_id" \
      --query "RouteTables[0].Associations[?SubnetId=='$subnet_id'][0].RouteTableAssociationId" \
      --output text
  )"
  association_id="$(text_or_empty "$association_id")"

  if [[ -z "$association_id" ]]; then
    aws_cli ec2 associate-route-table \
      --subnet-id "$subnet_id" \
      --route-table-id "$route_table_id" >/dev/null
  else
    aws_cli ec2 replace-route-table-association \
      --association-id "$association_id" \
      --route-table-id "$route_table_id" >/dev/null
  fi
}

security_group_id_by_name() {
  local name="$1"
  local group_id
  group_id="$(
    aws_cli ec2 describe-security-groups \
      --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$name" \
      --query 'SecurityGroups[0].GroupId' \
      --output text
  )"
  text_or_empty "$group_id"
}

authorize_ingress_from_security_group() {
  local group_id="$1"
  local source_group_id="$2"
  local port="$3"
  local err

  if ! err="$(
    aws_cli ec2 authorize-security-group-ingress \
      --group-id "$group_id" \
      --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,UserIdGroupPairs=[{GroupId=$source_group_id,Description=Managed by codex for proxy-api}]" \
      2>&1 >/dev/null
  )"; then
    if [[ "$err" != *"InvalidPermission.Duplicate"* ]]; then
      echo "$err" >&2
      exit 1
    fi
  fi
}

ensure_apprunner_connector_security_group() {
  local group_id

  group_id="$(security_group_id_by_name "$APP_RUNNER_CONNECTOR_SG_NAME")"
  if [[ -n "$group_id" ]]; then
    echo "$group_id"
    return
  fi

  aws_cli ec2 create-security-group \
    --group-name "$APP_RUNNER_CONNECTOR_SG_NAME" \
    --description "App Runner VPC connector egress for proxy-api" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$APP_RUNNER_CONNECTOR_SG_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
    --query 'GroupId' \
    --output text
}

ensure_db_ingress_for_connector_sg() {
  local connector_sg_id="$1"
  local db_security_group_ids
  local db_security_group_id

  db_security_group_ids="$(
    aws_cli rds describe-db-instances \
      --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
      --query 'DBInstances[0].VpcSecurityGroups[].VpcSecurityGroupId' \
      --output text
  )"

  for db_security_group_id in $db_security_group_ids; do
    authorize_ingress_from_security_group "$db_security_group_id" "$connector_sg_id" 5432
  done
}

ensure_kms_endpoint_security_group() {
  local allowed_source_group_id="$1"
  local group_id

  group_id="$(security_group_id_by_name "$KMS_ENDPOINT_SG_NAME")"
  if [[ -z "$group_id" ]]; then
    group_id="$(
      aws_cli ec2 create-security-group \
        --group-name "$KMS_ENDPOINT_SG_NAME" \
        --description "KMS interface endpoint access for proxy-api" \
        --vpc-id "$VPC_ID" \
        --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$KMS_ENDPOINT_SG_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
        --query 'GroupId' \
        --output text
    )"
  fi

  authorize_ingress_from_security_group "$group_id" "$allowed_source_group_id" 443
  echo "$group_id"
}

vpc_endpoint_id_by_name() {
  local name="$1"
  local endpoint_id
  endpoint_id="$(
    aws_cli ec2 describe-vpc-endpoints \
      --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=$name" \
      --query 'VpcEndpoints[0].VpcEndpointId' \
      --output text
  )"
  text_or_empty "$endpoint_id"
}

ensure_kms_vpc_endpoint() {
  local endpoint_sg_id="$1"
  local subnet_a_id="$2"
  local subnet_b_id="$3"
  local subnet_c_id="$4"
  local endpoint_id

  endpoint_id="$(vpc_endpoint_id_by_name "$KMS_ENDPOINT_NAME")"
  if [[ -n "$endpoint_id" ]]; then
    wait_for_vpc_endpoint_available "$endpoint_id"
    echo "$endpoint_id"
    return
  fi

  endpoint_id="$(
    aws_cli ec2 create-vpc-endpoint \
      --vpc-id "$VPC_ID" \
      --service-name "com.amazonaws.$AWS_REGION.kms" \
      --vpc-endpoint-type Interface \
      --private-dns-enabled \
      --subnet-ids "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" \
      --security-group-ids "$endpoint_sg_id" \
      --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=$KMS_ENDPOINT_NAME},{Key=Project,Value=proxy-api},{Key=ManagedBy,Value=codex}]" \
      --query 'VpcEndpoint.VpcEndpointId' \
      --output text
  )"
  wait_for_vpc_endpoint_available "$endpoint_id"
  echo "$endpoint_id"
}

wait_for_vpc_endpoint_available() {
  local endpoint_id="$1"
  local state

  while true; do
    state="$(
      aws_cli ec2 describe-vpc-endpoints \
        --vpc-endpoint-ids "$endpoint_id" \
        --query 'VpcEndpoints[0].State' \
        --output text
    )"
    state="$(text_or_empty "$state")"

    if [[ "$state" == "available" ]]; then
      return
    fi

    if [[ "$state" == "failed" || "$state" == "deleted" || "$state" == "rejected" || "$state" == "expired" ]]; then
      echo "VPC endpoint $endpoint_id entered unexpected state: $state" >&2
      exit 1
    fi

    sleep 10
  done
}

vpc_connector_arn_by_name() {
  local name="$1"
  local connector_rows
  local connector_arn

  connector_rows="$(
    aws_cli apprunner list-vpc-connectors \
      --query 'VpcConnectors[*].[VpcConnectorName,VpcConnectorArn]' \
      --output text
  )"
  connector_arn="$(awk -v connector_name="$name" '$1 == connector_name { print $2; exit }' <<<"$connector_rows")"
  text_or_empty "$connector_arn"
}

wait_for_vpc_connector_active() {
  local name="$1"
  local connector_rows
  local status

  while true; do
    connector_rows="$(
      aws_cli apprunner list-vpc-connectors \
        --query 'VpcConnectors[*].[VpcConnectorName,Status]' \
        --output text
    )"
    status="$(awk -v connector_name="$name" '$1 == connector_name { print $2; exit }' <<<"$connector_rows")"
    status="$(text_or_empty "$status")"

    if [[ "$status" == "ACTIVE" ]]; then
      return
    fi

    if [[ "$status" == "FAILED" || "$status" == "INACTIVE" ]]; then
      echo "App Runner VPC connector $name entered unexpected status: $status" >&2
      exit 1
    fi

    sleep 10
  done
}

ensure_vpc_connector() {
  local subnet_a_id="$1"
  local subnet_b_id="$2"
  local subnet_c_id="$3"
  local connector_sg_id="$4"
  local connector_arn

  connector_arn="$(vpc_connector_arn_by_name "$APP_RUNNER_CONNECTOR_NAME")"
  if [[ -z "$connector_arn" ]]; then
    connector_arn="$(
      aws_cli apprunner create-vpc-connector \
        --vpc-connector-name "$APP_RUNNER_CONNECTOR_NAME" \
        --subnets "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" \
        --security-groups "$connector_sg_id" \
        --tags "Key=Project,Value=proxy-api" "Key=ManagedBy,Value=codex" \
        --query 'VpcConnector.VpcConnectorArn' \
        --output text
    )"
  fi

  wait_for_vpc_connector_active "$APP_RUNNER_CONNECTOR_NAME"
  echo "$connector_arn"
}

update_apprunner_service_network() {
  local connector_arn="$1"
  local current_connector_arn

  current_connector_arn="$(
    aws_cli apprunner describe-service \
      --service-arn "$SERVICE_ARN" \
      --query 'Service.NetworkConfiguration.EgressConfiguration.VpcConnectorArn' \
      --output text
  )"
  current_connector_arn="$(text_or_empty "$current_connector_arn")"

  if [[ "$current_connector_arn" == "$connector_arn" ]]; then
    return
  fi

  aws_cli apprunner update-service \
    --service-arn "$SERVICE_ARN" \
    --network-configuration "EgressConfiguration={EgressType=VPC,VpcConnectorArn=$connector_arn},IngressConfiguration={IsPubliclyAccessible=true},IpAddressType=IPV4" >/dev/null
}

wait_for_service_running() {
  local expected_connector_arn="$1"
  local status
  local current_connector_arn

  while true; do
    status="$(
      aws_cli apprunner describe-service \
        --service-arn "$SERVICE_ARN" \
        --query 'Service.Status' \
        --output text
    )"
    current_connector_arn="$(
      aws_cli apprunner describe-service \
        --service-arn "$SERVICE_ARN" \
        --query 'Service.NetworkConfiguration.EgressConfiguration.VpcConnectorArn' \
        --output text
    )"
    current_connector_arn="$(text_or_empty "$current_connector_arn")"

    if [[ "$status" == "RUNNING" && "$current_connector_arn" == "$expected_connector_arn" ]]; then
      return
    fi

    if [[ "$status" == "CREATE_FAILED" || "$status" == "DELETE_FAILED" || "$status" == "OPERATION_FAILED" ]]; then
      echo "App Runner service entered unexpected status: $status" >&2
      exit 1
    fi

    sleep 10
  done
}

main() {
  local subnet_a_id
  local subnet_b_id
  local subnet_c_id
  local allocation_id
  local nat_gateway_id
  local route_table_id
  local connector_sg_id
  local endpoint_sg_id
  local kms_endpoint_id
  local connector_arn

  subnet_a_id="$(ensure_private_subnet "$PRIVATE_SUBNET_A_NAME" "$PRIVATE_SUBNET_A_CIDR" "eu-west-2a")"
  subnet_b_id="$(ensure_private_subnet "$PRIVATE_SUBNET_B_NAME" "$PRIVATE_SUBNET_B_CIDR" "eu-west-2b")"
  subnet_c_id="$(ensure_private_subnet "$PRIVATE_SUBNET_C_NAME" "$PRIVATE_SUBNET_C_CIDR" "eu-west-2c")"

  allocation_id="$(ensure_elastic_ip)"
  nat_gateway_id="$(ensure_nat_gateway "$allocation_id")"
  route_table_id="$(ensure_private_route_table "$nat_gateway_id")"

  associate_subnet_to_route_table "$subnet_a_id" "$route_table_id"
  associate_subnet_to_route_table "$subnet_b_id" "$route_table_id"
  associate_subnet_to_route_table "$subnet_c_id" "$route_table_id"

  connector_sg_id="$(ensure_apprunner_connector_security_group)"
  ensure_db_ingress_for_connector_sg "$connector_sg_id"

  endpoint_sg_id="$(ensure_kms_endpoint_security_group "$connector_sg_id")"
  kms_endpoint_id="$(ensure_kms_vpc_endpoint "$endpoint_sg_id" "$subnet_a_id" "$subnet_b_id" "$subnet_c_id")"

  connector_arn="$(ensure_vpc_connector "$subnet_a_id" "$subnet_b_id" "$subnet_c_id" "$connector_sg_id")"
  update_apprunner_service_network "$connector_arn"
  wait_for_service_running "$connector_arn"

  cat <<EOF
private_subnet_a_id=$subnet_a_id
private_subnet_b_id=$subnet_b_id
private_subnet_c_id=$subnet_c_id
nat_gateway_id=$nat_gateway_id
private_route_table_id=$route_table_id
apprunner_connector_sg_id=$connector_sg_id
kms_endpoint_sg_id=$endpoint_sg_id
kms_vpc_endpoint_id=$kms_endpoint_id
apprunner_vpc_connector_arn=$connector_arn
EOF
}

main "$@"
