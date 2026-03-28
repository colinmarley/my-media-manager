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
    quality: Optional[str] = None
    extension: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FilenameParser:
    """Parses filenames into structured media hints."""

    _episode_patterns = [
        re.compile(r"(?i)\bS(\d{1,2})[ ._-]*E(\d{1,2})\b"),
        re.compile(r"(?i)\b(\d{1,2})x(\d{1,2})\b"),
    ]

    # Matches MakeMKV disc filenames like B1_t00, A1_t04, C2_t02
    _makemkv_pattern = re.compile(r"^[A-Za-z]\d+[_-]t\d+$")

    _year_pattern = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
    _quality_pattern = re.compile(
        r"(?i)\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|bluray|web[ ._-]?dl|webrip)\b"
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

    def parse_filename(
        self, filename: str, folder_name: Optional[str] = None
    ) -> ParsedMediaInfo:
        """Parse a filename and return normalized media hints.

        If folder_name is provided and the filename is a bare MakeMKV disc code
        (e.g. B1_t00.mkv), the folder name is used as the title fallback.
        """
        base_name = os.path.basename(filename)
        name_without_ext, extension = os.path.splitext(base_name)

        quality_match = self._quality_pattern.search(name_without_ext)
        quality = quality_match.group(1).lower() if quality_match else None

        episode_match = self._match_episode(name_without_ext)
        if episode_match:
            season_number = int(episode_match.group(1))
            episode_number = int(episode_match.group(2))
            title_candidate = name_without_ext[: episode_match.start()]
            title = self._clean_title(title_candidate)
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                season=season_number,
                episode=episode_number,
                quality=quality,
                extension=extension.lower() if extension else None,
            )

        year = self._extract_year(name_without_ext)
        title_candidate = name_without_ext
        if year is not None:
            year_match = self._year_pattern.search(name_without_ext)
            if year_match:
                title_candidate = name_without_ext[: year_match.start()]

        title = self._clean_title(title_candidate)

        # Fall back to folder name when filename is a MakeMKV disc code or useless
        if folder_name and (
            not title or self._makemkv_pattern.match(name_without_ext.strip())
        ):
            title = self._clean_title(folder_name)

        media_type = "movie" if year is not None else "unknown"
        return ParsedMediaInfo(
            file_name=base_name,
            media_type=media_type,
            title=title,
            normalized_title=self.normalize_title(title),
            year=year,
            quality=quality,
            extension=extension.lower() if extension else None,
        )

    def detect_media_type(self, filename: str) -> str:
        """Return the likely media type for the provided filename."""
        return self.parse_filename(filename).media_type

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

    def _extract_year(self, name_without_ext: str) -> Optional[int]:
        year_match = self._year_pattern.search(name_without_ext)
        if not year_match:
            return None
        return int(year_match.group(1))

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