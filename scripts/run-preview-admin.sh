#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.preview.local}"

if [[ ! -f "${ENV_FILE}" ]]; then
  ENV_FILE="${ROOT_DIR}/.env.preview.example"
fi

"${ROOT_DIR}/scripts/dev-postgres.sh" start >/dev/null

set -a
source "${ENV_FILE}"
set +a

exec npm run dev
