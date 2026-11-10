"""
Filename parser service for automated ingress processing.

Parses common movie and TV episode filename formats and returns normalized
metadata for downstream matching and assignment steps.

The parser looks at three things, in this order of trust:

1. Identifier tags anywhere in the folder chain or filename
   (``[imdbid-tt1234567]``, ``[tmdbid-603]``) — written by disc-ripper-service
   and by Jellyfin-style libraries. These are definitive.
2. The filename itself (SxxExx, year, track number, MakeMKV codes, extras
   keywords, quality tokens).
3. The folder chain above the file (series title, season folder, year,
   disc-set marker, ``extras`` sub-folder).

Every non-obvious choice is appended to ``ParsedMediaInfo.parse_notes`` so
the review UI and the processing history can show *why* a file was parsed
the way it was.
"""

import os
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:  # Shared extras vocabulary (folder names like "deleted scenes").
    from services.extras_taxonomy import EXTRA_FOLDERS as _EXTRA_FOLDER_ALIASES
except Exception:  # pragma: no cover - keeps the parser importable standalone
    _EXTRA_FOLDER_ALIASES = {}


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
    # Definitive identifiers found in folder tags or the filename.
    imdb_id: Optional[str] = None
    tmdb_id: Optional[str] = None
    # MakeMKV title index when the file carries a _tNN marker (B1_t03, title_t00, Name_t00).
    makemkv_track: Optional[int] = None
    # Disc number when the source folder is "Title D2 (Year)" / "Title Disc 2".
    disc_number: Optional[int] = None
    # Edition / version hints: 3D, Extended, Unrated, Director's Cut, 2160p, ...
    edition_hints: List[str] = field(default_factory=list)
    # Where the title came from: filename | folder | path.
    title_source: Optional[str] = None
    # Human-readable notes explaining non-obvious parse decisions.
    parse_notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class _PathContext:
    """Facts recovered from the folder chain above a file."""

    season: Optional[int] = None
    title: Optional[str] = None
    year: Optional[int] = None
    imdb_id: Optional[str] = None
    tmdb_id: Optional[str] = None
    disc_number: Optional[int] = None
    in_extras_folder: bool = False
    extras_folder: Optional[str] = None
    edition_hints: List[str] = field(default_factory=list)
    title_level: Optional[int] = None  # how many levels up the title folder was


class FilenameParser:
    """Parses filenames into structured media hints."""

    # ── Episode numbering ────────────────────────────────────────────────
    _episode_patterns = [
        # S01E04, S01 E04, S01.E04, S01E104
        re.compile(r"(?i)(?:^|[\s._-])S(\d{1,2})[ ._-]*E(\d{1,4})(?!\d)"),
        # 1x04, 10x25
        re.compile(r"(?i)(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?!\d)"),
        # V01E10 / Vol01E10 — volume-numbered collections (Looney Tunes etc.); volume maps to season.
        re.compile(r"(?i)(?:^|[\s._-])V(?:ol)?(\d{1,2})[ ._-]*E(\d{1,3})(?!\d)"),
    ]
    # Multi-episode suffix: E25E26, E25-E26, E25_E26 immediately after primary episode
    _multi_episode_suffix = re.compile(r"(?i)[E_-]E?(\d{1,3})(?=[^\d]|$)")

    # Season-pack: "Season 1", "Season.2" with no episode indicator
    _season_pack_pattern = re.compile(r"(?i)(?:^|[\s._-])Season[\s._-]*(\d{1,2})(?:[\s._-]|$)")

    # Bare episode filename: "e01", "e21", "ep09", "episode 09", "episode09"
    _bare_episode_pattern = re.compile(
        r"(?i)^[\s._-]*(?:episode|ep|e)[\s._-]*(\d{1,3})(?:[\s._-]|$)"
    )

    # Track-numbered file: "15 Aunt Mommy", "23_Founder's_Day", "01. The Collection", "07 - Fred".
    # A dash/underscore separator must be followed by a non-digit so "50-50" stays a title.
    _track_prefix_pattern = re.compile(r"^(\d{1,3})(?:[.\s]+[\s_-]*|[_-]+(?=\D))\s*(.*)$")
    # Conservative variant used to flag disc-chapter extras outside a season folder ("01 Some Title").
    _track_companion_pattern = re.compile(r"^\d{1,2}[.\s]\s*\D")

    # Season folder name: "Season 02", "Season02", "S02", "Specials"
    _season_folder_pattern = re.compile(r"(?i)^S(?:eason)?[\s._-]*(\d{1,2})$")
    _specials_folder_pattern = re.compile(r"(?i)^(?:specials?|season[\s._-]*0+)$")
    # Folders that talk about seasons but are not a season folder ("Best of Seasons 1 & 2",
    # "Complete Seasons 1 to 10"): never use these as a title.
    _seasonish_folder_pattern = re.compile(r"(?i)\bseasons?\b.*\d|\bS\d{1,2}(?:-S?\d{1,2})?\b.*complete|\bcomplete\b")

    # Anime absolute episode: "[Group] Show - 125 [tag]" — 2-4 digit number after " - "
    _anime_bracket_prefix = re.compile(r"^\s*\[([^\]]+)\]\s*")
    _anime_abs_episode = re.compile(r"(?:^|[\s._-])-[\s._-](\d{2,4})(?:[\s._-]|$)")

    # ── MakeMKV markers ──────────────────────────────────────────────────
    # Whole-name disc code: B1_t00, A1_t04, C2-t02, AB7_t02
    _makemkv_pattern = re.compile(r"(?i)^[A-Z]{1,2}\d+[_-]t(\d+)$")
    # MakeMKV-style track code appearing as a suffix: "13 GHOSTS-B4 t01"
    _makemkv_suffix_pattern = re.compile(r"(?i)[\s._-]+[A-Z]\d+[\s._-]t(\d+)$")
    # MakeMKV default output name: title_t00
    _makemkv_default_pattern = re.compile(r"(?i)^title[_-]t(\d+)$")
    # Named MakeMKV output: "Premium Rush_t00"
    _makemkv_named_pattern = re.compile(r"(?i)^(.+?)[_-]t(\d{2,3})$")

    # ── Identifier tags ──────────────────────────────────────────────────
    _imdb_tag_pattern = re.compile(r"(?i)[\[{(]\s*imdb(?:id)?\s*[-=:_]\s*(tt\d{7,8})\s*[\]})]")
    _imdb_bare_pattern = re.compile(r"(?<![A-Za-z0-9])(tt\d{7,8})(?![0-9])")
    _tmdb_tag_pattern = re.compile(r"(?i)[\[{(]\s*tmdb(?:id)?\s*[-=:_]\s*(\d{1,9})\s*[\]})]")
    _any_tag_group_pattern = re.compile(r"\s*[\[{][^\]}]*[\]}]\s*")

    # ── Companion / extras ───────────────────────────────────────────────
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
    # Disc / part suffix on a title: "Top Gun D2", "The Matrix Disc 2", "Movie CD1"
    _disc_suffix_pattern = re.compile(
        r"(?i)(?:\b(?:disc|disk|dvd|bd|cd|pt|part)\s*\d+\b|\b[A-Z]\d+\b)$"
    )
    _disc_number_pattern = re.compile(r"(?i)(?:^|[\s._(-])(?:disc|disk|dvd|bd|cd|d)\s*(\d{1,2})(?:\)|\b)\s*$")

    # Tokens that are never part of a title. Only "safe" tokens live here —
    # words like "web" or "dvd" that can legitimately appear in titles are
    # handled by the parenthesized-group rule instead.
    _noise_tokens = {
        "bluray", "blu-ray", "bdrip", "brrip", "webrip", "webdl", "web-dl", "hdrip",
        "dvdrip", "hdtv", "hdtvrip", "tvrip", "remux",
        "x264", "x265", "h264", "h265", "h.264", "h.265", "hevc", "avc", "xvid", "divx", "10bit", "8bit",
        "aac", "ac3", "dts", "dts-hd", "truehd", "atmos", "eac3", "ddp", "dd5", "dd51", "ddp51", "aac2", "51", "71",
        "2160p", "1080p", "1080i", "720p", "576p", "480p", "4k", "uhd", "hdr", "hdr10", "dolbyvision",
        "proper", "repack", "internal", "limited", "readnfo", "reenc",
        "extended", "unrated",
    }
    # Tokens that identify a parenthesized group as technical info rather than title text.
    _tech_group_token = re.compile(
        r"(?i)\b(?:\d{3,4}[pi]|4k|uhd|x26[45]|h\.?26[45]|hevc|avc|xvid|divx|blu-?ray|bdrip|brrip"
        r"|web-?dl|webrip|hdtv|dvdrip|hdrip|remux|aac|ac3|dts|truehd|atmos|10bit|hdr10?|dv|dovi"
        r"|amzn|nf|dsnp|hmax|atvp|pcok|yify|rarbg|psa|ghost|panda|silence|celdra|qxr)\b"
    )
    _edition_pattern = re.compile(
        r"(?i)\b(3d|half-?sbs|half-?ou|sbs|extended(?:\s+(?:cut|edition))?|unrated|uncut|theatrical(?:\s+cut)?"
        r"|director'?s?\s+cut|final\s+cut|ultimate\s+(?:cut|edition)|remastered|imax|criterion"
        r"|special\s+edition|collector'?s?\s+edition|anniversary\s+edition|2160p|4k|uhd|hdr10?|dolby\s*vision)\b"
    )

    _generic_companion_labels = {
        "extra", "extras", "special feature", "special features", "bonus", "bonus feature",
        "bonus features", "deleted scene", "deleted scenes", "featurette", "featurettes",
        "interview", "interviews", "trailer", "trailers", "sample", "samples",
        "behind the scenes", "making of", "bloopers", "gag reel",
    }

    # Folder names that are library roots or ingest roots, never titles.
    _generic_root_folders = {
        "ingest", "ingress", "incoming", "inbox", "staging", "encoded", "ripped", "rips",
        "media", "jellyfin", "plex", "ark", "data", "mnt", "volumes", "movies", "shows",
        "tv", "tv shows", "series", "documentaries", "live performances", "home videos",
        "_needsreview", "unprocessed", "video_ts", "bdmv", "stream",
    }

    _MAX_PATH_LEVELS = 5

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def parse_filename(
        self, filename: str, folder_name: Optional[str] = None, file_path: Optional[str] = None
    ) -> ParsedMediaInfo:
        """Parse a filename and return normalized media hints.

        ``folder_name`` is the source-root folder the queue resolved for this
        file (kept for backwards compatibility). ``file_path`` lets the parser
        walk the whole folder chain for season folders, identifier tags, years
        and series titles.
        """
        base_name = os.path.basename(filename)
        name_without_ext, extension = os.path.splitext(base_name)
        ext_lower = extension.lower() if extension else None
        notes: List[str] = []

        ctx = self._collect_path_context(file_path, folder_name)
        folder_title = ctx.title or (self._clean_folder_title(folder_name) if folder_name else "")
        if folder_title and self.is_generic_companion_label(folder_title):
            folder_title = ""

        # Identifier tags in the filename itself.
        file_imdb = self._find_imdb_id(name_without_ext)
        file_tmdb = self._find_tmdb_id(name_without_ext)
        imdb_id = file_imdb or ctx.imdb_id
        tmdb_id = file_tmdb or ctx.tmdb_id
        if imdb_id:
            notes.append(f"imdb id {imdb_id} from {'filename' if file_imdb else 'folder tag'}")
        if tmdb_id and not imdb_id:
            notes.append(f"tmdb id {tmdb_id} from {'filename' if file_tmdb else 'folder tag'}")

        quality_match = self._quality_pattern.search(name_without_ext)
        quality = quality_match.group(1).lower() if quality_match else None

        edition_hints = self._merge_hints(ctx.edition_hints, self._extract_edition_hints(name_without_ext))

        # ── Strip anime group tag from the front: "[SubGroup] Show - 125 [720p]"
        anime_prefix_match = self._anime_bracket_prefix.match(name_without_ext)
        working = name_without_ext
        if anime_prefix_match:
            working = name_without_ext[anime_prefix_match.end():]

        # Remove [tag] groups ([imdbid-…], [1080p], [Group]) and technical (…) groups so
        # they never leak into titles or episode titles.
        working = self._any_tag_group_pattern.sub(" ", working)
        working = self._strip_tech_paren_groups(working)
        stripped_for_parse = working.strip()

        # ── Standard SxxExx / NxNN / VxxExx episode patterns ────────────────
        episode_match = self._match_episode(stripped_for_parse)
        if episode_match:
            season_number = int(episode_match.group(1))
            episode_number = int(episode_match.group(2))
            title_candidate = stripped_for_parse[: episode_match.start()]
            remainder = stripped_for_parse[episode_match.end():]
            if episode_match.re is self._episode_patterns[2]:
                notes.append(f"volume {season_number} treated as season")

            # Detect multi-episode continuation: E25E26, E25-E26, E25_E26
            episode_end: Optional[int] = None
            multi_match = self._multi_episode_suffix.match(remainder)
            if multi_match:
                episode_end = int(multi_match.group(1))
                remainder = remainder[multi_match.end():]

            # Year inside the title segment: "The Fresh Prince of Bel-Air (1990) - S04E18"
            year, title_candidate = self._split_year(title_candidate)
            if year is not None:
                notes.append(f"year {year} from filename")

            # Strip "Part N" from title so API matching isn't confused
            title_candidate = self._part_pattern.sub(" ", title_candidate)
            title = self._clean_title(title_candidate)
            title_source = "filename"
            if not title or self.is_generic_companion_label(title):
                title = folder_title
                title_source = "path" if ctx.title else "folder"
                if title:
                    notes.append(f"series title '{title}' from {title_source}")
            if year is None and ctx.year is not None:
                year = ctx.year
                notes.append(f"year {year} from folder")

            episode_title = self._clean_episode_title(remainder)

            # Season 0 is a TV special — flag it
            classification_hint = "special_feature" if season_number == 0 else None

            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                year=year,
                season=season_number,
                episode=episode_number,
                episode_end=episode_end,
                episode_title=episode_title or None,
                quality=quality,
                extension=ext_lower,
                classification_hint=classification_hint,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                disc_number=ctx.disc_number,
                edition_hints=edition_hints,
                title_source=title_source,
                parse_notes=notes,
            )

        # ── Season-pack: "Show.Name.Season.1" with no episode number ─────────
        season_pack_match = self._season_pack_pattern.search(stripped_for_parse)
        if season_pack_match:
            season_number = int(season_pack_match.group(1))
            title_candidate = stripped_for_parse[: season_pack_match.start()]
            year, title_candidate = self._split_year(title_candidate)
            title = self._clean_title(title_candidate)
            title_source = "filename"
            if not title:
                title = folder_title
                title_source = "path" if ctx.title else "folder"
            if year is None:
                year = ctx.year
            notes.append(f"season pack: season {season_number}, episode unknown")
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                year=year,
                season=season_number,
                episode=None,
                quality=quality,
                extension=ext_lower,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                edition_hints=edition_hints,
                title_source=title_source,
                parse_notes=notes,
            )

        # ── Bare episode filename: "e01", "ep09", "episode 09" ───────────────
        bare_ep_match = self._bare_episode_pattern.match(stripped_for_parse)
        if bare_ep_match:
            episode_number = int(bare_ep_match.group(1))
            title = folder_title
            if title:
                notes.append(f"series title '{title}' from path")
            if ctx.season is not None:
                notes.append(f"season {ctx.season} from folder")
            remainder = stripped_for_parse[bare_ep_match.end():]
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                year=ctx.year,
                season=ctx.season,
                episode=episode_number,
                episode_title=self._clean_episode_title(remainder) or None,
                quality=quality,
                extension=ext_lower,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                edition_hints=edition_hints,
                title_source="path" if ctx.title else "folder",
                parse_notes=notes,
            )

        # ── Track-numbered file under a season folder: "15 Aunt Mommy" ──────
        # Disc rips name episodes by track order; when the folder chain says
        # which season this is, the leading number is the episode number.
        track_match = self._track_prefix_pattern.match(stripped_for_parse)
        if track_match and ctx.season is not None and not self._makemkv_pattern.match(stripped_for_parse):
            episode_number = int(track_match.group(1))
            rest = track_match.group(2) or ""
            title = folder_title
            notes.append(
                f"track {episode_number} under season folder {ctx.season} treated as episode {episode_number}"
            )
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=title,
                normalized_title=self.normalize_title(title),
                year=ctx.year,
                season=ctx.season,
                episode=episode_number,
                episode_title=self._clean_episode_title(rest) or None,
                quality=quality,
                extension=ext_lower,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                edition_hints=edition_hints,
                title_source="path" if ctx.title else "folder",
                parse_notes=notes,
            )

        # ── Anime absolute episode: "[Group] Show - 125 [tag]" ───────────────
        if anime_prefix_match:
            abs_ep_match = self._anime_abs_episode.search(stripped_for_parse)
            if abs_ep_match:
                title_candidate = stripped_for_parse[: abs_ep_match.start()]
                title = self._clean_title(title_candidate) or folder_title
                episode_number = int(abs_ep_match.group(1))
                notes.append("anime absolute episode numbering; season unknown")
                return ParsedMediaInfo(
                    file_name=base_name,
                    media_type="episode",
                    title=title,
                    normalized_title=self.normalize_title(title),
                    year=ctx.year,
                    season=None,   # absolute numbering — no season known
                    episode=episode_number,
                    quality=quality,
                    extension=ext_lower,
                    imdb_id=imdb_id,
                    tmdb_id=tmdb_id,
                    edition_hints=edition_hints,
                    title_source="filename",
                    parse_notes=notes,
                )

        # ── Movie / unknown ──────────────────────────────────────────────────
        makemkv_track: Optional[int] = None
        is_companion = False
        title_candidate = stripped_for_parse

        mk_whole = self._makemkv_pattern.match(name_without_ext.strip())
        mk_default = self._makemkv_default_pattern.match(name_without_ext.strip())
        mk_suffix = self._makemkv_suffix_pattern.search(name_without_ext)
        mk_named = None if (mk_whole or mk_default) else self._makemkv_named_pattern.match(name_without_ext.strip())

        if mk_whole:
            makemkv_track = int(mk_whole.group(1))
            is_companion = True
            title_candidate = ""
            notes.append(f"MakeMKV disc code (track {makemkv_track}); title from folder")
        elif mk_default:
            makemkv_track = int(mk_default.group(1))
            title_candidate = ""
            notes.append(f"MakeMKV default name title_t{makemkv_track:02d}; title from folder")
        elif mk_suffix:
            makemkv_track = int(mk_suffix.group(1))
            is_companion = True
            title_candidate = name_without_ext[: mk_suffix.start()]
            notes.append(f"MakeMKV track suffix (track {makemkv_track})")
        elif mk_named:
            makemkv_track = int(mk_named.group(2))
            title_candidate = mk_named.group(1)
            notes.append(f"MakeMKV named output (track {makemkv_track}); not treated as extra")

        year, title_candidate = self._split_year(title_candidate)
        if year is not None:
            notes.append(f"year {year} from filename")

        file_disc_number = self._find_disc_number(title_candidate)
        title_candidate = self._disc_suffix_pattern.sub("", title_candidate.strip()).strip(" -_.")
        title = self._clean_title(title_candidate)
        title_source = "filename"
        disc_number = ctx.disc_number if ctx.disc_number is not None else file_disc_number

        # Companion detection (track prefix outside a season folder, keyword suffix, generic label)
        if not is_companion:
            is_companion = bool(
                (ctx.season is None and self._track_companion_pattern.match(stripped_for_parse))
                or self._companion_suffix_pattern.search(name_without_ext)
                or (title and self.is_generic_companion_label(title))
            )
            if is_companion:
                notes.append("companion/extra by filename pattern")
        if ctx.in_extras_folder:
            is_companion = True
            notes.append(f"inside extras folder '{ctx.extras_folder}'")

        # Fall back to the folder title when the filename carries no usable title,
        # is an extra, or is a MakeMKV capture.
        if folder_title and (not title or is_companion or makemkv_track is not None and not mk_named):
            if title and title.lower() != folder_title.lower() and not is_companion:
                notes.append(f"filename title '{title}' replaced by folder title '{folder_title}'")
            title = folder_title
            title_source = "path" if ctx.title else "folder"
        if year is None and ctx.year is not None:
            year = ctx.year
            notes.append(f"year {year} from folder")

        # A plain file living under a Season folder is an episode with an unknown number.
        if ctx.season is not None and not is_companion:
            notes.append(f"file under season folder {ctx.season}; episode number unknown")
            return ParsedMediaInfo(
                file_name=base_name,
                media_type="episode",
                title=folder_title or title,
                normalized_title=self.normalize_title(folder_title or title),
                year=year,
                season=ctx.season,
                episode=None,
                episode_title=title if folder_title and title.lower() != folder_title.lower() else None,
                quality=quality,
                extension=ext_lower,
                imdb_id=imdb_id,
                tmdb_id=tmdb_id,
                makemkv_track=makemkv_track,
                edition_hints=edition_hints,
                title_source="path" if ctx.title else title_source,
                parse_notes=notes,
            )

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
            imdb_id=imdb_id,
            tmdb_id=tmdb_id,
            makemkv_track=makemkv_track,
            disc_number=disc_number,
            edition_hints=edition_hints,
            title_source=title_source,
            parse_notes=notes,
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
        normalized = (title or "").lower().strip().replace("&", " and ")
        normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()

    # ------------------------------------------------------------------
    # Folder-chain context
    # ------------------------------------------------------------------

    def _collect_path_context(self, file_path: Optional[str], folder_name: Optional[str]) -> _PathContext:
        """Walk the folder chain above ``file_path`` and collect every usable fact."""
        ctx = _PathContext()
        parts: List[str] = []
        if file_path:
            normalized = os.path.normpath(file_path).replace("\\", "/")
            parts = [p for p in normalized.split("/") if p][:-1]
        elif folder_name:
            parts = [folder_name]

        parents = list(reversed(parts))[: self._MAX_PATH_LEVELS]

        for depth, part in enumerate(parents, start=1):
            if not part or part.strip().lower() in self._generic_root_folders:
                break  # reached a library/ingest root; nothing above is ours

            # Identifier tags can sit on any level.
            if ctx.imdb_id is None:
                ctx.imdb_id = self._find_imdb_id(part)
            if ctx.tmdb_id is None:
                ctx.tmdb_id = self._find_tmdb_id(part)

            ctx.edition_hints = self._merge_hints(ctx.edition_hints, self._extract_edition_hints(part))

            # Extras sub-folder ("extras", "deleted scenes", "featurettes" …)
            compact = re.sub(r"[^a-z0-9]+", "", part.lower())
            if compact in _EXTRA_FOLDER_ALIASES or self.is_generic_companion_label(part):
                if not ctx.in_extras_folder and ctx.title is None:
                    ctx.in_extras_folder = True
                    ctx.extras_folder = part
                continue

            # Season folders.
            season_m = self._season_folder_pattern.match(part.strip())
            if season_m and ctx.season is None and ctx.title is None:
                ctx.season = int(season_m.group(1))
                continue
            if self._specials_folder_pattern.match(part.strip()) and ctx.season is None and ctx.title is None:
                ctx.season = 0
                continue
            if self._seasonish_folder_pattern.search(part) and ctx.title is None:
                # "Best of Seasons 1 & 2", "Season 1 Complete TVRip [i_c]" — carries the year
                # sometimes, never a clean title. Keep walking.
                if ctx.year is None:
                    ctx.year = self._folder_year(part)
                continue

            if ctx.title is None:
                cleaned = self._clean_folder_title(part)
                if cleaned and not self.is_generic_companion_label(cleaned):
                    ctx.title = cleaned
                    ctx.title_level = depth
                    ctx.disc_number = self._find_disc_number(part)
                if ctx.year is None:
                    ctx.year = self._folder_year(part)
                # The title folder is the last level we care about for titles, but tags
                # above it (rare) are still collected on later iterations.
                continue

            # Above the title folder: only look for tags/year once more, then stop.
            if ctx.year is None:
                ctx.year = self._folder_year(part)
            break

        return ctx

    def _extract_path_context(self, file_path: Optional[str]) -> Tuple[Optional[int], Optional[str]]:
        """Backward-compatible helper: (season_number_or_None, series_title_or_None)."""
        ctx = self._collect_path_context(file_path, None)
        return ctx.season, ctx.title

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _match_episode(self, name_without_ext: str):
        for pattern in self._episode_patterns:
            match = pattern.search(name_without_ext)
            if match:
                return match
        return None

    def _find_imdb_id(self, value: str) -> Optional[str]:
        if not value:
            return None
        m = self._imdb_tag_pattern.search(value) or self._imdb_bare_pattern.search(value)
        return m.group(1).lower() if m else None

    def _find_tmdb_id(self, value: str) -> Optional[str]:
        if not value:
            return None
        m = self._tmdb_tag_pattern.search(value)
        return m.group(1) if m else None

    def _extract_edition_hints(self, value: str) -> List[str]:
        hints: List[str] = []
        for m in self._edition_pattern.finditer(value or ""):
            hint = re.sub(r"\s+", " ", m.group(1)).strip()
            if hint.lower() not in {h.lower() for h in hints}:
                hints.append(hint)
        return hints

    @staticmethod
    def _merge_hints(a: List[str], b: List[str]) -> List[str]:
        merged: List[str] = list(a)
        seen = {h.lower() for h in merged}
        for h in b:
            if h.lower() not in seen:
                merged.append(h)
                seen.add(h.lower())
        return merged

    def _strip_tech_paren_groups(self, value: str) -> str:
        """Remove ``(…)`` groups that are technical info: "(480p DVD x265 Panda)", "(1080p BluRay)"."""
        def _replace(m: "re.Match[str]") -> str:
            inner = m.group(1)
            if self._tech_group_token.search(inner):
                return " "
            return m.group(0)

        return re.sub(r"\(([^()]*)\)", _replace, value)

    def _split_year(self, value: str) -> Tuple[Optional[int], str]:
        """Return (year, value_without_year). Prefers a parenthesized year, then the last bare year
        that is not the leading token (so '2012.mkv' keeps its title)."""
        if not value:
            return None, value
        paren = re.search(r"\((19\d{2}|20\d{2})\)", value)
        if paren:
            return int(paren.group(1)), (value[: paren.start()] + " " + value[paren.end():]).strip()
        matches = list(self._year_pattern.finditer(value))
        if not matches:
            return None, value
        # Choose the first year that is not at the very start of the string (titles like "2012").
        chosen = None
        for m in matches:
            if m.start() > 0 and value[: m.start()].strip(" ._-"):
                chosen = m
                break
        if chosen is None:
            return None, value
        return int(chosen.group(1)), value[: chosen.start()].strip()

    def _extract_year(self, name_without_ext: str) -> Optional[int]:
        year_match = self._year_pattern.search(name_without_ext or "")
        if not year_match:
            return None
        return int(year_match.group(1))

    def _folder_year(self, value: str) -> Optional[int]:
        """Year of a folder name, preferring "(2009)" over a leading "2012"-style title."""
        year, _ = self._split_year(value or "")
        return year

    def _find_disc_number(self, value: str) -> Optional[int]:
        """Disc number from "Title D2 (2011)", "Title Disc 2", "Title (D2) (2019)"."""
        if not value:
            return None
        stripped = self._any_tag_group_pattern.sub(" ", value)
        stripped = re.sub(r"\((?:19|20)\d{2}\)", " ", stripped).strip()
        m = self._disc_number_pattern.search(stripped)
        return int(m.group(1)) if m else None

    def _clean_folder_title(self, value: str) -> str:
        if not value:
            return ""
        value = self._any_tag_group_pattern.sub(" ", value)
        value = self._strip_tech_paren_groups(value)
        value = self._edition_pattern.sub(" ", value) if "(" in value else value
        year, title_candidate = self._split_year(value)
        if year is None:
            title_candidate = value

        cleaned = self._clean_title(title_candidate)
        cleaned = self._disc_suffix_pattern.sub("", cleaned).strip(" -")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def _clean_episode_title(self, remainder: str) -> str:
        """Clean the text after an episode token into an episode title, or ''.

        Keeps natural punctuation ("Stop Will!", "Ann's Decision") and only drops
        technical/release tokens.
        """
        text = (remainder or "").strip(" ._-")
        if not text:
            return ""
        text = text.replace("_", " ")
        if " " not in text:
            text = text.replace(".", " ")
        words = [w for w in re.split(r"\s+", text) if w]
        if not words:
            return ""
        # Drop leading technical noise entirely ("720p HDTV ReEnc-Max" is not a title).
        if words[0].lower().strip("()[]") in self._noise_tokens or self._tech_group_token.match(words[0]):
            return ""
        kept = [
            w for w in words
            if w.lower().strip("()[]-") not in self._noise_tokens and not self._tech_group_token.fullmatch(w)
        ]
        cleaned = " ".join(kept).strip(" -_.")
        return re.sub(r"\s+", " ", cleaned)

    def _clean_title(self, value: str) -> str:
        cleaned = (value or "").replace("_", " ").replace(".", " ").replace("&", " and ").strip(" -")
        cleaned = re.sub(r"\s+", " ", cleaned)

        words = []
        for word in cleaned.split(" "):
            compact_word = re.sub(r"[^a-zA-Z0-9'\-]", "", word)
            if compact_word.lower().strip("'-") in self._noise_tokens:
                continue
            compact_word = compact_word.strip("'")
            if not re.search(r"[A-Za-z0-9]", compact_word):
                continue  # drop punctuation-only tokens such as a lone "-"
            words.append(compact_word)

        cleaned = " ".join([word for word in words if word])
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" -")
        return cleaned
