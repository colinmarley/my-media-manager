#!/usr/bin/env bash
# Run the database-backed catalog and release tests against a throwaway
# Postgres 16 container, then remove the container.
#
#   scripts/test-releases.sh            # the release + client-flow + catalog-error tests
#   scripts/test-releases.sh tests/     # the whole backend suite with those tests enabled
#
# Without a database these tests are skipped by a plain `pytest`, so this is
# the way to actually run them. PYTHON picks the interpreter (default: python);
# RELEASES_TEST_DB_PORT the local port (default: 5439).
set -euo pipefail

PYTHON="${PYTHON:-python}"
PORT="${RELEASES_TEST_DB_PORT:-5439}"
NAME="mmm-releases-test-pg-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD=t postgres:16 >/dev/null
for _ in $(seq 1 30); do
  # Ready twice in a row: the image restarts Postgres once during first start.
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    sleep 1
    docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  fi
  sleep 1
done

cd "$ROOT/backend"
if [ "$#" -eq 0 ]; then
  set -- tests/test_releases.py tests/test_release_client_flows.py tests/test_physical_releases_migration.py tests/test_catalog_errors.py
fi
CATALOG_TEST_DATABASE_URL="postgresql+asyncpg://postgres:t@127.0.0.1:${PORT}/postgres" \
  "$PYTHON" -m pytest -q -p no:cacheprovider "$@"
