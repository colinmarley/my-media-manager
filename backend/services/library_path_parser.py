"""
What a library file is, read from its library-relative path.

:func:`parse_library_relative` takes a path relative to the library root
(``Movies/Inception (2010) [imdbid-tt1375666]/Inception (2010) [imdbid-tt1375666].mkv``)
and returns the category, the title folder and what it says (year, IMDb id),
and the role the file plays in it: the main feature, an alternate version, an
extra, an episode (with season / episode numbers), or other.

It reads what :class:`services.path_builder.PathBuilder` writes and what is
really on disk from before it: title folders with or without the
``[imdbid-tt…]`` tag, ``Season NN`` / ``Specials`` / ``Season 00``,
``SxxEyy``, ``SxxEyyEzz``, ``SxxEyy-Ezz``, `` - Version N``,
``Special Feature N``, Jellyfin extras folders, and the tape naming
``Series - S01E01 - Title``.

Pure: no filesystem, no database.
"""

from __future__ import annotations

import posixpath
import re
from typing import Any, Dict, Optional

from config.settings import settings
from services.extras_taxonomy import EXTRA_FOLDERS, FOLDER_TO_CATEGORY, classify_extra_from_stem
from services.path_builder import ROLE_EPISODE, ROLE_MAIN, ROLE_VERSION

# Inventory roles (media_files.role). ``main`` / ``version`` / ``episode``
# are PathBuilder's roles; a PathBuilder ``special`` and anything in an extras
# folder are ``extra``; the rest is ``other``.
ROLE_EXTRA = "extra"
ROLE_OTHER = "other"
ROLES = (ROLE_MAIN, ROLE_VERSION, ROLE_EXTRA, ROLE_EPISODE, ROLE_OTHER)

_IMDB_TAG_RE = re.compile(r"[\[{(]\s*imdb(?:id)?\s*[-=:_]\s*(tt\d{7,9})\s*[\]})]", re.IGNORECASE)
_BARE_IMDB_TAG_RE = re.compile(r"\[\s*(tt\d{7,9})\s*\]", re.IGNORECASE)
_ANY_TAG_RE = re.compile(r"\s*[\[{][^\]}]*[\]}]\s*")
_YEAR_RE = re.compile(r"\((\d{4})\)")
_SEASON_FOLDER_RE = re.compile(r"^(?:season|series|s)[\s._-]*(\d{1,3})$", re.IGNORECASE)
_SPECIALS_FOLDER_RE = re.compile(r"^specials?$", re.IGNORECASE)
# S01E01, S01E01E02, S01E01-E02, S01E01-02 (and lower case / dots / spaces).
# The range needs an "E" or an attached "-NN" so "S01E01 - 1080p" is not read
# as a range ending at 1080.
_SXXEYY_RE = re.compile(
    r"(?:^|[^a-z0-9])s(\d{1,3})[\s._-]*e(\d{1,4})(?:-?e(\d{1,4})|-(\d{1,4}))?(?![0-9])",
    re.IGNORECASE,
)
_NXNN_RE = re.compile(r"(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9])", re.IGNORECASE)
# PathBuilder's absolute numbering when no season is known: "Show E001".
_ABSOLUTE_RE = re.compile(r"(?:^|[\s._-])e(\d{1,4})(?:e(\d{1,4}))?(?=$|[\s._-])", re.IGNORECASE)
_VERSION_RE = re.compile(r"\s-\s*version\s*(\d+)\s*$", re.IGNORECASE)
_SPECIAL_FEATURE_RE = re.compile(r"^special\s+feature(?:\s+(\d+))?$", re.IGNORECASE)


def _category_types() -> Dict[str, str]:
    """Lower-cased top-level folder -> media type (same configured names as PathBuilder)."""
    return {
        settings.folder_movies.lower(): "movie",
        settings.folder_tv_shows.lower(): "series",
        settings.folder_documentaries.lower(): "documentary",
        settings.folder_live_performances.lower(): "live_performance",
    }


def _empty() -> Dict[str, Any]:
    return {
        "media_type": None,
        "title_folder": None,
        "imdb_id": None,
        "year": None,
        "role": ROLE_OTHER,
        "season_number": None,
        "episode_number": None,
        "episode_end_number": None,
        "extra_category": None,
    }


def imdb_id_from_name(name: Any) -> Optional[str]:
    """IMDb id from a ``[imdbid-tt…]`` / ``{imdb-tt…}`` / ``[tt…]`` tag, else None."""
    text = str(name or "")
    match = _IMDB_TAG_RE.search(text) or _BARE_IMDB_TAG_RE.search(text)
    return match.group(1).lower() if match else None


def year_from_name(name: Any) -> Optional[int]:
    """The last ``(YYYY)`` in a folder name that looks like a year, else None."""
    years = [int(y) for y in _YEAR_RE.findall(str(name or "")) if 1870 <= int(y) <= 2100]
    return years[-1] if years else None


def strip_tags(name: Any) -> str:
    """Folder or file stem without ``[...]`` / ``{...}`` tags, spaces collapsed."""
    return re.sub(r"\s{2,}", " ", _ANY_TAG_RE.sub(" ", str(name or ""))).strip()


def season_from_folder(name: Any) -> Optional[int]:
    """Season number of a ``Season NN`` / ``Specials`` folder (Specials is 0), else None."""
    text = str(name or "").strip()
    if _SPECIALS_FOLDER_RE.match(text):
        return 0
    match = _SEASON_FOLDER_RE.match(text)
    return int(match.group(1)) if match else None


def extra_folder(name: Any) -> Optional[str]:
    """Canonical extras folder for a folder name (``Featurettes`` -> ``featurettes``), else None."""
    lowered = str(name or "").strip().lower()
    if lowered in EXTRA_FOLDERS:
        return EXTRA_FOLDERS[lowered]
    compact = re.sub(r"[\s._-]+", "", lowered)
    return EXTRA_FOLDERS.get(compact)


def _extra_category(folder: Optional[str]) -> Optional[str]:
    if folder is None:
        return None
    return FOLDER_TO_CATEGORY.get(folder, folder)


def episode_numbers(stem: Any):
    """(season, episode, episode_end) from a file stem, or (None, None, None)."""
    text = str(stem or "")
    match = _SXXEYY_RE.search(text)
    if match:
        season, episode = int(match.group(1)), int(match.group(2))
        end_text = match.group(3) or match.group(4)
        end = int(end_text) if end_text else None
        if end is not None and end <= episode:
            end = None
        return season, episode, end
    match = _NXNN_RE.search(text)
    if match:
        return int(match.group(1)), int(match.group(2)), None
    return None, None, None


def _absolute_episode(stem: str):
    match = _ABSOLUTE_RE.search(stem)
    if not match:
        return None, None
    episode = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else None
    if end is not None and end <= episode:
        end = None
    return episode, end


def _feature_role(stem: str, title_folder: str) -> Dict[str, Any]:
    """Role of a file at the root of a movie / documentary / live performance folder."""
    if _SPECIAL_FEATURE_RE.match(stem.strip()):
        return {"role": ROLE_EXTRA, "extra_category": None}
    base_stem = strip_tags(stem).lower()
    base_folder = strip_tags(title_folder).lower()
    if base_stem == base_folder or stem.strip().lower() == title_folder.strip().lower():
        return {"role": ROLE_MAIN, "extra_category": None}
    version = _VERSION_RE.search(stem)
    if version:
        return {"role": ROLE_VERSION, "extra_category": None}
    if base_folder and base_stem.startswith(base_folder + " - "):
        # Jellyfin's "<folder> - <label>" multi-version naming (e.g. "- 1080p").
        return {"role": ROLE_VERSION, "extra_category": None}
    folder = classify_extra_from_stem(stem)  # "Title-trailer", "Behind the Scenes", ...
    if folder is not None:
        return {"role": ROLE_EXTRA, "extra_category": _extra_category(folder)}
    return {"role": ROLE_OTHER, "extra_category": None}


def parse_library_relative(rel: Any) -> Dict[str, Any]:
    """Parse a library-relative path (forward or back slashes) into what the file is.

    Returns ``media_type`` (movie / series / documentary / live_performance,
    None outside the four category folders), ``title_folder``, ``imdb_id``,
    ``year``, ``role``, ``season_number``, ``episode_number``,
    ``episode_end_number`` and ``extra_category`` (the extras category slug,
    or the canonical folder name for folders without a slug, e.g. ``extras``).
    """
    result = _empty()
    text = str(rel or "").replace("\\", "/").strip("/")
    if not text:
        return result
    parts = [part for part in posixpath.normpath(text).split("/") if part and part != "."]
    if not parts:
        return result

    media_type = _category_types().get(parts[0].lower())
    result["media_type"] = media_type
    if media_type is None or len(parts) < 3:
        # Outside the categories, or a file loose in a category folder.
        return result

    title_folder = parts[1]
    result["title_folder"] = title_folder
    result["imdb_id"] = imdb_id_from_name(title_folder)
    result["year"] = year_from_name(title_folder)

    file_name = parts[-1]
    stem = posixpath.splitext(file_name)[0]
    inner = parts[2:-1]  # folders between the title folder and the file

    if media_type == "series":
        _parse_episode_file(result, stem, inner)
        return result

    # Movies / documentaries / live performances.
    for folder in inner:
        canonical = extra_folder(folder)
        if canonical is not None:
            result["role"] = ROLE_EXTRA
            result["extra_category"] = _extra_category(canonical)
            return result
    if inner:
        result["role"] = ROLE_OTHER
        return result
    result.update(_feature_role(stem, title_folder))
    return result


def _parse_episode_file(result: Dict[str, Any], stem: str, inner: list) -> None:
    folder_season: Optional[int] = None
    for folder in inner:
        season = season_from_folder(folder)
        if season is not None:
            folder_season = season
            continue
        canonical = extra_folder(folder)
        if canonical is not None:
            result["role"] = ROLE_EXTRA
            result["extra_category"] = _extra_category(canonical)
            result["season_number"] = folder_season
            return
    season, episode, end = episode_numbers(stem)
    if episode is None and folder_season is not None:
        episode, end = _absolute_episode(stem)
        if episode is not None:
            season = folder_season
    if season is None:
        season = folder_season
    result["season_number"] = season
    if episode is not None:
        result["role"] = ROLE_EPISODE
        result["episode_number"] = episode
        result["episode_end_number"] = end
        return
    folder = classify_extra_from_stem(stem)
    if folder is not None and folder != "extras":
        result["role"] = ROLE_EXTRA
        result["extra_category"] = _extra_category(folder)
        return
    result["role"] = ROLE_OTHER


def title_key(rel_or_folder: Any) -> Optional[str]:
    """``category/title folder`` (lower case) of a library path or title-folder path.

    Takes a library-relative file path, or any title (or season) folder path
    whatever its root: the key is its last ``category/title`` pair, so a
    catalog folder written under an older library root still matches.
    """
    text = str(rel_or_folder or "").replace("\\", "/").rstrip("/")
    if not text:
        return None
    parts = [part for part in text.split("/") if part]
    categories = _category_types()
    for index in range(len(parts) - 2, -1, -1):
        if parts[index].lower() in categories and index + 1 < len(parts):
            return f"{parts[index].lower()}/{parts[index + 1].lower()}"
    return None
