"""media_file_inventory

Turns ``media_files`` into an inventory of every video in the library (P1):

- title links: ``movie_id`` -> movies.id and ``series_id`` -> series.id
  (ON DELETE SET NULL; documentaries and live performances are rows in
  ``movies``). The loose text ``assigned_to_type`` / ``assigned_to_id`` stay.
- placement: ``role`` (main / version / extra / episode / other),
  ``season_number``, ``episode_number``, ``episode_end_number`` and
  ``location`` (ingest / library / other). ``relative_path`` (already there)
  holds the library-root-relative path with forward slashes.
- technical metadata from a probe: ``container``, ``video_codec``,
  ``resolution_category``, ``width``, ``height``, ``hdr_format``,
  ``audio_codec``, ``audio_channels``, ``duration_ms``, ``bitrate``, plus
  ``probed_at`` / ``probe_error``. Full track lists keep going into the
  existing ``video_metadata`` / ``audio_tracks`` / ``subtitle_tracks``.
- ``missing_since``: when the reconcile scan last saw the file disappear
  (``is_available`` false).

Schema only: no data is rewritten. The inventory scan fills the columns.

Revision ID: 9c0d1e2f3a4b
Revises: 8b9c0d1e2f3a
Create Date: 2026-11-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c0d1e2f3a4b'
down_revision: Union[str, None] = '8b9c0d1e2f3a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, type) of every column this revision adds, in order.
NEW_COLUMNS = (
    ('movie_id', sa.Text()),
    ('series_id', sa.Text()),
    ('role', sa.Text()),
    ('season_number', sa.Integer()),
    ('episode_number', sa.Integer()),
    ('episode_end_number', sa.Integer()),
    ('location', sa.Text()),
    ('container', sa.Text()),
    ('video_codec', sa.Text()),
    ('resolution_category', sa.Text()),
    ('width', sa.Integer()),
    ('height', sa.Integer()),
    ('hdr_format', sa.Text()),
    ('audio_codec', sa.Text()),
    ('audio_channels', sa.Integer()),
    ('duration_ms', sa.BigInteger()),
    ('bitrate', sa.BigInteger()),
    ('probed_at', sa.DateTime(timezone=True)),
    ('probe_error', sa.Text()),
    ('missing_since', sa.DateTime(timezone=True)),
)

FOREIGN_KEYS = (
    ('fk_media_files_movie_id_movies', 'movies', 'movie_id'),
    ('fk_media_files_series_id_series', 'series', 'series_id'),
)

INDEXES = (
    ('ix_media_files_movie_id', ['movie_id']),
    ('ix_media_files_series_episode', ['series_id', 'season_number', 'episode_number']),
    ('ix_media_files_location', ['location']),
    ('ix_media_files_is_available', ['is_available']),
)


def upgrade() -> None:
    for name, type_ in NEW_COLUMNS:
        op.add_column('media_files', sa.Column(name, type_, nullable=True))
    for fk_name, target, column in FOREIGN_KEYS:
        op.create_foreign_key(fk_name, 'media_files', target, [column], ['id'], ondelete='SET NULL')
    for index_name, columns in INDEXES:
        op.create_index(index_name, 'media_files', columns)


def downgrade() -> None:
    for index_name, _ in reversed(INDEXES):
        op.drop_index(index_name, table_name='media_files')
    for fk_name, _, _ in reversed(FOREIGN_KEYS):
        op.drop_constraint(fk_name, 'media_files', type_='foreignkey')
    for name, _ in reversed(NEW_COLUMNS):
        op.drop_column('media_files', name)
