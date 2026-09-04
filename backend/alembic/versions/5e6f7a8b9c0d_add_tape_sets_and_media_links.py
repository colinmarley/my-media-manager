"""add_tape_sets_and_media_links

Extends the boxed-set and multi-title-linking mechanism added for discs in
2b3c4d5e6f7a to tapes, closing the gap where "Tapes don't support
multi-title linking or boxed sets" (media-manager-mobile's own README).

`disc_sets` needs no schema change — it has no FK to discs, just `id`/
`title`/timestamps, so it's already media-type-generic despite the name.
Only two things are tape-specific and missing:

  1. `tapes.set_id` FK -> disc_sets — mirrors `discs.set_id`.
  2. `tape_media_links` table — many-to-many tape <-> movie/series, mirroring
     `disc_media_links` for tapes containing more than one recording. The
     pre-existing scalar `tape.raw_data.mediaId/mediaType` is left untouched.

Revision ID: 5e6f7a8b9c0d
Revises: 4d5e6f7a8b9c
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5e6f7a8b9c0d'
down_revision: Union[str, None] = '4d5e6f7a8b9c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tapes', sa.Column('set_id', sa.Text(), nullable=True))
    op.create_index(op.f('ix_tapes_set_id'), 'tapes', ['set_id'], unique=False)
    op.create_foreign_key(
        'fk_tapes_set_id_disc_sets',
        'tapes', 'disc_sets',
        ['set_id'], ['id'],
        ondelete='SET NULL',
    )

    op.create_table(
        'tape_media_links',
        sa.Column('tape_id', sa.Text(), nullable=False),
        sa.Column('media_type', sa.Text(), nullable=False),
        sa.Column('media_id', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tape_id'], ['tapes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('tape_id', 'media_type', 'media_id'),
    )
    op.create_index(op.f('ix_tape_media_links_media'), 'tape_media_links', ['media_type', 'media_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_tape_media_links_media'), table_name='tape_media_links')
    op.drop_table('tape_media_links')

    op.drop_constraint('fk_tapes_set_id_disc_sets', 'tapes', type_='foreignkey')
    op.drop_index(op.f('ix_tapes_set_id'), table_name='tapes')
    op.drop_column('tapes', 'set_id')
