"""
Data retention job — keeps the database from growing without limit.

Deletes expired sessions and mobile tokens, old ingress processing history,
and old *completed* ingress queue items. Queue items in any other status
(needs_review, failed, pending, …) are never touched.

Runs once on startup and then every ``retention_interval_hours`` from the
lifespan in main.py. With ``retention_dry_run`` enabled it only counts the
rows it would delete.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy import delete, func, select

from config.settings import settings
from db.models import IngressProcessingHistory, IngressQueueItem, MobileToken, Session
from utils.logging import logger


def retention_targets(
    now: datetime,
    *,
    history_days: int,
    completed_queue_days: int,
) -> Dict[str, tuple]:
    """Return ``{name: (model, where_clause)}`` for every retention target."""
    history_cutoff = now - timedelta(days=history_days)
    queue_cutoff = now - timedelta(days=completed_queue_days)
    return {
        "sessions": (Session, Session.expires_at < now),
        "mobile_tokens": (MobileToken, MobileToken.expires_at < now),
        "ingress_processing_history": (
            IngressProcessingHistory,
            IngressProcessingHistory.created_at < history_cutoff,
        ),
        "ingress_queue_completed": (
            IngressQueueItem,
            (IngressQueueItem.status == "completed")
            & (func.coalesce(IngressQueueItem.processed_at, IngressQueueItem.updated_at) < queue_cutoff),
        ),
    }


async def run_retention(
    db_session_factory,
    *,
    now: Optional[datetime] = None,
    dry_run: Optional[bool] = None,
    history_days: Optional[int] = None,
    completed_queue_days: Optional[int] = None,
) -> Dict[str, int]:
    """Run one retention pass and return the row count per target."""
    now = now or datetime.now(timezone.utc)
    dry_run = settings.retention_dry_run if dry_run is None else dry_run
    targets = retention_targets(
        now,
        history_days=settings.retention_ingress_history_days if history_days is None else history_days,
        completed_queue_days=(
            settings.retention_completed_queue_days if completed_queue_days is None else completed_queue_days
        ),
    )

    counts: Dict[str, int] = {}
    async with db_session_factory() as db:
        for name, (model, where) in targets.items():
            if dry_run:
                result = await db.execute(select(func.count()).select_from(model).where(where))
                counts[name] = int(result.scalar() or 0)
            else:
                result = await db.execute(delete(model).where(where))
                counts[name] = int(result.rowcount or 0)
        if not dry_run:
            await db.commit()

    logger.info(
        "Retention dry run: rows that would be deleted" if dry_run else "Retention: rows deleted",
        dry_run=dry_run,
        **counts,
    )
    return counts


async def run_retention_loop(db_session_factory, interval_hours: Optional[int] = None):
    """Run retention now, then once per interval, until cancelled."""
    interval_seconds = max(1, interval_hours or settings.retention_interval_hours) * 3600
    while True:
        try:
            await run_retention(db_session_factory)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Retention job failed", error=str(exc))
        await asyncio.sleep(interval_seconds)
