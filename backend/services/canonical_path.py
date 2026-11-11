"""
Where a linked library file should be, by the library's own naming rules.

One computation, two uses:

- the To-Do list's ``needs_rename`` items (services/attention_service.py)
  flag a file when its path differs from the canonical one under a
  *tolerant* comparison (:func:`naming_key`), so long-standing harmless
  differences are not a flood on day one;
- ``POST /api/catalog/media-files/{id}/rename-canonical`` renames the file to
  the *strict* target: exactly what :class:`services.path_builder.PathBuilder`
  spells, kept inside the file's current title folder.

The spec is built the way the organizer builds one
(``PathBuilder.spec_from_assignment``): title, year and IMDb id from the
linked catalog row; role, season, episode and extension from the file. The
category (Movies / Documentaries / ...) is the one the file is already in,
since moving between categories is not a rename.

The target never leaves the current title folder: when the folder itself is
not canonical, the file is still renamed inside it and the folder difference
is reported (``folder_matches`` false) for a person to rename the folder.

Pure: no filesystem, no database.
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from services import storage_paths
from services.library_path_parser import (
    ROLE_OTHER,
    episode_numbers,
    imdb_id_from_name,
    parse_library_relative,
)
from services.path_builder import (
    ROLE_EPISODE,
    ROLE_MAIN,
    ROLE_VERSION,
    PathBuilder,
    PathSpec,
)

RENAMABLE_ROLES = (ROLE_MAIN, ROLE_VERSION, ROLE_EPISODE)

# Refusal codes (also the API's error codes).
NOT_IN_LIBRARY = "NOT_IN_LIBRARY"
FILE_MISSING = "FILE_MISSING"
NO_TITLE_LINK = "NO_TITLE_LINK"
TITLE_NOT_FOUND = "TITLE_NOT_FOUND"
ROLE_NOT_RENAMABLE = "ROLE_NOT_RENAMABLE"
NO_EPISODE_NUMBER = "NO_EPISODE_NUMBER"
NOT_IN_TITLE_FOLDER = "NOT_IN_TITLE_FOLDER"
CATEGORY_MISMATCH = "CATEGORY_MISMATCH"

_IMDB_FIELD_RE = re.compile(r"tt\d+")
_VERSION_NUMBER_RE = re.compile(r"\s-\s*version\s*(\d+)\s*$", re.IGNORECASE)
_UNIQUE_SUFFIX_RE = re.compile(r"\s\(\d{1,2}\)$")
_EPISODE_TOKEN_RE = re.compile(
    r"(?:^|(?<=[^a-z0-9]))s(\d{1,3})[\s._-]*e(\d{1,4})(?:-?e(\d{1,4})|-(\d{1,4}))?(?![0-9])",
    re.IGNORECASE,
)
_IMDB_TAG_STRIP_RE = re.compile(r"[\[{(]\s*imdb(?:id)?\s*[-=:_]\s*tt\d{7,9}\s*[\]})]|\[\s*tt\d{7,9}\s*\]", re.IGNORECASE)
_SPECIALS_RE = re.compile(r"^specials?$", re.IGNORECASE)
_QUALITY_RE = re.compile(
    r"\b(?:\d{3,4}p|4k|uhd|web[- ]?dl|webrip|web|bluray|blu-ray|bdrip|brrip|dvdrip|hdtv|x26[45]|h\.?26[45]|hevc|"
    r"aac\d?|ac3|dts|hdr\d*|remux|proper|repack)\b.*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class TitleIdentity:
    """What the canonical folder name is made of, from a ``movies`` / ``series`` row."""

    kind: str  # "movie" | "series" (the table)
    id: str
    title: str
    year: Optional[int] = None
    imdb_id: Optional[str] = None


@dataclass
class CanonicalResult:
    ok: bool
    code: Optional[str] = None  # refusal code when not ok
    message: Optional[str] = None
    current_relative: Optional[str] = None
    canonical_relative: Optional[str] = None  # full PathBuilder path (canonical folder)
    target_relative: Optional[str] = None  # strict rename target inside the current title folder
    current_folder: Optional[str] = None  # title folder name
    canonical_folder: Optional[str] = None
    file_matches: bool = True  # tolerant: current vs target
    folder_matches: bool = True  # tolerant: current vs canonical title folder
    skip_flagging: bool = False  # no IMDb id anywhere: never flagged (see naming rules)
    role: Optional[str] = None
    notes: List[str] = field(default_factory=list)

    @property
    def strictly_changed(self) -> bool:
        return bool(self.ok and self.target_relative and self.target_relative != self.current_relative)


def _get(row: Any, name: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(name, default)
    return getattr(row, name, default)


def imdb_of(row: Any) -> Optional[str]:
    """IMDb id of a catalog row: the column, then the record's IMDb fields."""
    candidates = [_get(row, "imdb_id")]
    raw = _get(row, "raw_data") or {}
    if isinstance(raw, dict):
        external = raw.get("externalIds") if isinstance(raw.get("externalIds"), dict) else {}
        candidates += [raw.get("imdbId"), raw.get("imdbID"), external.get("imdbId")]
    for value in candidates:
        if isinstance(value, str) and _IMDB_FIELD_RE.fullmatch(value.strip()):
            return value.strip()
    return None


def title_identity(kind: str, row: Any) -> TitleIdentity:
    from services.catalog_stats import _release_year  # same year rules as the stats / lists

    try:
        year = _release_year(row)
    except Exception:  # pylint: disable=broad-except
        year = None
    return TitleIdentity(
        kind=kind,
        id=str(_get(row, "id")),
        title=str(_get(row, "title") or "Unknown"),
        year=year,
        imdb_id=imdb_of(row),
    )


def relative_of(file_row: Any) -> Optional[str]:
    rel = _get(file_row, "relative_path")
    if rel:
        return str(rel).replace("\\", "/").strip("/")
    return storage_paths.to_library_relative(_get(file_row, "file_path"))


def episode_tail(stem: str) -> Optional[str]:
    """The text after the ``SxxEyy`` token of an episode file stem, cleaned (None when nothing useful)."""
    match = _EPISODE_TOKEN_RE.search(stem or "")
    if not match:
        return None
    tail = stem[match.end():]
    tail = re.sub(r"[._]+", " ", tail)
    tail = _QUALITY_RE.sub("", tail)
    tail = re.sub(r"\s{2,}", " ", tail).strip(" -")
    return tail or None


def _refuse(code: str, message: str, **fields: Any) -> CanonicalResult:
    return CanonicalResult(ok=False, code=code, message=message, **fields)


def compute(
    file_row: Any,
    title: Optional[TitleIdentity],
    *,
    episode_title: Optional[str] = None,
    check_available: bool = True,
) -> CanonicalResult:
    """Canonical placement of a linked library file (see the module docstring)."""
    rel = relative_of(file_row)
    if _get(file_row, "location") not in (None, "library") or not rel:
        return _refuse(NOT_IN_LIBRARY, "The file is not in the library.", current_relative=rel)
    if check_available and _get(file_row, "is_available") is False:
        return _refuse(FILE_MISSING, "The file is missing from disk.", current_relative=rel)
    if not (_get(file_row, "movie_id") or _get(file_row, "series_id")):
        return _refuse(NO_TITLE_LINK, "The file is not linked to a catalog title.", current_relative=rel)
    if title is None:
        return _refuse(TITLE_NOT_FOUND, "The linked catalog title was not found.", current_relative=rel)

    parts = rel.split("/")
    parsed = parse_library_relative(rel)
    category = parsed["media_type"]
    role = _get(file_row, "role") or parsed["role"]
    base = {"current_relative": rel, "role": role}
    if role not in RENAMABLE_ROLES:
        return _refuse(
            ROLE_NOT_RENAMABLE,
            f"Files with role '{role or ROLE_OTHER}' are kept under their own names.",
            **base,
        )
    if category is None or len(parts) < 3:
        return _refuse(NOT_IN_TITLE_FOLDER, "The file is not inside a title folder of a library category.", **base)
    if (category == "series") != (title.kind == "series"):
        return _refuse(
            CATEGORY_MISMATCH,
            f"The file is in '{parts[0]}' but is linked to a {title.kind}.",
            **base,
        )

    file_name = parts[-1]
    stem, ext = posixpath.splitext(file_name)
    if category == "series":
        if role != ROLE_EPISODE:
            return _refuse(ROLE_NOT_RENAMABLE, "Only episodes are renamed inside a show folder.", **base)
        season = _get(file_row, "season_number")
        episode = _get(file_row, "episode_number")
        episode_end = _get(file_row, "episode_end_number")
        if season is None:
            season = parsed["season_number"]
        if episode is None:
            episode = parsed["episode_number"]
            episode_end = episode_end if episode_end is not None else parsed["episode_end_number"]
        if episode is None:
            return _refuse(NO_EPISODE_NUMBER, "The episode number is not known.", **base)
        spec = PathSpec(
            media_type="episode",
            title=title.title,
            year=title.year,
            imdb_id=title.imdb_id,
            extension=ext,
            role=ROLE_EPISODE,
            season=season,
            episode=episode,
            episode_end=episode_end,
            episode_title=episode_title or episode_tail(stem),
            original_name=file_name,
        )
    else:
        if len(parts) != 3:
            return _refuse(NOT_IN_TITLE_FOLDER, "The file is in a subfolder of its title folder.", **base)
        number = None
        if role == ROLE_VERSION:
            match = _VERSION_NUMBER_RE.search(stem)
            number = int(match.group(1)) if match else 2
        spec = PathSpec(
            media_type=category,
            title=title.title,
            year=title.year,
            imdb_id=title.imdb_id,
            extension=ext,
            role=role,
            number=number,
            original_name=file_name,
        )

    canonical = PathBuilder.relative_path(spec)
    if canonical is None:  # a category PathBuilder does not know
        return _refuse(NOT_IN_TITLE_FOLDER, "The file's category has no canonical naming.", **base)
    canonical_parts = canonical.split("/")
    target = "/".join(parts[:2] + canonical_parts[2:])
    folder = parts[1]
    canonical_folder = canonical_parts[1]
    strip_imdb = title.imdb_id is None
    result = CanonicalResult(
        ok=True,
        current_relative=rel,
        canonical_relative=canonical,
        target_relative=target,
        current_folder=folder,
        canonical_folder=canonical_folder,
        role=role,
        file_matches=naming_key(rel, role, strip_imdb=strip_imdb) == naming_key(target, role, strip_imdb=strip_imdb),
        folder_matches=_segment_key(folder, strip_imdb) == _segment_key(canonical_folder, strip_imdb),
        skip_flagging=strip_imdb and imdb_id_from_name(folder) is None,
    )
    if folder != canonical_folder:
        result.notes.append(
            f"The title folder '{folder}' is not the canonical '{canonical_folder}'; "
            "the file is renamed inside its current folder and the folder is left as it is."
        )
    return result


# ---------------------------------------------------------------------------
# Tolerant comparison
# ---------------------------------------------------------------------------

def _squash(text: str) -> str:
    """Case and whitespace differences ignored."""
    return re.sub(r"\s+", "", text).lower()


def _segment_key(segment: str, strip_imdb: bool) -> str:
    text = segment
    if strip_imdb:
        text = _IMDB_TAG_STRIP_RE.sub("", text)
    if _SPECIALS_RE.match(text.strip()):
        text = "Season 00"
    return _squash(text)


def _stem_key(stem: str, role: Optional[str], strip_imdb: bool) -> str:
    text = _UNIQUE_SUFFIX_RE.sub("", stem.strip())
    if strip_imdb:
        text = _IMDB_TAG_STRIP_RE.sub("", text)
    if role == ROLE_EPISODE:
        match = _EPISODE_TOKEN_RE.search(text)
        if match:
            season, episode, end = episode_numbers(match.group(0))
            token = f"s{season:02d}e{episode:02d}" + (f"e{end:02d}" if end else "")
            text = text[: match.start()] + " " + token  # the episode-title tail is dropped
    elif role == ROLE_VERSION and " - " in text:
        text = text.rsplit(" - ", 1)[0]  # "- Version N" and any " - <label>" alike
    return _squash(text)


def naming_key(rel: str, role: Optional[str], *, strip_imdb: bool = False) -> str:
    """Comparison form of a library-relative path. Two paths with the same key
    differ only in ways the To-Do list does not flag:

    - ``Specials`` vs ``Season 00``;
    - a ``PathBuilder.unique_path`` numeric suffix (`` (2)``);
    - ``SxxEyy-Ezz`` vs ``SxxEyyEzz`` (and other spellings of the same numbers);
    - an episode-title tail after ``SxxEyy``;
    - the version label (`` - Version N`` vs any `` - <label>``);
    - letter case and whitespace;
    - with ``strip_imdb`` (the catalog row has no IMDb id): ``[imdbid-…]`` tags.
    """
    parts = [p for p in str(rel or "").replace("\\", "/").split("/") if p]
    if not parts:
        return ""
    stem, ext = posixpath.splitext(parts[-1])
    keys = [_segment_key(p, strip_imdb) for p in parts[:-1]]
    keys.append(_stem_key(stem, role, strip_imdb) + ext.lower())
    return "/".join(keys)


def describe(result: CanonicalResult) -> Dict[str, Any]:
    """Plain dict of a result (tests and logs)."""
    return {
        "ok": result.ok,
        "code": result.code,
        "current": result.current_relative,
        "target": result.target_relative,
        "canonical": result.canonical_relative,
        "fileMatches": result.file_matches,
        "folderMatches": result.folder_matches,
    }

