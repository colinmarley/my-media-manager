"""
Rename one library file to its canonical name (``rename-canonical``).

:func:`plan` works out the target with the same computation the To-Do list
uses (:func:`services.canonical_path.compute`, strict form: the exact
PathBuilder name, inside the file's current title folder), the sidecar files
that move with it (same stem: ``.nfo``, subtitles such as ``.srt`` /
``.en.srt``) and anything in the way. :func:`apply` moves the files with
``FileSystemManager.move_file``, records each move in ``ingest_operations``
(through ``OperationRecorder``) so it is auditable and
``media_file_index.resolve_current`` can follow it, and relocates the
``media_files`` rows.

A title folder that is not canonical is reported (``folder_mismatch``) and
left alone: the file is renamed inside it, and no new title folder is made.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from services import canonical_path, media_file_index, storage_paths
from services.ingest_operations import OP_MOVE, OperationLog, OperationRecorder
from utils.logging import logger

SIDECAR_EXTENSIONS = (".nfo", ".srt", ".vtt", ".ass", ".ssa", ".sub", ".idx", ".sup", ".smi")


class RenameRefused(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class RenamePlan:
    row: Any
    result: canonical_path.CanonicalResult
    current_path: str
    target_path: str
    sidecars: List[Tuple[str, str]] = field(default_factory=list)
    conflict: Optional[str] = None

    @property
    def changed(self) -> bool:
        return self.result.strictly_changed


def _same_file(a: str, b: str) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def _blocked(path: str, source: str) -> bool:
    """Something other than ``source`` itself is at ``path`` (a case-only rename is not blocked)."""
    return os.path.lexists(path) and not _same_file(path, source)


def find_sidecars(current_path: str, target_path: str) -> List[Tuple[str, str]]:
    """``(src, dst)`` of files next to ``current_path`` sharing its stem."""
    directory = os.path.dirname(current_path)
    stem = os.path.splitext(os.path.basename(current_path))[0]
    new_stem = os.path.splitext(os.path.basename(target_path))[0]
    target_dir = os.path.dirname(target_path)
    pairs: List[Tuple[str, str]] = []
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return pairs
    for name in names:
        if name == os.path.basename(current_path) or not name.startswith(stem + "."):
            continue
        if os.path.splitext(name)[1].lower() not in SIDECAR_EXTENSIONS:
            continue
        src = media_file_index.normalize_path(os.path.join(directory, name))
        if not os.path.isfile(src):
            continue
        dst = media_file_index.normalize_path(os.path.join(target_dir, new_stem + name[len(stem):]))
        pairs.append((src, dst))
    return pairs


async def _title_for(session: Any, row: Any) -> Optional[canonical_path.TitleIdentity]:
    from db.models import Movie, Series

    if row.movie_id:
        title = await session.get(Movie, row.movie_id)
        return canonical_path.title_identity("movie", title) if title is not None else None
    if row.series_id:
        title = await session.get(Series, row.series_id)
        return canonical_path.title_identity("series", title) if title is not None else None
    return None


async def _episode_title(session: Any, row: Any) -> Optional[str]:
    from sqlalchemy import select
    from db.models import Episode

    if not row.series_id or row.season_number is None or row.episode_number is None:
        return None
    result = await session.execute(
        select(Episode).where(
            Episode.series_id == row.series_id,
            Episode.season_number == row.season_number,
            Episode.episode_number == row.episode_number,
        ).limit(1)
    )
    episode = result.scalars().first()
    return episode.title if episode is not None and episode.title else None


_REFUSAL_STATUS = {
    canonical_path.NOT_IN_LIBRARY: 422,
    canonical_path.FILE_MISSING: 409,
    canonical_path.NO_TITLE_LINK: 422,
    canonical_path.TITLE_NOT_FOUND: 422,
    canonical_path.ROLE_NOT_RENAMABLE: 422,
    canonical_path.NO_EPISODE_NUMBER: 422,
    canonical_path.NOT_IN_TITLE_FOLDER: 422,
    canonical_path.CATEGORY_MISMATCH: 422,
}


async def plan(session: Any, row: Any) -> RenamePlan:
    title = await _title_for(session, row)
    episode_title = await _episode_title(session, row)
    result = canonical_path.compute(row, title, episode_title=episode_title)
    if not result.ok:
        raise RenameRefused(_REFUSAL_STATUS.get(result.code, 422), result.code, result.message)

    current_path = media_file_index.normalize_path(row.file_path)
    target_path = media_file_index.normalize_path(storage_paths.from_library_relative(result.target_relative))
    title_dir = media_file_index.normalize_path(
        storage_paths.from_library_relative("/".join(result.current_relative.split("/")[:2]))
    )
    if storage_paths.relative_to(target_path, title_dir) is None:  # never leaves the title folder
        raise RenameRefused(422, canonical_path.NOT_IN_TITLE_FOLDER, "The canonical name would leave the title folder.")

    plan_obj = RenamePlan(row=row, result=result, current_path=current_path, target_path=target_path)
    if not plan_obj.changed:
        return plan_obj
    plan_obj.sidecars = find_sidecars(current_path, target_path)
    if not os.path.isfile(current_path):
        plan_obj.conflict = f"The file is not on disk at {current_path}."
    elif _blocked(target_path, current_path):
        plan_obj.conflict = f"A file already exists at {target_path}."
    else:
        holder = await media_file_index.get_by_path(session, target_path)
        if holder is not None and holder.id != row.id and not _same_file(target_path, current_path):
            plan_obj.conflict = f"Another media file record already holds {target_path}."
        for src, dst in plan_obj.sidecars:
            if plan_obj.conflict is None and _blocked(dst, src):
                plan_obj.conflict = f"A file already exists at {dst} (sidecar of the renamed file)."
    return plan_obj


class _SharedSession:
    """Session factory over the request's session (OperationLog commits through it; nothing is closed)."""

    def __init__(self, session: Any):
        self.session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *exc):
        return False


def _move(file_manager: Any, src: str, dst: str) -> None:
    if os.path.lexists(dst) and _same_file(src, dst):
        # Case-only rename on a case-insensitive share: go through a free name.
        temporary = f"{src}.mmm-renaming"
        _check(file_manager.move_file(src, temporary))
        _check(file_manager.move_file(temporary, dst))
    else:
        _check(file_manager.move_file(src, dst))
    if not os.path.isfile(dst):
        raise RuntimeError(f"file did not arrive at {dst}")


def _check(result: Any) -> None:
    if isinstance(result, dict) and result.get("success") is False:
        raise RuntimeError(result.get("error") or "move failed")


def _size(path: str) -> Optional[int]:
    try:
        return os.path.getsize(path)
    except OSError:
        return None


async def apply(session: Any, plan_obj: RenamePlan, file_manager: Any) -> Dict[str, Any]:
    """Move the file and its sidecars and relocate their rows. Returns ``{operations, sidecarErrors, row}``."""
    if plan_obj.conflict:
        raise RenameRefused(409, "RENAME_CONFLICT", plan_obj.conflict)
    if not plan_obj.changed:
        return {"operations": [], "sidecarErrors": [], "row": plan_obj.row}
    recorder = OperationRecorder(OperationLog(_SharedSession(session)), None, None)
    operations: List[str] = []
    sidecar_errors: List[str] = []
    moves = [(plan_obj.current_path, plan_obj.target_path, True)] + [(s, d, False) for s, d in plan_obj.sidecars]
    moved: List[Tuple[str, str]] = []
    for src, dst, is_main in moves:
        size = _size(src)
        op_id = await recorder.before(OP_MOVE, src=src, dst=dst, planned_dst=dst, size_before=size)
        try:
            _move(file_manager, src, dst)
        except Exception as exc:  # pylint: disable=broad-except
            await recorder.failed(op_id, str(exc))
            if is_main:
                raise RenameRefused(500, "RENAME_FAILED", f"Could not rename the file: {exc}") from exc
            sidecar_errors.append(f"{os.path.basename(src)}: {exc}")
            continue
        await recorder.done(op_id, dst=dst, size=size)
        operations.append(op_id)
        moved.append((src, dst))

    row = plan_obj.row
    try:
        async with media_file_index.savepoint(session):
            for src, dst in moved:
                if src == plan_obj.current_path:
                    row = await media_file_index.relocate(session, src, dst, row=plan_obj.row) or plan_obj.row
                else:
                    await media_file_index.relocate(session, src, dst)
    except Exception as exc:  # pylint: disable=broad-except
        # The files moved and the moves are on record; the inventory scan reconciles the rows.
        logger.warning("Could not relocate media_files rows after a canonical rename", error=str(exc))
    await session.commit()
    return {"operations": operations, "sidecarErrors": sidecar_errors, "row": row}
