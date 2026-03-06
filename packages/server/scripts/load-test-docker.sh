#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/../load-testing"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
DATABASE_URL="postgresql://test:test@localhost:5433/outboxy_test"

cleanup() {
  echo ""
  echo "Stopping Docker Compose stack..."
  docker compose -f "$COMPOSE_FILE" down
}

trap cleanup EXIT INT TERM

echo "Starting Docker Compose stack (Postgres + Prometheus + Grafana)..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for PostgreSQL to be ready..."
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U test -d outboxy_test > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready."

echo ""
echo "Grafana dashboard:  http://localhost:3001/d/outboxy-worker-load-test"
echo "PG monitoring:      http://localhost:3001/d/postgres-load-test-diagnostics"
echo "Prometheus:         http://localhost:9091"
echo "Worker metrics:     http://localhost:9090/metrics (available after load test starts)"
echo ""

# Pass all arguments through to the load test CLI
export GRAFANA_URL="http://localhost:3001"
tsx "$SCRIPT_DIR/load-test.ts" --database-url "$DATABASE_URL" "$@"
