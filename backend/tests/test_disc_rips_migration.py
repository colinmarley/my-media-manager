"""Pins migration af3a4b5c6d7e (disc rips) against the ORM models."""

import importlib.util
from pathlib import Path
from unittest.mock import MagicMock

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS / "af3a4b5c6d7e_disc_rips.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("disc_rips_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _upgraded():
    migration = _load_migration()
    op = MagicMock()
    migration.op = op
    migration.upgrade()
    return migration, op


def test_migration_follows_the_single_head():
    migration = _load_migration()
    assert migration.revision == "af3a4b5c6d7e"
    assert migration.down_revision == "ae2f3a4b5c6d"
    revising = [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = 'ae2f3a4b5c6d'" in p.read_text(encoding="utf-8")
    ]
    assert revising == [MIGRATION.name]
    # Nothing revises this one yet: it is the head.
    assert not [
        p.name for p in VERSIONS.glob("*.py")
        if "down_revision: Union[str, None] = 'af3a4b5c6d7e'" in p.read_text(encoding="utf-8")
    ]


def test_tables_match_the_models():
    from db.models import Base

    migration, op = _upgraded()
    created = {call.args[0]: call.args[1:] for call in op.create_table.call_args_list}
    assert list(created) == [migration.RIPS_TABLE, migration.TITLES_TABLE]

    for table_name, items in created.items():
        model = Base.metadata.tables[table_name]
        columns = {c.name: c for c in items if hasattr(c, "nullable") and hasattr(c, "type")}
        assert set(columns) == set(model.c.keys()), table_name
        for name, column in columns.items():
            assert type(column.type).__name__ == type(model.c[name].type).__name__, (table_name, name)
            if not model.c[name].primary_key:
                assert column.nullable == model.c[name].nullable, (table_name, name)

        foreign_keys = {
            (fk.column_keys[0], fk.elements[0].target_fullname, fk.ondelete)
            for fk in items if type(fk).__name__ == "ForeignKeyConstraint"
        }
        model_fks = {
            (c.name, f"{fk.column.table.name}.{fk.column.name}", fk.ondelete)
            for c in model.c for fk in c.foreign_keys
        }
        assert foreign_keys == model_fks, table_name


def test_indexes_and_unique_constraint_match_the_models():
    from db.models import Base

    migration, op = _upgraded()
    created = {call.args[0]: (call.args[1], list(call.args[2])) for call in op.create_index.call_args_list}
    assert created == {name: (table, columns) for name, (table, columns) in migration.INDEXES.items()}
    for name, (table_name, columns) in created.items():
        model_indexes = {i.name: [c.name for c in i.columns] for i in Base.metadata.tables[table_name].indexes}
        assert model_indexes.get(name) == columns, name
    # ...and the models declare no index the migration does not create.
    for table_name in (migration.RIPS_TABLE, migration.TITLES_TABLE):
        assert {i.name for i in Base.metadata.tables[table_name].indexes} == {
            name for name, (table, _c) in migration.INDEXES.items() if table == table_name
        }

    titles = Base.metadata.tables[migration.TITLES_TABLE]
    unique = [c for c in titles.constraints if type(c).__name__ == "UniqueConstraint"]
    assert [(c.name, [col.name for col in c.columns]) for c in unique] == [
        (migration.TITLES_UNIQUE, ["rip_id", "title_index", "file_seq"])
    ]


def test_downgrade_drops_what_upgrade_created():
    migration = _load_migration()
    op = MagicMock()
    migration.op = op
    migration.downgrade()
    assert [call.args[0] for call in op.drop_table.call_args_list] == [migration.TITLES_TABLE, migration.RIPS_TABLE]
    assert {call.args[0] for call in op.drop_index.call_args_list} == set(migration.INDEXES)
