#!/bin/sh
# Container entrypoint: apply database migrations, then exec the CMD (uvicorn).
#
# alembic/env.py reads DATABASE_URL (the app's asyncpg URL) and swaps in the
# psycopg2 driver, so no second copy of the password is needed.
# Set MIGRATE_ON_START=false to skip (e.g. while restoring a dump).
set -eu

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] FATAL: DATABASE_URL is not set; cannot run migrations." >&2
    exit 1
  fi
  echo "[entrypoint] Running: alembic upgrade head"
  if ! alembic upgrade head; then
    echo "[entrypoint] FATAL: 'alembic upgrade head' failed (see the traceback above)." >&2
    echo "[entrypoint] The API was NOT started. Check that Postgres is reachable, that the" >&2
    echo "[entrypoint] database was restored before first start (the baseline migration" >&2
    echo "[entrypoint] cannot build the schema from an empty database), then restart." >&2
    exit 1
  fi
  echo "[entrypoint] Migrations up to date."
else
  echo "[entrypoint] MIGRATE_ON_START=${MIGRATE_ON_START}; skipping migrations."
fi

exec "$@"
