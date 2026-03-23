"""
Ingress queue service for automated media pipeline.

Maintains in-memory queue state for detected ingress files and exposes
operations for processing, retrying, and tracking status transitions.
"""

import threading
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from services.filename_parser import FilenameParser
from utils.logging import logger


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

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class IngressQueueService:
    """In-memory queue and processing coordinator for ingress files."""

    def __init__(self, parser: Optional[FilenameParser] = None):
        self.parser = parser or FilenameParser()
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

    def process_next_item(self) -> Optional[IngressQueueItem]:
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
            parsed_info = self.parser.parse_filename(candidate.file_name).to_dict()
            confidence_score = self._calculate_confidence(parsed_info)

            with self.lock:
                candidate.parsed_info = parsed_info
                candidate.confidence_score = confidence_score
                candidate.status = (
                    QUEUE_AUTO_ASSIGNED if confidence_score >= 80 else QUEUE_NEEDS_REVIEW
                )
                candidate.processed_at = time.time()

                self.processing_history.append(
                    {
                        "item_id": candidate.id,
                        "file_path": candidate.file_path,
                        "status": candidate.status,
                        "confidence_score": confidence_score,
                        "duration_ms": int((time.time() - start_time) * 1000),
                        "processed_at": candidate.processed_at,
                    }
                )

            return candidate
        except Exception as exc:
            with self.lock:
                candidate.status = QUEUE_FAILED
                candidate.last_error = str(exc)
                candidate.processed_at = time.time()
                self.processing_history.append(
                    {
                        "item_id": candidate.id,
                        "file_path": candidate.file_path,
                        "status": QUEUE_FAILED,
                        "error": str(exc),
                        "duration_ms": int((time.time() - start_time) * 1000),
                        "processed_at": candidate.processed_at,
                    }
                )

            logger.error(
                "Ingress queue item processing failed",
                item_id=candidate.id,
                file_path=candidate.file_path,
                error=str(exc),
            )
            return candidate

    def retry_item(self, item_id: str) -> Optional[IngressQueueItem]:
        """Retry a failed queue item by placing it back into pending state."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_PENDING
            item.last_error = None
            return item

    def mark_complete(self, item_id: str) -> Optional[IngressQueueItem]:
        """Mark an item as fully completed after organization."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_COMPLETED
            item.processed_at = time.time()
            return item

    def mark_failed(self, item_id: str, reason: str) -> Optional[IngressQueueItem]:
        """Mark an item as failed with a reason."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

            item.status = QUEUE_FAILED
            item.last_error = reason
            item.processed_at = time.time()
            return item

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            item = self.items_by_id.get(item_id)
            return item.to_dict() if item else None

    def get_queue_items(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.lock:
            items = [self.items_by_id[item_id] for item_id in self.item_order]
            if status is not None:
                items = [item for item in items if item.status == status]
            return [item.to_dict() for item in items]

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