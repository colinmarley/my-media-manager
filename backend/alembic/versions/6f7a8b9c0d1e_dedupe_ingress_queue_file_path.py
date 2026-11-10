"""dedupe_ingress_queue_file_path

The ingress queue lived in memory and was written to `ingress_queue` as a
log: every watcher restart or re-scan inserted a fresh row (new UUID) for
files that already had one. On 2026-11-08 production held 26,687 rows for
9,577 distinct paths (up to 9 per file).

The queue now restores itself from this table on startup and persists by
path, so `file_path` must be unique. This migration keeps the newest row per
path (by queued_at, then created_at), deletes the rest, and adds the unique
index. `ingress_processing_history.queue_item_id` has no FK and keeps
pointing at the removed ids, which is fine: history rows are snapshots.

Revision ID: 6f7a8b9c0d1e
Revises: 5e6f7a8b9c0d
Create Date: 2026-11-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6f7a8b9c0d1e'
down_revision: Union[str, None] = '5e6f7a8b9c0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Prefer completed rows, then the most recently queued, so an organized file's
    # record survives over a stale needs_review duplicate.
    op.execute(
        """
        DELETE FROM ingress_queue q
        USING (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY file_path
                       ORDER BY (status = 'completed') DESC,
                                queued_at DESC NULLS LAST,
                                created_at DESC NULLS LAST,
                                id DESC
                   ) AS rn
            FROM ingress_queue
        ) ranked
        WHERE q.id = ranked.id AND ranked.rn > 1
        """
    )
    op.create_index(
        'uq_ingress_queue_file_path',
        'ingress_queue',
        ['file_path'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('uq_ingress_queue_file_path', table_name='ingress_queue')
