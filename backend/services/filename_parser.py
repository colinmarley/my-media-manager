"""
Filename parser service for automated ingress processing.

Parses common movie and TV episode filename formats and returns normalized
metadata for downstream matching and assignment steps.
"""

import os
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional


@dataclass
class ParsedMediaInfo:
    """Structured parsing result for a media filename."""

    file_name: str
    media_type: str  # movie | episode | unknown
    title: str
    normalized_title: str
    year: Optional[int] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    episode_end: Optional[int] = None  # last episode in a multi-episode file (e.g. S10E25E26)
    episode_title: Optional[str] = None
    quality: Optional[str] = None
    extension: Optional[str] = None
    classification_hint: Optional[str] = None
    is_companion: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FilenameParser:
    """Parses filenames into structured media hints."""

    _episode_patterns = [
        re.compile(r"(?i)\bS(\d{1,2})[ ._-]*E(\d{1,2})(?!\d)"),
        re.compile(r"(?i)\b(\d{1,2})x(\d{1,2})\b"),
    ]
    # Multi-episode suffix: E25E26, E25-E26, E25_E26 immediately after primary episode
    _multi_episode_suffix = re.compile(r"(?i)[E_-]E?(\d{1,2})(?=[^\d]|$)")

    # Season-pack: "Season 1", "Season.2" with no episode indicator
    _season_pack_pattern = re.compile(r"(?i)(?:^|[\s._-])Season[\s._-]*(\d{1,2})(?:[\s._-]|$)")

    # Bare episode filename: "e01", "e21", "ep09", "episode 09", "episode09"
    # May optionally be preceded by a separator and followed by a separator or end
    _bare_episode_pattern = re.compile(
        r"(?i)^[\s._-]*(?:episode|ep|e)[\s._-]*(\d{1,3})(?:[\s._-]|$)"
    )

    # Season folder name: "Season 02", "Season02", "S02"
    _season_folder_pattern = re.compile(r"(?i)^S(?:eason)?[\s._-]*(\d{1,2})$")

    # Anime absolute episode: "[Group] Show - 125 [tag]" — 2-4 digit number after " - "
    _anime_bracket_prefix = re.compile(r"^\s*\[([^\]]+)\]\s*")
    _anime_abs_episode = re.compile(r"(?:^|[\s._-])-[\s._-](\d{2,4})(?:[\s._-]|$)")

    # Matches MakeMKV disc filenames like B1_t00, A1_t04, C2_t02 (whole name or suffix)
    _makemkv_pattern = re.compile(r"^[A-Za-z]\d+[_-]t\d+$")
    # MakeMKV-style track code appearing as a suffix: e.g. "13 GHOSTS-B4 t01"
    _makemkv_suffix_pattern = re.compile(r"(?i)[\s._-]+[A-Za-z]\d+[\s._-]t\d+$")
    # Numbered-track prefix: "01 Some Title" or "01. Some Title" — disc chapter indicator
    _track_prefix_pattern = re.compile(r"^\d{1,2}[.\s]\s*")

    # Companion keyword suffix: "Movie Title - Making Of", "Movie Title - Featurette"
    _companion_suffix_pattern = re.compile(
        r"(?i)[\s._-]+-[\s._-]+("
        r"making[\s._-]+of|behind[\s._-]+the[\s._-]+scenes|deleted[\s._-]+scenes?"
        r"|featurettes?|interviews?|trailers?|extras?|bonus(?:[\s._-]+features?)?"
        r"|special[\s._-]+features?|bloopers?|gag[\s._-]+reel"
        r")(?:[\s._-]|$)"
    )

    # Multi-part episode: "Part 2", "Pt 2", "Pt2" — strip before API matching
    _part_pattern = re.compile(r"(?i)[\s._-]+(?:part|pt)[\s._-]*(\d+)(?:[\s._-]|$)")

    _year_pattern = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
    _quality_pattern = re.compile(
        r"(?i)\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|bluray|web[ ._-]?dl|webrip)\b"
    )
    _disc_suffix_pattern = re.compile(
        r"(?i)(?:\b(?:disc|dvd|bd|cd|pt|part)\s*\d+\b|\b[A-Z]\d+\b)$"
    )

    _noise_tokens = [
        "bluray",
        "bdrip",
        "brrip",
        "webrip",
        "webdl",
        "web-dl",
        "hdrip",
        "dvdrip",
        "x264",
        "x265",
        "h264",
        "h265",
        "hevc",
        "aac",
        "dts",
        "proper",
        "repack",
        "extended",
        "unrated",
        "remux",
    ]

    _generic_companion_labels = {
        "extra",
        "extras",
        "special feature",
        "special features",
        "bonus",
        "bonus feature",
        "bonus features",
        "deleted scene",
        "deleted scenes",
        "featurette",
        "featurettes",
        "interview",
        "interviews",
        "trailer",
        "trailers",
        "sample",
        "samples",
        "behind the scenes",
        "making of",
        "bloopers",
        "gag reel",
    }

    def parse_filename(
        self, filename: str, folder_name: Optional[str] = None, file_path: Optional[str] = None
    ) -> ParsedMediaInfo:
        """Parse a filename and return normalized media hints.

        If folder_name is provided and the filename is a bare MakeMKV disc code
        (e.g. B1_t00.mkv), the folder name is used as the title fallback.

        If file_path is provided, path segments are inspected when the filename
        alone is a bare episode name (e.g. "e02.mkv" under "Cheers/Season 02/")
        so the series title and season number can be recovered from the directory
        structure.
        """
        base_name = os.path.basename(filename)
        name_without_ext, extension = os.path.splitext(base_name)
        ext_lower = extension.lower() if extension else None

        quality_match = self._quality_pattern.search(name_without_ext)
        quality = quality_match.group(1).lower() if quality_match else None

        # ── Strip anime group tag from the front: "[SubGroup] Show - 125 [720p]"
        anime_prefix_match = self._anime_bracket_prefix.match(name_without_ext)
        stripped_for_parse = name_without_ext
        if anime_prefix_match:
            stripped_for_parse = name_without_ext[anime_prefix_match.end():]

        # ── Standard SxxExx / NxNN episode patterns ──────────────────────────
        episode_match = self._match_episode(stripped_for_parse)
        if episode_match:
            season_number = int(episode_match.group(1))
            episode_number = int(episode_match.group(2))
            title_candidate = stripped_for_parse[: episode_match.start()]
            remainder = stripped_for_parse[episode_match.end():]

            # Detect multi-episode continuation: E25E26, E25-E26, E25_E26
            episode_end: Optional[int] = None
            multi_match = self._multi_episode_suffix.match(remainder)
            if multi_match:
                episode_end = int(multi_match.group(1))
                remainder = remainder[multi_match.end():]

            # Strip "Part N" from title so API matching isn't confused
            title_candidate = self._part_pattern.sub(" ", title_candidate)
            title = self._clean_title(title_candidate)
            episode_title = self._clean_title(remainder)

            # Season 0 is a TV special — flag it
            classification_hint = "special_feature" if season_number == 0 else None

            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                season=season_number,
                episode=episode_number,
                episode_end=episode_end,
                episode_title=episode_title or None,
                quality=quality,
                extension=ext_lower,
                classification_hint=classification_hint,
            )

        # ── Season-pack: "Show.Name.Season.1" with no episode number ─────────
        season_pack_match = self._season_pack_pattern.search(stripped_for_parse)
        if season_pack_match:
            season_number = int(season_pack_match.group(1))
            title_candidate = stripped_for_parse[: season_pack_match.start()]
            title = self._clean_title(title_candidate) or self._clean_folder_title(folder_name or "")
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                season=season_number,
                episode=None,
                quality=quality,
                extension=ext_lower,
            )

        # ── Bare episode filename: "e01", "ep09", "episode 09" ───────────────
        # Recover series title and season from parent path segments when available.
        bare_ep_match = self._bare_episode_pattern.match(stripped_for_parse)
        if bare_ep_match:
            episode_number = int(bare_ep_match.group(1))
            path_season, path_title = self._extract_path_context(file_path)
            title = path_title or self._clean_folder_title(folder_name or "") or ""
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                season=path_season,
                episode=episode_number,
                quality=quality,
                extension=ext_lower,
            )

        # ── Anime absolute episode: "[Group] Show - 125 [tag]" ───────────────
        if anime_prefix_match:
            abs_ep_match = self._anime_abs_episode.search(stripped_for_parse)
            if abs_ep_match:
                title_candidate = stripped_for_parse[: abs_ep_match.start()]
                title = self._clean_title(title_candidate)
                episode_number = int(abs_ep_match.group(1))
                return ParsedMediaInfo(
                    file_name=base_name,
                    media_type="episode",
                    title=title,
                    normalized_title=self.normalize_title(title),
                    season=None,   # absolute numbering — no season known
                    episode=episode_number,
                    quality=quality,
                    extension=ext_lower,
                )

        year = self._extract_year(name_without_ext)
        title_candidate = name_without_ext
        if year is not None:
            year_match = self._year_pattern.search(name_without_ext)
            if year_match:
                title_candidate = name_without_ext[: year_match.start()]

        title = self._clean_title(title_candidate)

        # ── Companion detection (order matters — check suffix before title) ───
        is_companion = bool(
            self._makemkv_pattern.match(name_without_ext.strip())
            or self._makemkv_suffix_pattern.search(name_without_ext)
            or self._track_prefix_pattern.match(name_without_ext.strip())
            or self._companion_suffix_pattern.search(name_without_ext)
            or self.is_generic_companion_label(title)
        )

        # Fall back to the parent media folder when the filename is a MakeMKV
        # capture or a generic extras/special-features label.
        if folder_name and (
            not title
            or is_companion
        ):
            title = self._clean_folder_title(folder_name)
            if year is None:
                year = self._extract_year(folder_name)

        media_type = "movie" if year is not None else "unknown"
        return ParsedMediaInfo(
            file_name=base_name,
            media_type=media_type,
            title=title,
            normalized_title=self.normalize_title(title),
            year=year,
            quality=quality,
            extension=ext_lower,
            classification_hint="special_feature" if is_companion else None,
            is_companion=is_companion,
        )

    def detect_media_type(self, filename: str) -> str:
        """Return the likely media type for the provided filename."""
        return self.parse_filename(filename).media_type

    def is_generic_companion_label(self, value: str) -> bool:
        """Return True when a title/folder is just a generic extras label."""
        normalized = self.normalize_title(value)
        if not normalized:
            return True
        if normalized in self._generic_companion_labels:
            return True
        return bool(re.fullmatch(r"(?:disc|cd|dvd|bd)\s*\d+", normalized))

    def normalize_title(self, title: str) -> str:
        """Normalize titles for lookups and fuzzy matching."""
        normalized = title.lower().strip()
        normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()

    def _match_episode(self, name_without_ext: str):
        for pattern in self._episode_patterns:
            match = pattern.search(name_without_ext)
            if match:
                return match
        return None

    def _extract_path_context(self, file_path: Optional[str]) -> tuple:
        """Walk parent directories of file_path to find a Season folder and a series title.

        Returns (season_number_or_None, series_title_or_None).

        Expected layout:  .../[Series Title]/Season 02/e01.mkv
                          .../[Series Title]/S02/e01.mkv
                          .../[Series Title]/e01.mkv   (no explicit season folder)
        """
        if not file_path:
            return None, None

        parts = os.path.normpath(file_path).split(os.sep)
        # parts[-1] is the filename; walk upward through parent segments
        parent_parts = parts[:-1]

        season_num: Optional[int] = None
        series_title: Optional[str] = None

        for depth, part in enumerate(reversed(parent_parts), start=1):
            if season_num is None:
                season_m = self._season_folder_pattern.match(part)
                if season_m:
                    season_num = int(season_m.group(1))
                    continue  # next level up should be the series title
                # No season folder found yet — treat the immediate parent as a
                # potential title if it doesn't look like a generic/ingress folder.
                if depth == 1:
                    candidate = self._clean_folder_title(part)
                    if candidate and not self.is_generic_companion_label(candidate):
                        series_title = candidate
                    break
            else:
                # First non-season segment above the season folder = series title
                candidate = self._clean_folder_title(part)
                if candidate and not self._season_folder_pattern.match(part):
                    series_title = candidate
                    break
            # Don't walk more than 4 levels up — avoid grabbing ingress root names
            if depth >= 4:
                break

        return season_num, series_title

    def _extract_year(self, name_without_ext: str) -> Optional[int]:
        year_match = self._year_pattern.search(name_without_ext)
        if not year_match:
            return None
        return int(year_match.group(1))

    def _clean_folder_title(self, value: str) -> str:
        year = self._extract_year(value)
        title_candidate = value
        if year is not None:
            year_match = self._year_pattern.search(value)
            if year_match:
                title_candidate = value[: year_match.start()]

        cleaned = self._clean_title(title_candidate)
        cleaned = self._disc_suffix_pattern.sub("", cleaned).strip(" -")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def _clean_title(self, value: str) -> str:
        cleaned = value.replace("_", " ").replace(".", " ").strip(" -")
        cleaned = re.sub(r"\s+", " ", cleaned)

        words = []
        for word in cleaned.split(" "):
            compact_word = re.sub(r"[^a-zA-Z0-9-]", "", word)
            if compact_word.lower() in self._noise_tokens:
                continue
            words.append(compact_word)

        cleaned = " ".join([word for word in words if word])
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned