"""Bulk triage actions for the ingress queue: accept / ignore / retry / classify.

Actions run item by item through `IngressQueueService` (so accepts still go through the
`AssignmentOrchestrator`) and report partial success. Each mutated item gets exactly one
`ingress_processing_history` row tagged with the batch id, the action and `source: "bulk"`.
"""

import uuid
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import IngressQueueItem as DBQueueItem
from services.ingress_queue_service import (
    QUEUE_ALL_STATUSES,
    QUEUE_COMPLETED,
    QUEUE_IGNORED,
    VALID_CLASSIFICATION_OVERRIDES,
)
from services.ingress_triage_service import GROUP_MEDIA_TYPE, GROUP_PATH, GROUP_TITLE, fetch_rows
from utils.logging import logger

BULK_ACCEPT = "accept"
BULK_IGNORE = "ignore"
BULK_RETRY = "retry"
BULK_CLASSIFY = "classify"
BULK_ACTIONS = (BULK_ACCEPT, BULK_IGNORE, BULK_RETRY, BULK_CLASSIFY)
BULK_ACTION_STATUSES: Dict[str, Sequence[str]] = {
    BULK_ACCEPT: tuple(status for status in QUEUE_ALL_STATUSES if status not in (QUEUE_COMPLETED, QUEUE_IGNORED)),
    BULK_IGNORE: tuple(status for status in QUEUE_ALL_STATUSES if status != QUEUE_IGNORED),
    BULK_RETRY: ("pending", "needs_review", "failed"),
    BULK_CLASSIFY: ("pending", "auto_assigned", "needs_review", "failed"),
}
MAX_GROUP_ITEMS = 1000

_GROUP_FIELDS = ((GROUP_MEDIA_TYPE, "media_type"), (GROUP_PATH, "ingress_path"), (GROUP_TITLE, "title"))


class IngressBulkService:
    """Applies one action to explicit queue items and/or every item of a persisted group."""

    def __init__(self, queue_service: Any, db_session_factory: Optional[Any] = None) -> None:
        self.queue_service = queue_service
        self.db_session_factory = (
            db_session_factory
            or getattr(queue_service, "db_session_factory", None)
            or AsyncSessionLocal
        )

    async def bulk_action(
        self,
        *,
        action: str,
        item_ids: Optional[Sequence[str]] = None,
        group: Optional[Dict[str, Any]] = None,
        statuses: Optional[Sequence[str]] = None,
        classification: Optional[str] = None,
        exclude_item_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """Run the batch and return per-item results; a bad action or no targets is a request error."""
        normalized_action = str(action or "").strip().lower()
        if normalized_action not in BULK_ACTIONS:
            return {"error": f"Unsupported bulk action: {action}"}

        override = None
        if normalized_action == BULK_CLASSIFY:
            override = str(classification or "").strip().lower() or None
            if override is not None and override not in VALID_CLASSIFICATION_OVERRIDES:
                return {"error": f"Unsupported classification override: {classification}"}

        targets = [str(item_id) for item_id in (item_ids or [])]
        if group:
            targets.extend(await self.resolve_group_item_ids(group, statuses=statuses))
        if not targets:
            return {"error": "Bulk actions require item_ids or a group selector"}

        excluded = {str(item_id) for item_id in (exclude_item_ids or [])}
        batch_id = str(uuid.uuid4())
        history_extra = {"batch_id": batch_id, "action": normalized_action, "source": "bulk"}

        results: List[Dict[str, Any]] = []
        seen: set = set()
        for item_id in targets:
            if not item_id or item_id in seen or item_id in excluded:
                continue
            seen.add(item_id)
            results.append(await self._apply_item(batch_id, history_extra, normalized_action, item_id, override))

        summary = {
            "batch_id": batch_id,
            "action": normalized_action,
            "requested": len(results),
            "succeeded": sum(1 for result in results if result["status"] == "succeeded"),
            "failed": sum(1 for result in results if result["status"] == "failed"),
            "skipped": sum(1 for result in results if result["status"] == "skipped"),
            "results": results,
        }
        logger.info(
            "Ingress bulk action finished",
            batch_id=batch_id,
            action=normalized_action,
            requested=summary["requested"],
            succeeded=summary["succeeded"],
            failed=summary["failed"],
            skipped=summary["skipped"],
        )
        return summary

    async def resolve_group_item_ids(
        self,
        group: Dict[str, Any],
        statuses: Optional[Sequence[str]] = None,
    ) -> List[str]:
        """Resolve a group selector (media_type / ingress_path / title, any subset) to queue item ids."""
        filters = [
            expression == str(group[field])
            for expression, field in _GROUP_FIELDS
            if group.get(field) is not None
        ]
        if not filters:
            return []
        if statuses:
            filters.append(DBQueueItem.status.in_([str(status) for status in statuses]))

        rows = await fetch_rows(self.db_session_factory, select(DBQueueItem).where(*filters).limit(MAX_GROUP_ITEMS))
        self.queue_service.hydrate_items(rows)
        return [str(row.id) for row in rows if getattr(row, "id", None)]

    async def _apply_item(
        self,
        batch_id: str,
        history_extra: Dict[str, Any],
        action: str,
        item_id: str,
        override: Optional[str],
    ) -> Dict[str, Any]:
        item = self.queue_service.get_item(item_id) or await self._hydrate_item(item_id)
        if item is None:
            return self._result(item_id, action, "failed", error="Queue item not found")

        current_status = str(item.get("status") or "")
        if current_status not in BULK_ACTION_STATUSES[action]:
            return self._result(
                item_id, action, "skipped",
                error=f"Cannot {action} an item in status '{current_status}'",
                item_status=current_status,
            )

        if action == BULK_ACCEPT:
            updated = await self.queue_service.mark_complete(item_id, history_extra=history_extra)
        elif action == BULK_IGNORE:
            updated = await self.queue_service.mark_ignored(item_id, history_extra=history_extra)
        elif action == BULK_RETRY:
            updated = await self.queue_service.retry_item(item_id, history_extra=history_extra)
        else:
            updated = await self.queue_service.update_classification(item_id, override, history_extra=history_extra)

        if updated is None:
            return self._result(item_id, action, "failed", error=f"Queue item '{item_id}' is no longer actionable")
        if updated.status == "failed":
            return self._result(item_id, action, "failed", error=updated.last_error, item_status=updated.status)
        return self._result(item_id, action, "succeeded", item_status=updated.status)

    async def _hydrate_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        rows = await fetch_rows(self.db_session_factory, select(DBQueueItem).where(DBQueueItem.id == item_id).limit(1))
        if not rows:
            return None
        self.queue_service.hydrate_items(rows)
        return self.queue_service.get_item(item_id)

    @staticmethod
    def _result(
        item_id: str,
        action: str,
        status: str,
        error: Optional[str] = None,
        item_status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {"item_id": item_id, "action": action, "status": status, "item_status": item_status, "error": error}
