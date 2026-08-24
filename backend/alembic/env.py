import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make backend/ importable so db.database and db.models resolve correctly.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db.database import Base   # noqa: E402 — registers declarative base
import db.models               # noqa: E402, F401 — registers all ORM models with Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """
    Resolve the database URL for Alembic (sync driver only).
    Prefer DATABASE_URL env var so CI/CD and local overrides work without
    editing alembic.ini.  Strip the asyncpg driver prefix so SQLAlchemy uses
    the synchronous psycopg2 driver during migrations.
    """
    raw = (
        os.environ.get("DATABASE_URL")
        or config.get_main_option("sqlalchemy.url")
    )
    # asyncpg is async-only; Alembic needs a sync connection.
    return raw.replace("postgresql+asyncpg://", "postgresql+psycopg2://")


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (generates SQL to stdout)."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against the live database."""
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
