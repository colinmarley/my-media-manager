"""Pins migration ad1e2f3a4b5c (needs_review columns, attention_dismissals) against the ORM model."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "ad1e2f3a4b5c_attention.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("attention_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_follows_the_single_head():
    migration = _load_migration()
    assert migration.revision == "ad1e2f3a4b5c"
    assert migration.down_revision == "9c0d1e2f3a4b"
    revising = [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = '9c0d1e2f3a4b'" in p.read_text(encoding="utf-8")
    ]
    assert revising == [MIGRATION.name]
    # Nothing revises this one yet: it is the head.
    assert not [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = 'ad1e2f3a4b5c'" in p.read_text(encoding="utf-8")
    ]


def test_media_file_columns_match_the_model():
    from db.models import MediaFile

    migration = _load_migration()
    table = MediaFile.__table__
    for name, type_, nullable, default in migration.MEDIA_FILE_COLUMNS:
        assert name in table.c, name
        assert type(table.c[name].type).__name__ == type(type_).__name__, name
        assert table.c[name].nullable == nullable, name
        if default is not None:
            assert str(table.c[name].server_default.arg) == str(default), name


def test_dismissals_table_matches_the_model():
    from db.models import AttentionDismissal

    migration = _load_migration()
    op = MagicMock()
    migration.op = op
    migration.upgrade()
    create = op.create_table.call_args
    assert create.args[0] == migration.DISMISSALS_TABLE == AttentionDismissal.__tablename__
    columns = {c.name: c for c in create.args[1:] if hasattr(c, "nullable") and hasattr(c, "type")}
    model = AttentionDismissal.__table__
    assert set(columns) == set(model.c.keys())
    for name, column in columns.items():
        assert type(column.type).__name__ == type(model.c[name].type).__name__, name
        if name != "id":
            assert column.nullable == model.c[name].nullable, name
    uniques = [c for c in create.args[1:] if type(c).__name__ == "UniqueConstraint"]
    assert [list(u._pending_colargs) for u in uniques] == [["kind", "subject_type", "subject_id"]]
    model_uniques = [
        [col.name for col in c.columns] for c in model.constraints if type(c).__name__ == "UniqueConstraint"
    ]
    assert model_uniques == [["kind", "subject_type", "subject_id"]]


def test_upgrade_and_downgrade_are_symmetric():
    migration = _load_migration()
    op = MagicMock()
    migration.op = op

    migration.upgrade()
    added = [call.args[1].name for call in op.add_column.call_args_list]
    assert added == [name for name, *_ in migration.MEDIA_FILE_COLUMNS]
    assert op.create_table.call_count == 1

    migration.downgrade()
    dropped = [call.args[1] for call in op.drop_column.call_args_list]
    assert dropped == list(reversed(added))
    op.drop_table.assert_called_once_with(migration.DISMISSALS_TABLE)
