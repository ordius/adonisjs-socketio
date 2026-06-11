#!/usr/bin/env sh
set -eu

COMPOSE_FILE="docker-compose.test.yml"
REDIS_URL_DEFAULT="redis://127.0.0.1:6399"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

echo "[integration] starting redis via docker compose"
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "[integration] running redis-backed end-to-end tests"
REDIS_URL="${REDIS_URL:-$REDIS_URL_DEFAULT}" \
node --import=./tsnode.esm.js --enable-source-maps bin/test.integration.ts

echo "[integration] done"
