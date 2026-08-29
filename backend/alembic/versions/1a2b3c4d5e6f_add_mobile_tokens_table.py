"""add_mobile_tokens_table

Adds the `mobile_tokens` table: long-lived bearer tokens issued to the
mobile app after password login, parallel to the existing cookie-based
`sessions` table used by the web app.

Revision ID: 1a2b3c4d5e6f
Revises: 7f2e9c04b8a1
Create Date: 2026-08-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1a2b3c4d5e6f'
down_revision: Union[str, None] = '7f2e9c04b8a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mobile_tokens',
        sa.Column('token', sa.Text(), nullable=False),
        sa.Column('device_name', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('token'),
    )


def downgrade() -> None:
    op.drop_table('mobile_tokens')
