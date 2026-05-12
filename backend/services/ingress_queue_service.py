"""
Ingress queue service for automated media pipeline.

Maintains in-memory queue state for detected ingress files and exposes
operations for processing, retrying, and tracking status transitions.
"""

import os
import re
import shutil
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select

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
        pass
    return None


QUEUE_PENDING = "pending"
QUEUE_PROCESSING = "processing"
QUEUE_AUTO_ASSIGNED = "auto_assigned"
QUEUE_NEEDS_REVIEW = "needs_review"
QUEUE_FAILED = "failed"
QUEUE_COMPLETED = "completed"
QUEUE_ACTIVE_STATUSES = {QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_AUTO_ASSIGNED}
VALID_CLASSIFICATION_OVERRIDES = {"main_feature", "special_feature", "alternate_version"}


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


class IngressQueueService:
    """In-memory queue and processing coordinator for ingress files."""

    def __init__(
        self,
        parser: Optional[FilenameParser] = None,
        auto_matcher_service: Optional[Any] = None,
        firestore_service: Optional[Any] = None,
        assignment_orchestrator: Optional[Any] = None,
        auto_assign_threshold: int = 80,
        db_session_factory: Optional[Any] = None,
    ):
        self.parser = parser or FilenameParser()
        self.auto_matcher_service = auto_matcher_service
        self.firestore_service = firestore_service
        self.assignment_orchestrator = assignment_orchestrator
        self.auto_assign_threshold = max(0, min(auto_assign_threshold, 100))
        self.db_session_factory = db_session_factory
        self.lock = threading.RLock()

        self.items_by_id: Dict[str, IngressQueueItem] = {}
        self.item_order: List[str] = []
        self.path_to_item_id: Dict[str, str] = {}
        self.processing_history: List[Dict[str, Any]] = []

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
                if existing_item.status not in {QUEUE_PENDING, QUEUE_PROCESSING}:
                    existing_item.status = QUEUE_PENDING
                    existing_item.last_error = None
                    existing_item.processed_at = None
                    existing_item.queued_at = time.time()
                    existing_item.priority = max(1, min(priority, 10))
                return existing_item

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
            item_id = str(uuid.uuid4())
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
                has_best_match = isinstance(best_match, dict) and bool(best_match)
                # proposed_path is computed dynamically in get_queue_items() so that
                # main-feature vs special-feature designation can be resolved across
                # all items matched to the same title.
                candidate.status = (
                    QUEUE_AUTO_ASSIGNED
                    if has_best_match and confidence_score >= self.auto_assign_threshold
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

    async def update_classification(
        self,
        item_id: str,
        classification: Optional[str],
    ) -> Optional[IngressQueueItem]:
        """Override the proposed queue classification before acceptance."""
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

        self._prime_organization_hints_for_item(item)
        await self._persist_queue_item(item)
        await self._record_history_event(
            item,
            "classification_updated",
            {
                "classification_override": normalized,
            },
        )
        return item

    async def mark_complete(self, item_id: str) -> Optional[IngressQueueItem]:
        """Mark an item complete and attempt organization to Jellyfin."""
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

        organization_error: Optional[str] = None
        organized = False
        assignment_id: Optional[str] = None

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

            if assignment_result and assignment_result.get("organized"):
                await self._finalize_source_folder(item)

            if assignment_id:
                item.assignment_id = assignment_id
            if assignment_result:
                item.proposed_path = self._extract_organized_path(assignment_result)

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

        await self._persist_queue_item(item)
        await self._record_history_event(
            item,
            "accepted_assignment",
            {
                "organized": organized,
                "organization_error": organization_error,
            },
        )
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
        with self.lock:
            item = self.items_by_id.get(item_id)
            if item is None:
                return None

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
            "media_id": match_payload.get("media_id") or match_payload.get("firebase_media_id") or match_payload.get("imdb_id"),
            "firebase_media_id": match_payload.get("firebase_media_id"),
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

        if assignment_result and assignment_result.get("organized"):
            await self._finalize_source_folder(item)

        with self.lock:
            if assignment_result:
                item.assignment_id = assignment_result.get("assignment_id")
                item.proposed_path = self._extract_organized_path(assignment_result)
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
                return f"shows/{folder}/{season_str}/{folder} {ep_str}{ep_label}{ext}"
            # Season-pack or unknown episode — keep original filename for manual ID
            return f"shows/{folder}/{season_str}/{file_name}"
        if media_type == "documentary":
            return f"Documentaries/{folder}/{folder}{ext}"
        if media_type == "live_performance":
            return f"Live Performances/{folder}/{folder}{ext}"
        return f"Movies/{folder}/{folder}{ext}"

    @staticmethod
    def _build_version_path(file_name: str, best_match: Dict[str, Any], version_number: int) -> str:
        """Proposed path for an alternate version of an already-processed movie."""
        ext = os.path.splitext(file_name)[1]
        folder = IngressQueueService._folder_title(best_match)
        media_type = best_match.get("media_type", "movie")
        subfolder = {
            "documentary": "Documentaries",
            "live_performance": "Live Performances",
        }.get(media_type, "Movies")
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
            return f"shows/{folder}/{season_str}/{file_name}"
        if media_type == "documentary":
            return f"Documentaries/{folder}/Special Feature {number}{ext}"
        if media_type == "live_performance":
            return f"Live Performances/{folder}/Special Feature {number}{ext}"
        return f"Movies/{folder}/Special Feature {number}{ext}"

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

        Any item still without a proposed path after all groups are resolved is
        written to the _NeedsReview folder so nothing is left unprocessed.
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
            file_path = item.get("file_path")
            ingress_root = item.get("ingress_path")
            if not file_path:
                return os.path.abspath(ingress_root or ".")

            file_path_abs = os.path.abspath(file_path)
            ingress_root_abs = os.path.abspath(ingress_root or os.path.dirname(file_path_abs))
            if self._is_within_path(file_path_abs, ingress_root_abs):
                rel = os.path.relpath(file_path_abs, ingress_root_abs)
                top_segment = rel.split(os.sep, 1)[0]
                if top_segment and top_segment not in (".", ".."):
                    return os.path.join(ingress_root_abs, top_segment)
            return os.path.dirname(file_path_abs)

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

        def _fallback_title(item: Dict[str, Any], match: Dict[str, Any]) -> Optional[str]:
            parsed_info = item.get("parsed_info") or {}
            source_root = os.path.basename(_source_root_key(item))
            return (
                match.get("title")
                or parsed_info.get("title")
                or source_root
                or os.path.basename(item.get("ingress_path") or "")
                or None
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

        for i, item in enumerate(items):
            if item.get("proposed_path"):
                # Preserve already-resolved destination paths captured from
                # successful organization operations.
                continue

            source_root = _source_root_key(item)
            if source_root:
                source_root_groups[source_root].append(i)

            match = item.get("best_match")
            if match and isinstance(match, dict):
                title = _fallback_title(item, match)
                if title:
                    key: Tuple[str, Any] = (title.lower(), match.get("year"))
                    groups[key].append(i)
                else:
                    items[i]["proposed_path"] = None
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
                if i != anchor_idx and _looks_like_companion_item(items[i])
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

        # ── Zero-unprocessed guarantee ────────────────────────────────────────
        # Any item still without a proposed path is routed to _NeedsReview so
        # nothing is ever left in an unprocessed state.
        for item in items:
            if item.get("proposed_path"):
                continue
            raw_name = item.get("file_name") or "unknown"
            stem, ext = os.path.splitext(raw_name)
            review_name = f"{stem} - NEEDS REVIEW{ext}"
            item["proposed_path"] = os.path.join(settings.folder_needs_review, review_name)
            item.setdefault("needs_review", True)

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

    def _apply_resolved_path_hints(
        self,
        item: IngressQueueItem,
        resolved_item: Dict[str, Any],
    ) -> None:
        """Apply proposed-path-derived organization hints back onto the live queue item."""
        item.proposed_path = resolved_item.get("proposed_path")
        item.is_alternate_version = False
        item.version_number = None
        item.special_feature_number = None
        item.unknown_episode_label = None

        resolved_match = resolved_item.get("best_match")
        if isinstance(resolved_match, dict) and resolved_match:
            item.best_match = resolved_match

        proposed_path = item.proposed_path or ""
        if not proposed_path:
            return

        stem = os.path.splitext(os.path.basename(proposed_path))[0]
        media_type = ((item.best_match or {}).get("media_type") or "movie").lower()

        if media_type in ("movie", "documentary", "live_performance"):
            version_match = re.search(r"\s+-\s+Version\s+(\d+)$", stem, re.IGNORECASE)
            special_match = re.match(r"^Special Feature\s+(\d+)$", stem, re.IGNORECASE)
            if version_match:
                item.is_alternate_version = True
                item.version_number = int(version_match.group(1))
            elif special_match:
                item.special_feature_number = int(special_match.group(1))
            return

        if media_type in ("episode", "series"):
            parsed_info = item.parsed_info or {}
            if (item.best_match or {}).get("season") is None and parsed_info.get("season") is not None:
                item.best_match = dict(item.best_match or {})
                item.best_match["season"] = parsed_info.get("season")
            if (item.best_match or {}).get("episode") is None and parsed_info.get("episode") is not None:
                item.best_match = dict(item.best_match or {})
                item.best_match["episode"] = parsed_info.get("episode")

            if (item.best_match or {}).get("episode") is None:
                item.unknown_episode_label = stem
            elif re.search(r"Unknown Episode\s+\d+", stem, re.IGNORECASE):
                item.unknown_episode_label = stem

    def _prime_organization_hints_for_item(self, item: IngressQueueItem) -> None:
        """Resolve main-feature versus duplicate/special-file hints for the given queue item."""
        if not isinstance(item.best_match, dict) or not item.best_match:
            item.proposed_path = None
            item.is_alternate_version = False
            item.version_number = None
            item.special_feature_number = None
            item.unknown_episode_label = None
            return

        if item.media_duration_ms is None:
            item.media_duration_ms = _get_file_duration(item.file_path)

        with self.lock:
            snapshot = [self.items_by_id[item_id].to_dict() for item_id in self.item_order]

        for snapshot_item in snapshot:
            if snapshot_item.get("id") != item.id:
                continue
            snapshot_item["best_match"] = dict(item.best_match or {})
            snapshot_item["parsed_info"] = dict(item.parsed_info or {})
            snapshot_item["media_duration_ms"] = item.media_duration_ms
            snapshot_item["proposed_path"] = None
            break

        self._enrich_proposed_paths(snapshot)

        resolved_item = next((entry for entry in snapshot if entry.get("id") == item.id), None)
        if resolved_item is not None:
            self._apply_resolved_path_hints(item, resolved_item)

    async def _attempt_auto_assignment(
        self,
        item: IngressQueueItem,
        force_organize: bool = False,
    ) -> Optional[Dict[str, Any]]:
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

    async def _persist_queue_item(self, item: IngressQueueItem) -> None:
        if self.db_session_factory is not None:
            try:
                async with self.db_session_factory() as session:
                    existing = await session.get(DBIngressQueueItem, item.id)
                    parsed_info = dict(item.parsed_info or {})
                    if item.classification_override:
                        parsed_info["classification_override"] = item.classification_override
                    else:
                        parsed_info.pop("classification_override", None)

                    payload = {
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
                    if existing is None:
                        session.add(DBIngressQueueItem(**payload))
                    else:
                        for key, value in payload.items():
                            setattr(existing, key, value)
                    await session.commit()
            except Exception as exc:
                logger.warning(
                    "Failed to persist ingress queue item to database",
                    item_id=item.id,
                    error=str(exc),
                )

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

        if self.firestore_service is None:
            return

        try:
            await self.firestore_service.save_ingress_processing_history(history_item)
        except Exception as exc:
            logger.warning("Failed to persist processing history", error=str(exc))

    @staticmethod
    def _is_within_path(path: str, parent: str) -> bool:
        """Return True when path is the same as or nested under parent."""
        try:
            return os.path.commonpath([os.path.abspath(path), os.path.abspath(parent)]) == os.path.abspath(parent)
        except ValueError:
            return False

    def _resolve_source_root(self, item: IngressQueueItem) -> str:
        """Resolve the top-level source folder under ingress root for a queue item."""
        file_path = os.path.abspath(item.file_path)
        ingress_root = os.path.abspath(item.ingress_path or os.path.dirname(file_path))

        if self._is_within_path(file_path, ingress_root):
            rel = os.path.relpath(file_path, ingress_root)
            top_segment = rel.split(os.sep, 1)[0]
            if top_segment and top_segment not in (".", ".."):
                return os.path.join(ingress_root, top_segment)

        return os.path.dirname(file_path)

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
        """Resolve the parent movie/show folder for passthrough files."""
        if not proposed_path:
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