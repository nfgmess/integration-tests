#!/usr/bin/env bash
set -euo pipefail

IDENTITY_URL="${IDENTITY_URL:-http://localhost:8081/health}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080/health}"
WEB_URL="${WEB_URL:-http://localhost:3000/}"
MAX_WAIT="${MAX_WAIT:-60}"

echo "Waiting for services to be ready..."

wait_for() {
  local url="$1"
  local name="$2"
  local elapsed=0

  while [ $elapsed -lt $MAX_WAIT ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "  $name is ready"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "  ERROR: $name not ready after ${MAX_WAIT}s"
  return 1
}

wait_for "$IDENTITY_URL" "identity-service"
wait_for "$GATEWAY_URL" "gateway"
wait_for "$WEB_URL" "web-client"

echo "All services ready."
