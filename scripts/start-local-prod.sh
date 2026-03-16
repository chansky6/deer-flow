#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/logs"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"

mkdir -p "${LOG_DIR}"

load_env() {
  set -a
  if [ -f "${ROOT_DIR}/.env" ]; then
    # shellcheck disable=SC1090
    . "${ROOT_DIR}/.env"
  fi
  if [ -f "${FRONTEND_DIR}/.env" ]; then
    # shellcheck disable=SC1090
    . "${FRONTEND_DIR}/.env"
  fi
  set +a
}

debug_env() {
  if [ "${DEBUG_ENV:-0}" = "1" ]; then
    echo "DEBUG: AUTH_DATABASE_URL=${AUTH_DATABASE_URL:-<unset>}"
    echo "DEBUG: DEER_FLOW_POSTGRES_URL=${DEER_FLOW_POSTGRES_URL:-<unset>}"
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: '${cmd}' not found in PATH."
    exit 1
  fi
}

require_config() {
  if [ -n "${DEER_FLOW_CONFIG_PATH:-}" ] && [ -f "${DEER_FLOW_CONFIG_PATH}" ]; then
    return
  fi
  if [ -f "${ROOT_DIR}/config.yaml" ] || [ -f "${BACKEND_DIR}/config.yaml" ]; then
    return
  fi
  echo "Error: No config file found."
  echo "Checked: \$DEER_FLOW_CONFIG_PATH, ${ROOT_DIR}/config.yaml, ${BACKEND_DIR}/config.yaml"
  echo "Run 'make config' to generate config.yaml, then set model API keys in .env."
  exit 1
}

check_database() {
  local db_url="${AUTH_DATABASE_URL:-${DEER_FLOW_POSTGRES_URL:-}}"
  if [ -z "${db_url}" ]; then
    echo "Error: AUTH_DATABASE_URL or DEER_FLOW_POSTGRES_URL must be configured."
    exit 1
  fi

  if command -v pg_isready >/dev/null 2>&1; then
    if ! pg_isready -d "${db_url}" >/dev/null 2>&1; then
      echo "Error: PostgreSQL is not ready. Check connection string and server status."
      exit 1
    fi
  elif command -v psql >/dev/null 2>&1; then
    if ! psql "${db_url}" -c "select 1" >/dev/null 2>&1; then
      echo "Error: PostgreSQL connection failed. Check connection string and server status."
      exit 1
    fi
  else
    echo "Warning: pg_isready/psql not found; skipping database connectivity check."
  fi
}

ensure_backend_deps() {
  require_command uv
  if [ ! -d "${BACKEND_DIR}/.venv" ]; then
    echo "Installing backend dependencies (uv sync)..."
    (cd "${BACKEND_DIR}" && uv sync)
  fi
}

ensure_frontend_deps() {
  require_command pnpm
  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    echo "Installing frontend dependencies (pnpm install)..."
    (cd "${FRONTEND_DIR}" && pnpm install)
  fi
}

ensure_frontend_build() {
  if [ ! -f "${FRONTEND_DIR}/.next/BUILD_ID" ]; then
    echo "Building frontend (pnpm build)..."
    (
      cd "${FRONTEND_DIR}"
      NODE_ENV=production \
      pnpm build
    )
  fi
}

start_backend() {
  echo "Starting backend API on :8001..."
  (cd "${BACKEND_DIR}" && uv run uvicorn src.gateway.app:app --host 0.0.0.0 --port 8001 --workers 1 \
    > "${LOG_DIR}/gateway.log" 2>&1) &
  BACKEND_API_PID=$!

  echo "Starting backend worker..."
  (cd "${BACKEND_DIR}" && uv run python -m src.runtime.worker \
    > "${LOG_DIR}/worker.log" 2>&1) &
  BACKEND_WORKER_PID=$!
}

start_frontend() {
  echo "Starting frontend on :3000..."
  (
    cd "${FRONTEND_DIR}"
    NODE_ENV=production \
    BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://localhost:8001}" \
    BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-default-change-me-in-production}" \
    INTERNAL_AUTH_JWT_SECRET="${INTERNAL_AUTH_JWT_SECRET:-default-change-me-in-production}" \
    pnpm start > "${LOG_DIR}/frontend.log" 2>&1
  ) &
  FRONTEND_PID=$!
}

cleanup() {
  trap - INT TERM
  echo ""
  echo "Shutting down services..."
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${BACKEND_WORKER_PID:-}" ] && kill -0 "${BACKEND_WORKER_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_WORKER_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${BACKEND_API_PID:-}" ] && kill -0 "${BACKEND_API_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_API_PID}" >/dev/null 2>&1 || true
  fi
  wait >/dev/null 2>&1 || true
  echo "All services stopped."
  exit 0
}

trap cleanup INT TERM

load_env
debug_env
require_config
check_database
ensure_backend_deps
ensure_frontend_deps
ensure_frontend_build
start_backend
start_frontend

echo ""
echo "DeerFlow is running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8001"
echo ""
echo "Logs:"
echo "  Backend API: ${LOG_DIR}/gateway.log"
echo "  Backend Worker: ${LOG_DIR}/worker.log"
echo "  Frontend: ${LOG_DIR}/frontend.log"
echo ""
echo "Press Ctrl+C to stop."

wait
