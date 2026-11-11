"""
The one writer of ``media_files.file_path``.

A ``media_files`` row is the identity of a file: queue items, the ripper's
``link-source`` call and undo find it by its absolute path, and
``media_assignments.primary_file_id`` / ``assignment_extra_files.media_file_id``
point at its id. When the file moves, its row must move with it, keeping the
id and everything hung on it (disc / tape, assignment). Every caller that
creates a row or moves one goes through here:

- :func:`upsert_by_path` — the row for a path, created when missing;
- :func:`relocate` / :func:`relocate_tree` — a file (or a folder of files)
  moved; merges into an existing row at the destination instead of breaking
  the unique ``file_path``;
- :func:`resolve_current` — the row for a path that may since have been
  organized (follows the recorded ``ingest_operations`` moves);
- :func:`apply_probe`, :func:`mark_missing`, :func:`mark_available` — the
  inventory scan's writes.

The decisions (path fields, which row survives a merge, which values it keeps,
probe field mapping) are pure functions over plain values; the async functions
only load rows and apply them.

Stored paths are container paths with forward slashes. Whatever separator a
caller passes, :func:`normalize_path` is what gets stored.
"""

from __future__ import annotations

import asyncio
import os
import posixpath
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from services import storage_paths
from utils.logging import logger

LOCATION_INGEST = "ingest"
LOCATION_LIBRARY = "library"
LOCATION_OTHER = "other"

# Assignment / link fields a merge keeps from the surviving row and fills from
# the dropped one only where the survivor has nothing.
MERGE_KEEP_FIELDS = (
    "disc_id",
    "tape_id",
    "assigned_to_type",
    "assigned_to_id",
    "movie_id",
    "series_id",
    "detected_media_type",
    "parsed_info",
    "target_path",
    "organization_status",
    "needs_organization",
    "library_path_id",
    "tags",
    "notes",
    "confidence",
)

# Technical metadata: taken from whichever row was probed more recently.
PROBE_FIELDS = (
    "container",
    "video_codec",
    "resolution_category",
    "width",
    "height",
    "hdr_format",
    "audio_codec",
    "audio_channels",
    "duration_ms",
    "bitrate",
    "video_metadata",
    "audio_tracks",
    "subtitle_tracks",
    "probed_at",
    "probe_error",
)

# Fields that describe where the file is (recomputed from the new path).
PLACEMENT_FIELDS = ("role", "season_number", "episode_number", "episode_end_number")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def normalize_path(path: Any) -> str:
    """Forward slashes, no ``.`` / ``..`` segments or doubled slashes (a UNC ``//`` prefix is kept)."""
    text = str(path or "").strip().replace("\\", "/")
    if not text:
        return ""
    normalized = posixpath.normpath(text)
    if text.startswith("//") and not normalized.startswith("//"):
        normalized = "/" + normalized
    return normalized


def location_for(path: Any, library_root: Optional[str] = None, ingest_roots: Optional[Iterable[str]] = None) -> str:
    if storage_paths.is_in_library(path, library_root):
        return LOCATION_LIBRARY
    if storage_paths.is_in_ingest(path, ingest_roots):
        return LOCATION_INGEST
    return LOCATION_OTHER


def path_fields(
    path: Any,
    library_root: Optional[str] = None,
    ingest_roots: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """The columns that follow from a file's path alone."""
    normalized = normalize_path(path)
    name = posixpath.basename(normalized)
    ext = posixpath.splitext(name)[1].lower() or None
    location = location_for(normalized, library_root, ingest_roots)
    relative = storage_paths.to_library_relative(normalized, library_root) if location == LOCATION_LIBRARY else None
    return {
        "file_path": normalized,
        "file_name": name,
        "file_extension": ext,
        "folder_path": posixpath.dirname(normalized) or None,
        "relative_path": relative or None,
        "location": location,
    }


def placement_fields(relative_path: Optional[str]) -> Dict[str, Any]:
    """role / season / episode for a library-relative path (all None outside the library)."""
    from services.library_path_parser import parse_library_relative

    if not relative_path:
        return {name: None for name in PLACEMENT_FIELDS}
    parsed = parse_library_relative(relative_path)
    return {
        "role": parsed["role"] if parsed["media_type"] else None,
        "season_number": parsed["season_number"],
        "episode_number": parsed["episode_number"],
        "episode_end_number": parsed["episode_end_number"],
    }


def rebase_path(path: Any, old_dir: Any, new_dir: Any) -> Optional[str]:
    """``path`` moved from under ``old_dir`` to under ``new_dir``, None when it is not under ``old_dir``."""
    rest = storage_paths.relative_to(path, old_dir)
    if rest is None:
        return None
    base = normalize_path(new_dir)
    return base if rest == "" else f"{base.rstrip('/')}/{rest}"


def _sort_time(value: Any) -> float:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.timestamp()
    return float("inf")  # unknown age: never wins "older"


def choose_survivor(moving: Dict[str, Any], existing: Dict[str, Any]) -> str:
    """Which of two rows for the same file survives a merge: ``"moving"`` or ``"existing"``.

    The older row (earlier ``created_at``) survives: its id is the one other
    tables were most likely pointed at first. A tie keeps the moving row.
    """
    if _sort_time(existing.get("created_at")) < _sort_time(moving.get("created_at")):
        return "existing"
    return "moving"


def merged_values(survivor: Dict[str, Any], dropped: Dict[str, Any]) -> Dict[str, Any]:
    """Field updates for the survivor of a merge (only the fields that change).

    Link and assignment fields stay the survivor's, filled from the dropped
    row only where the survivor has none (an ``unassigned`` status counts as
    none). Probe results come from whichever row was probed more recently.
    """
    updates: Dict[str, Any] = {}
    for name in MERGE_KEEP_FIELDS:
        if _empty(survivor.get(name)) and not _empty(dropped.get(name)):
            updates[name] = dropped.get(name)
    survivor_status = survivor.get("assignment_status")
    dropped_status = dropped.get("assignment_status")
    if (survivor_status in (None, "", "unassigned")) and dropped_status not in (None, "", "unassigned"):
        updates["assignment_status"] = dropped_status

    survivor_probe = survivor.get("probed_at")
    dropped_probe = dropped.get("probed_at")
    if dropped_probe is not None and (survivor_probe is None or _sort_time(dropped_probe) > _sort_time(survivor_probe)):
        for name in PROBE_FIELDS:
            if dropped.get(name) != survivor.get(name):
                updates[name] = dropped.get(name)
    for name in ("file_size", "modified_date", "checksum"):
        if _empty(survivor.get(name)) and not _empty(dropped.get(name)):
            updates[name] = dropped.get(name)
    return updates


def probe_values(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Column values from ``MediaMetadataExtractor.extract_full_metadata`` output.

    Raises ``ValueError`` when the extractor found nothing (it returns an empty
    shape instead of raising), so the caller records a probe error.
    """
    data = metadata or {}
    video = data.get("videoMetadata") or {}
    audio_tracks = list(data.get("audioTracks") or [])
    subtitle_tracks = list(data.get("subtitleTracks") or [])
    if not video and not audio_tracks and not data.get("containerFormat"):
        raise ValueError("no media information could be read from the file")

    first_audio = next((t for t in audio_tracks if t.get("isDefault")), audio_tracks[0] if audio_tracks else {})
    duration = _as_int(data.get("duration")) or _as_int(video.get("duration"))
    return {
        "container": _as_text(data.get("containerFormat")),
        "video_codec": _as_text(video.get("codec")),
        "resolution_category": _as_text(video.get("resolutionCategory")),
        "width": _as_int(video.get("width")),
        "height": _as_int(video.get("height")),
        "hdr_format": _as_text(video.get("hdrFormat")),
        "audio_codec": _as_text(first_audio.get("codec")),
        "audio_channels": _as_int(first_audio.get("channels")),
        "duration_ms": duration,
        "bitrate": _as_int(data.get("overallBitrate")) or _as_int(video.get("bitrate")),
        "video_metadata": _json_safe(video) if video else {},
        "audio_tracks": _json_safe(audio_tracks),
        "subtitle_tracks": _json_safe(subtitle_tracks),
    }


def _as_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(float(str(value).split("/")[0].strip()))
    except (TypeError, ValueError):
        return None


def _as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _json_safe(value: Any) -> Any:
    """JSONB-safe copy (pymediainfo can hand back non-JSON types)."""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def row_values(row: Any, names: Iterable[str]) -> Dict[str, Any]:
    return {name: getattr(row, name, None) for name in names}


_ALL_FIELDS = MERGE_KEEP_FIELDS + PROBE_FIELDS + ("assignment_status", "created_at", "file_size", "modified_date", "checksum")


# ---------------------------------------------------------------------------
# Row writes (pure, on a row object)
# ---------------------------------------------------------------------------

def apply_path(row: Any, path: Any, *, library_root: Optional[str] = None, placement: bool = True) -> None:
    """Point ``row`` at ``path``: file_path and every column that follows from it."""
    fields = path_fields(path, library_root)
    for name, value in fields.items():
        setattr(row, name, value)
    if placement:
        for name, value in placement_fields(fields["relative_path"]).items():
            setattr(row, name, value)


def apply_probe(row: Any, metadata: Optional[Dict[str, Any]], *, now: Optional[datetime] = None) -> bool:
    """Write probe results onto ``row``; on unusable output record ``probe_error``. True on success."""
    moment = now or _now()
    try:
        values = probe_values(metadata)
    except ValueError as exc:
        record_probe_error(row, str(exc), now=moment)
        return False
    for name, value in values.items():
        setattr(row, name, value)
    row.probed_at = moment
    row.probe_error = None
    return True


def record_probe_error(row: Any, error: str, *, now: Optional[datetime] = None) -> None:
    """Mark the probe as attempted and failed (``probed_at`` set so it is not retried until the file changes)."""
    row.probe_error = (error or "probe failed")[:1000]
    row.probed_at = now or _now()


def clear_probe(row: Any) -> None:
    """Forget the last probe so the file is probed again (its content changed)."""
    row.probed_at = None
    row.probe_error = None


def mark_missing(row: Any, *, now: Optional[datetime] = None) -> bool:
    """``is_available`` false and ``missing_since`` set (kept if already set). True when it changed."""
    if row.is_available is False and row.missing_since is not None:
        return False
    row.is_available = False
    if row.missing_since is None:
        row.missing_since = now or _now()
    return True


def mark_available(row: Any) -> bool:
    """``is_available`` true and ``missing_since`` cleared. True when it changed."""
    if row.is_available is True and row.missing_since is None:
        return False
    row.is_available = True
    row.missing_since = None
    return True


def clear_title_links(row: Any) -> None:
    """Drop what ties the row to a library title (undo / reset back to ingest)."""
    row.movie_id = None
    row.series_id = None
    for name in PLACEMENT_FIELDS:
        setattr(row, name, None)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@asynccontextmanager
async def savepoint(session: Any):
    """A SAVEPOINT around best-effort index writes inside a caller's transaction.

    A failed relocation then rolls back only itself, and the caller's own
    writes in the same session (assignment status, ...) still commit.
    """
    begin_nested = getattr(session, "begin_nested", None)
    if begin_nested is None:
        yield
        return
    async with begin_nested():
        yield


def like_prefix(directory: str) -> str:
    """A LIKE pattern (escape character: backslash) for every path under ``directory``."""
    escaped = directory.rstrip("/").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped + "/%"


async def get_by_path(session: Any, path: Any) -> Optional[Any]:
    from sqlalchemy import select
    from db.models import MediaFile

    normalized = normalize_path(path)
    if not normalized:
        return None
    result = await session.execute(select(MediaFile).where(MediaFile.file_path == normalized))
    row = result.scalar_one_or_none()
    if row is None and normalized != str(path):
        # A row written before paths were normalized.
        result = await session.execute(select(MediaFile).where(MediaFile.file_path == str(path)))
        row = result.scalar_one_or_none()
    return row


async def upsert_by_path(session: Any, path: Any, **fields: Any) -> Any:
    """The row for ``path`` (created when missing), with ``fields`` set on it.

    A new row gets every path-derived column; an existing one keeps its own
    placement unless ``fields`` say otherwise.
    """
    from db.models import MediaFile
    import uuid

    row = await get_by_path(session, path)
    if row is None:
        row = MediaFile(id=str(uuid.uuid4()))
        apply_path(row, path)
        row.is_available = True
        row.assignment_status = "unassigned"
        session.add(row)
    elif row.file_path != normalize_path(path):
        apply_path(row, path, placement=False)
    for name, value in fields.items():
        setattr(row, name, value)
    await session.flush()
    return row


async def _repoint_references(session: Any, dropped_id: str, survivor_id: str) -> None:
    from sqlalchemy import update
    from db.models import AssignmentExtraFile, MediaAssignment

    await session.execute(
        update(MediaAssignment)
        .where(MediaAssignment.primary_file_id == dropped_id)
        .values(primary_file_id=survivor_id)
    )
    await session.execute(
        update(AssignmentExtraFile)
        .where(AssignmentExtraFile.media_file_id == dropped_id)
        .values(media_file_id=survivor_id)
    )


async def relocate(
    session: Any,
    old_path: Any,
    new_path: Any,
    *,
    row: Any = None,
    placement: bool = True,
) -> Optional[Any]:
    """Move the row for ``old_path`` (or ``row``) to ``new_path``; returns the surviving row.

    When another row already holds ``new_path`` the two are merged: the older
    row survives with its id, the other's references
    (``media_assignments.primary_file_id``, ``assignment_extra_files``) are
    repointed to it and it is deleted. Returns None when there is no row to
    move and none at the destination.
    """
    target = normalize_path(new_path)
    if not target:
        return None
    moving = row if row is not None else await get_by_path(session, old_path)
    existing = await get_by_path(session, target)
    if existing is not None and moving is not None and existing is moving:
        apply_path(existing, target, placement=placement)
        return existing
    if moving is None:
        return existing

    if existing is None:
        apply_path(moving, target, placement=placement)
        await session.flush()
        return moving

    # Two rows for one file: keep the older id.
    winner = choose_survivor(row_values(moving, ("created_at",)), row_values(existing, ("created_at",)))
    survivor, dropped = (moving, existing) if winner == "moving" else (existing, moving)
    updates = merged_values(row_values(survivor, _ALL_FIELDS), row_values(dropped, _ALL_FIELDS))
    logger.info(
        "Merging duplicate media_files rows",
        survivor_id=survivor.id,
        dropped_id=dropped.id,
        path=target,
    )
    await _repoint_references(session, dropped.id, survivor.id)
    await session.delete(dropped)
    await session.flush()  # the dropped row releases file_path before the survivor takes it
    for name, value in updates.items():
        setattr(survivor, name, value)
    apply_path(survivor, target, placement=placement)
    await session.flush()
    return survivor


async def relocate_tree(session: Any, old_dir: Any, new_dir: Any) -> int:
    """Relocate every row under ``old_dir`` to the same place under ``new_dir``; returns how many moved."""
    from sqlalchemy import select
    from db.models import MediaFile

    source = normalize_path(old_dir)
    if not source or not normalize_path(new_dir):
        return 0
    result = await session.execute(
        select(MediaFile).where(MediaFile.file_path.like(like_prefix(source), escape="\\"))
    )
    moved = 0
    for row in list(result.scalars().all()):
        destination = rebase_path(row.file_path, source, new_dir)
        if destination is None or destination == row.file_path:
            continue
        await relocate(session, row.file_path, destination, row=row)
        moved += 1
    return moved


def next_hops(moves: Iterable[Tuple[str, str]]) -> Dict[str, str]:
    """``src -> dst`` from (src, dst) move pairs in execution order; a later move from the same src wins."""
    hops: Dict[str, str] = {}
    for src, dst in moves:
        if src and dst:
            hops[normalize_path(src)] = normalize_path(dst)
    return hops


def follow(path: str, hops: Dict[str, str], limit: int = 16) -> str:
    """Where ``path`` ended up after every recorded hop (stops on a cycle)."""
    current = normalize_path(path)
    seen = {current}
    for _ in range(limit):
        nxt = hops.get(current)
        if not nxt or nxt in seen:
            break
        seen.add(nxt)
        current = nxt
    return current


async def _latest_move_from(session: Any, src: str) -> Optional[str]:
    from sqlalchemy import select
    from db.models import IngestOperation

    result = await session.execute(
        select(IngestOperation)
        .where(
            IngestOperation.op == "move",
            IngestOperation.status == "done",
            IngestOperation.undone_at.is_(None),
            IngestOperation.src == src,
        )
        .order_by(IngestOperation.created_at.desc())
        .limit(1)
    )
    operation = result.scalar_one_or_none()
    return getattr(operation, "dst", None) if operation is not None else None


def _default_exists(path: str) -> bool:
    return os.path.exists(path)


async def resolve_current(
    session: Any,
    path: Any,
    *,
    exists: Optional[Callable[[str], bool]] = None,
    max_hops: int = 8,
) -> Optional[Any]:
    """The row for ``path``, or for wherever the file at ``path`` was moved since.

    A late caller holding an ingest path (the ripper's ``link-source`` after
    the file was already organized) gets the organized row. Moves are followed
    through done, not-undone ``ingest_operations`` rows, and only while the
    file is no longer at ``path`` — a new file that arrived at the same path
    is a different file.
    """
    row = await get_by_path(session, path)
    if row is not None:
        return row
    check = exists or _default_exists
    current = normalize_path(path)
    if not current:
        return None
    try:
        still_there = await asyncio.to_thread(check, current)
    except Exception:  # pylint: disable=broad-except
        still_there = False
    if still_there:
        return None
    seen = {current}
    for _ in range(max_hops):
        dst = await _latest_move_from(session, current)
        if not dst:
            return None
        dst = normalize_path(dst)
        if dst in seen:
            return None
        seen.add(dst)
        row = await get_by_path(session, dst)
        if row is not None:
            return row
        current = dst
    return None
