"""add_tapes_table_and_media_file_tape_id

Adds the `tapes` catalog table (physical VHS/VHS-C/Mini DV tapes owned —
same first-class-entity treatment as `discs`) and a media_files.tape_id
FK linking a digitized file back to the tape it came from.

Revision ID: 7f2e9c04b8a1
Revises: c3a7d891f256
Create Date: 2026-08-23 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '7f2e9c04b8a1'
down_revision: Union[str, None] = 'c3a7d891f256'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tapes',
        sa.Column('id', sa.Text(), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('tape_type', sa.Text(), nullable=True),
        sa.Column('tape_label', sa.Text(), nullable=True),
        sa.Column('brand', sa.Text(), nullable=True),
        sa.Column('condition', sa.Text(), nullable=True),
        sa.Column('recording_speed', sa.Text(), nullable=True),
        sa.Column('label_notes', sa.Text(), nullable=True),
        sa.Column('purchase_date', sa.Text(), nullable=True),
        sa.Column('video_files', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=True),
        sa.Column('image_files', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=True),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.add_column('media_files', sa.Column('tape_id', sa.Text(), nullable=True))
    op.create_index(op.f('ix_media_files_tape_id'), 'media_files', ['tape_id'], unique=False)
    op.create_foreign_key(
        'fk_media_files_tape_id_tapes',
        'media_files', 'tapes',
        ['tape_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_media_files_tape_id_tapes', 'media_files', type_='foreignkey')
    op.drop_index(op.f('ix_media_files_tape_id'), table_name='media_files')
    op.drop_column('media_files', 'tape_id')
    op.drop_table('tapes')
