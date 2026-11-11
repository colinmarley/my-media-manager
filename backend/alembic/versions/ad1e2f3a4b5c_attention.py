"""attention

The To-Do list (P2):

- ``media_files.needs_review`` (bool, default false, not null),
  ``review_note`` and ``reviewed_at``: a person's "take another look at this
  file" flag, set and cleared through
  ``PATCH /api/catalog/media-files/{id}/review``.
- ``attention_dismissals``: an item of the To-Do list someone dismissed.
  ``(kind, subject_type, subject_id)`` is unique. ``fingerprint`` is the fact
  that was dismissed (a rename item's current relative path, ...): when the
  fact changes the dismissal no longer applies. ``dismissed_until`` null means
  until the fact changes; otherwise it also lapses at that time.

Revision ID: ad1e2f3a4b5c
Revises: 9c0d1e2f3a4b
Create Date: 2026-11-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ad1e2f3a4b5c'
down_revision: Union[str, None] = '9c0d1e2f3a4b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, type, nullable, server default) of every media_files column this revision adds, in order.
MEDIA_FILE_COLUMNS = (
    ('needs_review', sa.Boolean(), False, sa.text('false')),
    ('review_note', sa.Text(), True, None),
    ('reviewed_at', sa.DateTime(timezone=True), True, None),
)

DISMISSALS_TABLE = 'attention_dismissals'
DISMISSALS_UNIQUE = 'uq_attention_dismissals_subject'


def upgrade() -> None:
    for name, type_, nullable, default in MEDIA_FILE_COLUMNS:
        op.add_column(
            'media_files',
            sa.Column(name, type_, nullable=nullable, server_default=default),
        )
    op.create_table(
        DISMISSALS_TABLE,
        sa.Column('id', sa.Text(), server_default=sa.text('(gen_random_uuid())::text'), nullable=False),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('subject_type', sa.Text(), nullable=False),
        sa.Column('subject_id', sa.Text(), nullable=False),
        sa.Column('fingerprint', sa.Text(), nullable=True),
        sa.Column('dismissed_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('kind', 'subject_type', 'subject_id', name=DISMISSALS_UNIQUE),
    )


def downgrade() -> None:
    op.drop_table(DISMISSALS_TABLE)
    for name, _, _, _ in reversed(MEDIA_FILE_COLUMNS):
        op.drop_column('media_files', name)
