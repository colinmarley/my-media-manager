"""
Ingress file watcher service.

This service monitors one or more ingress directories for newly created or
modified media files, waits for writes to settle, and then queues stable files
for downstream processing.
"""

import os
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any, Callable, Deque, Dict, List, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

from config.settings import settings
from services.filesystem_manager import FileSystemManager
from utils.exceptions import ScanOperationError
from utils.logging import logger


@dataclass
class PendingIngressFile:
    """Tracks a file that has been detected but is not yet stable."""

    file_path: str
    first_detected_at: float
    last_event_at: float
    last_event_type: str
    last_size: Optional[int] = None
    last_mtime: Optional[float] = None
    stable_since: Optional[float] = None
    event_count: int = 1


@dataclass
class QueuedIngressFile:
    """Represents a stable ingress file that is ready for processing."""

    file_path: str
    file_name: str
    ingress_path: str
    detected_at: float
    queued_at: float
    file_size: int
    last_event_type: str


class _IngressEventHandler(FileSystemEventHandler):
    """Watchdog event bridge for the file watcher service."""

    def __init__(self, watcher_service: "FileWatcherService"):
        self.watcher_service = watcher_service

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.watcher_service.on_file_created(event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self.watcher_service.on_file_modified(event.src_path)


class FileWatcherService:
    """Monitors ingress folders and queues stable media files for processing."""

    def __init__(
        self,
        file_manager: Optional[FileSystemManager] = None,
        queue_callback: Optional[Callable[[QueuedIngressFile], None]] = None,
    ):
        self.file_manager = file_manager or FileSystemManager()
        self.queue_callback = queue_callback
        self.supported_extensions = {
            extension.lower() for extension in settings.supported_video_extensions
        }

        self.file_stability_wait_seconds = settings.ingress_file_stability_wait_seconds
        self.event_debounce_seconds = settings.ingress_debounce_seconds
        self.stability_poll_interval_seconds = (
            settings.ingress_stability_poll_interval_seconds
        )
        self.watch_recursive = settings.ingress_watch_recursive
        self.use_polling_watcher = settings.ingress_use_polling_watcher

        self.observer: Optional[Observer] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.lock = threading.RLock()

        self.watched_paths: List[str] = []
        self.pending_files: Dict[str, PendingIngressFile] = {}
        self.processing_queue: Deque[QueuedIngressFile] = deque()
        self.queued_file_paths: set[str] = set()
        self.processed_event_count = 0
        self.initial_queue_status: Dict[str, Any] = {
            "in_progress": False,
            "scanned_files": 0,
            "queued_files": 0,
            "started_at": None,
            "completed_at": None,
            "last_file": None,
            "last_error": None,
        }

    @staticmethod
    def _is_network_path(path: str) -> bool:
        """Return True if *path* looks like a UNC or SMB network path."""
        # Normalise backslashes so both UNC forms are caught
        p = path.replace("\\", "/")
        return p.startswith("//")

    def start_watching(
        self,
        ingress_paths: List[str],
        use_polling: Optional[bool] = None,
        recursive: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Start monitoring the provided ingress directories."""
        with self.lock:
            if self.is_running:
                # Idempotent start: return current status when watcher is already active.
                return self.get_status()

            normalized_paths = self._normalize_ingress_paths(ingress_paths)
            if not normalized_paths:
                raise ScanOperationError("At least one ingress path is required")

            use_polling_resolved = use_polling if use_polling is not None else self.use_polling_watcher
            # Auto-upgrade to polling for any network path (PollingObserver works
            # over SMB/NFS; the default inotify-backed Observer does not).
            if not use_polling_resolved:
                for p in normalized_paths:
                    if self._is_network_path(p):
                        use_polling_resolved = True
                        logger.info(
                            "Network path detected — switching to PollingObserver",
                            path=p,
                        )
                        break

            if use_polling_resolved:
                timeout = settings.ingress_polling_observer_timeout_seconds
                observer_class = lambda: PollingObserver(timeout=timeout)  # noqa: E731
            else:
                observer_class = Observer  # type: ignore[assignment]
            # Wrap in a callable for uniform instantiation below
            _make_observer = observer_class if use_polling_resolved else lambda: observer_class()
            should_watch_recursively = (
                recursive if recursive is not None else self.watch_recursive
            )

            self.observer = _make_observer()
            self.stop_event.clear()
            self.pending_files.clear()
            self.watched_paths = normalized_paths

            event_handler = _IngressEventHandler(self)
            for ingress_path in normalized_paths:
                self.observer.schedule(
                    event_handler,
                    ingress_path,
                    recursive=should_watch_recursively,
                )

            self.observer.start()
            self.worker_thread = threading.Thread(
                target=self._process_pending_files,
                name="ingress-file-watcher",
                daemon=True,
            )
            self.worker_thread.start()

        logger.info(
            "File watcher started",
            ingress_paths=normalized_paths,
            recursive=should_watch_recursively,
            polling=use_polling_resolved,
        )
        return self.get_status()

    def stop_watching(self) -> Dict[str, Any]:
        """Stop monitoring ingress directories."""
        observer = None
        worker_thread = None

        with self.lock:
            observer = self.observer
            worker_thread = self.worker_thread
            self.stop_event.set()
            self.observer = None
            self.worker_thread = None
            self.pending_files.clear()
            self.watched_paths = []

        if observer is not None:
            observer.stop()
            observer.join(timeout=5)

        if worker_thread is not None and worker_thread.is_alive():
            worker_thread.join(timeout=5)

        logger.info("File watcher stopped")
        return self.get_status()

    def on_file_created(self, file_path: str) -> bool:
        """Handle new file events from watchdog."""
        return self._register_file_event(file_path, "created")

    def on_file_modified(self, file_path: str) -> bool:
        """Handle file modification events from watchdog."""
        return self._register_file_event(file_path, "modified")

    def is_file_stable(self, file_path: str) -> bool:
        """Check whether a detected file has stopped changing."""
        normalized_path = os.path.abspath(file_path)
        current_time = time.time()

        with self.lock:
            pending_file = self.pending_files.get(normalized_path)
            if pending_file is None:
                return False

        if not os.path.exists(normalized_path) or not os.path.isfile(normalized_path):
            with self.lock:
                self.pending_files.pop(normalized_path, None)
            return False

        try:
            stat_result = os.stat(normalized_path)
        except OSError:
            return False

        if self.file_manager.is_file_locked(normalized_path):
            return False

        with self.lock:
            pending_file = self.pending_files.get(normalized_path)
            if pending_file is None:
                return False

            if (
                pending_file.last_size != stat_result.st_size
                or pending_file.last_mtime != stat_result.st_mtime
            ):
                pending_file.last_size = stat_result.st_size
                pending_file.last_mtime = stat_result.st_mtime
                pending_file.stable_since = None
                return False

            if pending_file.stable_since is None:
                pending_file.stable_since = current_time
                return False

            return (
                current_time - pending_file.stable_since
            ) >= self.file_stability_wait_seconds

    def queue_for_processing(self, file_path: str) -> Optional[QueuedIngressFile]:
        """Queue a stable file for downstream processing."""
        normalized_path = os.path.abspath(file_path)
        if not os.path.exists(normalized_path):
            return None

        try:
            stat_result = os.stat(normalized_path)
        except OSError:
            return None

        with self.lock:
            if normalized_path in self.queued_file_paths:
                self.pending_files.pop(normalized_path, None)
                return None

            pending_file = self.pending_files.pop(normalized_path, None)
            if pending_file is None:
                return None

            queue_item = QueuedIngressFile(
                file_path=normalized_path,
                file_name=os.path.basename(normalized_path),
                ingress_path=self._get_ingress_root(normalized_path),
                detected_at=pending_file.first_detected_at,
                queued_at=time.time(),
                file_size=stat_result.st_size,
                last_event_type=pending_file.last_event_type,
            )
            self.processing_queue.append(queue_item)
            self.queued_file_paths.add(normalized_path)
            self.processed_event_count += 1

        logger.info(
            "Ingress file queued for processing",
            file_path=normalized_path,
            file_size=stat_result.st_size,
            queue_size=len(self.processing_queue),
        )

        if self.queue_callback is not None:
            try:
                self.queue_callback(queue_item)
            except Exception as exc:
                logger.error(
                    "File watcher queue callback failed",
                    file_path=normalized_path,
                    error=str(exc),
                )

        return queue_item

    def dequeue_file(self) -> Optional[QueuedIngressFile]:
        """Pop the next queued file, if one is available."""
        with self.lock:
            if not self.processing_queue:
                return None

            queue_item = self.processing_queue.popleft()
            self.queued_file_paths.discard(queue_item.file_path)
            return queue_item

    def clear_queue(self) -> int:
        """Remove all queued files and return the number of items cleared."""
        with self.lock:
            cleared_count = len(self.processing_queue)
            self.processing_queue.clear()
            self.queued_file_paths.clear()
            return cleared_count

    def begin_initial_queue_scan(self) -> None:
        """Mark background queueing of existing files as started."""
        with self.lock:
            self.initial_queue_status = {
                "in_progress": True,
                "scanned_files": 0,
                "queued_files": 0,
                "started_at": time.time(),
                "completed_at": None,
                "last_file": None,
                "last_error": None,
            }

    def update_initial_queue_scan(
        self,
        *,
        scanned_increment: int = 0,
        queued_increment: int = 0,
        last_file: Optional[str] = None,
        last_error: Optional[str] = None,
    ) -> None:
        """Update progress for background queueing of existing files."""
        with self.lock:
            self.initial_queue_status["scanned_files"] += max(0, scanned_increment)
            self.initial_queue_status["queued_files"] += max(0, queued_increment)
            if last_file is not None:
                self.initial_queue_status["last_file"] = last_file
            if last_error is not None:
                self.initial_queue_status["last_error"] = last_error

    def finish_initial_queue_scan(self, error: Optional[str] = None) -> None:
        """Mark background queueing of existing files as completed."""
        with self.lock:
            self.initial_queue_status["in_progress"] = False
            self.initial_queue_status["completed_at"] = time.time()
            if error is not None:
                self.initial_queue_status["last_error"] = error

    def get_status(self) -> Dict[str, Any]:
        """Return the current watcher state."""
        with self.lock:
            return {
                "is_running": self.is_running,
                "watched_paths": list(self.watched_paths),
                "pending_count": len(self.pending_files),
                "queue_count": len(self.processing_queue),
                "processed_event_count": self.processed_event_count,
                "queued_files": [asdict(item) for item in list(self.processing_queue)],
                "initial_queue": dict(self.initial_queue_status),
            }

    @property
    def is_running(self) -> bool:
        """Whether the underlying watchdog observer is active."""
        return self.observer is not None and self.observer.is_alive()

    def _register_file_event(self, file_path: str, event_type: str) -> bool:
        normalized_path = os.path.abspath(file_path)
        if not self._should_track_file(normalized_path):
            return False

        current_time = time.time()
        size = None
        mtime = None
        if os.path.exists(normalized_path):
            try:
                stat_result = os.stat(normalized_path)
                size = stat_result.st_size
                mtime = stat_result.st_mtime
            except OSError:
                pass

        with self.lock:
            existing = self.pending_files.get(normalized_path)
            if existing is None:
                self.pending_files[normalized_path] = PendingIngressFile(
                    file_path=normalized_path,
                    first_detected_at=current_time,
                    last_event_at=current_time,
                    last_event_type=event_type,
                    last_size=size,
                    last_mtime=mtime,
                )
            else:
                existing.last_event_at = current_time
                existing.last_event_type = event_type
                existing.last_size = size
                existing.last_mtime = mtime
                existing.stable_since = None
                existing.event_count += 1

        logger.info(
            "Ingress file event detected",
            file_path=normalized_path,
            event_type=event_type,
        )
        return True

    def _process_pending_files(self) -> None:
        """Background loop that promotes stable files into the processing queue."""
        while not self.stop_event.wait(self.stability_poll_interval_seconds):
            with self.lock:
                pending_paths = list(self.pending_files.keys())

            for file_path in pending_paths:
                with self.lock:
                    pending_file = self.pending_files.get(file_path)
                    if pending_file is None:
                        continue
                    idle_seconds = time.time() - pending_file.last_event_at

                if idle_seconds < self.event_debounce_seconds:
                    continue

                if self.is_file_stable(file_path):
                    self.queue_for_processing(file_path)

    def _normalize_ingress_paths(self, ingress_paths: List[str]) -> List[str]:
        normalized_paths: List[str] = []
        seen_paths = set()

        for ingress_path in ingress_paths:
            if not ingress_path:
                continue

            normalized_path = os.path.abspath(ingress_path)
            if normalized_path in seen_paths:
                continue

            if not os.path.exists(normalized_path):
                raise ScanOperationError(
                    f"Ingress path does not exist: {normalized_path}"
                )

            if not os.path.isdir(normalized_path):
                raise ScanOperationError(
                    f"Ingress path must be a directory: {normalized_path}"
                )

            seen_paths.add(normalized_path)
            normalized_paths.append(normalized_path)

        return normalized_paths

    def _get_ingress_root(self, file_path: str) -> str:
        normalized_path = os.path.abspath(file_path)
        normalized_path_lower = normalized_path.lower()

        for ingress_path in self.watched_paths:
            ingress_path_lower = ingress_path.lower()
            if normalized_path_lower.startswith(ingress_path_lower):
                return ingress_path

        return os.path.dirname(normalized_path)

    def _should_track_file(self, file_path: str) -> bool:
        file_name = os.path.basename(file_path)
        if not file_name or file_name.startswith("."):
            return False

        file_extension = os.path.splitext(file_name)[1].lower()
        if file_extension not in self.supported_extensions:
            return False

        if self.watched_paths:
            normalized_path_lower = os.path.abspath(file_path).lower()
            watched_path_matches = any(
                normalized_path_lower.startswith(ingress_path.lower())
                for ingress_path in self.watched_paths
            )
            if not watched_path_matches:
                return False

        return True