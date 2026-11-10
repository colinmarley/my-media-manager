"""dedupe_ingress_queue_file_path

The ingress queue lived in memory and was written to `ingress_queue` as a
log: every watcher restart or re-scan inserted a fresh row (new UUID) for
files that already had one. On 2026-11-08 production held 26,687 rows for
9,577 distinct paths (up to 9 per file).

The queue now restores itself from this table on startup and persists by
path, so `file_path` must be unique. This migration keeps the newest row per
path, deletes the rest, and adds the unique index. A row a human made a
decision on (organized, ignored, or manually dismissed) wins over a newer
duplicate: re-scans re-queued dismissed files as fresh needs_review rows, and
on 2026-11-09 newest-wins would have brought back 625 of 1,056 dismissals.
Ties go to the most recently queued row.

Dismissals made before this change were stored with attempts = 1, which the
automatic retry loop (failed and attempts < 3) would pick up as soon as the
queue is restored from this table. They are raised to 3, the value
`IngressQueueService.mark_failed` now writes.

`ingress_processing_history.queue_item_id` has no FK and keeps pointing at
the removed ids, which is fine: history rows are snapshots.

Revision ID: 7a8b9c0d1e2f
Revises: 6f7a8b9c0d1e
Create Date: 2026-11-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7a8b9c0d1e2f'
down_revision: Union[str, None] = '6f7a8b9c0d1e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The message the review UI sends with a dismiss (`useIngressQueueActions.ts`).
_DISMISSED = "status = 'failed' AND last_error = 'Manually dismissed'"
# `IngressQueueService.MANUAL_FAILURE_ATTEMPTS`; the retry loop skips failed rows at or above it.
_MANUAL_FAILURE_ATTEMPTS = 3


def upgrade() -> None:
    # Prefer rows a decision was made on (organized, ignored or dismissed), then the most
    # recently queued, so that decision survives over a stale needs_review duplicate.
    op.execute(
        f"""
        DELETE FROM ingress_queue q
        USING (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY file_path
                       ORDER BY (status IN ('completed', 'ignored') OR ({_DISMISSED})) DESC,
                                queued_at DESC NULLS LAST,
                                created_at DESC NULLS LAST,
                                id DESC
                   ) AS rn
            FROM ingress_queue
        ) ranked
        WHERE q.id = ranked.id AND ranked.rn > 1
        """
    )
    op.execute(
        f"""
        UPDATE ingress_queue
        SET attempts = {_MANUAL_FAILURE_ATTEMPTS}
        WHERE {_DISMISSED} AND COALESCE(attempts, 0) < {_MANUAL_FAILURE_ATTEMPTS}
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
