"""
Library inventory: reconcile ``media_files`` with what is on disk.

One scan, in order:

a. **heal** — rows still at the source of a recorded, done, not-undone
   ``ingest_operations`` move whose file is now at the destination are
   relocated there;
b. **walk** — the four category folders (Movies, TV Shows, Documentaries,
   Live Performances) with ``os.scandir`` in a thread, video files only;
c. **diff** — rows against files by path, size and mtime;
d. **moves** — a vanished row and a new path with the same size and the same
   name or mtime (unique on both sides) are one file that moved: the row is
   relocated, not deleted and re-created;
e. **link** — each file's title folder is matched to a ``movies`` / ``series``
   row by its stored folder path (``jellyfin_info.folderPath`` or
   ``raw_data.folderPath``), else by the ``[imdbid-tt…]`` tag; catalog rows are
   never created, and an ambiguous match is left alone. Role, season / episode,
   ``location`` and ``relative_path`` are set from the path;
f. **probe** — new and changed files get mediainfo, a few per scan, one at a
   time, each in a thread with a timeout; a failure is recorded and not
   retried until the file changes; skipped while the ingest queue is busy;
g. **missing** — files no longer found are marked unavailable, but only when
   the library is mounted and not too many vanished at once (an unmounted
   share looks like everything vanished). Files that come back are marked
   available again.

Single-flight (one scan at a time), cancellable, with progress in
:meth:`LibraryInventoryService.status`.
"""

from __future__ import annotations

import asyncio
import os
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from config.settings import settings
from services import media_file_index, storage_paths
from services.library_path_parser import (
    ROLE_MAIN,
    ROLE_OTHER,
    parse_library_relative,
    title_key,
)
from utils.logging import logger

# The category media types, in the order they are walked.
CATEGORY_TYPES = ("movie", "episode", "documentary", "live_performance")
SKIPPED_EXTENSIONS = {".strm", ".iso"}
# CIFS / FAT report mtimes to the second or two; closer than this is "the same".
MTIME_TOLERANCE_SECONDS = 2.0
_CHUNK = 500

Seen = Dict[str, Tuple[int, float]]  # normalized path -> (size, mtime)


class InventoryScanRunning(Exception):
    """A scan is already running."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def video_extensions() -> Set[str]:
    """What the ingest queue / watcher treat as video, minus ``.strm`` / ``.iso``."""
    return {ext.lower() for ext in settings.supported_video_extensions} - SKIPPED_EXTENSIONS


def default_mount_check() -> bool:
    """Whether ``settings.nas_mount_check_path`` is mounted (just present, off Linux)."""
    path = settings.nas_mount_check_path
    if not path:
        return True
    if os.name == "posix":
        return os.path.ismount(path)
    return os.path.isdir(path)


# ---------------------------------------------------------------------------
# Filesystem walk (runs in a thread)
# ---------------------------------------------------------------------------

def walk_roots(
    roots: Iterable[str],
    extensions: Set[str],
    cancel: Optional[threading.Event] = None,
) -> Seen:
    """Every video file under ``roots``: ``{normalized path: (size, mtime)}``.

    Hidden entries (``.``) and NAS metadata folders (``@eaDir``) are skipped;
    symlinks are not followed.
    """
    seen: Seen = {}
    stack = [root for root in roots if root]
    while stack:
        if cancel is not None and cancel.is_set():
            break
        directory = stack.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    name = entry.name
                    if name.startswith(".") or name.startswith("@"):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                            continue
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        if os.path.splitext(name)[1].lower() not in extensions:
                            continue
                        stat = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    seen[media_file_index.normalize_path(entry.path)] = (int(stat.st_size), float(stat.st_mtime))
        except OSError as exc:
            logger.warning("Inventory could not read a folder", path=directory, error=str(exc))
    return seen


# ---------------------------------------------------------------------------
# Pure decisions
# ---------------------------------------------------------------------------

def _timestamp(value: Any) -> Optional[float]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.timestamp()
    if isinstance(value, (int, float)):
        return float(value)
    return None


def same_mtime(a: Any, b: Any) -> bool:
    ta, tb = _timestamp(a), _timestamp(b)
    return ta is not None and tb is not None and abs(ta - tb) <= MTIME_TOLERANCE_SECONDS


def content_changed(known_size: Any, known_mtime: Any, size: int, mtime: float) -> bool:
    """Whether the file differs from what the row recorded (unknown values never count as a change)."""
    if known_size is not None and int(known_size) != int(size):
        return True
    if known_mtime is not None and not same_mtime(known_mtime, mtime):
        return True
    return False


def diff_inventory(known: Dict[str, Tuple[Any, Any]], seen: Seen) -> Dict[str, List[str]]:
    """Split paths into ``new`` / ``changed`` / ``unchanged`` / ``vanished``.

    ``known`` maps a row's path to its recorded (size, mtime); ``seen`` is the walk.
    """
    new = sorted(path for path in seen if path not in known)
    vanished = sorted(path for path in known if path not in seen)
    changed: List[str] = []
    unchanged: List[str] = []
    for path in sorted(set(known) & set(seen)):
        size, mtime = seen[path]
        known_size, known_mtime = known[path]
        (changed if content_changed(known_size, known_mtime, size, mtime) else unchanged).append(path)
    return {"new": new, "changed": changed, "unchanged": unchanged, "vanished": vanished}


def detect_moves(vanished: Dict[str, Tuple[Any, Any]], new: Seen) -> List[Tuple[str, str]]:
    """(old, new) pairs for files that moved: same size and the same name or mtime.

    Only unique candidates on both sides pair up; anything ambiguous stays a
    vanish plus a new file.
    """
    import posixpath

    def matches(old_path: str, new_path: str) -> bool:
        old_size, old_mtime = vanished[old_path]
        size, mtime = new[new_path]
        if old_size is None or int(old_size) != int(size):
            return False
        same_name = posixpath.basename(old_path).lower() == posixpath.basename(new_path).lower()
        return same_name or same_mtime(old_mtime, mtime)

    forward: Dict[str, List[str]] = {old: [p for p in new if matches(old, p)] for old in vanished}
    backward: Dict[str, List[str]] = {}
    for old, candidates in forward.items():
        for candidate in candidates:
            backward.setdefault(candidate, []).append(old)
    pairs = [
        (old, candidates[0])
        for old, candidates in forward.items()
        if len(candidates) == 1 and len(backward.get(candidates[0], [])) == 1
    ]
    return sorted(pairs)


def should_abort_missing(vanished_count: int, known_available: int, ratio: float) -> bool:
    """More than ``ratio`` of the known available files vanished in one scan."""
    if vanished_count <= 0:
        return False
    if known_available <= 0:
        return True
    return vanished_count / known_available > ratio


def kind_for_media_type(media_type: Optional[str]) -> Optional[str]:
    """Catalog table for a parsed media type: ``series`` for TV, ``movie`` for the rest."""
    if media_type is None:
        return None
    return "series" if media_type == "series" else "movie"


class TitleIndex:
    """Catalog rows by title-folder key and by IMDb id."""

    def __init__(self) -> None:
        self.by_folder: Dict[str, Set[Tuple[str, str]]] = {}
        self.by_imdb: Dict[str, Set[Tuple[str, str]]] = {}

    def add(self, kind: str, row_id: str, imdb_id: Optional[str], folders: Iterable[Optional[str]]) -> None:
        for folder in folders:
            key = title_key(folder) if folder else None
            if key:
                self.by_folder.setdefault(key, set()).add((kind, row_id))
        if imdb_id:
            self.by_imdb.setdefault(str(imdb_id).strip().lower(), set()).add((kind, row_id))

    def resolve(self, key: Optional[str], imdb_id: Optional[str], kind: Optional[str]) -> Tuple[Optional[str], str]:
        """(row id, how) for a title folder; how is folder / imdb / ambiguous / none."""
        if kind is None:
            return None, "none"
        if key:
            candidates = {row_id for k, row_id in self.by_folder.get(key, set()) if k == kind}
            if len(candidates) == 1:
                return next(iter(candidates)), "folder"
            if len(candidates) > 1:
                return None, "ambiguous"
        if imdb_id:
            candidates = {row_id for k, row_id in self.by_imdb.get(imdb_id.lower(), set()) if k == kind}
            if len(candidates) == 1:
                return next(iter(candidates)), "imdb"
            if len(candidates) > 1:
                return None, "ambiguous"
        return None, "none"


def build_title_index(movies: Iterable[Dict[str, Any]], series: Iterable[Dict[str, Any]]) -> TitleIndex:
    """Index from plain dicts ``{id, imdb_id, folders: [...]}`` (folder paths may disagree)."""
    index = TitleIndex()
    for row in movies:
        index.add("movie", row["id"], row.get("imdb_id"), row.get("folders") or [])
    for row in series:
        index.add("series", row["id"], row.get("imdb_id"), row.get("folders") or [])
    return index


def file_title_key(relative_path: str, parsed: Dict[str, Any]) -> Optional[str]:
    if not parsed.get("title_folder"):
        return None
    category = relative_path.replace("\\", "/").strip("/").split("/")[0]
    return f"{category.lower()}/{parsed['title_folder'].lower()}"


def promote_sole_mains(placements: Dict[str, Dict[str, Any]]) -> None:
    """In a feature folder with no file named like the folder, a single file at
    its root is the main feature (older rips kept their original names)."""
    by_title: Dict[str, List[str]] = {}
    for rel, parsed in placements.items():
        if parsed.get("media_type") in (None, "series") or not parsed.get("title_folder"):
            continue
        by_title.setdefault(file_title_key(rel, parsed) or "", []).append(rel)
    for rels in by_title.values():
        if any(placements[rel]["role"] == ROLE_MAIN for rel in rels):
            continue
        root_others = [
            rel for rel in rels
            if placements[rel]["role"] == ROLE_OTHER and rel.replace("\\", "/").strip("/").count("/") == 2
        ]
        if len(root_others) == 1:
            placements[root_others[0]]["role"] = ROLE_MAIN


def _set(row: Any, name: str, value: Any) -> bool:
    if getattr(row, name, None) != value:
        setattr(row, name, value)
        return True
    return False


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

def _empty_counts() -> Dict[str, int]:
    return {
        "healed": 0,
        "knownFiles": 0,
        "seenFiles": 0,
        "newFiles": 0,
        "changedFiles": 0,
        "movedFiles": 0,
        "vanishedFiles": 0,
        "markedMissing": 0,
        "reappeared": 0,
        "linked": 0,
        "ambiguous": 0,
        "unlinked": 0,
        "probed": 0,
        "probeErrors": 0,
        "probePending": 0,
    }


class LibraryInventoryService:
    """Runs reconcile scans; one at a time."""

    def __init__(
        self,
        db_session_factory: Callable,
        *,
        extractor: Any = None,
        mount_check: Optional[Callable[[], bool]] = None,
        queue_busy: Optional[Callable[[], bool]] = None,
        probe_batch: Optional[int] = None,
        probe_timeout_seconds: Optional[float] = None,
        missing_abort_ratio: Optional[float] = None,
        clock: Optional[Callable[[], datetime]] = None,
    ):
        self.db_session_factory = db_session_factory
        self._extractor = extractor
        self.mount_check = mount_check or default_mount_check
        self.queue_busy = queue_busy or (lambda: False)
        self.probe_batch = settings.inventory_probe_batch if probe_batch is None else probe_batch
        self.probe_timeout_seconds = (
            settings.inventory_probe_timeout_seconds if probe_timeout_seconds is None else probe_timeout_seconds
        )
        self.missing_abort_ratio = (
            settings.inventory_missing_abort_ratio if missing_abort_ratio is None else missing_abort_ratio
        )
        self.clock = clock or _now
        self._lock = asyncio.Lock()
        self._running = False
        self._cancel = threading.Event()
        self._task: Optional[asyncio.Task] = None
        self._progress: Dict[str, Any] = {
            "running": False,
            "phase": "idle",
            "startedAt": None,
            "finishedAt": None,
            "lastError": None,
            "warnings": [],
            "cancelled": False,
            "counts": _empty_counts(),
        }

    # -- status / control -------------------------------------------------
    @property
    def is_running(self) -> bool:
        return self._running

    def status(self) -> Dict[str, Any]:
        progress = dict(self._progress)
        progress["counts"] = dict(progress["counts"])
        progress["warnings"] = list(progress["warnings"])
        for key in ("startedAt", "finishedAt"):
            value = progress.get(key)
            progress[key] = value.isoformat() if isinstance(value, datetime) else value
        return progress

    def start_scan(self) -> bool:
        """Start a scan in the background; False when one is already running."""
        if self._running:
            return False
        self._running = True
        self._progress = {**self._progress, "running": True, "phase": "starting", "cancelled": False}
        self._task = asyncio.create_task(self._run_claimed())
        return True

    async def run_scan(self) -> Dict[str, Any]:
        """Run a scan now and return its final status; raises when one is running."""
        if self._running:
            raise InventoryScanRunning("An inventory scan is already running")
        self._running = True
        return await self._run_claimed()

    def cancel(self) -> bool:
        if not self._running:
            return False
        self._cancel.set()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        return True

    async def wait(self) -> None:
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_claimed(self) -> Dict[str, Any]:
        async with self._lock:
            self._cancel.clear()
            self._progress = {
                "running": True,
                "phase": "starting",
                "startedAt": self.clock(),
                "finishedAt": None,
                "lastError": None,
                "warnings": [],
                "cancelled": False,
                "counts": _empty_counts(),
            }
            try:
                await self._scan()
                self._progress["phase"] = "done"
            except asyncio.CancelledError:
                self._progress["cancelled"] = True
                self._progress["phase"] = "cancelled"
                logger.info("Inventory scan cancelled")
                raise
            except Exception as exc:  # pylint: disable=broad-except
                self._progress["lastError"] = str(exc)
                self._progress["phase"] = "failed"
                logger.error("Inventory scan failed", error=str(exc))
            finally:
                self._progress["running"] = False
                self._progress["finishedAt"] = self.clock()
                self._running = False
                # A scan changes what the To-Do list counts (new, missing,
                # probed, relinked files), so drop the cached summary.
                try:
                    from services import attention_service
                    attention_service.invalidate_summary()
                except Exception:  # pylint: disable=broad-except
                    logger.warning("Could not invalidate the To-Do summary after a scan")
        return self.status()

    def _check_cancel(self) -> None:
        if self._cancel.is_set():
            raise asyncio.CancelledError()

    def _warn(self, message: str) -> None:
        self._progress["warnings"].append(message)
        logger.warning("Inventory scan: " + message)

    @property
    def extractor(self) -> Any:
        if self._extractor is None:
            from services.media_metadata_extractor import MediaMetadataExtractor

            self._extractor = MediaMetadataExtractor()
        return self._extractor

    # -- the scan ---------------------------------------------------------
    async def _scan(self) -> None:
        counts = self._progress["counts"]
        library_root = storage_paths.library_root()
        roots = [root for root in (storage_paths.category_root(t) for t in CATEGORY_TYPES) if root]

        # (a) heal
        self._progress["phase"] = "heal"
        counts["healed"] = await self._heal()
        self._check_cancel()

        # (b) walk
        self._progress["phase"] = "walk"
        library_present = await asyncio.to_thread(os.path.isdir, library_root)
        try:
            mounted = bool(await asyncio.to_thread(self.mount_check))
        except Exception as exc:  # pylint: disable=broad-except
            mounted = False
            self._warn(f"mount check failed: {exc}")
        existing_roots = await asyncio.to_thread(lambda: [root for root in roots if os.path.isdir(root)])
        seen = await asyncio.to_thread(walk_roots, existing_roots, video_extensions(), self._cancel)
        self._check_cancel()
        counts["seenFiles"] = len(seen)

        # (c)-(e) reconcile and link
        self._progress["phase"] = "reconcile"
        reconcile = await self._reconcile(seen, roots, library_root)
        self._check_cancel()

        # (f) probe
        self._progress["phase"] = "probe"
        if self.queue_busy():
            self._warn("probing skipped: the ingest queue is processing")
            counts["probePending"] = len(reconcile["to_probe"])
        else:
            await self._probe(reconcile["to_probe"])

        # (g) missing
        self._progress["phase"] = "missing"
        if not library_present or not mounted:
            self._warn(
                f"missing files not marked: library root {library_root!r} present={library_present}, "
                f"mount {settings.nas_mount_check_path!r} ok={mounted}"
            )
            return
        vanished_ids = reconcile["vanished_ids"]
        if should_abort_missing(len(vanished_ids), reconcile["known_available"], self.missing_abort_ratio):
            message = (
                f"{len(vanished_ids)} of {reconcile['known_available']} known library files vanished in one "
                f"scan (more than {self.missing_abort_ratio:.0%}); nothing marked missing"
            )
            self._progress["lastError"] = message
            self._warn(message)
            return
        counts["markedMissing"] = await self._mark_missing(vanished_ids)

    async def _heal(self) -> int:
        from sqlalchemy import select
        from db.models import IngestOperation, MediaFile

        healed = 0
        async with self.db_session_factory() as session:
            result = await session.execute(
                select(IngestOperation)
                .where(
                    IngestOperation.op == "move",
                    IngestOperation.status == "done",
                    IngestOperation.undone_at.is_(None),
                )
                .order_by(IngestOperation.created_at)
            )
            operations = [op for op in result.scalars().all() if op.src and op.dst]
            if not operations:
                return 0
            hops = media_file_index.next_hops((op.src, op.dst) for op in operations)
            sources = list(hops)
            rows: List[Any] = []
            for start in range(0, len(sources), _CHUNK):
                chunk = sources[start:start + _CHUNK]
                found = await session.execute(select(MediaFile).where(MediaFile.file_path.in_(chunk)))
                rows.extend(found.scalars().all())
            for row in rows:
                final = media_file_index.follow(row.file_path, hops)
                if final == row.file_path:
                    continue
                gone = not await asyncio.to_thread(os.path.exists, row.file_path)
                arrived = await asyncio.to_thread(os.path.isfile, final)
                if not (gone and arrived):
                    continue  # moved back by hand (reset-to-encoded), or gone from both
                await media_file_index.relocate(session, row.file_path, final, row=row)
                healed += 1
            await session.commit()
        return healed

    async def _load_title_index(self, session: Any) -> TitleIndex:
        from sqlalchemy import select
        from db.models import Movie, Series

        def query(model):
            return select(
                model.id,
                model.imdb_id,
                model.jellyfin_info["folderPath"].astext,
                model.raw_data["folderPath"].astext,
            )

        movies = [
            {"id": row[0], "imdb_id": row[1], "folders": [row[2], row[3]]}
            for row in (await session.execute(query(Movie))).all()
        ]
        series = [
            {"id": row[0], "imdb_id": row[1], "folders": [row[2], row[3]]}
            for row in (await session.execute(query(Series))).all()
        ]
        return build_title_index(movies, series)

    async def _reconcile(self, seen: Seen, roots: List[str], library_root: str) -> Dict[str, Any]:
        from sqlalchemy import select, update
        from db.models import MediaFile

        counts = self._progress["counts"]
        now = self.clock()
        async with self.db_session_factory() as session:
            result = await session.execute(
                select(MediaFile).where(
                    MediaFile.file_path.like(
                        media_file_index.like_prefix(media_file_index.normalize_path(library_root)), escape="\\"
                    )
                )
            )
            known_rows: Dict[str, Any] = {}
            for row in result.scalars().all():
                path = media_file_index.normalize_path(row.file_path)
                if any(storage_paths.is_within(path, root) for root in roots):
                    known_rows[path] = row
            counts["knownFiles"] = len(known_rows)
            known_available = sum(1 for row in known_rows.values() if row.is_available is not False)

            diff = diff_inventory(
                {path: (row.file_size, row.modified_date) for path, row in known_rows.items()}, seen
            )
            vanished = {path: (known_rows[path].file_size, known_rows[path].modified_date) for path in diff["vanished"]}
            new = {path: seen[path] for path in diff["new"]}
            moves = detect_moves(vanished, new)

            present: Dict[str, Any] = {}
            to_probe: List[str] = []

            for old_path, new_path in moves:
                row = await media_file_index.relocate(session, old_path, new_path, row=known_rows[old_path])
                size, mtime = seen[new_path]
                row.file_size = size
                row.modified_date = datetime.fromtimestamp(mtime, tz=timezone.utc)
                if media_file_index.mark_available(row):
                    counts["reappeared"] += 1
                present[new_path] = row
                vanished.pop(old_path, None)
                new.pop(new_path, None)
            counts["movedFiles"] = len(moves)

            for path in diff["changed"] + diff["unchanged"]:
                row = known_rows[path]
                size, mtime = seen[path]
                if path in diff["changed"]:
                    media_file_index.clear_probe(row)
                    counts["changedFiles"] += 1
                if row.file_size is None or path in diff["changed"]:
                    row.file_size = size
                if row.modified_date is None or path in diff["changed"]:
                    row.modified_date = datetime.fromtimestamp(mtime, tz=timezone.utc)
                if media_file_index.mark_available(row):
                    counts["reappeared"] += 1
                present[path] = row

            for path in sorted(new):
                size, mtime = new[path]
                row = await media_file_index.upsert_by_path(
                    session,
                    path,
                    file_size=size,
                    modified_date=datetime.fromtimestamp(mtime, tz=timezone.utc),
                    is_available=True,
                    missing_since=None,
                )
                present[path] = row
                counts["newFiles"] += 1
            counts["vanishedFiles"] = len(vanished)

            # (e) placement and title links
            self._progress["phase"] = "link"
            index = await self._load_title_index(session)
            placements: Dict[str, Dict[str, Any]] = {}
            rel_of: Dict[str, str] = {}
            for path in present:
                rel = storage_paths.to_library_relative(path, library_root)
                if rel is None:
                    continue
                rel_of[path] = rel
                placements[rel] = parse_library_relative(rel)
            promote_sole_mains(placements)

            for path, row in present.items():
                rel = rel_of.get(path)
                if rel is None:
                    continue
                parsed = placements[rel]
                _set(row, "relative_path", rel)
                _set(row, "location", media_file_index.LOCATION_LIBRARY)
                _set(row, "role", parsed["role"])
                _set(row, "season_number", parsed["season_number"])
                _set(row, "episode_number", parsed["episode_number"])
                _set(row, "episode_end_number", parsed["episode_end_number"])
                if row.detected_media_type is None and parsed["media_type"]:
                    row.detected_media_type = "episode" if parsed["media_type"] == "series" else parsed["media_type"]
                kind = kind_for_media_type(parsed["media_type"])
                row_id, how = index.resolve(file_title_key(rel, parsed), parsed["imdb_id"], kind)
                if row_id is not None:
                    counts["linked"] += 1
                    if kind == "series":
                        _set(row, "series_id", row_id)
                        _set(row, "movie_id", None)
                    else:
                        _set(row, "movie_id", row_id)
                        _set(row, "series_id", None)
                elif how == "ambiguous":
                    counts["ambiguous"] += 1
                else:
                    counts["unlinked"] += 1
                if row.probed_at is None and row.is_available is not False:
                    to_probe.append(row.id)

            await session.flush()
            seen_ids = [row.id for row in present.values()]
            for start in range(0, len(seen_ids), _CHUNK):
                await session.execute(
                    update(MediaFile)
                    .where(MediaFile.id.in_(seen_ids[start:start + _CHUNK]))
                    .values(last_scanned_date=now)
                    .execution_options(synchronize_session=False)
                )
            vanished_ids = [
                known_rows[path].id for path in vanished if known_rows[path].is_available is not False
            ]
            await session.commit()

        return {"to_probe": to_probe, "vanished_ids": vanished_ids, "known_available": known_available}

    async def _probe(self, row_ids: List[str]) -> None:
        from db.models import MediaFile

        counts = self._progress["counts"]
        budget = max(0, int(self.probe_batch))
        batch = row_ids[:budget]
        counts["probePending"] = max(0, len(row_ids) - len(batch))
        for row_id in batch:
            self._check_cancel()
            if self.queue_busy():
                self._warn("probing paused: the ingest queue started processing")
                counts["probePending"] += len(batch) - batch.index(row_id)
                return
            async with self.db_session_factory() as session:
                row = await session.get(MediaFile, row_id)
                if row is None:
                    continue
                path = row.file_path
                try:
                    metadata = await asyncio.wait_for(
                        asyncio.to_thread(self.extractor.extract_full_metadata, path),
                        timeout=self.probe_timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    # The worker thread cannot be stopped; it finishes on its own.
                    media_file_index.record_probe_error(
                        row, f"probe timed out after {self.probe_timeout_seconds}s", now=self.clock()
                    )
                    counts["probeErrors"] += 1
                except Exception as exc:  # pylint: disable=broad-except
                    media_file_index.record_probe_error(row, f"{type(exc).__name__}: {exc}", now=self.clock())
                    counts["probeErrors"] += 1
                else:
                    if media_file_index.apply_probe(row, metadata, now=self.clock()):
                        counts["probed"] += 1
                    else:
                        counts["probeErrors"] += 1
                row.last_scanned_date = self.clock()
                await session.commit()

    async def _mark_missing(self, row_ids: List[str]) -> int:
        from sqlalchemy import select
        from db.models import MediaFile

        if not row_ids:
            return 0
        marked = 0
        now = self.clock()
        async with self.db_session_factory() as session:
            for start in range(0, len(row_ids), _CHUNK):
                result = await session.execute(
                    select(MediaFile).where(MediaFile.id.in_(row_ids[start:start + _CHUNK]))
                )
                for row in result.scalars().all():
                    if media_file_index.mark_missing(row, now=now):
                        marked += 1
            await session.commit()
        return marked


async def run_inventory_loop(
    service: LibraryInventoryService,
    interval_minutes: Optional[int] = None,
    initial_delay_seconds: float = 60.0,
):
    """Scan shortly after startup, then once per interval, until cancelled."""
    interval_seconds = max(1, interval_minutes or settings.inventory_interval_minutes) * 60
    await asyncio.sleep(initial_delay_seconds)
    while True:
        try:
            if not service.is_running:
                await service.run_scan()
        except asyncio.CancelledError:
            service._cancel.set()  # stop a walk still running in its thread
            raise
        except InventoryScanRunning:
            pass
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Inventory loop failed", error=str(exc))
        await asyncio.sleep(interval_seconds)
