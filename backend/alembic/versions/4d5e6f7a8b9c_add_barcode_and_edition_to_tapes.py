"""add_barcode_and_edition_to_tapes

Catches the Tape schema up to Disc for two fields the mobile app's "Add
Tape" flow was missing relative to "Add Disc": a scannable barcode and a
free-text edition/release label. Tapes still deliberately have no
disc_sets/disc_media_links equivalent (multi-title linking and boxed-set
grouping stay disc-only per the mobile app's README) — this migration
only closes the barcode/edition gap, not the structural one.

Revision ID: 4d5e6f7a8b9c
Revises: 3c4d5e6f7a8b
Create Date: 2026-09-02 00:00:00.000001

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d5e6f7a8b9c'
down_revision: Union[str, None] = '3c4d5e6f7a8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tapes', sa.Column('barcode', sa.Text(), nullable=True))
    op.add_column('tapes', sa.Column('edition', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('tapes', 'edition')
    op.drop_column('tapes', 'barcode')
