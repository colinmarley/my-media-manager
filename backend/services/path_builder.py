"""
The one place library destinations are spelled.

The ingress queue shows a proposed path for every file it can resolve, and the
organizer moves the file. Both used to build the path on their own, with
different folder names, sanitizing, season rules and extra naming, so what a
person accepted was not always where the file went. Both now ask this module.

A path is built from a :class:`PathSpec`: what the file is (media type, title,
year, IMDb id, season and episode) and the role it plays in its folder (main
feature, alternate version, special feature, episode, or kept under its own
name). Paths are returned relative to the library root, with forward slashes;
:meth:`PathBuilder.absolute` joins one onto a root.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from config.settings import settings

ROLE_MAIN = "main"
ROLE_VERSION = "version"
ROLE_SPECIAL = "special"
ROLE_EPISODE = "episode"
# Kept under its original file name: an episode whose number is unknown, or an
# extra that belongs to a show.
ROLE_KEEP_NAME = "keep_name"

EPISODE_TYPES = ("episode", "series", "tv")
FEATURE_TYPES = ("movie", "documentary", "live_performance")

_INVALID_CHARS = '<>:"|?*'
# Slashes separate words in titles such as "50/50" or "Face/Off", so they
# become a hyphen instead of being dropped ("5050").
_SEPARATOR_CHARS = "/\\"
_IMDB_ID_RE = re.compile(r"tt\d+")


@dataclass(frozen=True)
class PathSpec:
    media_type: str
    title: str
    extension: str
    year: Any = None
    imdb_id: Optional[str] = None
    role: str = ROLE_MAIN
    number: Optional[int] = None  # Version N / Special Feature N
    season: Optional[int] = None
    episode: Optional[int] = None
    episode_end: Optional[int] = None
    episode_title: Optional[str] = None
    original_name: Optional[str] = None  # file name kept for ROLE_KEEP_NAME


def _as_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class PathBuilder:
    """Builds library-relative destination paths from a :class:`PathSpec`."""

    @staticmethod
    def sanitize(name: Any) -> str:
        """Drop characters that are invalid in file or folder names and collapse spaces."""
        text = str(name or "")
        for char in _SEPARATOR_CHARS:
            text = text.replace(char, "-")
        for char in _INVALID_CHARS:
            text = text.replace(char, "")
        return re.sub(r"\s{2,}", " ", text).strip()

    @staticmethod
    def normalize_media_type(media_type: Any) -> str:
        value = str(media_type or "movie").strip().lower()
        if value in EPISODE_TYPES:
            return "episode"
        if value in FEATURE_TYPES:
            return value
        return value

    @staticmethod
    def year_of(year: Any = None, release_date: Any = None) -> Optional[int]:
        parsed = _as_int(year)
        if parsed is None and release_date:
            parsed = _as_int(str(release_date)[:4])
        return parsed

    @staticmethod
    def subfolder(media_type: str) -> Optional[str]:
        """Configured top-level library folder for a media type, or None when unknown."""
        return {
            "movie": settings.folder_movies,
            "documentary": settings.folder_documentaries,
            "live_performance": settings.folder_live_performances,
            "episode": settings.folder_tv_shows,
        }.get(PathBuilder.normalize_media_type(media_type))

    @classmethod
    def folder_name(cls, title: Any, year: Any = None, imdb_id: Any = None) -> str:
        """``Title (Year) [imdbid-ttNNN]``; the year and tag only when known."""
        folder = cls.sanitize(title) or "Unknown"
        parsed_year = cls.year_of(year)
        if parsed_year is not None:
            folder = f"{folder} ({parsed_year})"
        if isinstance(imdb_id, str) and _IMDB_ID_RE.fullmatch(imdb_id.strip()):
            folder = f"{folder} [imdbid-{imdb_id.strip()}]"
        return folder

    @staticmethod
    def season_folder(season: Optional[int], role: str) -> str:
        """Season 0 is ``Specials``. With no season, a numbered (absolute) episode
        goes to ``Season 01``; anything else waits in ``Season 00``."""
        if season is not None:
            if season <= 0:
                return "Specials"
            return f"Season {season:02d}"
        return "Season 01" if role == ROLE_EPISODE else "Season 00"

    @classmethod
    def relative_dir(cls, spec: PathSpec) -> Optional[str]:
        media_type = cls.normalize_media_type(spec.media_type)
        subfolder = cls.subfolder(media_type)
        if subfolder is None:
            return None
        folder = cls.folder_name(spec.title, spec.year, spec.imdb_id)
        if media_type == "episode":
            return f"{subfolder}/{folder}/{cls.season_folder(_as_int(spec.season), cls._episode_role(spec))}"
        return f"{subfolder}/{folder}"

    @staticmethod
    def _episode_role(spec: PathSpec) -> str:
        if spec.role in (ROLE_MAIN, ROLE_EPISODE):
            return ROLE_EPISODE if _as_int(spec.episode) is not None else ROLE_KEEP_NAME
        return ROLE_KEEP_NAME

    @classmethod
    def file_name(cls, spec: PathSpec) -> str:
        ext = spec.extension or ""
        if ext and not ext.startswith("."):
            ext = f".{ext}"
        media_type = cls.normalize_media_type(spec.media_type)
        folder = cls.folder_name(spec.title, spec.year, spec.imdb_id)
        original = cls.sanitize(spec.original_name) or f"{folder}{ext}"

        if media_type == "episode":
            if cls._episode_role(spec) == ROLE_KEEP_NAME:
                return original
            season = _as_int(spec.season)
            episode = _as_int(spec.episode)
            episode_end = _as_int(spec.episode_end)
            assert episode is not None  # _episode_role checked it
            if season is None:
                label = f"E{episode:03d}"
                if episode_end is not None and episode_end > episode:
                    label = f"{label}E{episode_end:03d}"
            else:
                label = f"S{max(season, 0):02d}E{episode:02d}"
                if episode_end is not None and episode_end > episode:
                    label = f"{label}E{episode_end:02d}"
            episode_title = cls.sanitize(spec.episode_title)
            suffix = f" {episode_title}" if episode_title else ""
            return f"{folder} {label}{suffix}{ext}"

        if spec.role == ROLE_VERSION:
            return f"{folder} - Version {_as_int(spec.number) or 2}{ext}"
        if spec.role == ROLE_SPECIAL:
            return f"Special Feature {_as_int(spec.number) or 1}{ext}"
        if spec.role == ROLE_KEEP_NAME:
            return original
        return f"{folder}{ext}"

    @classmethod
    def relative_path(cls, spec: PathSpec) -> Optional[str]:
        """Destination relative to the library root, or None for an unknown media type."""
        directory = cls.relative_dir(spec)
        if directory is None:
            return None
        return f"{directory}/{cls.file_name(spec)}"

    @staticmethod
    def absolute(library_root: str, relative_path: str) -> str:
        """Join a library-relative path onto a root; an absolute path is returned as is."""
        if os.path.isabs(relative_path) or re.match(r"^[A-Za-z]:[\\/]", relative_path or ""):
            return relative_path
        return f"{str(library_root).rstrip('/').rstrip(os.sep)}/{relative_path.lstrip('/')}"

    # ------------------------------------------------------------------
    # Specs from the two shapes the pipeline carries
    # ------------------------------------------------------------------

    @classmethod
    def spec_from_match(
        cls,
        best_match: Dict[str, Any],
        file_name: str,
        role: str = ROLE_MAIN,
        number: Optional[int] = None,
    ) -> PathSpec:
        """Spec from a queue item's match (``title``, ``year``, ``imdb_id``, ``season``...)."""
        match = best_match or {}
        media_type = cls.normalize_media_type(match.get("media_type"))
        if cls.subfolder(media_type) is None:
            media_type = "movie"  # the queue files anything it matched as a feature
        if media_type == "episode" and role == ROLE_SPECIAL:
            role = ROLE_KEEP_NAME
        return PathSpec(
            media_type=media_type,
            title=match.get("title") or "Unknown",
            year=match.get("year"),
            imdb_id=match.get("imdb_id"),
            extension=os.path.splitext(file_name or "")[1],
            role=role,
            number=number,
            season=_as_int(match.get("season")),
            episode=_as_int(match.get("episode")),
            episode_end=_as_int(match.get("episode_end")),
            episode_title=match.get("episode_title"),
            original_name=file_name,
        )

    @classmethod
    def spec_from_assignment(
        cls,
        assignment: Dict[str, Any],
        media: Dict[str, Any],
        media_type: str,
        source_file: str,
    ) -> PathSpec:
        """Spec from an organizer assignment and its media payload.

        Used only when an assignment carries no proposed path (it did not come
        through the queue); the queue's own proposal is executed as stored.
        """
        normalized = cls.normalize_media_type(media_type)
        parsed_info = assignment.get("parsedInfo") or {}
        file_name = os.path.basename(source_file or "")
        title = media.get("title") or "Unknown"
        if normalized == "episode":
            title = media.get("seriesTitle") or title

        role = ROLE_MAIN
        number = None
        if normalized == "episode":
            role = ROLE_EPISODE
            if assignment.get("unknownEpisodeLabel"):
                role = ROLE_KEEP_NAME
                label = cls.sanitize(assignment.get("unknownEpisodeLabel"))
                if label:
                    file_name = f"{label}{os.path.splitext(file_name)[1]}"
        elif assignment.get("isAlternateVersion"):
            role = ROLE_VERSION
            number = _as_int(assignment.get("versionNumber")) or 2
        elif _as_int(assignment.get("specialFeatureNumber")) is not None:
            role = ROLE_SPECIAL
            number = _as_int(assignment.get("specialFeatureNumber"))

        season = assignment.get("seasonNumber")
        if season is None:
            season = parsed_info.get("season")
        episode = assignment.get("episodeNumber")
        if episode is None:
            episode = parsed_info.get("episode")

        return PathSpec(
            media_type=normalized,
            title=title,
            year=cls.year_of(media.get("year"), media.get("releaseDate")),
            imdb_id=media.get("imdbId"),
            extension=os.path.splitext(source_file or "")[1],
            role=role,
            number=number,
            season=_as_int(season),
            episode=_as_int(episode),
            episode_end=_as_int(parsed_info.get("episode_end") or assignment.get("episodeEnd")),
            episode_title=parsed_info.get("episode_title") or media.get("episodeTitle"),
            original_name=file_name,
        )

    @staticmethod
    def unique_path(destination: str, source_file: str) -> str:
        """``destination``, or the first free variant of it when a file is already there.

        Tries ``<stem> - <source stem><ext>`` first, then ``<stem> (N)<ext>``.
        The queue applies this when it resolves the plan right before an
        organize, so the plan already names the free path and the organizer
        finds nothing in the way.
        """
        if not os.path.exists(destination):
            return destination
        base, ext = os.path.splitext(destination)
        source_stem = PathBuilder.sanitize(os.path.splitext(os.path.basename(source_file or ""))[0]) or "copy"
        preferred = f"{base} - {source_stem}{ext}"
        if preferred != destination and not os.path.exists(preferred):
            return preferred
        suffix = 2
        while True:
            candidate = f"{base} ({suffix}){ext}"
            if not os.path.exists(candidate):
                return candidate
            suffix += 1


path_builder = PathBuilder()
