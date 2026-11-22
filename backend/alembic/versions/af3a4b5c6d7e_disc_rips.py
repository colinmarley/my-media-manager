"""disc_rips

Rip records pushed by disc-ripper-service (api/rips.py).

- ``disc_rips``: one row per rip job of a physical disc — which catalogued
  disc and release, what was declared (title, TMDB/IMDb id, season), what the
  disc reported about itself (volume label, fingerprint, drive, MakeMKV
  version), every title on the disc, and the manifest as received.
- ``disc_rip_titles``: one row per output file — the disc title it came from,
  what it was declared to be (content type, season, episode range, TMDB
  episode id), where it was delivered, its size / sha256 / read errors, and
  the ``media_files`` row it became.

No backfill: rips made before this revision have no record.

Revision ID: af3a4b5c6d7e
Revises: ae2f3a4b5c6d
Create Date: 2026-11-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'af3a4b5c6d7e'
down_revision: Union[str, None] = 'ae2f3a4b5c6d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RIPS_TABLE = 'disc_rips'
TITLES_TABLE = 'disc_rip_titles'
TITLES_UNIQUE = 'uq_disc_rip_titles_rip_title_seq'

# index name -> (table, columns)
INDEXES = {
    'ix_disc_rips_disc_id': (RIPS_TABLE, ['disc_id']),
    'ix_disc_rips_release_id': (RIPS_TABLE, ['release_id']),
    'ix_disc_rips_fingerprint': (RIPS_TABLE, ['fingerprint']),
    'ix_disc_rip_titles_rip_id': (TITLES_TABLE, ['rip_id']),
    'ix_disc_rip_titles_delivered_path': (TITLES_TABLE, ['delivered_path']),
    'ix_disc_rip_titles_media_file_id': (TITLES_TABLE, ['media_file_id']),
}


def _timestamps():
    return (
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        RIPS_TABLE,
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('schema_version', sa.Integer(), nullable=True),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('disc_id', sa.Text(), nullable=True),
        sa.Column('release_id', sa.Text(), nullable=True),
        sa.Column('media_type', sa.Text(), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('year', sa.Integer(), nullable=True),
        sa.Column('imdb_id', sa.Text(), nullable=True),
        sa.Column('tmdb_id', sa.Integer(), nullable=True),
        sa.Column('season', sa.Integer(), nullable=True),
        sa.Column('disc_type', sa.Text(), nullable=True),
        sa.Column('reported_disc_type', sa.Text(), nullable=True),
        sa.Column('disc_name', sa.Text(), nullable=True),
        sa.Column('volume_label', sa.Text(), nullable=True),
        sa.Column('fingerprint', sa.Text(), nullable=True),
        sa.Column('fingerprint_algo', sa.Text(), nullable=True),
        sa.Column('drive_model', sa.Text(), nullable=True),
        sa.Column('makemkv_version', sa.Text(), nullable=True),
        sa.Column('ripper_host', sa.Text(), nullable=True),
        sa.Column('rip_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rip_finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('scan_titles', postgresql.JSONB(), nullable=True),
        sa.Column('manifest', postgresql.JSONB(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['disc_id'], ['discs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['release_id'], ['disc_sets.id'], ondelete='SET NULL'),
    )
    op.create_table(
        TITLES_TABLE,
        sa.Column('id', sa.Text(), server_default=sa.text('(gen_random_uuid())::text'), nullable=False),
        sa.Column('rip_id', sa.Text(), nullable=False),
        sa.Column('title_index', sa.Integer(), nullable=False),
        sa.Column('file_seq', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('status', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('content_type', sa.Text(), nullable=True),
        sa.Column('is_main_feature', sa.Boolean(), nullable=True),
        sa.Column('season', sa.Integer(), nullable=True),
        sa.Column('episode', sa.Integer(), nullable=True),
        sa.Column('episode_end', sa.Integer(), nullable=True),
        sa.Column('tmdb_episode_id', sa.Integer(), nullable=True),
        sa.Column('episode_name', sa.Text(), nullable=True),
        sa.Column('custom_name', sa.Text(), nullable=True),
        sa.Column('makemkv_filename', sa.Text(), nullable=True),
        sa.Column('delivered_path', sa.Text(), nullable=True),
        sa.Column('ingest_relative_path', sa.Text(), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('sha256', sa.Text(), nullable=True),
        sa.Column('duration_seconds', sa.Float(), nullable=True),
        sa.Column('read_errors', sa.Integer(), nullable=True),
        sa.Column('messages', postgresql.JSONB(), nullable=True),
        sa.Column('probe', postgresql.JSONB(), nullable=True),
        sa.Column('rip_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rip_finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('media_file_id', sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['rip_id'], [f'{RIPS_TABLE}.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['media_file_id'], ['media_files.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('rip_id', 'title_index', 'file_seq', name=TITLES_UNIQUE),
    )
    for name, (table, columns) in INDEXES.items():
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, (table, _columns) in reversed(list(INDEXES.items())):
        op.drop_index(name, table_name=table)
    op.drop_table(TITLES_TABLE)
    op.drop_table(RIPS_TABLE)
