"""redesign_assignment_extra_files

Adds a surrogate id PK plus category/source/confirmed columns to
assignment_extra_files, replacing the bare (assignment_id, media_file_id)
composite-PK join table with one that can actually record what kind of
extra a file is and whether a human has confirmed it.

Revision ID: c3a7d891f256
Revises: 9e1c5b2a4f07
Create Date: 2026-08-23 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3a7d891f256'
down_revision: Union[str, None] = '9e1c5b2a4f07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Table has never had rows written to it in production (the only writer
    # was a dead no-op stub), so this is a safe drop-and-recreate rather than
    # an in-place ALTER of the composite primary key.
    op.drop_table('assignment_extra_files')

    op.create_table(
        'assignment_extra_files',
        sa.Column('id', sa.Text(), server_default=sa.text('(gen_random_uuid())::text'), nullable=False),
        sa.Column('assignment_id', sa.Text(), nullable=False),
        sa.Column('media_file_id', sa.Text(), nullable=False),
        sa.Column('category', sa.Text(), nullable=True),
        sa.Column('source', sa.Text(), nullable=True),
        sa.Column('confirmed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['assignment_id'], ['media_assignments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['media_file_id'], ['media_files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_assignment_extra_files_assignment_id'),
        'assignment_extra_files', ['assignment_id'], unique=False,
    )
    op.create_index(
        op.f('ix_assignment_extra_files_media_file_id'),
        'assignment_extra_files', ['media_file_id'], unique=False,
    )
    op.create_index(
        op.f('ix_assignment_extra_files_confirmed'),
        'assignment_extra_files', ['confirmed'], unique=False,
    )


def downgrade() -> None:
    op.drop_table('assignment_extra_files')
    op.create_table(
        'assignment_extra_files',
        sa.Column('assignment_id', sa.Text(), nullable=False),
        sa.Column('media_file_id', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['assignment_id'], ['media_assignments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['media_file_id'], ['media_files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('assignment_id', 'media_file_id'),
    )
