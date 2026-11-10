"""drop_unused_tables

Drops 14 tables that no code reads or writes and that were empty in
production when audited (2026-10-14): the pre-disc_sets `releases` model
and its M2M tables, the relational actor/director link tables (cast and
crew live in movies/series JSONB and `generic_data`), the old scanner's
`scan_results`/`scanned_files`/`scanned_directories` (scans are in-memory
now), plus `jellyfin_folders`, `media_matches` and `ingress_config`.

`discs.release_id` and `media_files.scan_id` keep their columns; only their
foreign keys into the dropped tables go.

upgrade() checks every table is still empty first and aborts otherwise, so
running it can never silently destroy data. downgrade() recreates the
tables (empty) and the two foreign keys.

Revision ID: 6f7a8b9c0d1e
Revises: 5e6f7a8b9c0d
Create Date: 2026-10-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '6f7a8b9c0d1e'
down_revision: Union[str, None] = '5e6f7a8b9c0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Dependents before the tables they reference.
DROPPED_TABLES = (
    'release_movies',
    'release_series',
    'movie_actors',
    'movie_directors',
    'series_actors',
    'series_directors',
    'actors',
    'releases',
    'scanned_files',
    'scanned_directories',
    'scan_results',
    'jellyfin_folders',
    'media_matches',
    'ingress_config',
)

# (table, column, referenced table) for kept columns pointing at dropped tables.
_KEPT_FKS = (
    ('discs', 'release_id', 'releases'),
    ('media_files', 'scan_id', 'scan_results'),
)

_UUID_DEFAULT = sa.text('CAST(gen_random_uuid() AS TEXT)')


def _assert_empty(conn) -> None:
    non_empty = [
        table for table in DROPPED_TABLES
        if conn.execute(sa.text(f'SELECT EXISTS (SELECT 1 FROM {table})')).scalar()
    ]
    if non_empty:
        raise RuntimeError(
            f"Refusing to drop tables that contain rows: {', '.join(non_empty)}"
        )


def upgrade() -> None:
    conn = op.get_bind()
    _assert_empty(conn)

    inspector = sa.inspect(conn)
    for table, column, referred in _KEPT_FKS:
        for fk in inspector.get_foreign_keys(table):
            if fk['referred_table'] == referred and fk['constrained_columns'] == [column]:
                op.drop_constraint(fk['name'], table, type_='foreignkey')

    for table in DROPPED_TABLES:
        op.drop_table(table)


def _timestamp(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False)


def downgrade() -> None:
    op.create_table(
        'ingress_config',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('config', postgresql.JSONB(), nullable=False),
        _timestamp('updated_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'media_matches',
        sa.Column('id', sa.Text(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column('file_info', postgresql.JSONB(), nullable=False),
        sa.Column('confidence', sa.Integer()),
        sa.Column('media_id', sa.Text()),
        sa.Column('media_type', sa.Text()),
        sa.Column('suggestions', postgresql.JSONB()),
        sa.Column('status', sa.Text()),
        _timestamp('created_at'),
        _timestamp('updated_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'jellyfin_folders',
        sa.Column('id', sa.Text(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column('folder_path', sa.Text(), nullable=False),
        sa.Column('folder_name', sa.Text(), nullable=False),
        sa.Column('folder_type', sa.Text()),
        sa.Column('media_type', sa.Text()),
        sa.Column('media_id', sa.Text()),
        sa.Column('season_number', sa.Integer()),
        sa.Column('media_title', sa.Text()),
        sa.Column('year', sa.Integer()),
        sa.Column('imdb_id', sa.Text()),
        sa.Column('jellyfin_name', sa.Text()),
        sa.Column('video_files', postgresql.JSONB()),
        sa.Column('subtitle_files', postgresql.JSONB()),
        sa.Column('audio_files', postgresql.JSONB()),
        sa.Column('image_files', postgresql.JSONB()),
        sa.Column('extra_folders', postgresql.JSONB()),
        sa.Column('created_date', sa.DateTime(timezone=True)),
        sa.Column('last_verified', sa.DateTime(timezone=True)),
        sa.Column('is_valid', sa.Boolean()),
        sa.Column('validation_errors', postgresql.JSONB()),
        _timestamp('created_at'),
        _timestamp('updated_at'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('folder_path'),
    )

    op.create_table(
        'scan_results',
        sa.Column('id', sa.Text(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column('library_path_id', sa.Text()),
        sa.Column('library_path', sa.Text(), nullable=False),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('total_items', sa.Integer()),
        sa.Column('files_found', sa.Integer()),
        sa.Column('directories_found', sa.Integer()),
        _timestamp('start_time'),
        sa.Column('end_time', sa.DateTime(timezone=True)),
        sa.Column('error_message', sa.Text()),
        _timestamp('created_at'),
        sa.ForeignKeyConstraint(['library_path_id'], ['library_paths.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'scanned_directories',
        sa.Column('id', sa.Text(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column('scan_id', sa.Text()),
        sa.Column('library_path_id', sa.Text()),
        sa.Column('dir_path', sa.Text(), nullable=False),
        sa.Column('dir_name', sa.Text(), nullable=False),
        sa.Column('media_type', sa.Text()),
        sa.Column('status', sa.Text()),
        sa.Column('metadata', postgresql.JSONB()),
        _timestamp('discovered_at'),
        sa.ForeignKeyConstraint(['scan_id'], ['scan_results.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['library_path_id'], ['library_paths.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'scanned_files',
        sa.Column('id', sa.Text(), server_default=_UUID_DEFAULT, nullable=False),
        sa.Column('scan_id', sa.Text()),
        sa.Column('library_path_id', sa.Text()),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('file_name', sa.Text(), nullable=False),
        sa.Column('folder_path', sa.Text()),
        sa.Column('extension', sa.Text()),
        sa.Column('media_type', sa.Text()),
        sa.Column('status', sa.Text()),
        sa.Column('file_size', sa.BigInteger()),
        sa.Column('modified_time', sa.DateTime(timezone=True)),
        sa.Column('media_metadata', postgresql.JSONB()),
        sa.Column('parsed_info', postgresql.JSONB()),
        _timestamp('discovered_at'),
        sa.ForeignKeyConstraint(['scan_id'], ['scan_results.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['library_path_id'], ['library_paths.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'releases',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('year', sa.Integer()),
        sa.Column('media_type', sa.Text()),
        sa.Column('edition', sa.Text()),
        sa.Column('publisher', sa.Text()),
        sa.Column('territory', sa.Text()),
        sa.Column('release_date', sa.Text()),
        sa.Column('spine_number', sa.Text()),
        sa.Column('out_of_print', sa.Boolean()),
        sa.Column('upc', sa.Text()),
        sa.Column('contains_extras', sa.Boolean()),
        sa.Column('extras', postgresql.JSONB()),
        sa.Column('contains_inserts', sa.Boolean()),
        sa.Column('inserts', postgresql.JSONB()),
        sa.Column('image_files', postgresql.JSONB()),
        _timestamp('created_at'),
        _timestamp('updated_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'actors',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('full_name', sa.Text(), nullable=False),
        sa.Column('birthplace', sa.Text()),
        sa.Column('birthday', sa.Text()),
        sa.Column('notes', sa.Text()),
        _timestamp('created_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'series_directors',
        sa.Column('series_id', sa.Text(), nullable=False),
        sa.Column('director_id', sa.Text(), nullable=False),
        sa.Column('seasons', postgresql.ARRAY(sa.Text())),
        sa.Column('title', sa.Text()),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['director_id'], ['directors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('series_id', 'director_id'),
    )
    op.create_table(
        'series_actors',
        sa.Column('series_id', sa.Text(), nullable=False),
        sa.Column('actor_id', sa.Text(), nullable=False),
        sa.Column('characters', postgresql.ARRAY(sa.Text())),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_id'], ['actors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('series_id', 'actor_id'),
    )
    op.create_table(
        'movie_directors',
        sa.Column('movie_id', sa.Text(), nullable=False),
        sa.Column('director_id', sa.Text(), nullable=False),
        sa.Column('title', sa.Text()),
        sa.ForeignKeyConstraint(['movie_id'], ['movies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['director_id'], ['directors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('movie_id', 'director_id'),
    )
    op.create_table(
        'movie_actors',
        sa.Column('movie_id', sa.Text(), nullable=False),
        sa.Column('actor_id', sa.Text(), nullable=False),
        sa.Column('characters', postgresql.ARRAY(sa.Text())),
        sa.ForeignKeyConstraint(['movie_id'], ['movies.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_id'], ['actors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('movie_id', 'actor_id'),
    )
    op.create_table(
        'release_series',
        sa.Column('release_id', sa.Text(), nullable=False),
        sa.Column('series_id', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['release_id'], ['releases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['series_id'], ['series.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('release_id', 'series_id'),
    )
    op.create_table(
        'release_movies',
        sa.Column('release_id', sa.Text(), nullable=False),
        sa.Column('movie_id', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['release_id'], ['releases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['movie_id'], ['movies.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('release_id', 'movie_id'),
    )

    # Postgres' default names, matching the constraints originally created.
    op.create_foreign_key(
        'discs_release_id_fkey', 'discs', 'releases',
        ['release_id'], ['id'], ondelete='SET NULL',
    )
    op.create_foreign_key(
        'media_files_scan_id_fkey', 'media_files', 'scan_results',
        ['scan_id'], ['id'], ondelete='SET NULL',
    )
