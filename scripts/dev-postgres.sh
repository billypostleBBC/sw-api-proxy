#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-sw-api-proxy-dev-postgres}"
VOLUME_NAME="${VOLUME_NAME:-sw-api-proxy-dev-postgres-data}"
IMAGE="${IMAGE:-postgres:16-alpine}"
HOST_PORT="${HOST_PORT:-54329}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-proxy_api_preview}"
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${HOST_PORT}/${POSTGRES_DB}"

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required" >&2
    exit 1
  fi
}

container_exists() {
  docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | grep -q .
}

container_running() {
  docker ps -q --filter "name=^/${CONTAINER_NAME}$" | grep -q .
}

wait_for_healthy() {
  local status=""
  for _ in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}")"
    if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "Postgres container did not become ready. Current status: ${status}" >&2
  docker logs "${CONTAINER_NAME}" >&2 || true
  exit 1
}

start_container() {
  ensure_docker

  if container_running; then
    wait_for_healthy
    echo "Postgres already running."
    echo "DATABASE_URL=${DATABASE_URL}"
    return 0
  fi

  if container_exists; then
    docker start "${CONTAINER_NAME}" >/dev/null
    wait_for_healthy
    echo "Postgres container started."
    echo "DATABASE_URL=${DATABASE_URL}"
    return 0
  fi

  docker volume create "${VOLUME_NAME}" >/dev/null
  docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -e POSTGRES_USER="${POSTGRES_USER}" \
    -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    -e POSTGRES_DB="${POSTGRES_DB}" \
    -p "${HOST_PORT}:5432" \
    -v "${VOLUME_NAME}:/var/lib/postgresql/data" \
    --health-cmd "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}" \
    --health-interval 2s \
    --health-timeout 5s \
    --health-retries 30 \
    "${IMAGE}" >/dev/null

  wait_for_healthy
  echo "Postgres container created."
  echo "DATABASE_URL=${DATABASE_URL}"
}

stop_container() {
  ensure_docker
  if container_running; then
    docker stop "${CONTAINER_NAME}" >/dev/null
    echo "Postgres container stopped."
  else
    echo "Postgres container is not running."
  fi
}

reset_container() {
  ensure_docker
  if container_exists; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null
  fi
  docker volume rm -f "${VOLUME_NAME}" >/dev/null 2>&1 || true
  start_container
}

status_container() {
  ensure_docker
  if container_exists; then
    docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo "DATABASE_URL=${DATABASE_URL}"
  else
    echo "Postgres container does not exist."
    echo "DATABASE_URL=${DATABASE_URL}"
  fi
}

logs_container() {
  ensure_docker
  docker logs -f "${CONTAINER_NAME}"
}

print_url() {
  echo "${DATABASE_URL}"
}

usage() {
  cat <<'EOF'
Usage: scripts/dev-postgres.sh <start|stop|reset|status|logs|url>
EOF
}

case "${1:-}" in
  start)
    start_container
    ;;
  stop)
    stop_container
    ;;
  reset)
    reset_container
    ;;
  status)
    status_container
    ;;
  logs)
    logs_container
    ;;
  url)
    print_url
    ;;
  *)
    usage
    exit 1
    ;;
esac
