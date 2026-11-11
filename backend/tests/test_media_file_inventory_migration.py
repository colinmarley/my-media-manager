"""Pins migration 9c0d1e2f3a4b (media_files inventory columns) against the ORM model."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "9c0d1e2f3a4b_media_file_inventory.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("media_file_inventory", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_follows_the_single_head():
    migration = _load_migration()
    assert migration.revision == "9c0d1e2f3a4b"
    assert migration.down_revision == "8b9c0d1e2f3a"
    # Nothing else revises 8b9c0d1e2f3a, so this stays a single head.
    revising = [p.name for p in VERSIONS.glob("*.py") if "down_revision: Union[str, None] = '8b9c0d1e2f3a'" in p.read_text(encoding="utf-8")]
    assert revising == [MIGRATION.name]


def test_migration_columns_match_the_model():
    from db.models import MediaFile

    migration = _load_migration()
    table = MediaFile.__table__
    for name, type_ in migration.NEW_COLUMNS:
        assert name in table.c, name
        assert type(table.c[name].type).__name__ == type(type_).__name__, name
        assert table.c[name].nullable


def test_migration_foreign_keys_and_indexes_match_the_model():
    from db.models import MediaFile

    migration = _load_migration()
    table = MediaFile.__table__
    fks = {fk.parent.name: (fk.column.table.name, fk.ondelete) for fk in table.foreign_keys}
    for _, target, column in migration.FOREIGN_KEYS:
        assert fks[column] == (target, "SET NULL")
    model_indexes = {ix.name: [c.name for c in ix.columns] for ix in table.indexes}
    for name, columns in migration.INDEXES:
        assert model_indexes.get(name) == columns, name


def test_upgrade_and_downgrade_are_symmetric():
    migration = _load_migration()
    op = MagicMock()
    migration.op = op

    migration.upgrade()
    added = [call.args[1].name for call in op.add_column.call_args_list]
    assert added == [name for name, _ in migration.NEW_COLUMNS]
    assert op.create_foreign_key.call_count == 2 and op.create_index.call_count == 4

    migration.downgrade()
    dropped = [call.args[1] for call in op.drop_column.call_args_list]
    assert dropped == list(reversed(added))
    assert op.drop_constraint.call_count == 2 and op.drop_index.call_count == 4
