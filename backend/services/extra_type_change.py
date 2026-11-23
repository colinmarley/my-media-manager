"""
Change the type of an extra that is already in the library (``extra-type``).

An extra's type (scene, featurette, blooper, ...) lives in its file name:
``Title (Year)-<suffix>.mkv`` for the first file of a type in a folder,
``Title (Year) N-<suffix>.mkv`` (N from 2) for the next ones. Changing the
type is therefore a rename in place: :func:`plan` picks the next free name for
the new type in the same folder, and :func:`apply` moves the file and the
sidecars sharing its stem with
:func:`services.canonical_rename.move_with_sidecars` (recorded moves, the
``media_files`` row relocated with its id, disc / tape link and assignment),
then puts the new name in the ``<title>`` of a moved ``.nfo`` when that title
was the old name.
"""

from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape

from services import extras_taxonomy, media_file_index, storage_paths
from services.canonical_rename import RenameRefused, find_sidecars, move_with_sidecars
from services.library_path_parser import ROLE_EXTRA, parse_library_relative
from utils.logging import logger

UNKNOWN_CATEGORY = "UNKNOWN_CATEGORY"
NOT_AN_EXTRA = "NOT_AN_EXTRA"
NOT_IN_LIBRARY = "NOT_IN_LIBRARY"
FILE_MISSING = "FILE_MISSING"
TYPE_NOT_IN_NAME = "TYPE_NOT_IN_NAME"
SAME_TYPE = "SAME_TYPE"
NO_FREE_NAME = "NO_FREE_NAME"

_MAX_NUMBER = 999
_TITLE_RE = re.compile(r"(<title>)(.*?)(</title>)", re.IGNORECASE | re.DOTALL)
_YEAR_RE = re.compile(r"\s*\(\d{4}\)")


@dataclass
class ExtraTypePlan:
    row: Any
    category: str
    current_category: Optional[str]
    current_path: str
    target_path: str
    sidecars: List[Tuple[str, str]] = field(default_factory=list)


def _free(path: str) -> bool:
    return not os.path.lexists(path)


async def plan(session: Any, row: Any, category: str) -> ExtraTypePlan:
    """Where the file goes for ``category``, or :class:`RenameRefused` saying why it cannot change."""
    if category not in extras_taxonomy.CATEGORIES:
        raise RenameRefused(
            422, UNKNOWN_CATEGORY,
            f"Unknown extra type '{category}'. Use one of: {', '.join(extras_taxonomy.CATEGORIES)}.",
        )
    if row.role != ROLE_EXTRA:
        raise RenameRefused(422, NOT_AN_EXTRA, "This file is not an extra, so it has no extra type to change.")
    current_path = media_file_index.normalize_path(row.file_path)
    relative = storage_paths.to_library_relative(current_path)
    if not relative:
        raise RenameRefused(422, NOT_IN_LIBRARY, "This file is outside the library.")
    if row.is_available is False or not os.path.isfile(current_path):
        raise RenameRefused(409, FILE_MISSING, f"The file is not on disk at {current_path}.")

    directory, name = os.path.split(current_path)
    stem, extension = os.path.splitext(name)
    parts = extras_taxonomy.split_suffixed_stem(stem)
    in_folder = "This extra gets its type from the folder it is in, not from its name, so it cannot be changed here."
    if parts is None:
        raise RenameRefused(422, TYPE_NOT_IN_NAME, in_folder)
    if parts["category"] == category:
        raise RenameRefused(409, SAME_TYPE, f"This file already has the type '{category}'.")

    relative_dir = relative.rsplit("/", 1)[0] if "/" in relative else ""
    for number in range(1, _MAX_NUMBER + 1):
        new_name = extras_taxonomy.suffixed_stem(parts["base"], category, number) + extension
        target_path = media_file_index.normalize_path(os.path.join(directory, new_name))
        if number == 1:
            parsed = parse_library_relative(f"{relative_dir}/{new_name}")
            if parsed["role"] != ROLE_EXTRA or parsed["extra_category"] != category:
                raise RenameRefused(422, TYPE_NOT_IN_NAME, in_folder)
        if not _free(target_path) or await media_file_index.get_by_path(session, target_path) is not None:
            continue
        sidecars = find_sidecars(current_path, target_path)
        if all(_free(dst) for _src, dst in sidecars):
            return ExtraTypePlan(
                row=row, category=category, current_category=parts["category"],
                current_path=current_path, target_path=target_path, sidecars=sidecars,
            )
    raise RenameRefused(409, NO_FREE_NAME, "No free file name was found for that type in this folder.")


def _without_year(stem: str) -> str:
    return _YEAR_RE.sub("", stem).strip()


def retitle_nfo(nfo_path: str, old_stem: str, new_stem: str) -> bool:
    """Put the new name in the nfo's ``<title>`` when it holds the old one. True when the file changed.

    The disc ripper writes the title as the stem without its year
    (``Burn Notice 8-scene``). A title that is neither that nor the stem
    itself was written by someone and is left alone.
    """
    try:
        with open(nfo_path, "r", encoding="utf-8", newline="") as handle:
            text = handle.read()
    except (OSError, UnicodeDecodeError):
        return False
    match = _TITLE_RE.search(text)
    if not match:
        return False
    current = html.unescape(match.group(2)).strip()
    replacements = {old_stem: new_stem, _without_year(old_stem): _without_year(new_stem)}
    new_title = replacements.get(current)
    if new_title is None or new_title == current:
        return False
    updated = text[:match.start(2)] + escape(new_title) + text[match.end(2):]
    try:
        with open(nfo_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(updated)
    except OSError as exc:
        logger.warning("Could not update the nfo title after an extra type change", path=nfo_path, error=str(exc))
        return False
    return True


async def _update_extra_rows(session: Any, file_id: str, category: str) -> None:
    """Keep ``assignment_extra_files.category`` in step with the file name."""
    from sqlalchemy import select
    from db.models import AssignmentExtraFile

    result = await session.execute(select(AssignmentExtraFile).where(AssignmentExtraFile.media_file_id == file_id))
    for extra in result.scalars().all():
        extra.category = category
        extra.source = "manual"


async def apply(session: Any, plan_obj: ExtraTypePlan, file_manager: Any) -> Dict[str, Any]:
    """Rename the file and its sidecars. Returns ``{operations, sidecarErrors, row, nfoTitleUpdated}``."""
    outcome = await move_with_sidecars(
        session, plan_obj.row, plan_obj.current_path, plan_obj.target_path, plan_obj.sidecars, file_manager
    )
    old_stem = os.path.splitext(os.path.basename(plan_obj.current_path))[0]
    new_base = os.path.splitext(plan_obj.target_path)[0]
    nfo_updated = False
    for _src, dst in outcome["moved"]:
        base, extension = os.path.splitext(dst)
        if base == new_base and extension.lower() == ".nfo":
            nfo_updated = retitle_nfo(dst, old_stem, os.path.basename(new_base)) or nfo_updated
    try:
        await _update_extra_rows(session, outcome["row"].id, plan_obj.category)
        await session.commit()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Could not update assignment_extra_files after an extra type change", error=str(exc))
    return {
        "operations": outcome["operations"],
        "sidecarErrors": outcome["sidecarErrors"],
        "row": outcome["row"],
        "nfoTitleUpdated": nfo_updated,
    }
