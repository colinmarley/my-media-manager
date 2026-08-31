"""add_disc_sets_edition_media_links

Adds three pieces of disc data-modeling the catalog was missing (the
pre-existing `releases` table + `disc.media_id`/`mediaType` scalar can't
represent them):

  1. `disc_sets` table + `discs.set_id` FK — boxed sets grouping multiple
     physical discs (main feature + special features, theatrical vs.
     director's cut, a multi-disc season, etc.).
  2. `discs.edition` — free-text variant label (Special Edition, Director's
     Cut, ...).
  3. `disc_media_links` table — many-to-many disc <-> movie/series, for
     discs containing more than one title (e.g. a double-feature disc).
     Existing disc.raw_data.mediaId/mediaType (set by reassign-discs) is
     left untouched; this is an additive, independent mechanism.

Revision ID: 2b3c4d5e6f7a
Revises: 1a2b3c4d5e6f
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b3c4d5e6f7a'
down_revision: Union[str, None] = '1a2b3c4d5e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'disc_sets',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('discs', sa.Column('set_id', sa.Text(), nullable=True))
    op.add_column('discs', sa.Column('edition', sa.Text(), nullable=True))
    op.create_index(op.f('ix_discs_set_id'), 'discs', ['set_id'], unique=False)
    op.create_foreign_key(
        'fk_discs_set_id_disc_sets',
        'discs', 'disc_sets',
        ['set_id'], ['id'],
        ondelete='SET NULL',
    )

    op.create_table(
        'disc_media_links',
        sa.Column('disc_id', sa.Text(), nullable=False),
        sa.Column('media_type', sa.Text(), nullable=False),
        sa.Column('media_id', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['disc_id'], ['discs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('disc_id', 'media_type', 'media_id'),
    )
    op.create_index(op.f('ix_disc_media_links_media'), 'disc_media_links', ['media_type', 'media_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_disc_media_links_media'), table_name='disc_media_links')
    op.drop_table('disc_media_links')

    op.drop_constraint('fk_discs_set_id_disc_sets', 'discs', type_='foreignkey')
    op.drop_index(op.f('ix_discs_set_id'), table_name='discs')
    op.drop_column('discs', 'edition')
    op.drop_column('discs', 'set_id')

    op.drop_table('disc_sets')
