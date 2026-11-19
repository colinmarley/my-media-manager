"""Pins migration ae2f3a4b5c6d (releases) against the ORM models."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "ae2f3a4b5c6d_physical_releases.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("physical_releases_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_follows_the_single_head():
    migration = _load_migration()
    assert migration.revision == "ae2f3a4b5c6d"
    assert migration.down_revision == "ad1e2f3a4b5c"
    revising = [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = 'ad1e2f3a4b5c'" in p.read_text(encoding="utf-8")
    ]
    assert revising == [MIGRATION.name]
    # Nothing revises this one yet: it is the head.
    assert not [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = 'ae2f3a4b5c6d'" in p.read_text(encoding="utf-8")
    ]


def test_added_columns_match_the_models():
    from db.models import Base

    migration = _load_migration()
    for table_name, columns in migration.ADDED_COLUMNS:
        table = Base.metadata.tables[table_name]
        for name, type_, nullable, default in columns:
            assert name in table.c, (table_name, name)
            assert type(table.c[name].type).__name__ == type(type_).__name__, (table_name, name)
            assert table.c[name].nullable == nullable, (table_name, name)
            if default is not None:
                assert str(table.c[name].server_default.arg) == str(default), (table_name, name)


def test_contents_table_matches_the_model():
    from db.models import ReleaseContent

    migration = _load_migration()
    op = MagicMock()
    migration.op = op
    migration.upgrade()
    create = op.create_table.call_args
    assert create.args[0] == migration.CONTENTS_TABLE == ReleaseContent.__tablename__
    columns = {c.name: c for c in create.args[1:] if hasattr(c, "nullable") and hasattr(c, "type")}
    model = ReleaseContent.__table__
    assert set(columns) == set(model.c.keys())
    for name, column in columns.items():
        assert type(column.type).__name__ == type(model.c[name].type).__name__, name
        if name != "id":
            assert column.nullable == model.c[name].nullable, name


def test_indexes_and_foreign_key_match_the_models():
    from db.models import Base

    migration = _load_migration()
    op = MagicMock()
    migration.op = op
    migration.upgrade()
    created = {call.args[0]: (call.args[1], list(call.args[2])) for call in op.create_index.call_args_list}
    assert created == {
        migration.DISC_SET_BARCODE_INDEX: ("disc_sets", ["barcode"]),
        migration.MEDIA_FILE_RELEASE_INDEX: ("media_files", ["release_id"]),
        migration.CONTENTS_RELEASE_INDEX: ("release_contents", ["release_id"]),
        migration.CONTENTS_MEDIA_INDEX: ("release_contents", ["media_type", "media_id"]),
    }
    for name, (table_name, columns) in created.items():
        model_indexes = {i.name: [c.name for c in i.columns] for i in Base.metadata.tables[table_name].indexes}
        assert model_indexes.get(name) == columns, name

    fk = op.create_foreign_key.call_args
    assert fk.args[1:5] == ("media_files", "disc_sets", ["release_id"], ["id"])
    assert fk.kwargs == {"ondelete": "SET NULL"}
    model_fk = next(iter(Base.metadata.tables["media_files"].c.release_id.foreign_keys))
    assert model_fk.column.table.name == "disc_sets"
    assert model_fk.ondelete == "SET NULL"


def test_upgrade_and_downgrade_are_symmetric():
    migration = _load_migration()
    op = MagicMock()
    migration.op = op

    migration.upgrade()
    added = [(call.args[0], call.args[1].name) for call in op.add_column.call_args_list]
    assert added == [(table, name) for table, columns in migration.ADDED_COLUMNS for name, *_ in columns]
    # The backfill runs after the schema exists.
    assert [call.args[0] for call in op.execute.call_args_list] == [
        migration.BACKFILL_LOOSE_RELEASES, migration.BACKFILL_FILE_RELEASES,
    ]

    op.reset_mock()
    migration.downgrade()
    dropped = [(call.args[0], call.args[1]) for call in op.drop_column.call_args_list]
    assert dropped == list(reversed(added))
    op.drop_table.assert_called_once_with(migration.CONTENTS_TABLE)
    # Loose releases go before the columns that identify them.
    assert [call.args[0] for call in op.execute.call_args_list] == [
        migration.DETACH_LOOSE_DISCS, migration.DELETE_LOOSE_RELEASES,
    ]
