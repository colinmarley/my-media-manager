"""
Pins the removal of the unused, empty tables (issue #8): the ORM no longer
declares them, nothing left in it points at them, and the migration that
drops them refuses to run against a table that has rows.
"""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

import pytest

DROPPED = {
    "releases", "release_movies", "release_series",
    "actors", "movie_actors", "movie_directors", "series_actors", "series_directors",
    "scan_results", "scanned_files", "scanned_directories",
    "jellyfin_folders", "media_matches", "ingress_config",
}

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "6f7a8b9c0d1e_drop_unused_tables.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("drop_unused_tables", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_models_no_longer_declare_dropped_tables():
    from db.models import Base

    assert DROPPED.isdisjoint(Base.metadata.tables)


def test_no_remaining_foreign_key_targets_a_dropped_table():
    from db.models import Base

    targets = {
        fk.column.table.name
        for table in Base.metadata.tables.values()
        for fk in table.foreign_keys
    }
    assert DROPPED.isdisjoint(targets)


def test_migration_follows_head_and_drops_exactly_these_tables():
    migration = _load_migration()

    assert migration.down_revision == "5e6f7a8b9c0d"
    assert set(migration.DROPPED_TABLES) == DROPPED


def test_migration_refuses_to_drop_a_non_empty_table():
    migration = _load_migration()
    conn = MagicMock()
    conn.execute.side_effect = lambda stmt: MagicMock(
        scalar=lambda: "media_matches" in str(stmt)
    )

    with pytest.raises(RuntimeError, match="media_matches"):
        migration._assert_empty(conn)


def test_migration_allows_dropping_empty_tables():
    migration = _load_migration()
    conn = MagicMock()
    conn.execute.return_value.scalar.return_value = False

    migration._assert_empty(conn)
