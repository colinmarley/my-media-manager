"""add_storage_location_to_discs_and_tapes

Adds an optional physical storage location to discs and tapes — where a
loose disc/tape lives (a labeled box or binder on a shelf), as opposed to
`disc_sets`/`edition` which describe the *content* grouping. Two flattened
columns per table (`storage_type`, `storage_id`) rather than a free-text
field, matching the existing pattern of flattening fields the app needs to
filter/sort on directly (see `_apply_disc_fields`/`_apply_tape_fields` in
api/catalog.py) — the mobile app's beta shelf/binder views group and sort
by this field, so it needs to be queryable, not buried in raw_data.

`storage_id` is a free-text label (e.g. "MED0001") rather than an enum —
the "MED00##" numbering is a client-side convention, not enforced here.

Revision ID: 3c4d5e6f7a8b
Revises: 2b3c4d5e6f7a
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c4d5e6f7a8b'
down_revision: Union[str, None] = '2b3c4d5e6f7a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('discs', sa.Column('storage_type', sa.Text(), nullable=True))
    op.add_column('discs', sa.Column('storage_id', sa.Text(), nullable=True))
    op.create_index(op.f('ix_discs_storage_id'), 'discs', ['storage_id'], unique=False)

    op.add_column('tapes', sa.Column('storage_type', sa.Text(), nullable=True))
    op.add_column('tapes', sa.Column('storage_id', sa.Text(), nullable=True))
    op.create_index(op.f('ix_tapes_storage_id'), 'tapes', ['storage_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_tapes_storage_id'), table_name='tapes')
    op.drop_column('tapes', 'storage_id')
    op.drop_column('tapes', 'storage_type')

    op.drop_index(op.f('ix_discs_storage_id'), table_name='discs')
    op.drop_column('discs', 'storage_id')
    op.drop_column('discs', 'storage_type')
