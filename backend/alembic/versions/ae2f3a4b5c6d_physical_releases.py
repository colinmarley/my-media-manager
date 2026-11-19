"""physical_releases

Phase 1 of docs/architecture/PHYSICAL_RELEASES_AND_DISC_LINKING.md.

- ``disc_sets`` becomes the release (the thing that was bought): barcode,
  edition, packaging, publisher, release year, region, expected disc count,
  the case's storage location, photos, purchase date, condition, notes and
  ``raw_data``.
- ``release_contents``: what a release contains, one row per movie, series or
  season, with an optional episode range for a volume.
- ``discs``: ``content_role``, ``rip_intent`` (``rip`` by default, ``skip`` for
  a disc that is never meant to be ripped) and ``rip_skip_reason``.
- ``disc_media_links``: optional ``season_number`` / ``episode_start`` /
  ``episode_end`` scope.
- ``media_files``: ``release_id`` (for files whose exact disc is not known)
  and ``source_kind``.

Backfill: every disc without a set gets a one-disc ``loose`` release carrying
its title, barcode and edition. Only the ``set_id`` column points at it: the
disc's ``raw_data`` gets no ``setId``, so existing clients keep seeing a loose
disc as "not in a set". Files that already name a disc get that disc's release.

downgrade() detaches discs from the loose releases this revision made and
deletes those releases before dropping the columns.

Revision ID: ae2f3a4b5c6d
Revises: ad1e2f3a4b5c
Create Date: 2026-11-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'ae2f3a4b5c6d'
down_revision: Union[str, None] = 'ad1e2f3a4b5c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, type, nullable, server default) per table, in order.
DISC_SET_COLUMNS = (
    ('barcode', sa.Text(), True, None),
    ('edition', sa.Text(), True, None),
    ('packaging', sa.Text(), True, None),
    ('publisher', sa.Text(), True, None),
    ('release_year', sa.Integer(), True, None),
    ('region_code', sa.Text(), True, None),
    ('expected_disc_count', sa.Integer(), True, None),
    ('storage_type', sa.Text(), True, None),
    ('storage_id', sa.Text(), True, None),
    ('image_files', postgresql.JSONB(), True, None),
    ('purchase_date', sa.Text(), True, None),
    ('condition', sa.Text(), True, None),
    ('notes', sa.Text(), True, None),
    ('raw_data', postgresql.JSONB(), True, None),
)
DISC_COLUMNS = (
    ('content_role', sa.Text(), True, None),
    ('rip_intent', sa.Text(), False, sa.text("'rip'")),
    ('rip_skip_reason', sa.Text(), True, None),
)
DISC_LINK_COLUMNS = (
    ('season_number', sa.Integer(), True, None),
    ('episode_start', sa.Integer(), True, None),
    ('episode_end', sa.Integer(), True, None),
)
MEDIA_FILE_COLUMNS = (
    ('release_id', sa.Text(), True, None),
    ('source_kind', sa.Text(), True, None),
)
ADDED_COLUMNS = (
    ('disc_sets', DISC_SET_COLUMNS),
    ('discs', DISC_COLUMNS),
    ('disc_media_links', DISC_LINK_COLUMNS),
    ('media_files', MEDIA_FILE_COLUMNS),
)

CONTENTS_TABLE = 'release_contents'
CONTENTS_RELEASE_INDEX = 'ix_release_contents_release_id'
CONTENTS_MEDIA_INDEX = 'ix_release_contents_media'
DISC_SET_BARCODE_INDEX = 'ix_disc_sets_barcode'
MEDIA_FILE_RELEASE_INDEX = 'ix_media_files_release_id'
MEDIA_FILE_RELEASE_FK = 'media_files_release_id_fkey'

LOOSE = 'loose'

# One loose release per disc that has no set. The release id is generated per
# disc inside the CTE and written back to the disc's column and raw_data.
BACKFILL_LOOSE_RELEASES = f"""
WITH loose AS (
    SELECT id AS disc_id, (gen_random_uuid())::text AS release_id, title, barcode, edition
    FROM discs
    WHERE set_id IS NULL
), made AS (
    INSERT INTO disc_sets (id, title, barcode, edition, packaging, raw_data)
    SELECT release_id, title, barcode, edition, '{LOOSE}', '{{}}'::jsonb
    FROM loose
)
UPDATE discs d
SET set_id = loose.release_id
FROM loose
WHERE d.id = loose.disc_id
"""

BACKFILL_FILE_RELEASES = """
UPDATE media_files f
SET release_id = d.set_id
FROM discs d
WHERE f.disc_id = d.id AND d.set_id IS NOT NULL AND f.release_id IS NULL
"""

# Undo of BACKFILL_LOOSE_RELEASES (also covers loose releases made after the
# upgrade): detach the discs, then delete the loose releases.
DETACH_LOOSE_DISCS = f"""
UPDATE discs d
SET set_id = NULL
FROM disc_sets s
WHERE d.set_id = s.id AND s.packaging = '{LOOSE}'
"""
DELETE_LOOSE_RELEASES = f"DELETE FROM disc_sets WHERE packaging = '{LOOSE}'"


def upgrade() -> None:
    for table, columns in ADDED_COLUMNS:
        for name, type_, nullable, default in columns:
            op.add_column(table, sa.Column(name, type_, nullable=nullable, server_default=default))
    op.create_index(DISC_SET_BARCODE_INDEX, 'disc_sets', ['barcode'])
    op.create_index(MEDIA_FILE_RELEASE_INDEX, 'media_files', ['release_id'])
    op.create_foreign_key(
        MEDIA_FILE_RELEASE_FK, 'media_files', 'disc_sets', ['release_id'], ['id'], ondelete='SET NULL',
    )
    op.create_table(
        CONTENTS_TABLE,
        sa.Column('id', sa.Text(), server_default=sa.text('(gen_random_uuid())::text'), nullable=False),
        sa.Column('release_id', sa.Text(), nullable=False),
        sa.Column('media_type', sa.Text(), nullable=False),
        sa.Column('media_id', sa.Text(), nullable=False),
        sa.Column('season_number', sa.Integer(), nullable=True),
        sa.Column('episode_start', sa.Integer(), nullable=True),
        sa.Column('episode_end', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['release_id'], ['disc_sets.id'], ondelete='CASCADE'),
    )
    op.create_index(CONTENTS_RELEASE_INDEX, CONTENTS_TABLE, ['release_id'])
    op.create_index(CONTENTS_MEDIA_INDEX, CONTENTS_TABLE, ['media_type', 'media_id'])

    op.execute(BACKFILL_LOOSE_RELEASES)
    op.execute(BACKFILL_FILE_RELEASES)


def downgrade() -> None:
    op.execute(DETACH_LOOSE_DISCS)
    op.execute(DELETE_LOOSE_RELEASES)

    op.drop_index(CONTENTS_MEDIA_INDEX, table_name=CONTENTS_TABLE)
    op.drop_index(CONTENTS_RELEASE_INDEX, table_name=CONTENTS_TABLE)
    op.drop_table(CONTENTS_TABLE)
    op.drop_constraint(MEDIA_FILE_RELEASE_FK, 'media_files', type_='foreignkey')
    op.drop_index(MEDIA_FILE_RELEASE_INDEX, table_name='media_files')
    op.drop_index(DISC_SET_BARCODE_INDEX, table_name='disc_sets')
    for table, columns in reversed(ADDED_COLUMNS):
        for name, _, _, _ in reversed(columns):
            op.drop_column(table, name)
