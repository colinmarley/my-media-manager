"""DB-backed triage layer for the ingress queue: grouped listing and bulk actions.

Grouped listings and bulk actions read the persisted `ingress_queue` table so items
detected before a restart stay groupable, pageable and triageable without re-scanning.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import String, case, cast, func, or_, select

from db.database import AsyncSessionLocal
from db.models import IngressQueueItem as DBQueueItem
from services.ingress_queue_service import (
    QUEUE_ALL_STATUSES,
    QUEUE_COMPLETED,
    QUEUE_IGNORED,
    VALID_CLASSIFICATION_OVERRIDES,
    queue_item_from_row,
)
from utils.logging import logger

MEDIA_TYPE_MOVIE = "movie"
MEDIA_TYPE_SERIES = "series"
MEDIA_TYPE_EPISODE = "episode"
MEDIA_TYPE_UNCLASSIFIED = "unclassified"
QUEUE_GROUP_MEDIA_TYPES = (MEDIA_TYPE_MOVIE, MEDIA_TYPE_SERIES, MEDIA_TYPE_EPISODE, MEDIA_TYPE_UNCLASSIFIED)

BULK_ACCEPT = "accept"
BULK_IGNORE = "ignore"
BULK_RETRY = "retry"
BULK_CLASSIFY = "classify"
BULK_ACTIONS = (BULK_ACCEPT, BULK_IGNORE, BULK_RETRY, BULK_CLASSIFY)
BULK_ACTION_STATUSES: Dict[str, Tuple[str, ...]] = {
    BULK_ACCEPT: tuple(
        status for status in QUEUE_ALL_STATUSES if status not in (QUEUE_COMPLETED, QUEUE_IGNORED)
    ),
    BULK_IGNORE: tuple(status for status in QUEUE_ALL_STATUSES if status != QUEUE_IGNORED),
    BULK_RETRY: ("pending", "needs_review", "failed"),
    BULK_CLASSIFY: ("pending", "auto_assigned", "needs_review", "failed"),
}

MAX_GROUP_PAGE_SIZE = 50
MAX_PREVIEW_ITEMS = 10
MAX_PREVIEW_ROWS = 200
MAX_GROUP_ITEMS = 1000

# Issue #34 grouping knobs: one group per parsed title inside a folder, or one per ingress folder.
QUEUE_GROUP_BY_TITLE = "parsed_title"
QUEUE_GROUP_BY_FOLDER = "source_folder"
QUEUE_GROUP_BY: Tuple[str, ...] = (QUEUE_GROUP_BY_TITLE, QUEUE_GROUP_BY_FOLDER)


def _matched(field: str) -> Any:
    """Read a JSON text field from best_match, falling back to parsed_info."""
    return func.coalesce(
        func.nullif(DBQueueItem.best_match[field].as_string(), ""),
        func.nullif(DBQueueItem.parsed_info[field].as_string(), ""),
    )


_MEDIA_TYPE = func.lower(_matched("media_type"))

GROUP_MEDIA_TYPE = case(
    (_MEDIA_TYPE.in_((MEDIA_TYPE_MOVIE, "movie_fallback")), MEDIA_TYPE_MOVIE),
    (_MEDIA_TYPE == MEDIA_TYPE_SERIES, MEDIA_TYPE_SERIES),
    (_MEDIA_TYPE == MEDIA_TYPE_EPISODE, MEDIA_TYPE_EPISODE),
    else_=MEDIA_TYPE_UNCLASSIFIED,
)
GROUP_PATH = func.coalesce(DBQueueItem.ingress_path, "")
GROUP_TITLE = func.lower(
    func.trim(func.regexp_replace(func.coalesce(_matched("title"), DBQueueItem.file_name), r"\s+", " ", "g"))
)
GROUP_EXPRS = (GROUP_MEDIA_TYPE, GROUP_PATH, GROUP_TITLE)


def group_exprs_for(group_by: str) -> Tuple[Any, ...]:
    """SQL grouping expressions; media type and ingress path always scope the group."""
    return (GROUP_MEDIA_TYPE, GROUP_PATH) if group_by == QUEUE_GROUP_BY_FOLDER else GROUP_EXPRS


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value is not None else None


def _earlier(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    return candidate if current is None or (candidate is not None and candidate < current) else current


def _later(current: Optional[str], candidate: Optional[str]) -> Optional[str]:
    return candidate if current is None or (candidate is not None and candidate > current) else current


def item_group_key(item: Dict[str, Any]) -> Tuple[str, str, str]:
    """Mirror GROUP_EXPRS in python so preview rows land in the group the query built."""
    best_match = item.get("best_match") or {}
    parsed_info = item.get("parsed_info") or {}
    media_type = str(best_match.get("media_type") or parsed_info.get("media_type") or "").lower()
    if media_type in (MEDIA_TYPE_MOVIE, "movie_fallback"):
        bucket = MEDIA_TYPE_MOVIE
    elif media_type == MEDIA_TYPE_SERIES:
        bucket = MEDIA_TYPE_SERIES
    elif media_type == MEDIA_TYPE_EPISODE:
        bucket = MEDIA_TYPE_EPISODE
    else:
        bucket = MEDIA_TYPE_UNCLASSIFIED
    title = " ".join(str(best_match.get("title") or parsed_info.get("title") or item.get("file_name") or "").split())
    return (bucket, str(item.get("ingress_path") or ""), title.lower())


class IngressTriageService:
    """Grouped ingress queue listing plus partial-success bulk actions."""

    def __init__(self, queue_service: Any, db_session_factory: Optional[Any] = None) -> None:
        self.queue_service = queue_service
        self.db_session_factory = (
            db_session_factory
            or getattr(queue_service, "db_session_factory", None)
            or AsyncSessionLocal
        )

    async def get_queue_groups(
        self,
        *,
        statuses: Optional[Sequence[str]] = None,
        media_types: Optional[Sequence[str]] = None,
        ingress_paths: Optional[Sequence[str]] = None,
        search: Optional[str] = None,
        limit: int = 25,
        offset: int = 0,
        preview_size: int = MAX_PREVIEW_ITEMS,
        group_by: str = QUEUE_GROUP_BY_TITLE,
    ) -> Dict[str, Any]:
        """Return Postgres-grouped queue rows: title/path/media_type with counts and previews."""
        group_by = str(group_by or QUEUE_GROUP_BY_TITLE).strip().lower()
        if group_by not in QUEUE_GROUP_BY:
            raise ValueError(f"Unsupported group_by '{group_by}', expected one of {', '.join(QUEUE_GROUP_BY)}")
        by_folder = group_by == QUEUE_GROUP_BY_FOLDER

        requested_statuses = [str(status) for status in (statuses or []) if status]
        page_size = max(1, min(int(limit or 25), MAX_GROUP_PAGE_SIZE))
        page_offset = max(0, int(offset or 0))
        preview_size = max(0, min(int(preview_size or MAX_PREVIEW_ITEMS), MAX_PREVIEW_ITEMS))

        filters = self._filters(media_types, ingress_paths, search)
        groups, status_counts = self._collect_groups(
            await self._fetch(self._group_statement(filters, group_by)), requested_statuses, group_by
        )

        page = groups[page_offset:page_offset + page_size]
        row_offset = sum(group["matching_count"] for group in groups[:page_offset])
        row_limit = min(sum(group["matching_count"] for group in page), MAX_PREVIEW_ROWS)
        previews = (
            await self._load_items(filters, requested_statuses, row_offset, row_limit, group_by) if row_limit else []
        )

        bucketed: Dict[Tuple[str, ...], List[Dict[str, Any]]] = {}
        for item in previews:
            key = item_group_key(item)
            bucketed.setdefault(key[:2] if by_folder else key, []).append(item)
        for group in page:
            key = (group["media_type"], group["ingress_path"])
            group["preview_items"] = bucketed.get(key if by_folder else key + (group["title"],), [])[:preview_size]

        return {
            "groups": page,
            "total_groups": len(groups),
            "total_items": sum(group["matching_count"] for group in groups),
            "status_counts": status_counts,
            "group_by": group_by,
            "limit": page_size,
            "offset": page_offset,
            "preview_size": preview_size,
        }

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
        """Apply accept/ignore/retry/classify to selected items or a whole group, item by item."""
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
        seen: set[str] = set()
        for item_id in targets:
            if not item_id or item_id in seen or item_id in excluded:
                continue
            seen.add(item_id)
            results.append(await self._apply_bulk_item(batch_id, history_extra, normalized_action, item_id, override))

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
        group: Optional[Dict[str, Any]],
        statuses: Optional[Sequence[str]] = None,
    ) -> List[str]:
        """Resolve a group selector (media_type/ingress_path/title, any subset) to queue item ids."""
        filters = []
        for expression, field in ((GROUP_MEDIA_TYPE, "media_type"), (GROUP_PATH, "ingress_path"), (GROUP_TITLE, "title")):
            value = (group or {}).get(field)
            if value is not None:
                filters.append(expression == str(value))
        if not filters:
            return []
        if statuses:
            filters.append(DBQueueItem.status.in_([str(status) for status in statuses]))

        rows = await self._fetch(select(DBQueueItem).where(*filters).limit(MAX_GROUP_ITEMS))
        self.queue_service.hydrate_items(rows)
        return [str(row.id) for row in rows if getattr(row, "id", None)]

    async def _apply_bulk_item(
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
                item_id,
                action,
                "skipped",
                error=f"Cannot {action} an item in status '{current_status}'",
                item_status=current_status,
            )

        try:
            if action == BULK_ACCEPT:
                updated = await self.queue_service.mark_complete(item_id, history_extra=history_extra)
            elif action == BULK_IGNORE:
                updated = await self.queue_service.mark_ignored(item_id, history_extra=history_extra)
            elif action == BULK_RETRY:
                updated = await self.queue_service.retry_item(item_id, history_extra=history_extra)
            else:
                updated = await self.queue_service.update_classification(
                    item_id,
                    override,
                    history_extra=history_extra,
                )
        except ValueError as exc:
            return self._result(item_id, action, "failed", error=str(exc))

        if updated is None:
            return self._result(item_id, action, "failed", error=f"Queue item '{item_id}' is no longer actionable")

        final_status = str(updated.status)
        if final_status == "failed":
            return self._result(item_id, action, "failed", error=updated.last_error, item_status=final_status)
        return self._result(item_id, action, "succeeded", item_status=final_status)

    @staticmethod
    def _result(
        item_id: str,
        action: str,
        status: str,
        error: Optional[str] = None,
        item_status: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "item_id": item_id,
            "action": action,
            "status": status,
            "item_status": item_status,
            "error": error,
        }

    def _filters(
        self,
        media_types: Optional[Sequence[str]],
        ingress_paths: Optional[Sequence[str]],
        search: Optional[str],
    ) -> List[Any]:
        filters: List[Any] = []
        if media_types:
            filters.append(GROUP_MEDIA_TYPE.in_([str(media_type) for media_type in media_types]))
        if ingress_paths:
            filters.append(GROUP_PATH.in_([str(path) for path in ingress_paths]))
        if search and str(search).strip():
            pattern = f"%{str(search).strip()}%"
            filters.append(or_(
                DBQueueItem.file_name.ilike(pattern),
                cast(DBQueueItem.file_path, String).ilike(pattern),
                GROUP_TITLE.ilike(pattern),
                cast(DBQueueItem.proposed_path, String).ilike(pattern),
            ))
        return filters

    def _group_statement(self, filters: Sequence[Any], group_by: str = QUEUE_GROUP_BY_TITLE) -> Any:
        labels = [GROUP_MEDIA_TYPE.label("media_type"), GROUP_PATH.label("ingress_path")]
        if group_by != QUEUE_GROUP_BY_FOLDER:
            labels.append(GROUP_TITLE.label("title"))
        statement = (
            select(
                *labels,
                DBQueueItem.status.label("status"),
                func.count().label("item_count"),
                func.min(DBQueueItem.confidence_score).label("min_confidence"),
                func.max(DBQueueItem.confidence_score).label("max_confidence"),
                func.min(DBQueueItem.queued_at).label("first_queued_at"),
                func.max(DBQueueItem.queued_at).label("last_queued_at"),
            )
            .group_by(*group_exprs_for(group_by), DBQueueItem.status)
            .order_by(*group_exprs_for(group_by))
        )
        return statement.where(*filters) if filters else statement

    def _collect_groups(
        self,
        rows: Sequence[Any],
        requested_statuses: Sequence[str],
        group_by: str = QUEUE_GROUP_BY_TITLE,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        by_folder = group_by == QUEUE_GROUP_BY_FOLDER
        groups: Dict[Tuple[str, str, Optional[str]], Dict[str, Any]] = {}
        status_counts: Dict[str, int] = {status: 0 for status in QUEUE_ALL_STATUSES}

        for row in rows:
            key = (
                str(row.media_type or MEDIA_TYPE_UNCLASSIFIED),
                str(row.ingress_path or ""),
                None if by_folder else str(row.title or ""),
            )
            group = groups.get(key)
            if group is None:
                group = {
                    "group_key": {"media_type": key[0], "ingress_path": key[1], "title": key[2]},
                    "media_type": key[0],
                    "ingress_path": key[1],
                    "title": key[2],
                    "item_count": 0,
                    "matching_count": 0,
                    "status_counts": {},
                    "confidence_min": None,
                    "confidence_max": None,
                    "first_queued_at": None,
                    "last_queued_at": None,
                    "preview_items": [],
                }
                groups[key] = group

            count = int(row.item_count or 0)
            status = str(row.status or "")
            group["item_count"] += count
            group["status_counts"][status] = group["status_counts"].get(status, 0) + count
            status_counts[status] = status_counts.get(status, 0) + count
            if not requested_statuses or status in requested_statuses:
                group["matching_count"] += count
            if row.min_confidence is not None and (
                group["confidence_min"] is None or int(row.min_confidence) < group["confidence_min"]
            ):
                group["confidence_min"] = int(row.min_confidence)
            if row.max_confidence is not None and (
                group["confidence_max"] is None or int(row.max_confidence) > group["confidence_max"]
            ):
                group["confidence_max"] = int(row.max_confidence)
            group["first_queued_at"] = _earlier(group["first_queued_at"], _iso(row.first_queued_at))
            group["last_queued_at"] = _later(group["last_queued_at"], _iso(row.last_queued_at))

        ranked = sorted(
            groups.values(),
            key=lambda group: (group["media_type"], group["ingress_path"], group["title"] or ""),
        )
        return [group for group in ranked if group["matching_count"] > 0], status_counts

    async def _load_items(
        self,
        filters: Sequence[Any],
        requested_statuses: Sequence[str],
        row_offset: int,
        row_limit: int,
        group_by: str = QUEUE_GROUP_BY_TITLE,
    ) -> List[Dict[str, Any]]:
        item_filters = list(filters)
        if requested_statuses:
            item_filters.append(DBQueueItem.status.in_(list(requested_statuses)))
        statement = select(DBQueueItem).order_by(
            *group_exprs_for(group_by),
            DBQueueItem.queued_at.desc(),
            DBQueueItem.file_name,
        ).offset(row_offset).limit(row_limit)
        rows = await self._fetch(statement.where(*item_filters) if item_filters else statement)

        self.queue_service.hydrate_items(rows)
        payloads = []
        for row in rows:
            payload = queue_item_from_row(row)
            if payload is not None:
                payloads.append(self.queue_service.get_item(payload["id"]) or payload)
        return payloads

    async def _hydrate_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Pull a DB-only queue row into the queue service so backlog items stay actionable."""
        hydrate = getattr(self.queue_service, "hydrate_item", None)
        return await hydrate(item_id) if hydrate else None

    async def _fetch(self, statement: Any) -> List[Any]:
        if self.db_session_factory is None:
            return []
        try:
            async with self.db_session_factory() as session:
                return list((await session.execute(statement)).all())
        except Exception as exc:
            logger.warning("Ingress queue triage query failed", error=str(exc))
            return []
