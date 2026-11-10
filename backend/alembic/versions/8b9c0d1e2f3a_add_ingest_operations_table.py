"""add_ingest_operations_table

Adds `ingest_operations` (ingest redesign 6.3 / 6.7): one row per
filesystem step of executing a queue item's plan (move / mkdir / write_nfo).
The organizer writes a row before each step and updates it after, so a failed
step leaves the earlier ones on record, and undo can replay a queue item's
steps in reverse while each recorded destination still matches.

No foreign keys: like `ingress_processing_history`, these rows are a log and
must outlive (and never block on) the queue and assignment rows they name.

Revision ID: 8b9c0d1e2f3a
Revises: 7a8b9c0d1e2f
Create Date: 2026-11-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b9c0d1e2f3a'
down_revision: Union[str, None] = '7a8b9c0d1e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ingest_operations',
        sa.Column('id', sa.Text(), server_default=sa.text('(gen_random_uuid())::text'), nullable=False),
        sa.Column('queue_item_id', sa.Text(), nullable=True),
        sa.Column('assignment_id', sa.Text(), nullable=True),
        sa.Column('op', sa.Text(), nullable=False),
        sa.Column('src', sa.Text(), nullable=True),
        sa.Column('dst', sa.Text(), nullable=True),
        sa.Column('planned_dst', sa.Text(), nullable=True),
        sa.Column('size_before', sa.BigInteger(), nullable=True),
        sa.Column('status', sa.Text(), nullable=False, server_default='running'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('executed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('undone_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ingest_operations_queue_item_id', 'ingest_operations', ['queue_item_id'])
    op.create_index('ix_ingest_operations_assignment_id', 'ingest_operations', ['assignment_id'])


def downgrade() -> None:
    op.drop_index('ix_ingest_operations_assignment_id', table_name='ingest_operations')
    op.drop_index('ix_ingest_operations_queue_item_id', table_name='ingest_operations')
    op.drop_table('ingest_operations')
