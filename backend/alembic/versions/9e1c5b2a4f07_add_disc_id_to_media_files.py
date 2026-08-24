"""add_disc_id_to_media_files

Revision ID: 9e1c5b2a4f07
Revises: 21bea9fa707c
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e1c5b2a4f07'
down_revision: Union[str, None] = '21bea9fa707c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('media_files', sa.Column('disc_id', sa.Text(), nullable=True))
    op.create_index(op.f('ix_media_files_disc_id'), 'media_files', ['disc_id'], unique=False)
    op.create_foreign_key(
        'fk_media_files_disc_id_discs',
        'media_files', 'discs',
        ['disc_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_media_files_disc_id_discs', 'media_files', type_='foreignkey')
    op.drop_index(op.f('ix_media_files_disc_id'), table_name='media_files')
    op.drop_column('media_files', 'disc_id')
