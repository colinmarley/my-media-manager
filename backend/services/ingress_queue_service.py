"""
Ingress queue service for automated media pipeline.

Maintains in-memory queue state for detected ingress files and exposes
operations for processing, retrying, and tracking status transitions.
"""

import asyncio
import os
import re
import shutil
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, fields as dataclass_fields
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from config.settings import settings
from db.models import IngressProcessingHistory as DBIngressProcessingHistory
from db.models import IngressQueueItem as DBIngressQueueItem
from services.filename_parser import FilenameParser
from utils.logging import logger

try:
    from pymediainfo import MediaInfo as _MediaInfo
    _MEDIAINFO_AVAILABLE = True
except ImportError:
    _MEDIAINFO_AVAILABLE = False


def _get_file_duration(file_path: str) -> Optional[float]:
    """Return duration in milliseconds for a media file, or None on failure."""
    if not _MEDIAINFO_AVAILABLE or not os.path.isfile(file_path):
        return None
    try:
        info = _MediaInfo.parse(file_path)
        for track in info.tracks:
            if track.track_type == "General" and track.duration is not None:
                return float(track.duration)
    except Exception:
        logger.warning("MediaInfo duration lookup failed", file_path=file_path, exc_info=True)
    return None


QUEUE_PENDING = "pending"
QUEUE_PROCESSING = "processing"
QUEUE_AUTO_ASSIGNED = "auto_assigned"
QUEUE_NEEDS_REVIEW = "needs_review"
QUEUE_FAILED = "failed"
QUEUE_COMPLETED = "completed"
QUEUE_IGNORED = "ignored"
QUEUE_ACTIVE_STATUSES = {QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_AUTO_ASSIGNED}
QUEUE_TERMINAL_STATUSES = {QUEUE_COMPLETED, QUEUE_IGNORED}
QUEUE_ALL_STATUSES = (
    QUEUE_PENDING,
    QUEUE_PROCESSING,
    QUEUE_AUTO_ASSIGNED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_FAILED,
    QUEUE_COMPLETED,
    QUEUE_IGNORED,
)
VALID_CLASSIFICATION_OVERRIDES = {"main_feature", "special_feature", "alternate_version"}


class QueueItemBusy(ValueError):
    """The auto-processor holds this item (status `processing`); acting on it now would be overwritten."""


def _to_epoch_seconds(value: Any) -> Optional[float]:
    """Normalize persisted timestamp values (datetime/epoch/ISO) to epoch seconds."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        return value.timestamp()
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


def queue_item_from_row(row: Any) -> Optional[Dict[str, Any]]:
    """Convert a persisted ingress_queue row (ORM row or mapping) into queue-item fields.

    Lets queue state be rebuilt from Postgres so items detected before a restart stay triageable.
    """
    if isinstance(row, IngressQueueItem):
        return row.to_dict()

    read = row.get if isinstance(row, dict) else (lambda key, default=None: getattr(row, key, default))
    item_id = read("id")
    file_path = read("file_path")
    if not item_id or not file_path:
        return None

    parsed_info = dict(read("parsed_info") or {})
    return {
        "id": str(item_id),
        "file_path": str(file_path),
        "file_name": str(read("file_name") or os.path.basename(str(file_path))),
        "ingress_path": str(read("ingress_path") or ""),
        "file_size": int(read("file_size") or 0),
        "detected_at": _to_epoch_seconds(read("detected_at")) or 0.0,
        "queued_at": _to_epoch_seconds(read("queued_at")) or 0.0,
        "status": str(read("status") or QUEUE_PENDING),
        "priority": int(read("priority") or 5),
        "attempts": int(read("attempts") or 0),
        "last_attempt": _to_epoch_seconds(read("last_attempt")),
        "processed_at": _to_epoch_seconds(read("processed_at")),
        "last_error": read("last_error"),
        "confidence_score": read("confidence_score"),
        "assignment_id": read("assignment_id"),
        "parsed_info": parsed_info,
        "best_match": dict(read("best_match") or {}),
        "match_candidates": list(read("match_candidates") or []),
        "media_duration_ms": read("media_duration_ms"),
        "proposed_path": read("proposed_path"),
        "classification_override": parsed_info.get("classification_override"),
    }


@dataclass
class IngressQueueItem:
    id: str
    file_path: str
    file_name: str
    ingress_path: str
    file_size: int
    detected_at: float
    queued_at: float
    status: str
    priority: int
    attempts: int = 0
    last_attempt: Optional[float] = None
    processed_at: Optional[float] = None
    last_error: Optional[str] = None
    confidence_score: Optional[int] = None
    assignment_id: Optional[str] = None
    parsed_info: Optional[Dict[str, Any]] = None
    best_match: Optional[Dict[str, Any]] = None
    match_candidates: Optional[List[Dict[str, Any]]] = None
    media_duration_ms: Optional[float] = None
    proposed_path: Optional[str] = None
    is_alternate_version: bool = False
    version_number: Optional[int] = None
    special_feature_number: Optional[int] = None
    unknown_episode_label: Optional[str] = None
    classification_override: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


QUEUE_ITEM_FIELDS = {field.name for field in dataclass_fields(IngressQueueItem)}


class IngressQueueService:
    """In-memory queue and processing coordinator for ingress files."""

    def __init__(
        self,
        parser: Optional[FilenameParser] = None,
        auto_matcher_service: Optional[Any] = None,
        assignment_orchestrator: Optional[Any] = None,
        auto_assign_threshold: int = 80,
        db_session_factory: Optional[Any] = None,
    ):
        self.parser = parser or FilenameParser()
        self.auto_matcher_service = auto_matcher_service
        self.assignment_orchestrator = assignment_orchestrator
        self.auto_assign_threshold = max(0, min(auto_assign_threshold, 100))
        self.db_session_factory = db_session_factory
        self.lock = threading.RLock()

        self.items_by_id: Dict[str, IngressQueueItem] = {}
        self.item_order: List[str] = []
        self.path_to_item_id: Dict[str, str] = {}
        # file_path -> (row id, status) for every persisted row, loaded at startup and kept current by
        # _persist_queue_item, so a re-detected file after a restart updates its row (and an ignored file
        # stays ignored) instead of getting a fresh pending row.
        self.persisted_paths: Dict[str, Tuple[str, str]] = {}
        self.processing_history: List[Dict[str, Any]] = []

        # Match each stored proposal was resolved with, when it differs from the
        # matcher's own result (a companion file inheriting its folder's match,
        # an episode completed from the filename). Rebuilt by every refresh.
        self._proposal_matches: Dict[str, Dict[str, Any]] = {}
        # Items whose destination is being resolved and organized right now; a
        # proposal refresh running in a worker thread must not touch them.
        self._organizing_ids: Set[str] = set()
        # One proposal refresh at a time, so an older snapshot can never be
        # written over a newer one.
        self._proposal_refresh_lock = threading.Lock()

    @staticmethod
    def _to_datetime(value: Optional[float]) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            return None

    def _build_history_item(
        self,
        item: IngressQueueItem,
        event: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        history_item: Dict[str, Any] = {
            "event": event,
            "item_id": item.id,
            "file_path": item.file_path,
            "file_name": item.file_name,
            "ingress_path": item.ingress_path,
            "status": item.status,
            "priority": item.priority,
            "attempts": item.attempts,
            "last_error": item.last_error,
            "confidence_score": item.confidence_score,
            "assignment_id": item.assignment_id,
            "parsed_info": dict(item.parsed_info or {}),
            "best_match": dict(item.best_match or {}),
            "match_candidates": list(item.match_candidates or []),
            "media_duration_ms": item.media_duration_ms,
            "proposed_path": item.proposed_path,
            "is_alternate_version": bool(item.is_alternate_version),
            "version_number": item.version_number,
            "special_feature_number": item.special_feature_number,
            "unknown_episode_label": item.unknown_episode_label,
            "classification_override": item.classification_override,
            "queued_at": item.queued_at,
            "processed_at": item.processed_at,
            "recorded_at": time.time(),
        }
        resolved_match = self._proposal_matches.get(item.id)
        if resolved_match:
            history_item["resolved_match"] = dict(resolved_match)
        if extra:
            history_item.update(extra)
        return history_item

    async def _record_history_event(
        self,
        item: IngressQueueItem,
        event: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        history_item = self._build_history_item(item, event, extra)

        with self.lock:
            self.processing_history.append(history_item)

        await self._persist_processing_history(history_item)
        logger.info(
            "Ingress history event recorded",
            item_id=item.id,
            history_event=event,
            status=item.status,
            assignment_id=item.assignment_id,
        )
        return history_item

    @staticmethod
    def _is_video_file_path(file_path: str) -> bool:
        ext = os.path.splitext(file_path)[1].lower()
        return ext in {value.lower() for value in settings.supported_video_extensions}

    @staticmethod
    def _infer_ingress_root(file_path: str, explicit_ingress_path: Optional[str] = None) -> str:
        if explicit_ingress_path:
            return os.path.abspath(explicit_ingress_path)

        normalized_path = os.path.abspath(file_path)
        candidates = [os.path.abspath(path) for path in settings.ingress_default_paths if path]
        matches = [path for path in candidates if IngressQueueService._is_within_path(normalized_path, path)]
        if matches:
            return max(matches, key=len)

        return os.path.dirname(normalized_path)

    def add_from_watcher(
        self,
        queued_file: Any,
        priority: int = 5,
    ) -> Optional[IngressQueueItem]:
        """Add a queued watcher file to the ingress queue."""
        if not self._is_video_file_path(queued_file.file_path):
            logger.info(
                "Skipping non-video ingress file",
                file_path=queued_file.file_path,
            )
            return None

        with self.lock:
            existing_id = self.path_to_item_id.get(queued_file.file_path)
            if existing_id is not None:
                existing_item = self.items_by_id[existing_id]
                if existing_item.status == QUEUE_IGNORED:
                    # A reviewer decided to ignore this file; seeing it again doesn't undo that.
                    logger.info("Ignored ingress file re-detected; leaving it ignored", item_id=existing_id,
                                file_path=queued_file.file_path)
                    return existing_item
                if existing_item.status not in {QUEUE_PENDING, QUEUE_PROCESSING}:
                    existing_item.status = QUEUE_PENDING
                    existing_item.last_error = None
                    existing_item.processed_at = None
                    existing_item.queued_at = time.time()
                    existing_item.priority = max(1, min(priority, 10))
                return existing_item

            persisted = self.persisted_paths.get(queued_file.file_path)
            if persisted is not None and persisted[1] == QUEUE_IGNORED:
                # Not in memory (e.g. after a restart) but ignored in Postgres: don't resurrect it.
                logger.info("Ignored ingress file re-detected after restart; skipping", item_id=persisted[0],
                            file_path=queued_file.file_path)
                return None

            # Re-use the persisted row's id so the re-detected file updates that row, not a duplicate.
            item_id = persisted[0] if persisted is not None else str(uuid.uuid4())
            queue_item = IngressQueueItem(
                id=item_id,
                file_path=queued_file.file_path,
                file_name=queued_file.file_name,
                ingress_path=queued_file.ingress_path,
                file_size=queued_file.file_size,
                detected_at=queued_file.detected_at,
                queued_at=queued_file.queued_at,
                status=QUEUE_PENDING,
                priority=max(1, min(priority, 10)),
                media_duration_ms=None,
            )

            self.items_by_id[item_id] = queue_item
            self.path_to_item_id[queued_file.file_path] = item_id
            self.item_order.append(item_id)

        logger.info(
            "Ingress queue item added",
            item_id=queue_item.id,
            file_path=queue_item.file_path,
            priority=queue_item.priority,
        )
        return queue_item

    def add_manual_file(
        self,
        file_path: str,
        priority: int = 5,
        ingress_path: Optional[str] = None,
    ) -> Optional[IngressQueueItem]:
        """Manually add an existing file to the ingress queue.

        Returns the existing item if the file path is already tracked.
        """
        if not self._is_video_file_path(file_path):
            logger.info("Skipping manual add for non-video file", file_path=file_path)
            return None

        resolved_ingress_path = self._infer_ingress_root(file_path, ingress_path)

        with self.lock:
            existing_id = self.path_to_item_id.get(file_path)
            if existing_id is not None:
                existing_item = self.items_by_id[existing_id]
                if existing_item.status not in {QUEUE_PENDING, QUEUE_PROCESSING}:
                    existing_item.status = QUEUE_PENDING
                    existing_item.last_error = None
                    existing_item.processed_at = None
                    existing_item.queued_at = time.time()
                    existing_item.priority = max(1, min(priority, 10))
                return existing_item

            now = time.time()
            # An explicit manual add may re-queue an ignored file, but it updates the persisted row.
            persisted = self.persisted_paths.get(file_path)
            item_id = persisted[0] if persisted is not None else str(uuid.uuid4())
            file_name = os.path.basename(file_path)
            file_size = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
            queue_item = IngressQueueItem(
                id=item_id,
                file_path=file_path,
                file_name=file_name,
                ingress_path=resolved_ingress_path,
                file_size=file_size,
                detected_at=now,
                queued_at=now,
                status=QUEUE_PENDING,
                priority=max(1, min(priority, 10)),
                media_duration_ms=None,
            )

            self.items_by_id[item_id] = queue_item
            self.path_to_item_id[file_path] = item_id
            self.item_order.append(item_id)

        logger.info(
            "Manual ingress queue item added",
            item_id=queue_item.id,
            file_path=queue_item.file_path,
        )
        return queue_item

    async def process_next_item(self) -> Optional[IngressQueueItem]:
        """Process the next pending item and update status."""
        with self.lock:
            candidate = self._get_next_pending_item()
            if candidate is None:
                return None

            candidate.status = QUEUE_PROCESSING
            candidate.attempts += 1
            candidate.last_attempt = time.time()
            stale_keys = self._item_proposal_keys(candidate)

        start_time = time.time()
        try:
            if not self._is_video_file_path(candidate.file_path):
                with self.lock:
                    candidate.parsed_info = {"skipped": True, "reason": "non_video_companion"}
                    candidate.confidence_score = 0
                    candidate.best_match = None
                    candidate.match_candidates = []
                    candidate.status = QUEUE_COMPLETED
                    candidate.last_error = None
                    candidate.processed_at = time.time()

                await self._persist_queue_item(candidate)

                await self._record_history_event(
                    candidate,
                    "skipped_non_video_companion",
                    {
                        "skipped_reason": "non_video_companion",
                        "duration_ms": int((time.time() - start_time) * 1000),
                    },
                )
                return candidate

            if candidate.media_duration_ms is None:
                candidate.media_duration_ms = _get_file_duration(candidate.file_path)

            source_root = self._resolve_source_root(candidate)
            context_folder_name = os.path.basename(source_root.rstrip(os.sep)) or os.path.basename(os.path.dirname(candidate.file_path))
            parsed_info = self.parser.parse_filename(
                candidate.file_name,
                folder_name=context_folder_name,
                file_path=candidate.file_path,
            ).to_dict()
            existing_override = (candidate.parsed_info or {}).get("classification_override") or candidate.classification_override
            if existing_override in VALID_CLASSIFICATION_OVERRIDES:
                parsed_info["classification_override"] = existing_override
                candidate.classification_override = existing_override

            inferred_media_type = self._infer_source_media_type(source_root)
            if inferred_media_type == "episode":
                parsed_info["media_type"] = "episode"
            elif inferred_media_type == "disc_set":
                # Use the grandparent folder name (stripping the disc suffix) as
                # the movie title so items aren't accidentally named "Matrix Disc 2"
                grandparent = os.path.basename(os.path.dirname(source_root.rstrip(os.sep)))
                if grandparent:
                    parsed_info["title"] = self.parser._clean_folder_title(grandparent)
                    parsed_info["normalized_title"] = self.parser.normalize_title(parsed_info["title"])
                    parsed_info["year"] = parsed_info.get("year") or self.parser._extract_year(grandparent)
            match_result = self._run_matcher(parsed_info)
            best_match = match_result.get("best_match") if match_result else None
            has_best_match = isinstance(best_match, dict) and bool(best_match)
            ambiguous = bool(match_result.get("ambiguous")) if match_result else False

            # `confidence_score` is the *match* confidence only. How well the filename
            # parsed is a different number and lives in parsed_info["parse_quality"];
            # the two used to share this column, which made unmatched files look like
            # 85% matches in the review UI.
            parsed_info["parse_quality"] = self._calculate_confidence(parsed_info)
            best_match_dict: Dict[str, Any] = dict(best_match) if has_best_match and best_match else {}
            confidence_score: Optional[int] = None
            if has_best_match:
                confidence_score = best_match_dict.get("confidence_score")
                if confidence_score is None:
                    confidence_score = 0

            review_reason: Optional[str] = None
            if not has_best_match:
                status_value = (match_result or {}).get("status")
                if status_value == "no_title":
                    review_reason = "no title could be parsed from the filename or folders"
                elif status_value in ("matcher_unavailable", "matcher_failed"):
                    review_reason = f"metadata lookup unavailable ({status_value})"
                else:
                    review_reason = f"no metadata match for '{parsed_info.get('title') or ''}'"
            elif ambiguous:
                review_reason = "ambiguous match: " + (
                    next(
                        (e.get("note") for e in reversed(best_match_dict.get("score_breakdown") or [])
                         if e.get("rule") == "ambiguous"),
                        "runner-up candidate scored within the margin",
                    )
                    or ""
                )
            elif confidence_score is not None and confidence_score < self.auto_assign_threshold:
                review_reason = f"confidence {confidence_score} below threshold {self.auto_assign_threshold}"
            if review_reason:
                parsed_info["review_reason"] = review_reason
            else:
                parsed_info.pop("review_reason", None)
            if ambiguous:
                parsed_info["ambiguous_match"] = True
            else:
                parsed_info.pop("ambiguous_match", None)

            with self.lock:
                candidate.parsed_info = parsed_info
                candidate.confidence_score = confidence_score
                candidate.best_match = best_match
                candidate.match_candidates = (
                    match_result.get("candidates", []) if match_result else []
                )
                # The proposal depends on every item grouped with this one (main
                # feature versus special feature), so it is recomputed for the
                # whole group below and stored. Drop the one from the last run.
                candidate.proposed_path = None
                self._proposal_matches.pop(candidate.id, None)
                candidate.status = (
                    QUEUE_AUTO_ASSIGNED
                    if has_best_match
                    and not ambiguous
                    and confidence_score is not None
                    and confidence_score >= self.auto_assign_threshold
                    else QUEUE_NEEDS_REVIEW
                )
                candidate.processed_at = time.time()

            if candidate.status == QUEUE_AUTO_ASSIGNED and self.assignment_orchestrator:
                assignment_result = await self._attempt_auto_assignment(candidate)
                with self.lock:
                    if assignment_result:
                        candidate.assignment_id = assignment_result.get("assignment_id")
                        candidate.proposed_path = self._extract_organized_path(assignment_result)
                        if assignment_result.get("organized"):
                            candidate.status = QUEUE_COMPLETED
                        organization_result = assignment_result.get("organization_result")
                        if organization_result and not organization_result.get("success"):
                            candidate.last_error = organization_result.get("error")

                if assignment_result and assignment_result.get("organized"):
                    await self._finalize_source_folder(candidate)

            await self._store_proposals_safely(
                stale_keys | self._item_proposal_keys(candidate),
                skip_persist={candidate.id},
            )
            await self._persist_queue_item(candidate)

            event_name = "proposal_generated" if candidate.best_match else "item_processed"
            await self._record_history_event(
                candidate,
                event_name,
                {
                    "duration_ms": int((time.time() - start_time) * 1000),
                },
            )

            return candidate
        except Exception as exc:
            with self.lock:
                candidate.status = QUEUE_FAILED
                candidate.last_error = str(exc)
                candidate.processed_at = time.time()

            await self._store_proposals_safely(
                stale_keys | self._item_proposal_keys(candidate),
                skip_persist={candidate.id},
            )
            await self._persist_queue_item(candidate)

            await self._record_history_event(
                candidate,
                "processing_failed",
                {
                    "error": str(exc),
                    "duration_ms": int((time.time() - start_time) * 1000),
                },
            )

            logger.error(
                "Ingress queue item processing failed",
                item_id=candidate.id,
                file_path=candidate.file_path,
                error=str(exc),
            )
            return candidate

    async def retry_item(
        self,
        item_id: str,
        history_extra: Optional[Dict[str, Any]] = None,
    ) -> Optional[IngressQueueItem]:
        """Retry a failed queue item by placing it back into pending state."""
        await self.hydrate_item(item_id)
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None or item.status in QUEUE_TERMINAL_STATUSES:
                return None

            item.status = QUEUE_PENDING
            item.last_error = None

        await self._persist_queue_item(item)
        if history_extra is not None:
            await self._record_history_event(item, "retry_requested", history_extra)
        return item

    async def mark_ignored(
        self,
        item_id: str,
        history_extra: Optional[Dict[str, Any]] = None,
    ) -> Optional[IngressQueueItem]:
        """Move a queue item to the terminal ignored status (excluded from pending and auto-retry)."""
        await self.hydrate_item(item_id)
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None
            if item.status == QUEUE_PROCESSING:
                # process_next_item still holds this object and would overwrite `ignored` (and may organize
                # the file) when it persists; refuse rather than lose the reviewer's decision.
                raise QueueItemBusy(f"Queue item '{item_id}' is being processed; try again once it finishes")

            item.status = QUEUE_IGNORED
            item.processed_at = time.time()
            # An ignored file has no destination, and it frees its numbered slot
            # (Special Feature N, Version N) for the rest of its group.
            stale_keys = self._item_proposal_keys(item)
            item.proposed_path = None
            for name, value in self._role_hints(None, None).items():
                setattr(item, name, value)
            self._proposal_matches.pop(item.id, None)

        await self._store_proposals_safely(stale_keys, skip_persist={item.id})
        await self._persist_queue_item(item)
        await self._record_history_event(item, "item_ignored", dict(history_extra or {}))
        return item

    def get_retry_candidate_ids(
        self,
        now: Optional[float] = None,
        max_attempts: int = 3,
        min_seconds_since_attempt: float = 300.0,
    ) -> List[str]:
        """Return ids eligible for automatic retry; terminal statuses (completed, ignored) never retry."""
        reference = time.time() if now is None else now
        with self.lock:
            candidates: List[str] = []
            for item_id in self.item_order:
                item = self.items_by_id[item_id]
                if item.status in QUEUE_TERMINAL_STATUSES or item.status != QUEUE_FAILED:
                    continue
                if (item.attempts or 0) >= max_attempts:
                    continue
                if item.last_attempt is not None and reference - item.last_attempt <= min_seconds_since_attempt:
                    continue
                candidates.append(item.id)
            return candidates

    async def hydrate_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Return the queue item payload, loading the persisted row when the queue lost it (restart)."""
        with self.lock:
            tracked = self.items_by_id.get(item_id)
            if tracked is not None:
                return tracked.to_dict()
        if self.db_session_factory is None:
            return None

        try:
            async with self.db_session_factory() as session:
                row = (
                    await session.execute(
                        select(DBIngressQueueItem).where(DBIngressQueueItem.id == item_id).limit(1)
                    )
                ).scalars().first()
        except Exception as exc:
            logger.warning("Failed to hydrate ingress queue item", item_id=item_id, error=str(exc))
            return None

        if row is None:
            return None

        self.hydrate_items([row])
        return self.get_item(item_id)

    async def load_persisted_paths(self) -> int:
        """Index every persisted row's file_path → (id, status), newest row per path winning.

        Run once at startup, before the watcher starts: the in-memory queue starts empty, so without
        this a re-detected file would get a new row, and an ignored file would come back as pending.
        """
        if self.db_session_factory is None:
            return 0
        async with self.db_session_factory() as session:
            rows = (
                await session.execute(
                    select(DBIngressQueueItem.file_path, DBIngressQueueItem.id, DBIngressQueueItem.status)
                    .order_by(DBIngressQueueItem.queued_at, DBIngressQueueItem.id)
                )
            ).all()
        index = {str(path): (str(row_id), str(status)) for path, row_id, status in rows}  # later rows win
        with self.lock:
            for path, entry in index.items():
                self.persisted_paths.setdefault(path, entry)  # a live save since startup is newer
        logger.info("Ingress queue path index loaded", paths=len(index))
        return len(index)

    def hydrate_items(self, rows: Iterable[Any]) -> int:
        """Rebuild in-memory queue items from persisted rows; live state is never overwritten."""
        hydrated = 0
        with self.lock:
            for row in rows:
                payload = queue_item_from_row(row)
                if payload is None or payload["id"] in self.items_by_id:
                    continue
                item = IngressQueueItem(**{key: value for key, value in payload.items() if key in QUEUE_ITEM_FIELDS})
                self.items_by_id[item.id] = item
                self.item_order.append(item.id)
                self.path_to_item_id.setdefault(item.file_path, item.id)
                hydrated += 1

        if hydrated:
            logger.info("Ingress queue items hydrated from persisted rows", count=hydrated)
        return hydrated

    async def update_classification(
        self,
        item_id: str,
        classification: Optional[str],
        history_extra: Optional[Dict[str, Any]] = None,
    ) -> Optional[IngressQueueItem]:
        """Override the proposed queue classification before acceptance."""
        await self.hydrate_item(item_id)
        normalized = (classification or "").strip().lower()
        if normalized in ("", "auto", "default", "clear"):
            normalized = None
        elif normalized not in VALID_CLASSIFICATION_OVERRIDES:
            raise ValueError(f"Unsupported classification override: {classification}")

        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.classification_override = normalized
            parsed_info = dict(item.parsed_info or {})
            if normalized is None:
                parsed_info.pop("classification_override", None)
            else:
                parsed_info["classification_override"] = normalized
            item.parsed_info = parsed_info

        if item.media_duration_ms is None and item.best_match:
            item.media_duration_ms = _get_file_duration(item.file_path)
        # An override changes this item's role and with it the numbering of
        # every item it is grouped with.
        await self._store_proposals(
            self._item_proposal_keys(item),
            skip_persist={item.id},
        )
        await self._persist_queue_item(item)
        await self._record_history_event(
            item,
            "classification_updated",
            {
                "classification_override": normalized,
                **(history_extra or {}),
            },
        )
        return item

    async def mark_complete(
        self,
        item_id: str,
        history_extra: Optional[Dict[str, Any]] = None,
    ) -> Optional[IngressQueueItem]:
        """Mark an item complete and attempt organization to Jellyfin."""
        await self.hydrate_item(item_id)
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None
            if item.status == QUEUE_PROCESSING:
                raise QueueItemBusy(f"Queue item '{item_id}' is being processed; try again once it finishes")
            stale_keys = self._item_proposal_keys(item)
            # Claim it for the organize below, so the auto-processor can't pick it up meanwhile. Every path
            # out of this method sets the final status (completed or failed).
            item.status = QUEUE_PROCESSING

        organization_error: Optional[str] = None
        organized = False
        assignment_id: Optional[str] = None
        assignment_result: Optional[Dict[str, Any]] = None  # stays None if the assignment attempt raises

        if self.assignment_orchestrator is not None:
            try:
                assignment_result = await self._attempt_auto_assignment(
                    item,
                    force_organize=True,
                )
                if assignment_result:
                    assignment_id = assignment_result.get("assignment_id")
                    organized = bool(assignment_result.get("organized"))
                    if not organized:
                        org_result = assignment_result.get("organization_result") or {}
                        organization_error = org_result.get("error") or (
                            "Organization did not complete successfully"
                        )
                else:
                    organization_error = "Unable to create assignment for this queue item"
            except Exception as exc:
                organization_error = str(exc)

            if assignment_id:
                item.assignment_id = assignment_id
            # Record where the file actually went before cleaning up the source
            # folder: the cleanup merges leftover files next to it.
            organized_path = self._extract_organized_path(assignment_result) if assignment_result else None
            if organized_path:
                item.proposed_path = organized_path

            if organized:
                try:
                    await self._finalize_source_folder(item)
                except Exception as exc:
                    # The file is organized; a cleanup error must not leave the item claimed.
                    logger.warning("Source folder cleanup failed after organizing", item_id=item.id, error=str(exc))

        # Always settle the final status (this used to sit inside the orchestrator branch, so without an
        # orchestrator the item kept whatever status it had; now it would stay claimed as `processing`).
        with self.lock:
            if self.assignment_orchestrator is None:
                # Backward-compatible behavior when no orchestrator is configured.
                item.status = QUEUE_COMPLETED
                item.last_error = None
            elif organized:
                item.status = QUEUE_COMPLETED
                item.last_error = None
            else:
                item.status = QUEUE_FAILED
                item.last_error = organization_error or "Failed to organize accepted file"
            item.processed_at = time.time()

        await self._store_proposals_safely(
            stale_keys | self._item_proposal_keys(item),
            skip_persist={item.id},
        )
        await self._persist_queue_item(item)
        await self._record_history_event(
            item,
            "accepted_assignment",
            {
                "organized": organized,
                "organization_error": organization_error,
                **(history_extra or {}),
            },
        )
        return item

    # Items a human dismissed must never be picked up by the automatic retry loop
    # (which re-queues `failed` items with fewer than this many attempts).
    MANUAL_FAILURE_ATTEMPTS = 3

    async def mark_failed(self, item_id: str, reason: str) -> Optional[IngressQueueItem]:
        """Mark an item as failed with a reason. Durable: not subject to auto-retry."""
        await self.hydrate_item(item_id)
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_FAILED
            item.last_error = reason
            item.attempts = max(item.attempts, self.MANUAL_FAILURE_ATTEMPTS)
            item.last_attempt = time.time()
            item.processed_at = time.time()

        await self._persist_queue_item(item)

        await self._record_history_event(
            item,
            "marked_failed",
            {
                "error": reason,
            },
        )
        return item

    async def manual_assign_item(
        self,
        item_id: str,
        match_payload: Dict[str, Any],
        organize_now: bool = False,
    ) -> Optional[IngressQueueItem]:
        """Manually assign a queue item to explicit media and optionally organize now."""
        await self.hydrate_item(item_id)
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None
            stale_keys = self._item_proposal_keys(item)

        media_type = match_payload.get("media_type") or "movie"
        _valid_types = ("movie", "episode", "series", "documentary", "live_performance")
        if media_type not in _valid_types:
            media_type = "movie"

        if media_type in ("episode", "series"):
            normalized_media_type = "episode"
        elif media_type == "documentary":
            normalized_media_type = "documentary"
        elif media_type == "live_performance":
            normalized_media_type = "live_performance"
        else:
            normalized_media_type = "movie"

        unknown_episode = bool(match_payload.get("unknown_episode"))

        best_match = {
            "source": match_payload.get("source", "manual"),
            "title": match_payload.get("title"),
            "year": match_payload.get("year"),
            "media_type": normalized_media_type,
            "season": None if unknown_episode else match_payload.get("season"),
            "episode": None if unknown_episode else match_payload.get("episode"),
            "imdb_id": match_payload.get("imdb_id"),
            "media_id": match_payload.get("media_id") or match_payload.get("imdb_id"),
            "confidence_score": 100,
            "match_reason": "manual_assignment",
            "raw_data": match_payload.get("raw_data") or {},
        }

        parsed_info = dict(item.parsed_info or {})
        parsed_info["media_type"] = normalized_media_type
        if normalized_media_type == "episode":
            if unknown_episode:
                parsed_info.pop("season", None)
                parsed_info.pop("episode", None)
                parsed_info["unknown_episode"] = True
            else:
                parsed_info.pop("unknown_episode", None)
                if match_payload.get("season") is not None:
                    parsed_info["season"] = match_payload.get("season")
                if match_payload.get("episode") is not None:
                    parsed_info["episode"] = match_payload.get("episode")

        with self.lock:
            item.best_match = best_match
            self._proposal_matches.pop(item.id, None)
            item.parsed_info = parsed_info
            item.match_candidates = [best_match]
            item.confidence_score = 100
            item.status = QUEUE_AUTO_ASSIGNED
            item.last_error = None
            item.processed_at = time.time()
            item.unknown_episode_label = os.path.splitext(item.file_name)[0] if unknown_episode else None

        assignment_result = None
        if self.assignment_orchestrator is not None:
            assignment_result = await self._attempt_auto_assignment(
                item,
                force_organize=organize_now,
            )

        with self.lock:
            if assignment_result:
                item.assignment_id = assignment_result.get("assignment_id")
                # Keep the proposal resolved for the assignment when nothing was
                # moved yet; once the file is organized this is where it went.
                item.proposed_path = (
                    self._extract_organized_path(assignment_result) or item.proposed_path
                )
                if organize_now:
                    if assignment_result.get("organized"):
                        item.status = QUEUE_COMPLETED
                    else:
                        item.status = QUEUE_FAILED
                        org_result = assignment_result.get("organization_result") or {}
                        item.last_error = org_result.get("error") or "Manual assignment organization failed"
                else:
                    item.status = QUEUE_COMPLETED
            else:
                item.status = QUEUE_FAILED
                item.last_error = "Manual assignment failed"

        # After the organized path is recorded: the cleanup merges leftover
        # files next to it.
        if assignment_result and assignment_result.get("organized"):
            await self._finalize_source_folder(item)

        await self._store_proposals_safely(
            stale_keys | self._item_proposal_keys(item),
            skip_persist={item.id},
        )
        await self._persist_queue_item(item)

        await self._record_history_event(
            item,
            "manual_assignment",
            {
                "manual_assignment": True,
            },
        )
        return item

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            item = self.items_by_id.get(item_id)
            return self._item_view(item) if item else None

    # ------------------------------------------------------------------
    # Proposed-path helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize_title(title: str) -> str:
        """Strip characters that are invalid in file/folder names."""
        for ch in r'<>:"/\|?*':
            title = title.replace(ch, "")
        return title.strip()

    @staticmethod
    def _folder_title(best_match: Dict[str, Any]) -> str:
        """Folder name exactly as FileOrganizationService will create it:
        ``Title (Year) [imdbid-ttNNNNNNN]``."""
        title = IngressQueueService._sanitize_title(best_match.get("title") or "Unknown")
        year = best_match.get("year")
        folder = f"{title} ({year})" if year else title
        imdb_id = best_match.get("imdb_id")
        if isinstance(imdb_id, str) and re.fullmatch(r"tt\d+", imdb_id.strip()):
            folder = f"{folder} [imdbid-{imdb_id.strip()}]"
        return folder

    @staticmethod
    def _shows_folder() -> str:
        return settings.folder_tv_shows

    @staticmethod
    def _build_main_path(file_name: str, best_match: Dict[str, Any]) -> str:
        """Proposed path for the main feature file."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        shows = IngressQueueService._shows_folder()
        if media_type in ("episode", "series"):
            season = best_match.get("season")
            episode = best_match.get("episode")
            # Season 0 → Specials folder (Jellyfin convention)
            if season == 0:
                season_str = "Specials"
            elif season is not None:
                season_str = f"Season {int(season):02d}"
            else:
                # Absolute-episode anime or season-pack — no season known
                season_str = "Season 00"

            if episode is not None:
                if season is not None:
                    ep_str = f"S{int(season):02d}E{int(episode):02d}"
                else:
                    # Anime absolute episode: use E-only notation
                    ep_str = f"E{int(episode):03d}"
                episode_end = best_match.get("episode_end")
                if episode_end is not None and int(episode_end) > int(episode):
                    if season is not None:
                        ep_str = f"{ep_str}E{int(episode_end):02d}"
                    else:
                        ep_str = f"{ep_str}E{int(episode_end):03d}"
                ep_title = best_match.get("episode_title") or ""
                ep_label = f" {ep_title}" if ep_title else ""
                return f"{shows}/{folder}/{season_str}/{folder} {ep_str}{ep_label}{ext}"
            # Season-pack or unknown episode — keep original filename for manual ID
            return f"{shows}/{folder}/{season_str}/{file_name}"
        if media_type == "documentary":
            return f"{settings.folder_documentaries}/{folder}/{folder}{ext}"
        if media_type == "live_performance":
            return f"{settings.folder_live_performances}/{folder}/{folder}{ext}"
        return f"{settings.folder_movies}/{folder}/{folder}{ext}"

    @staticmethod
    def _build_version_path(file_name: str, best_match: Dict[str, Any], version_number: int) -> str:
        """Proposed path for an alternate version of an already-processed movie."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        subfolder = {
            "documentary": settings.folder_documentaries,
            "live_performance": settings.folder_live_performances,
        }.get(media_type, settings.folder_movies)
        return f"{subfolder}/{folder}/{folder} - Version {version_number}{ext}"

    @staticmethod
    def _build_special_path(file_name: str, best_match: Dict[str, Any], number: int) -> str:
        """Proposed path for an extra / special-feature file."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        if media_type in ("episode", "series"):
            season = best_match.get("season")
            season_str = f"Season {int(season):02d}" if season is not None else "Season 00"
            return f"{IngressQueueService._shows_folder()}/{folder}/{season_str}/{file_name}"
        subfolder = {
            "documentary": settings.folder_documentaries,
            "live_performance": settings.folder_live_performances,
        }.get(media_type, settings.folder_movies)
        return f"{subfolder}/{folder}/Special Feature {number}{ext}"

    def _enrich_proposed_paths(self, items: List[Dict[str, Any]]) -> None:
        """
        Assign proposed_path for each item dict in-place.

        Within each group of items that share the same best_match title+year,
        the file with the longest media duration is considered the main feature.
        If an identically-titled movie already exists on disk:
          - Files with duration >= threshold * existing_duration → Version N
          - Shorter files → Special Feature N
        If no main feature exists yet, the longest file becomes the main feature
        and all others become Special Features (ordered by duration descending).

        Episodes without a known episode number get sequential "Unknown Episode N"
        labels so they are never left without an organised path.

        An item that cannot be resolved keeps ``proposed_path`` None: it has no
        destination, stays where it is in its source folder and waits for a
        match. It is never renamed or moved into a holding folder.

        This reads the destination folders on the NAS. Call it from a proposal
        refresh or right before organizing, never from a read endpoint.
        """
        groups: Dict[Tuple[str, Any], List[int]] = defaultdict(list)
        source_root_groups: Dict[str, List[int]] = defaultdict(list)
        # (main_exists, next_special_num, main_duration_ms, next_version_num)
        movie_folder_state_cache: Dict[str, Tuple[bool, int, Optional[float], int]] = {}
        unknown_episode_state_cache: Dict[str, int] = {}  # cache_key -> next_unknown_N

        def _subfolder_for(media_type: str) -> str:
            return {
                "documentary": settings.folder_documentaries,
                "live_performance": settings.folder_live_performances,
            }.get(media_type, settings.folder_movies)

        def _movie_folder_state(
            best_match: Dict[str, Any],
        ) -> Tuple[bool, int, Optional[float], int]:
            """Return (main_exists, next_special_number, main_duration_ms, next_version_number)."""
            media_type = (best_match.get("media_type") or "movie").lower()
            if media_type in ("episode", "series"):
                return False, 1, None, 2

            folder = self._folder_title(best_match)
            cache_key = folder.lower()
            if cache_key in movie_folder_state_cache:
                return movie_folder_state_cache[cache_key]

            subfolder = _subfolder_for(media_type)
            dest_dir = os.path.join(settings.jellyfin_dest_base, subfolder, folder)
            main_exists = False
            main_duration_ms: Optional[float] = None
            highest_special_number = 0
            highest_version_number = 1  # versions start at 2
            folder_lower = folder.lower()
            video_extensions = {ext.lower() for ext in settings.supported_video_extensions}

            if os.path.isdir(dest_dir):
                try:
                    for name in os.listdir(dest_dir):
                        full_path = os.path.join(dest_dir, name)
                        if not os.path.isfile(full_path):
                            continue
                        stem, ext = os.path.splitext(name)
                        if ext.lower() not in video_extensions:
                            continue
                        if stem.lower() == folder_lower:
                            main_exists = True
                            main_duration_ms = _get_file_duration(full_path)
                        special_m = re.match(r"^Special Feature\s+(\d+)$", stem, re.IGNORECASE)
                        if special_m:
                            highest_special_number = max(
                                highest_special_number, int(special_m.group(1))
                            )
                        version_m = re.match(
                            rf"^{re.escape(folder_lower)}\s+-\s+Version\s+(\d+)$",
                            stem.lower(),
                        )
                        if version_m:
                            highest_version_number = max(
                                highest_version_number, int(version_m.group(1))
                            )
                except OSError:
                    pass

            state: Tuple[bool, int, Optional[float], int] = (
                main_exists,
                highest_special_number + 1,
                main_duration_ms,
                highest_version_number + 1,
            )
            movie_folder_state_cache[cache_key] = state
            return state

        def _unknown_episode_state(best_match: Dict[str, Any]) -> int:
            """Return the next available unknown-episode number for this series/season."""
            folder = self._folder_title(best_match)
            season = best_match.get("season")
            season_str = f"Season {int(season):02d}" if season is not None else "Season 00"
            cache_key = f"{folder.lower()}:{season_str}"
            if cache_key in unknown_episode_state_cache:
                val = unknown_episode_state_cache[cache_key]
                unknown_episode_state_cache[cache_key] = val + 1
                return val
            dest_dir = os.path.join(
                settings.jellyfin_dest_base, settings.folder_tv_shows, folder, season_str
            )
            highest = 0
            if os.path.isdir(dest_dir):
                try:
                    for name in os.listdir(dest_dir):
                        m = re.search(r"Unknown Episode\s+(\d+)", name, re.IGNORECASE)
                        if m:
                            highest = max(highest, int(m.group(1)))
                except OSError:
                    pass
            unknown_episode_state_cache[cache_key] = highest + 2
            return highest + 1

        def _source_root_key(item: Dict[str, Any]) -> str:
            return self._source_root_for(item.get("file_path"), item.get("ingress_path"))

        def _looks_like_companion_item(item: Dict[str, Any]) -> bool:
            parsed_info = item.get("parsed_info") or {}
            best_match = item.get("best_match") or {}
            file_name = str(item.get("file_name") or "")
            parent_name = os.path.basename(os.path.dirname(str(item.get("file_path") or "")))
            stem = os.path.splitext(file_name)[0].strip()

            return (
                bool(parsed_info.get("is_companion"))
                or parsed_info.get("classification_hint") == "special_feature"
                or self.parser.is_generic_companion_label(parsed_info.get("title") or "")
                or self.parser.is_generic_companion_label(best_match.get("title") or "")
                or self.parser.is_generic_companion_label(parent_name)
                or bool(re.match(r"^[A-Za-z]\d+[_-]t\d+$", stem))
            )

        def _classification_override(item: Dict[str, Any]) -> Optional[str]:
            override = (
                item.get("classification_override")
                or (item.get("parsed_info") or {}).get("classification_override")
            )
            if not override:
                return None
            normalized = str(override).strip().lower()
            return normalized if normalized in VALID_CLASSIFICATION_OVERRIDES else None

        # Items that came in with a path: organized already, or being organized
        # right now. Their path and match are never rewritten here.
        resolved: Set[int] = set()

        for i, item in enumerate(items):
            if item.get("proposed_path"):
                # Preserve already-resolved destination paths captured from
                # successful organization operations. A matched one still
                # anchors the companion files waiting in its source folder.
                resolved.add(i)
                if isinstance(item.get("best_match"), dict) and item.get("best_match"):
                    source_root = _source_root_key(item)
                    if source_root:
                        source_root_groups[source_root].append(i)
                continue

            source_root = _source_root_key(item)
            if source_root:
                source_root_groups[source_root].append(i)

            title_key = self._proposal_title_key(item)
            if title_key is not None:
                groups[title_key].append(i)
            else:
                items[i]["proposed_path"] = None

        for indices in groups.values():
            sample_match = items[indices[0]].get("best_match") or {}
            media_type = (sample_match.get("media_type") or "movie").lower()

            # ── Episode handling ──────────────────────────────────────────────
            if media_type in ("episode", "series"):
                special_offset = 0
                for idx in indices:
                    ep_match = dict(items[idx].get("best_match") or {})
                    parsed_info = items[idx].get("parsed_info") or {}
                    override = _classification_override(items[idx])

                    if ep_match.get("season") is None and parsed_info.get("season") is not None:
                        ep_match["season"] = parsed_info.get("season")
                    if ep_match.get("episode") is None and parsed_info.get("episode") is not None:
                        ep_match["episode"] = parsed_info.get("episode")
                    if ep_match.get("episode_title") is None and parsed_info.get("episode_title"):
                        ep_match["episode_title"] = parsed_info.get("episode_title")

                    items[idx]["best_match"] = ep_match
                    if override == "special_feature":
                        items[idx]["proposed_path"] = self._build_special_path(
                            items[idx]["file_name"], ep_match, special_offset + 1
                        )
                        special_offset += 1
                    elif ep_match.get("episode") is not None:
                        items[idx]["proposed_path"] = self._build_main_path(
                            items[idx]["file_name"], ep_match
                        )
                    else:
                        unknown_n = _unknown_episode_state(ep_match)
                        enriched = dict(ep_match)
                        enriched["unknown_episode_number"] = unknown_n
                        items[idx]["best_match"] = enriched
                        items[idx]["proposed_path"] = self._build_main_path(
                            items[idx]["file_name"], enriched
                        )
                continue

            # ── Movie / documentary / live_performance handling ───────────────
            main_exists, next_special_number, main_duration_ms, next_version_number = (
                _movie_folder_state(sample_match)
            )
            threshold = settings.movie_version_duration_threshold

            ordered = sorted(
                indices,
                key=lambda i: items[i].get("media_duration_ms") or 0,
                reverse=True,
            )

            forced_main = [idx for idx in ordered if _classification_override(items[idx]) == "main_feature"]
            forced_special = [idx for idx in ordered if _classification_override(items[idx]) == "special_feature"]
            forced_version = [idx for idx in ordered if _classification_override(items[idx]) == "alternate_version"]

            if main_exists:
                version_offset = 0
                special_offset = 0
                for idx in ordered:
                    override = _classification_override(items[idx])
                    item_duration = items[idx].get("media_duration_ms") or 0
                    # When duration metadata is unavailable, prefer keeping the
                    # duplicate as an alternate version rather than collapsing it
                    # into a special feature or risking an overwrite.
                    is_version = (
                        override == "alternate_version"
                        or (
                            override != "special_feature"
                            and (
                                main_duration_ms is None
                                or item_duration <= 0
                                or item_duration >= threshold * main_duration_ms
                            )
                        )
                    )
                    if is_version:
                        items[idx]["proposed_path"] = self._build_version_path(
                            items[idx]["file_name"],
                            items[idx]["best_match"],
                            next_version_number + version_offset,
                        )
                        version_offset += 1
                    else:
                        items[idx]["proposed_path"] = self._build_special_path(
                            items[idx]["file_name"],
                            items[idx]["best_match"],
                            next_special_number + special_offset,
                        )
                        special_offset += 1
                continue

            remaining = [
                idx for idx in ordered
                if idx not in forced_special and idx not in forced_version
            ]
            main_idx = forced_main[0] if forced_main else (remaining[0] if remaining else None)

            special_offset = 0
            for idx in forced_special:
                items[idx]["proposed_path"] = self._build_special_path(
                    items[idx]["file_name"], items[idx]["best_match"], special_offset + 1
                )
                special_offset += 1

            version_offset = 0
            for idx in forced_version:
                items[idx]["proposed_path"] = self._build_version_path(
                    items[idx]["file_name"], items[idx]["best_match"], next_version_number + version_offset
                )
                version_offset += 1

            if main_idx is not None:
                items[main_idx]["proposed_path"] = self._build_main_path(
                    items[main_idx]["file_name"], items[main_idx]["best_match"]
                )

            auto_others = [
                idx for idx in remaining
                if idx != main_idx
            ]
            for idx in auto_others:
                items[idx]["proposed_path"] = self._build_special_path(
                    items[idx]["file_name"], items[idx]["best_match"], special_offset + 1
                )
                special_offset += 1

        # Fallback: companion files from the same source root should inherit the
        # matched movie/show anchor instead of being matched to generic titles like
        # "Extras" or "Special Features".
        for source_indices in source_root_groups.values():
            matched = [
                i
                for i in source_indices
                if items[i].get("proposed_path") and isinstance(items[i].get("best_match"), dict)
            ]
            if not matched:
                continue

            anchor_candidates = [i for i in matched if not _looks_like_companion_item(items[i])]
            if not anchor_candidates:
                continue

            anchor_idx = max(anchor_candidates, key=lambda i: items[i].get("media_duration_ms") or 0)
            anchor_match = dict(items[anchor_idx].get("best_match") or {})
            if not anchor_match:
                continue

            _, next_special_number, _, _ = _movie_folder_state(anchor_match)
            companion_indices = [
                i for i in source_indices
                if i != anchor_idx and i not in resolved and _looks_like_companion_item(items[i])
            ]

            for offset, idx in enumerate(sorted(companion_indices, key=lambda i: items[i].get("media_duration_ms") or 0, reverse=True), start=0):
                inherited_match = dict(anchor_match)
                parsed_info = items[idx].get("parsed_info") or {}
                if inherited_match.get("media_type") in ("episode", "series"):
                    if parsed_info.get("season") is not None:
                        inherited_match["season"] = parsed_info.get("season")
                    else:
                        inherited_match.pop("season", None)
                    if parsed_info.get("episode") is not None:
                        inherited_match["episode"] = parsed_info.get("episode")
                    else:
                        inherited_match.pop("episode", None)
                    if parsed_info.get("episode_title"):
                        inherited_match["episode_title"] = parsed_info.get("episode_title")
                    else:
                        inherited_match.pop("episode_title", None)

                inherited_match["inferred_from_source_root"] = True
                items[idx]["best_match"] = inherited_match
                items[idx]["proposed_path"] = self._build_special_path(
                    items[idx].get("file_name") or "",
                    inherited_match,
                    next_special_number + offset,
                )

    @staticmethod
    def _extract_organized_path(assignment_result: Dict[str, Any]) -> Optional[str]:
        """Return the concrete destination path from an organization result."""
        if not assignment_result:
            return None

        org = assignment_result.get("organization_result") or {}
        operations = org.get("operations") or []
        for op in operations:
            destination = op.get("destination")
            if destination:
                return destination

        target_path = org.get("targetPath")
        if target_path:
            return target_path

        return None

    # ------------------------------------------------------------------
    # Stored proposals
    # ------------------------------------------------------------------
    #
    # A proposal is the proposed path plus the role it implies (main feature,
    # Version N, Special Feature N, Unknown Episode N). It depends on the other
    # queue items matched to the same title or sitting in the same source
    # folder, and on what already exists in the destination folder. It is
    # recomputed when one of those queue items changes, then stored on the item
    # and its database row, so reading the queue never touches the filesystem.
    # Changes made on the NAS outside the queue are picked up by the next
    # refresh, and always right before a file is organized.

    @staticmethod
    def _source_root_for(file_path: Optional[str], ingress_path: Optional[str]) -> str:
        """Top-level folder under the ingress root that a file arrived in."""
        if not file_path:
            return os.path.abspath(ingress_path or ".")

        file_path_abs = os.path.abspath(file_path)
        ingress_root_abs = os.path.abspath(ingress_path or os.path.dirname(file_path_abs))
        if IngressQueueService._is_within_path(file_path_abs, ingress_root_abs):
            rel = os.path.relpath(file_path_abs, ingress_root_abs)
            top_segment = rel.split(os.sep, 1)[0]
            if top_segment and top_segment not in (".", ".."):
                return os.path.join(ingress_root_abs, top_segment)
        return os.path.dirname(file_path_abs)

    @classmethod
    def _proposal_title_key(cls, item: Dict[str, Any]) -> Optional[Tuple[str, Any]]:
        """Key shared by the items matched to the same title and year."""
        match = item.get("best_match")
        if not isinstance(match, dict) or not match:
            return None
        parsed_info = item.get("parsed_info") or {}
        title = (
            match.get("title")
            or parsed_info.get("title")
            or os.path.basename(cls._source_root_for(item.get("file_path"), item.get("ingress_path")))
            or os.path.basename(item.get("ingress_path") or "")
            or None
        )
        if not title:
            return None
        return (str(title).lower(), match.get("year"))

    @classmethod
    def _proposal_keys(cls, item: Dict[str, Any]) -> Set[Tuple[Any, ...]]:
        """Groups an item's proposal is resolved in: its source folder and its title."""
        keys: Set[Tuple[Any, ...]] = {
            ("root", cls._source_root_for(item.get("file_path"), item.get("ingress_path")))
        }
        title_key = cls._proposal_title_key(item)
        if title_key is not None:
            keys.add(("title",) + title_key)
        return keys

    def _item_proposal_keys(self, item: IngressQueueItem) -> Set[Tuple[Any, ...]]:
        return self._proposal_keys(
            {
                "file_path": item.file_path,
                "ingress_path": item.ingress_path,
                "best_match": item.best_match,
                "parsed_info": item.parsed_info,
            }
        )

    def _proposal_scope(self, keys: Iterable[Tuple[Any, ...]]) -> List[str]:
        """Ids of every item whose proposal can depend on the given groups.

        Items are linked when they share a title or a source folder, and links
        are followed transitively. The caller holds the lock.
        """
        pending: Set[Tuple[Any, ...]] = set(keys)
        if not pending:
            return []

        keys_by_id = {
            item_id: self._item_proposal_keys(self.items_by_id[item_id])
            for item_id in self.item_order
        }
        seen: Set[Tuple[Any, ...]] = set()
        scope: Set[str] = set()
        while pending:
            seen |= pending
            reached = [
                item_id
                for item_id, own_keys in keys_by_id.items()
                if item_id not in scope and own_keys & pending
            ]
            scope.update(reached)
            pending = set()
            for item_id in reached:
                pending |= keys_by_id[item_id] - seen
        return [item_id for item_id in self.item_order if item_id in scope]

    def _proposal_is_final(self, item: IngressQueueItem) -> bool:
        """True when the stored path is where the file went (or is going right now)."""
        return item.status == QUEUE_COMPLETED or item.id in self._organizing_ids

    def _proposal_snapshot(
        self,
        item_ids: Iterable[str],
        resolving: Optional[IngressQueueItem] = None,
    ) -> List[Dict[str, Any]]:
        """Item dicts to resolve proposals on. The caller holds the lock.

        An open item has its path cleared so it is resolved again. An item whose
        path is final keeps it and is never rewritten. It is included, when it
        has a match, only so the companion files still waiting in its source
        folder can inherit that match: organizing the main feature must not
        strand its extras. ``resolving`` is the item the caller is about to
        organize; its path is resolved again like an open one. An ignored item
        is left out: it neither anchors its folder nor takes a numbered slot.
        """
        snapshot: List[Dict[str, Any]] = []
        for item_id in item_ids:
            item = self.items_by_id[item_id]
            if item.status == QUEUE_IGNORED and item is not resolving:
                continue
            entry = item.to_dict()
            if item is resolving or not self._proposal_is_final(item):
                entry["proposed_path"] = None
            elif not (entry.get("proposed_path") and isinstance(item.best_match, dict) and item.best_match):
                continue
            snapshot.append(entry)
        return snapshot

    @staticmethod
    def _role_hints(
        proposed_path: Optional[str],
        match: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Organization hints implied by a proposed path."""
        hints: Dict[str, Any] = {
            "is_alternate_version": False,
            "version_number": None,
            "special_feature_number": None,
            "unknown_episode_label": None,
        }
        if not proposed_path:
            return hints

        stem = os.path.splitext(os.path.basename(proposed_path))[0]
        media_type = ((match or {}).get("media_type") or "movie").lower()

        if media_type in ("movie", "documentary", "live_performance"):
            version_match = re.search(r"\s+-\s+Version\s+(\d+)$", stem, re.IGNORECASE)
            special_match = re.match(r"^Special Feature\s+(\d+)$", stem, re.IGNORECASE)
            if version_match:
                hints["is_alternate_version"] = True
                hints["version_number"] = int(version_match.group(1))
            elif special_match:
                hints["special_feature_number"] = int(special_match.group(1))
        elif media_type in ("episode", "series"):
            if (match or {}).get("episode") is None or re.search(
                r"Unknown Episode\s+\d+", stem, re.IGNORECASE
            ):
                hints["unknown_episode_label"] = stem
        return hints

    def _refresh_proposed_paths(
        self,
        keys: Optional[Iterable[Tuple[Any, ...]]] = None,
    ) -> List[IngressQueueItem]:
        """Recompute stored proposals; return the items whose proposed path changed.

        ``keys`` limits the work to the items grouped with whatever just
        changed; ``None`` recomputes the whole queue. This probes destination
        folders on the NAS, so async callers run it in a worker thread.
        """
        with self._proposal_refresh_lock:
            with self.lock:
                scope = list(self.item_order) if keys is None else self._proposal_scope(keys)
                snapshot = self._proposal_snapshot(scope)
            if all(entry.get("proposed_path") for entry in snapshot):
                # Nothing open to resolve (final items only, or nothing at all).
                return []

            self._enrich_proposed_paths(snapshot)

            changed: List[IngressQueueItem] = []
            with self.lock:
                for entry in snapshot:
                    item = self.items_by_id.get(entry.get("id"))
                    if item is None or self._proposal_is_final(item):
                        continue

                    proposed_path = entry.get("proposed_path") or None
                    resolved_match = entry.get("best_match")
                    if not isinstance(resolved_match, dict) or not resolved_match:
                        resolved_match = None

                    if proposed_path and resolved_match and resolved_match != item.best_match:
                        self._proposal_matches[item.id] = resolved_match
                    else:
                        self._proposal_matches.pop(item.id, None)

                    hints = self._role_hints(proposed_path, resolved_match or item.best_match)
                    for name, value in hints.items():
                        setattr(item, name, value)

                    if item.proposed_path != proposed_path:
                        item.proposed_path = proposed_path
                        changed.append(item)
            return changed

    async def _store_proposals(
        self,
        keys: Optional[Iterable[Tuple[Any, ...]]] = None,
        skip_persist: Iterable[str] = (),
    ) -> List[IngressQueueItem]:
        """Refresh proposals off the event loop and persist the rows that changed."""
        key_set = None if keys is None else set(keys)
        changed = await asyncio.to_thread(self._refresh_proposed_paths, key_set)
        skipped = set(skip_persist)
        for item in changed:
            if item.id not in skipped:
                await self._persist_queue_item(item)
        return changed

    async def _store_proposals_safely(
        self,
        keys: Optional[Iterable[Tuple[Any, ...]]] = None,
        skip_persist: Iterable[str] = (),
    ) -> List[IngressQueueItem]:
        """Like _store_proposals, but a refresh error never fails the caller.

        The proposals are a derived view; the queue transition that triggered
        the refresh must still be saved.
        """
        try:
            return await self._store_proposals(keys, skip_persist)
        except Exception as exc:
            logger.warning("Failed to refresh stored ingress proposals", error=str(exc))
            return []

    async def refresh_proposals(self, item_ids: Optional[Iterable[str]] = None) -> int:
        """Recompute stored proposals for the given items and everything grouped
        with them (the whole queue when omitted). Returns how many changed."""
        keys: Optional[Set[Tuple[Any, ...]]] = None
        if item_ids is not None:
            keys = set()
            with self.lock:
                for item_id in item_ids:
                    item = self.items_by_id.get(item_id)
                    if item is not None:
                        keys |= self._item_proposal_keys(item)
        changed = await self._store_proposals_safely(keys)
        return len(changed)

    def _item_view(self, item: IngressQueueItem) -> Dict[str, Any]:
        """Item as the API returns it: the stored proposal together with the
        match it was resolved with."""
        view = item.to_dict()
        resolved_match = self._proposal_matches.get(item.id)
        if resolved_match:
            view["best_match"] = dict(resolved_match)
        return view

    def get_queue_items(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Queue items with their stored proposals. No filesystem access."""
        with self.lock:
            items = [self.items_by_id[item_id] for item_id in self.item_order]
            if status is not None:
                items = [item for item in items if item.status == status]
            return [self._item_view(item) for item in items]

    def get_queue_status(self) -> Dict[str, Any]:
        with self.lock:
            counts = {
                QUEUE_PENDING: 0,
                QUEUE_PROCESSING: 0,
                QUEUE_AUTO_ASSIGNED: 0,
                QUEUE_NEEDS_REVIEW: 0,
                QUEUE_FAILED: 0,
                QUEUE_COMPLETED: 0,
                QUEUE_IGNORED: 0,
            }

            for item_id in self.item_order:
                item = self.items_by_id[item_id]
                counts[item.status] = counts.get(item.status, 0) + 1

            return {
                "total": len(self.item_order),
                "counts": counts,
                "recent": [
                    history_item
                    for history_item in self.processing_history[-25:]
                ],
            }

    def get_processing_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self.lock:
            if limit <= 0:
                return []
            return list(self.processing_history[-limit:])

    async def get_processing_history_persisted(self, limit: int = 100) -> List[Dict[str, Any]]:
        if limit <= 0:
            return []

        if self.db_session_factory is None:
            return self.get_processing_history(limit=limit)

        try:
            async with self.db_session_factory() as session:
                result = await session.execute(
                    select(DBIngressProcessingHistory)
                    .order_by(DBIngressProcessingHistory.created_at.desc())
                    .limit(limit)
                )
                rows = list(result.scalars().all())

            if not rows:
                return self.get_processing_history(limit=limit)

            items: List[Dict[str, Any]] = []
            for row in reversed(rows):
                snapshot = dict(row.snapshot or {})
                snapshot.setdefault("db_id", row.id)
                if row.created_at is not None:
                    snapshot.setdefault("created_at", row.created_at.isoformat())
                items.append(snapshot)
            return items
        except Exception as exc:
            logger.warning("Failed to load persisted ingress history", error=str(exc))
            return self.get_processing_history(limit=limit)

    def clear(self) -> int:
        with self.lock:
            count = len(self.item_order)
            self.items_by_id.clear()
            self.item_order.clear()
            self.path_to_item_id.clear()
            self.processing_history.clear()
            self._proposal_matches.clear()
            return count

    async def process_pending_items(self, max_items: int = 25) -> List[Dict[str, Any]]:
        """Process up to max_items pending queue items."""
        processed_items: List[Dict[str, Any]] = []

        limit = max(1, min(max_items, 500))
        for _ in range(limit):
            processed = await self.process_next_item()
            if processed is None:
                break
            processed_items.append(self._item_view(processed))

        return processed_items

    def _get_next_pending_item(self) -> Optional[IngressQueueItem]:
        pending_items = [
            self.items_by_id[item_id]
            for item_id in self.item_order
            if self.items_by_id[item_id].status == QUEUE_PENDING
        ]

        if not pending_items:
            return None

        pending_items.sort(key=lambda item: (-item.priority, item.queued_at))
        return pending_items[0]

    def _calculate_confidence(self, parsed_info: Dict[str, Any]) -> int:
        media_type = parsed_info.get("media_type")
        title = parsed_info.get("title") or ""

        score = 0
        if title:
            score += 35

        if media_type == "movie":
            score += 20
            if parsed_info.get("year") is not None:
                score += 25
        elif media_type == "episode":
            score += 25
            if parsed_info.get("season") is not None:
                score += 10
            if parsed_info.get("episode") is not None:
                score += 10

        if parsed_info.get("quality"):
            score += 5

        return max(0, min(score, 100))

    def _run_matcher(self, parsed_info: Dict[str, Any]) -> Dict[str, Any]:
        if self.auto_matcher_service is None:
            return {"status": "matcher_unavailable", "candidates": [], "best_match": None}

        try:
            return self.auto_matcher_service.search_and_match(parsed_info)
        except Exception as exc:
            logger.error("Auto-matcher failed", error=str(exc))
            return {"status": "matcher_failed", "candidates": [], "best_match": None}

    def _apply_resolved_path_hints(
        self,
        item: IngressQueueItem,
        resolved_item: Dict[str, Any],
    ) -> None:
        """Apply a freshly resolved proposal and its organization hints to the live queue item."""
        item.proposed_path = resolved_item.get("proposed_path") or None

        resolved_match = resolved_item.get("best_match")
        if isinstance(resolved_match, dict) and resolved_match:
            item.best_match = resolved_match
        # The live match now is the resolved one.
        self._proposal_matches.pop(item.id, None)

        media_type = ((item.best_match or {}).get("media_type") or "movie").lower()
        if item.proposed_path and media_type in ("episode", "series"):
            parsed_info = item.parsed_info or {}
            for field in ("season", "episode"):
                if (item.best_match or {}).get(field) is None and parsed_info.get(field) is not None:
                    item.best_match = dict(item.best_match or {})
                    item.best_match[field] = parsed_info.get(field)

        for name, value in self._role_hints(item.proposed_path, item.best_match).items():
            setattr(item, name, value)

    def _prime_organization_hints_for_item(self, item: IngressQueueItem) -> None:
        """Resolve the item's destination and role from current disk state, right
        before it is organized.

        The stored proposal can be stale by then (files added or removed on the
        NAS since the last refresh), so the item's whole group is resolved again
        instead of trusting it. An item without a match of its own still gets
        one here when it is a companion file of a matched item in its folder,
        including one that was organized earlier.
        """
        if item.media_duration_ms is None:
            item.media_duration_ms = _get_file_duration(item.file_path)

        with self.lock:
            snapshot = self._proposal_snapshot(
                self._proposal_scope(self._item_proposal_keys(item)),
                resolving=item,
            )
        if all(entry.get("id") != item.id for entry in snapshot):
            own_entry = item.to_dict()
            own_entry["proposed_path"] = None
            snapshot.append(own_entry)

        self._enrich_proposed_paths(snapshot)

        resolved_item = next((entry for entry in snapshot if entry.get("id") == item.id), None)
        if resolved_item is not None:
            self._apply_resolved_path_hints(item, resolved_item)

    async def _attempt_auto_assignment(
        self,
        item: IngressQueueItem,
        force_organize: bool = False,
    ) -> Optional[Dict[str, Any]]:
        # Until this returns the item's proposal belongs to this call: a refresh
        # running in a worker thread must not rewrite it between resolving the
        # destination and organizing the file.
        self._organizing_ids.add(item.id)
        try:
            self._repair_missing_source_path(item)
            self._prime_organization_hints_for_item(item)
            return await self.assignment_orchestrator.auto_assign(
                item.to_dict(),
                force_organize=force_organize,
            )
        except Exception as exc:
            logger.error(
                "Auto-assignment failed",
                item_id=item.id,
                file_path=item.file_path,
                error=str(exc),
            )
            return None
        finally:
            self._organizing_ids.discard(item.id)

    @staticmethod
    def _to_timestamp(value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return value.timestamp()
        except Exception:
            return None

    async def restore_from_db(self) -> int:
        """Reload unfinished queue items from Postgres into memory.

        The queue used to live only in memory and was written to the database as a
        log, so every restart emptied the review queue and every re-scan inserted a
        new row per file. Restoring on startup (newest row per path wins, files that
        no longer exist are skipped) makes the database the source of truth.

        ``load_persisted_paths`` indexes every row, completed ones included, so a
        re-detected file finds its row. This loads the unfinished rows themselves:
        proposals and source-folder cleanup look at the whole group in memory, so
        the items of a group cannot be hydrated one at a time on demand. Ignored
        rows are restored too, so an ignored file keeps holding its folder in
        place after a restart exactly as it does before one.
        """
        if self.db_session_factory is None:
            return 0

        try:
            async with self.db_session_factory() as session:
                result = await session.execute(
                    select(DBIngressQueueItem)
                    .where(DBIngressQueueItem.status != QUEUE_COMPLETED)
                    .order_by(DBIngressQueueItem.queued_at.desc(), DBIngressQueueItem.created_at.desc())
                )
                rows = list(result.scalars().all())
        except Exception as exc:
            logger.warning("Failed to load ingress queue from database", error=str(exc))
            return 0

        restored = 0
        skipped_missing = 0
        skipped_duplicate = 0
        with self.lock:
            for row in rows:
                file_path = row.file_path
                if not file_path:
                    continue
                if file_path in self.path_to_item_id:
                    skipped_duplicate += 1
                    continue
                if not os.path.isfile(file_path):
                    skipped_missing += 1
                    continue

                parsed_info = dict(row.parsed_info or {})
                status = row.status or QUEUE_PENDING
                if status == QUEUE_PROCESSING:
                    status = QUEUE_PENDING  # interrupted mid-run; process again

                item = IngressQueueItem(
                    id=row.id,
                    file_path=file_path,
                    file_name=row.file_name or os.path.basename(file_path),
                    ingress_path=row.ingress_path or self._infer_ingress_root(file_path),
                    file_size=int(row.file_size or 0),
                    detected_at=self._to_timestamp(row.detected_at) or time.time(),
                    queued_at=self._to_timestamp(row.queued_at) or time.time(),
                    status=status,
                    priority=int(row.priority or 5),
                    attempts=int(row.attempts or 0),
                    last_attempt=self._to_timestamp(row.last_attempt),
                    processed_at=self._to_timestamp(row.processed_at),
                    last_error=row.last_error,
                    confidence_score=row.confidence_score,
                    assignment_id=row.assignment_id,
                    parsed_info=parsed_info,
                    best_match=dict(row.best_match or {}) or None,
                    match_candidates=list(row.match_candidates or []),
                    media_duration_ms=float(row.media_duration_ms) if row.media_duration_ms is not None else None,
                    proposed_path=row.proposed_path,
                    classification_override=parsed_info.get("classification_override"),
                )
                self.items_by_id[item.id] = item
                self.path_to_item_id[file_path] = item.id
                self.item_order.append(item.id)
                restored += 1

        logger.info(
            "Ingress queue restored from database",
            restored=restored,
            skipped_missing_files=skipped_missing,
            skipped_duplicate_rows=skipped_duplicate,
        )
        return restored

    def _queue_row_payload(self, item: IngressQueueItem) -> Dict[str, Any]:
        parsed_info = dict(item.parsed_info or {})
        if item.classification_override:
            parsed_info["classification_override"] = item.classification_override
        else:
            parsed_info.pop("classification_override", None)

        return {
            "id": item.id,
            "file_path": item.file_path,
            "file_name": item.file_name,
            "ingress_path": item.ingress_path,
            "file_size": item.file_size,
            "detected_at": self._to_datetime(item.detected_at),
            "queued_at": self._to_datetime(item.queued_at),
            "status": item.status,
            "priority": item.priority,
            "attempts": item.attempts,
            "last_attempt": self._to_datetime(item.last_attempt),
            "processed_at": self._to_datetime(item.processed_at),
            "last_error": item.last_error,
            "confidence_score": item.confidence_score,
            "assignment_id": item.assignment_id,
            "parsed_info": parsed_info,
            "best_match": dict(item.best_match or {}),
            "match_candidates": list(item.match_candidates or []),
            "media_duration_ms": item.media_duration_ms,
            "proposed_path": item.proposed_path,
        }

    def _write_queue_row(self, session: Any, existing: Any, item: IngressQueueItem) -> None:
        payload = self._queue_row_payload(item)
        if existing is None:
            session.add(DBIngressQueueItem(**payload))
        else:
            for key, value in payload.items():
                setattr(existing, key, value)

    def _adopt_row_id(self, item: IngressQueueItem, row_id: str) -> None:
        """Re-key an in-memory item to the persisted row that already tracks its file."""
        with self.lock:
            old_id = item.id
            if old_id == row_id:
                return
            self.items_by_id.pop(old_id, None)
            item.id = row_id
            self.items_by_id[row_id] = item
            self.path_to_item_id[item.file_path] = row_id
            self.item_order = [row_id if i == old_id else i for i in self.item_order]
            if old_id in self._proposal_matches:
                self._proposal_matches[row_id] = self._proposal_matches.pop(old_id)
            if old_id in self._organizing_ids:
                self._organizing_ids.discard(old_id)
                self._organizing_ids.add(row_id)

    async def _persist_queue_item(self, item: IngressQueueItem) -> None:
        if self.db_session_factory is not None:
            try:
                async with self.db_session_factory() as session:
                    existing = await session.get(DBIngressQueueItem, item.id)
                    try:
                        self._write_queue_row(session, existing, item)
                        await session.commit()
                    except IntegrityError:
                        # file_path is unique. The path index normally hands a re-detected file the
                        # id of its row; when it could not (index not loaded, row written elsewhere)
                        # the insert collides. Adopt the row that tracks this file instead of failing.
                        await session.rollback()
                        if existing is not None:
                            raise
                        by_path = await session.execute(
                            select(DBIngressQueueItem).where(DBIngressQueueItem.file_path == item.file_path)
                        )
                        existing = by_path.scalar_one_or_none()
                        if existing is None:
                            raise
                        self._adopt_row_id(item, str(existing.id))
                        self._write_queue_row(session, existing, item)
                        await session.commit()
                self.persisted_paths[item.file_path] = (item.id, item.status)
            except Exception as exc:
                logger.warning(
                    "Failed to persist ingress queue item to database",
                    item_id=item.id,
                    error=str(exc),
                )


    async def _persist_processing_history(self, history_item: Dict[str, Any]) -> None:
        if self.db_session_factory is not None:
            try:
                async with self.db_session_factory() as session:
                    session.add(
                        DBIngressProcessingHistory(
                            queue_item_id=history_item.get("item_id"),
                            snapshot=dict(history_item),
                        )
                    )
                    await session.commit()
            except Exception as exc:
                logger.warning("Failed to persist processing history to database", error=str(exc))


    @staticmethod
    def _is_within_path(path: str, parent: str) -> bool:
        """Return True when path is the same as or nested under parent."""
        try:
            return os.path.commonpath([os.path.abspath(path), os.path.abspath(parent)]) == os.path.abspath(parent)
        except ValueError:
            return False

    def _resolve_source_root(self, item: IngressQueueItem) -> str:
        """Resolve the top-level source folder under ingress root for a queue item."""
        return self._source_root_for(item.file_path, item.ingress_path)

    @staticmethod
    def _infer_source_media_type(source_root: str) -> Optional[str]:
        """Infer whether a source root is likely a TV show based on its structure."""
        normalized_root = os.path.abspath(source_root).replace("\\", "/")
        if re.search(r"/Season\s+\d+(?:/|$)", normalized_root, re.IGNORECASE):
            return "episode"

        try:
            for name in os.listdir(source_root):
                full_path = os.path.join(source_root, name)
                if os.path.isdir(full_path) and re.match(r"^Season\s+\d+$", name, re.IGNORECASE):
                    return "episode"
        except OSError:
            return None

        # Disc-set folders (e.g. "The.Matrix.Disc.2") contain no Season sub-dirs;
        # treat them as movie sources so the parent folder name is used as the title.
        disc_set_name = os.path.basename(source_root.rstrip(os.sep))
        if re.search(r"(?i)[\s._-]+(?:disc|disk|cd|dvd|bd)[\s._-]*\d+$", disc_set_name):
            return "disc_set"

        return None

    def _has_active_items_for_source_root(self, source_root: str, current_item_id: str) -> bool:
        """Check if sibling queue items from the same source root are still unresolved."""
        source_root_abs = os.path.abspath(source_root)
        with self.lock:
            for item in self.items_by_id.values():
                if item.id == current_item_id:
                    continue
                if item.status == QUEUE_COMPLETED:
                    continue
                if self._is_within_path(item.file_path, source_root_abs):
                    return True
        return False

    def _repair_missing_source_path(self, item: IngressQueueItem) -> None:
        """Repair a stale source path when a source folder was moved to Unprocessed."""
        current_path = os.path.abspath(item.file_path)
        if os.path.exists(current_path):
            return

        source_root_abs = self._resolve_source_root(item)
        source_root_abs = os.path.abspath(source_root_abs)
        rel_path = None
        try:
            rel_path = os.path.relpath(current_path, source_root_abs)
        except ValueError:
            rel_path = os.path.basename(current_path)

        unprocessed_root = os.path.join(settings.jellyfin_dest_base, settings.folder_unprocessed)
        if not os.path.isdir(unprocessed_root):
            return

        folder_name = os.path.basename(source_root_abs.rstrip(os.sep))
        candidate_roots = []
        for name in os.listdir(unprocessed_root):
            candidate_root = os.path.join(unprocessed_root, name)
            if not os.path.isdir(candidate_root):
                continue
            if name == folder_name or name.startswith(f"{folder_name} ("):
                candidate_roots.append(candidate_root)

        for candidate_root in candidate_roots:
            candidate_path = os.path.join(candidate_root, rel_path)
            if os.path.exists(candidate_path):
                item.file_path = candidate_path
                item.file_name = os.path.basename(candidate_path)
                logger.info(
                    "Repaired stale ingress source path",
                    item_id=item.id,
                    old_path=current_path,
                    new_path=candidate_path,
                )
                return

    @staticmethod
    def _contains_files(root_path: str) -> bool:
        """Return True if any file exists under root_path."""
        for _, _, files in os.walk(root_path):
            if files:
                return True
        return False

    @staticmethod
    def _contains_video_files(root_path: str) -> bool:
        """Return True when root_path still contains any processable video file."""
        video_exts = {value.lower() for value in settings.supported_video_extensions}
        for _, _, files in os.walk(root_path):
            for name in files:
                if os.path.splitext(name)[1].lower() in video_exts:
                    return True
        return False

    @staticmethod
    def _prune_empty_tree(root_path: str) -> int:
        """Delete empty directories in root_path bottom-up."""
        removed = 0
        if not os.path.isdir(root_path):
            return removed

        for current_root, dirs, _ in os.walk(root_path, topdown=False):
            for dirname in dirs:
                dir_path = os.path.join(current_root, dirname)
                try:
                    os.rmdir(dir_path)
                    removed += 1
                except OSError:
                    continue

        try:
            os.rmdir(root_path)
            removed += 1
        except OSError:
            pass

        return removed

    @staticmethod
    def _unique_destination_path(base_dir: str, folder_name: str) -> str:
        """Build a collision-safe destination folder path."""
        candidate = os.path.join(base_dir, folder_name)
        if not os.path.exists(candidate):
            return candidate

        index = 2
        while True:
            alt = os.path.join(base_dir, f"{folder_name} ({index})")
            if not os.path.exists(alt):
                return alt
            index += 1

    @staticmethod
    def _resolve_target_media_root(proposed_path: Optional[str]) -> Optional[str]:
        """Resolve the parent movie/show folder for passthrough files.

        Only an absolute path, which is where a file was actually organized,
        qualifies. A proposal is relative to the library root, and resolving it
        here would point into the process working directory.
        """
        if not proposed_path or not os.path.isabs(proposed_path):
            return None

        candidate = os.path.abspath(proposed_path)
        if os.path.splitext(candidate)[1]:
            candidate = os.path.dirname(candidate)

        leaf = os.path.basename(candidate.rstrip(os.sep))
        if re.match(r"^Season\s+\d+$", leaf, re.IGNORECASE):
            candidate = os.path.dirname(candidate.rstrip(os.sep))

        return candidate or None

    @staticmethod
    def _merge_directory_contents(source_root: str, destination_root: str) -> int:
        """Move remaining files into destination_root, preserving relative structure."""
        moved_count = 0
        os.makedirs(destination_root, exist_ok=True)

        for name in os.listdir(source_root):
            source_path = os.path.join(source_root, name)
            destination_path = os.path.join(destination_root, name)

            if os.path.isdir(source_path):
                if os.path.isdir(destination_path):
                    moved_count += IngressQueueService._merge_directory_contents(source_path, destination_path)
                    try:
                        os.rmdir(source_path)
                    except OSError:
                        pass
                    continue
                shutil.move(source_path, destination_path)
                moved_count += 1
                continue

            if os.path.exists(destination_path):
                stem, ext = os.path.splitext(name)
                suffix = 2
                while True:
                    alt_path = os.path.join(destination_root, f"{stem} ({suffix}){ext}")
                    if not os.path.exists(alt_path):
                        destination_path = alt_path
                        break
                    suffix += 1

            shutil.move(source_path, destination_path)
            moved_count += 1

        return moved_count

    async def _finalize_source_folder(self, item: IngressQueueItem) -> None:
        """Clean up source folder after successful organization.

        Behavior:
        - If the source root has no files left: remove empty directories.
        - If files remain: move the whole source root under <dest>/Unprocessed.
        """
        source_root = self._resolve_source_root(item)
        source_root_abs = os.path.abspath(source_root)

        if not os.path.isdir(source_root_abs):
            return

        ingress_root_abs = os.path.abspath(item.ingress_path or os.path.dirname(item.file_path))
        if not self._is_within_path(source_root_abs, ingress_root_abs):
            return

        if self._has_active_items_for_source_root(source_root_abs, item.id):
            return

        try:
            if not self._contains_files(source_root_abs):
                removed_count = self._prune_empty_tree(source_root_abs)
                if removed_count:
                    logger.info(
                        "Pruned empty ingress source directories",
                        item_id=item.id,
                        source_root=source_root_abs,
                        removed_count=removed_count,
                    )
                return

            target_media_root = self._resolve_target_media_root(item.proposed_path)
            if target_media_root and not self._contains_video_files(source_root_abs):
                moved_count = self._merge_directory_contents(source_root_abs, target_media_root)
                removed_count = self._prune_empty_tree(source_root_abs)
                logger.info(
                    "Moved remaining non-video ingress files into organized target",
                    item_id=item.id,
                    source_root=source_root_abs,
                    target_root=target_media_root,
                    moved_count=moved_count,
                    removed_count=removed_count,
                )
                return

            unprocessed_root = os.path.join(
                settings.jellyfin_dest_base,
                settings.folder_unprocessed,
            )
            os.makedirs(unprocessed_root, exist_ok=True)

            folder_name = os.path.basename(source_root_abs.rstrip(os.sep))
            destination_root = self._unique_destination_path(unprocessed_root, folder_name)
            shutil.move(source_root_abs, destination_root)

            logger.warning(
                "Moved source folder to Unprocessed after organization",
                item_id=item.id,
                source_root=source_root_abs,
                destination_root=destination_root,
            )
        except Exception as exc:
            logger.warning(
                "Failed to finalize ingress source folder",
                item_id=item.id,
                source_root=source_root_abs,
                error=str(exc),
            )