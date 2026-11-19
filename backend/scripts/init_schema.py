"""
Create the schema in an EMPTY database and mark it as current for Alembic.

The baseline Alembic revision alters an existing schema and cannot build one
from nothing, so a fresh install runs this once before the first
`alembic upgrade head`:

    # Docker (from the repo root)
    docker compose up -d postgres --wait
    docker compose run --rm -e MIGRATE_ON_START=false backend python scripts/init_schema.py

    # Outside Docker (from backend/, DATABASE_URL set)
    python scripts/init_schema.py

It refuses to touch a database that already has tables, so it is safe to run
by mistake against an existing install.
"""

import asyncio
import os
import sys

# Allow running from the backend/ directory without installing the package.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from sqlalchemy import inspect

from db.database import Base, engine
import db.models  # noqa: F401  (registers every model on Base.metadata)


async def create_schema() -> bool:
    try:
        async with engine.begin() as conn:
            existing = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
            if existing:
                print(f"Database already has {len(existing)} tables; nothing to do.")
                return False
            await conn.run_sync(Base.metadata.create_all)
        return True
    finally:
        await engine.dispose()


def stamp_head() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.stamp(cfg, "head")


if __name__ == "__main__":
    if asyncio.run(create_schema()):
        stamp_head()
        print("Schema created from the models and stamped at the Alembic head.")
