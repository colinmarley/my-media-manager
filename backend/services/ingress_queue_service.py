"""
Ingress queue service for automated media pipeline.

Maintains in-memory queue state for detected ingress files and exposes
operations for processing, retrying, and tracking status transitions.
"""

import os
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Tuple

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
        pass
    return None


QUEUE_PENDING = "pending"
QUEUE_PROCESSING = "processing"
QUEUE_AUTO_ASSIGNED = "auto_assigned"
QUEUE_NEEDS_REVIEW = "needs_review"
QUEUE_FAILED = "failed"
QUEUE_COMPLETED = "completed"


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

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class IngressQueueService:
    """In-memory queue and processing coordinator for ingress files."""

    def __init__(
        self,
        parser: Optional[FilenameParser] = None,
        auto_matcher_service: Optional[Any] = None,
        firestore_service: Optional[Any] = None,
        assignment_orchestrator: Optional[Any] = None,
        auto_assign_threshold: int = 80,
    ):
        self.parser = parser or FilenameParser()
        self.auto_matcher_service = auto_matcher_service
        self.firestore_service = firestore_service
        self.assignment_orchestrator = assignment_orchestrator
        self.auto_assign_threshold = max(0, min(auto_assign_threshold, 100))
        self.lock = threading.RLock()

        self.items_by_id: Dict[str, IngressQueueItem] = {}
        self.item_order: List[str] = []
        self.path_to_item_id: Dict[str, str] = {}
        self.processing_history: List[Dict[str, Any]] = []

    def add_from_watcher(
        self,
        queued_file: Any,
        priority: int = 5,
    ) -> IngressQueueItem:
        """Add a queued watcher file to the ingress queue."""
        with self.lock:
            existing_id = self.path_to_item_id.get(queued_file.file_path)
            if existing_id is not None:
                return self.items_by_id[existing_id]

            item_id = str(uuid.uuid4())
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
                media_duration_ms=_get_file_duration(queued_file.file_path),
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

    def add_manual_file(self, file_path: str, priority: int = 5) -> IngressQueueItem:
        """Manually add an existing file to the ingress queue.

        Returns the existing item if the file path is already tracked.
        """
        with self.lock:
            existing_id = self.path_to_item_id.get(file_path)
            if existing_id is not None:
                return self.items_by_id[existing_id]

            now = time.time()
            item_id = str(uuid.uuid4())
            file_name = os.path.basename(file_path)
            file_size = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
            queue_item = IngressQueueItem(
                id=item_id,
                file_path=file_path,
                file_name=file_name,
                ingress_path=os.path.dirname(file_path),
                file_size=file_size,
                detected_at=now,
                queued_at=now,
                status=QUEUE_PENDING,
                priority=max(1, min(priority, 10)),
                media_duration_ms=_get_file_duration(file_path),
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

        start_time = time.time()
        try:
            folder_name = os.path.basename(os.path.dirname(candidate.file_path))
            parsed_info = self.parser.parse_filename(
                candidate.file_name, folder_name=folder_name
            ).to_dict()
            match_result = self._run_matcher(parsed_info)
            best_match = match_result.get("best_match") if match_result else None

            confidence_score = None
            if best_match and isinstance(best_match, dict):
                confidence_score = best_match.get("confidence_score")

            if confidence_score is None:
                confidence_score = self._calculate_confidence(parsed_info)

            with self.lock:
                candidate.parsed_info = parsed_info
                candidate.confidence_score = confidence_score
                candidate.best_match = best_match
                candidate.match_candidates = (
                    match_result.get("candidates", []) if match_result else []
                )
                # proposed_path is computed dynamically in get_queue_items() so that
                # main-feature vs special-feature designation can be resolved across
                # all items matched to the same title.
                candidate.status = (
                    QUEUE_AUTO_ASSIGNED
                    if confidence_score >= self.auto_assign_threshold
                    else QUEUE_NEEDS_REVIEW
                )
                candidate.processed_at = time.time()

            if candidate.status == QUEUE_AUTO_ASSIGNED and self.assignment_orchestrator:
                assignment_result = await self._attempt_auto_assignment(candidate)
                with self.lock:
                    if assignment_result:
                        candidate.assignment_id = assignment_result.get("assignment_id")
                        if assignment_result.get("organized"):
                            candidate.status = QUEUE_COMPLETED
                        organization_result = assignment_result.get("organization_result")
                        if organization_result and not organization_result.get("success"):
                            candidate.last_error = organization_result.get("error")

            await self._persist_queue_item(candidate)

            history_item = {
                "item_id": candidate.id,
                "file_path": candidate.file_path,
                "status": candidate.status,
                "confidence_score": confidence_score,
                "assignment_id": candidate.assignment_id,
                "duration_ms": int((time.time() - start_time) * 1000),
                "processed_at": candidate.processed_at,
            }

            with self.lock:
                self.processing_history.append(
                    history_item
                )

            await self._persist_processing_history(history_item)

            return candidate
        except Exception as exc:
            with self.lock:
                candidate.status = QUEUE_FAILED
                candidate.last_error = str(exc)
                candidate.processed_at = time.time()

            await self._persist_queue_item(candidate)

            history_item = {
                "item_id": candidate.id,
                "file_path": candidate.file_path,
                "status": QUEUE_FAILED,
                "error": str(exc),
                "duration_ms": int((time.time() - start_time) * 1000),
                "processed_at": candidate.processed_at,
            }

            with self.lock:
                self.processing_history.append(
                    history_item
                )

            await self._persist_processing_history(history_item)

            logger.error(
                "Ingress queue item processing failed",
                item_id=candidate.id,
                file_path=candidate.file_path,
                error=str(exc),
            )
            return candidate

    async def retry_item(self, item_id: str) -> Optional[IngressQueueItem]:
        """Retry a failed queue item by placing it back into pending state."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_PENDING
            item.last_error = None

        await self._persist_queue_item(item)
        return item

    async def mark_complete(self, item_id: str) -> Optional[IngressQueueItem]:
        """Mark an item as fully completed after organization."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_COMPLETED
            item.processed_at = time.time()

        await self._persist_queue_item(item)
        return item

    async def mark_failed(self, item_id: str, reason: str) -> Optional[IngressQueueItem]:
        """Mark an item as failed with a reason."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_FAILED
            item.last_error = reason
            item.processed_at = time.time()

        await self._persist_queue_item(item)

        history_item = {
            "item_id": item.id,
            "file_path": item.file_path,
            "status": QUEUE_FAILED,
            "error": reason,
            "processed_at": item.processed_at,
        }
        with self.lock:
            self.processing_history.append(history_item)

        await self._persist_processing_history(history_item)
        return item

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            item = self.items_by_id.get(item_id)
            return item.to_dict() if item else None

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
        title = IngressQueueService._sanitize_title(best_match.get("title") or "Unknown")
        year = best_match.get("year")
        return f"{title} ({year})" if year else title

    @staticmethod
    def _build_main_path(file_name: str, best_match: Dict[str, Any]) -> str:
        """Proposed path for the main feature file."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        if media_type in ("episode", "series"):
            season = best_match.get("season")
            season_str = f"Season {int(season):02d}" if season is not None else "Season 01"
            return f"shows/{folder}/{season_str}/{file_name}"
        return f"movies/{folder}/{folder}{ext}"

    @staticmethod
    def _build_special_path(file_name: str, best_match: Dict[str, Any], number: int) -> str:
        """Proposed path for an extra / special-feature file."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        if media_type in ("episode", "series"):
            season = best_match.get("season")
            season_str = f"Season {int(season):02d}" if season is not None else "Season 01"
            return f"shows/{folder}/{season_str}/{file_name}"
        return f"movies/{folder}/Special Feature {number}{ext}"

    def _enrich_proposed_paths(self, items: List[Dict[str, Any]]) -> None:
        """
        Assign proposed_path for each item dict in-place.

        Within each group of items that share the same best_match title+year,
        the file with the longest media duration is considered the main feature
        and gets a Jellyfin-style canonical name (e.g. "Yes Man (2008).mkv").
        All other files in that group are considered special features and are
        named "Special Feature 1.mkv", "Special Feature 2.mkv", etc. (ordered
        by duration descending).

        Items with no best_match are left with proposed_path = None.
        """
        # Build groups: key -> list of indices into items
        groups: Dict[Tuple[str, Any], List[int]] = defaultdict(list)
        for i, item in enumerate(items):
            match = item.get("best_match")
            if match and match.get("title"):
                key: Tuple[str, Any] = (match["title"].lower(), match.get("year"))
                groups[key].append(i)
            else:
                items[i]["proposed_path"] = None

        for indices in groups.values():
            if len(indices) == 1:
                idx = indices[0]
                items[idx]["proposed_path"] = self._build_main_path(
                    items[idx]["file_name"], items[idx]["best_match"]
                )
            else:
                # Longest duration → main feature
                main_idx = max(indices, key=lambda i: items[i].get("media_duration_ms") or 0)
                others = sorted(
                    [i for i in indices if i != main_idx],
                    key=lambda i: items[i].get("media_duration_ms") or 0,
                    reverse=True,
                )
                items[main_idx]["proposed_path"] = self._build_main_path(
                    items[main_idx]["file_name"], items[main_idx]["best_match"]
                )
                for number, idx in enumerate(others, start=1):
                    items[idx]["proposed_path"] = self._build_special_path(
                        items[idx]["file_name"], items[idx]["best_match"], number
                    )

    def get_queue_items(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.lock:
            items = [self.items_by_id[item_id] for item_id in self.item_order]
            if status is not None:
                items = [item for item in items if item.status == status]
            result = [item.to_dict() for item in items]
        self._enrich_proposed_paths(result)
        return result

    def get_queue_status(self) -> Dict[str, Any]:
        with self.lock:
            counts = {
                QUEUE_PENDING: 0,
                QUEUE_PROCESSING: 0,
                QUEUE_AUTO_ASSIGNED: 0,
                QUEUE_NEEDS_REVIEW: 0,
                QUEUE_FAILED: 0,
                QUEUE_COMPLETED: 0,
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

    def clear(self) -> int:
        with self.lock:
            count = len(self.item_order)
            self.items_by_id.clear()
            self.item_order.clear()
            self.path_to_item_id.clear()
            self.processing_history.clear()
            return count

    async def process_pending_items(self, max_items: int = 25) -> List[Dict[str, Any]]:
        """Process up to max_items pending queue items."""
        processed_items: List[Dict[str, Any]] = []

        limit = max(1, min(max_items, 500))
        for _ in range(limit):
            processed = await self.process_next_item()
            if processed is None:
                break
            processed_items.append(processed.to_dict())

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

    async def _attempt_auto_assignment(self, item: IngressQueueItem) -> Optional[Dict[str, Any]]:
        try:
            return await self.assignment_orchestrator.auto_assign(item.to_dict())
        except Exception as exc:
            logger.error(
                "Auto-assignment failed",
                item_id=item.id,
                file_path=item.file_path,
                error=str(exc),
            )
            return None

    async def _persist_queue_item(self, item: IngressQueueItem) -> None:
        if self.firestore_service is None:
            return

        try:
            await self.firestore_service.save_ingress_queue_item(item.to_dict())
        except Exception as exc:
            logger.warning(
                "Failed to persist ingress queue item",
                item_id=item.id,
                error=str(exc),
            )

    async def _persist_processing_history(self, history_item: Dict[str, Any]) -> None:
        if self.firestore_service is None:
            return

        try:
            await self.firestore_service.save_ingress_processing_history(history_item)
        except Exception as exc:
            logger.warning("Failed to persist processing history", error=str(exc))