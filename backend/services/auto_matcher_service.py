"""
Auto-matcher service for OMDB/TMDB integration.

Searches external APIs for parsed media info and returns match candidates
with confidence scores for assignment decision-making.

Scoring is explainable: every candidate carries a ``score_breakdown`` list of
``{"rule", "points", "note"}`` entries and a human-readable ``match_reason``.
The result also reports whether the top candidate is *ambiguous* (a runner-up
scored within ``ambiguity_margin`` points), so callers can hold an otherwise
high-scoring match for review.

Identifier-first: when the parsed info carries an IMDb or TMDB id (from a
``[imdbid-tt…]`` folder tag), the matcher looks the title up by id and returns
a single certain candidate instead of searching.
"""

import os
import re
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

import requests

from utils.logging import logger


# Points. Chosen so that an exact title + exact year reaches the default
# auto-assign threshold (80) and an exact title alone does not.
TITLE_POINTS_MAX = 55
YEAR_EXACT_POINTS = 25
YEAR_OFF_BY_ONE_POINTS = 15
YEAR_OFF_BY_TWO_POINTS = 5
SERIES_KIND_POINTS = 15
EPISODE_PRESENT_POINTS = 10
ID_MATCH_POINTS = 100
DEFAULT_AMBIGUITY_MARGIN = 10


@dataclass
class MatchCandidate:
    """A potential match result from an external source."""

    source: str  # omdb, tmdb, postgres
    media_id: str
    title: str
    media_type: str  # movie, series, episode
    year: Optional[int] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    imdb_id: Optional[str] = None
    confidence_score: int = 0
    match_reason: str = ""
    score_breakdown: List[Dict[str, Any]] = field(default_factory=list)
    raw_data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AutoMatcherService:
    """Matches parsed media info against OMDB/TMDB to find best candidates."""

    def __init__(
        self,
        omdb_api_key: Optional[str] = None,
        tmdb_api_key: Optional[str] = None,
        metadata_source: str = "library_then_omdb",
        ambiguity_margin: int = DEFAULT_AMBIGUITY_MARGIN,
    ):
        self.omdb_api_key = (
            omdb_api_key
            or os.environ.get("MEDIA_LIBRARY_OMDB_API_KEY", "")
            or os.environ.get("OMDB_API_KEY", "")
        )
        self.omdb_base_url = "http://www.omdbapi.com"
        self.tmdb_api_key = (
            tmdb_api_key
            or os.environ.get("MEDIA_LIBRARY_TMDB_API_KEY", "")
            or os.environ.get("TMDB_API_KEY", "")
        )
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.request_timeout = 10
        self.metadata_source = self._normalize_metadata_source(metadata_source)
        self.ambiguity_margin = max(0, int(ambiguity_margin))

    def _normalize_metadata_source(self, source: Optional[str]) -> str:
        value = (source or "library_then_omdb").strip().lower()
        aliases = {
            "omdb": "omdb_only",
            "tmdb": "tmdb_only",
            "library": "library_only",
        }
        value = aliases.get(value, value)
        if value not in {"library_then_omdb", "omdb_only", "tmdb_only", "library_only"}:
            return "library_then_omdb"
        return value

    def set_metadata_source(self, source: Optional[str]) -> None:
        self.metadata_source = self._normalize_metadata_source(source)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def search_and_match(
        self, parsed_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Search OMDB/external sources for matches and return candidates
        with calculated confidence scores.
        """
        media_type = parsed_info.get("media_type")
        title = parsed_info.get("title", "")
        year = parsed_info.get("year")
        season = parsed_info.get("season")
        episode = parsed_info.get("episode")

        # ── Identifier-first: a tagged folder is definitive ──────────────────
        imdb_id = parsed_info.get("imdb_id")
        tmdb_id = parsed_info.get("tmdb_id")
        if imdb_id or tmdb_id:
            try:
                id_candidate = self._lookup_by_id(imdb_id, tmdb_id, media_type, season, episode)
            except Exception as exc:
                id_candidate = None
                logger.warning("Identifier lookup failed", imdb_id=imdb_id, tmdb_id=tmdb_id, error=str(exc))
            if id_candidate is not None:
                return {
                    "status": "success",
                    "found": True,
                    "candidates": [id_candidate.to_dict()],
                    "best_match": id_candidate.to_dict(),
                    "ambiguous": False,
                    "margin": None,
                    "lookup": "id",
                }

        if not title:
            return {"status": "no_title", "candidates": [], "best_match": None, "ambiguous": False, "margin": None}

        candidates: List[MatchCandidate] = []
        mode = self.metadata_source

        should_call_omdb = mode in ("library_then_omdb", "omdb_only", "library_only")

        if should_call_omdb:
            try:
                if media_type == "episode":
                    candidates.extend(self._search_series(title, year, season=season, episode=episode))
                else:
                    candidates.extend(self._search_movie(title, year))
            except Exception as exc:
                logger.warning(
                    "OMDB search failed",
                    title=title,
                    error=str(exc),
                )

        should_call_tmdb = mode == "tmdb_only" or (mode == "library_then_omdb" and len(candidates) == 0)
        if should_call_tmdb and self.tmdb_api_key:
            try:
                if media_type == "episode":
                    candidates.extend(self._search_tmdb_series(title, year, season=season, episode=episode))
                else:
                    candidates.extend(self._search_tmdb_movie(title, year))
                if candidates:
                    logger.info(
                        "TMDB lookup returned candidates",
                        title=title,
                        count=len(candidates),
                        mode=mode,
                    )
            except Exception as exc:
                logger.warning(
                    "TMDB lookup failed",
                    title=title,
                    error=str(exc),
                )

        # Calculate confidence for each candidate
        for candidate in candidates:
            score, breakdown = self._score_candidate(candidate, parsed_info)
            candidate.confidence_score = score
            candidate.score_breakdown = breakdown
            candidate.match_reason = self._format_reason(breakdown)

        candidates.sort(key=lambda c: -c.confidence_score)

        best_candidate = candidates[0] if candidates else None
        ambiguous = False
        margin: Optional[int] = None
        if len(candidates) >= 2 and best_candidate is not None:
            runner_up = candidates[1]
            margin = best_candidate.confidence_score - runner_up.confidence_score
            if margin < self.ambiguity_margin:
                ambiguous = True
                note = (
                    f"ambiguous: '{runner_up.title}'"
                    f"{f' ({runner_up.year})' if runner_up.year else ''}"
                    f" scored {runner_up.confidence_score}, only {margin} below"
                )
                best_candidate.score_breakdown.append({"rule": "ambiguous", "points": 0, "note": note})
                best_candidate.match_reason = self._format_reason(best_candidate.score_breakdown)

        return {
            "status": "success",
            "found": len(candidates) > 0,
            "candidates": [c.to_dict() for c in candidates[:5]],
            "best_match": best_candidate.to_dict() if best_candidate else None,
            "ambiguous": ambiguous,
            "margin": margin,
            "lookup": "search",
        }

    # ------------------------------------------------------------------
    # Identifier lookups
    # ------------------------------------------------------------------

    def _lookup_by_id(
        self,
        imdb_id: Optional[str],
        tmdb_id: Optional[str],
        media_type: Optional[str],
        season: Optional[int],
        episode: Optional[int],
    ) -> Optional[MatchCandidate]:
        """Resolve a definitive identifier to a single candidate scored 100."""
        candidate: Optional[MatchCandidate] = None
        source_note = ""

        if imdb_id and self.omdb_api_key:
            response = requests.get(
                self.omdb_base_url,
                params={"apikey": self.omdb_api_key, "i": imdb_id},
                timeout=self.request_timeout,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("Response") == "True":
                omdb_type = (data.get("Type") or "").lower()
                kind = "series" if omdb_type in ("series", "episode") else "movie"
                candidate = MatchCandidate(
                    source="omdb",
                    media_id=data.get("imdbID", imdb_id),
                    title=data.get("Title", ""),
                    media_type=kind,
                    year=self._parse_year(data.get("Year")),
                    imdb_id=data.get("imdbID", imdb_id),
                    raw_data=data,
                )
                source_note = f"imdb id {imdb_id} resolved via OMDb"

        if candidate is None and self.tmdb_api_key:
            if imdb_id:
                response = requests.get(
                    f"{self.tmdb_base_url}/find/{imdb_id}",
                    params={"api_key": self.tmdb_api_key, "external_source": "imdb_id"},
                    timeout=self.request_timeout,
                )
                response.raise_for_status()
                data = response.json()
                movie_results = data.get("movie_results") or []
                tv_results = data.get("tv_results") or []
                hit = None
                kind = None
                if media_type == "episode" and tv_results:
                    hit, kind = tv_results[0], "series"
                elif movie_results:
                    hit, kind = movie_results[0], "movie"
                elif tv_results:
                    hit, kind = tv_results[0], "series"
                if hit and kind:
                    candidate = self._tmdb_result_to_candidate(hit, kind)
                    candidate.imdb_id = imdb_id
                    source_note = f"imdb id {imdb_id} resolved via TMDB"
            elif tmdb_id:
                kind = "tv" if media_type == "episode" else "movie"
                response = requests.get(
                    f"{self.tmdb_base_url}/{kind}/{tmdb_id}",
                    params={"api_key": self.tmdb_api_key, "append_to_response": "external_ids"},
                    timeout=self.request_timeout,
                )
                response.raise_for_status()
                data = response.json()
                if data.get("id"):
                    candidate = self._tmdb_result_to_candidate(data, "series" if kind == "tv" else "movie")
                    candidate.imdb_id = (data.get("external_ids") or {}).get("imdb_id")
                    source_note = f"tmdb id {tmdb_id} resolved via TMDB"

        if candidate is None:
            return None

        candidate.season = season
        candidate.episode = episode
        candidate.confidence_score = ID_MATCH_POINTS
        candidate.score_breakdown = [{"rule": "id_tag", "points": ID_MATCH_POINTS, "note": source_note}]
        candidate.match_reason = self._format_reason(candidate.score_breakdown)
        return candidate

    def _tmdb_result_to_candidate(self, result: Dict[str, Any], kind: str) -> MatchCandidate:
        date_value = result.get("release_date") if kind == "movie" else result.get("first_air_date")
        year = None
        if date_value:
            m = re.match(r"(\d{4})", str(date_value))
            if m:
                year = int(m.group(1))
        return MatchCandidate(
            source="tmdb",
            media_id=str(result.get("id", "")),
            title=(result.get("title") if kind == "movie" else result.get("name")) or "",
            media_type=kind,
            year=year,
            raw_data=result,
        )

    def _extract_imdb_id(self, payload: Dict[str, Any]) -> Optional[str]:
        external_ids = payload.get("externalIds")
        if isinstance(external_ids, dict):
            imdb_id = external_ids.get("imdbId")
            if isinstance(imdb_id, str) and imdb_id:
                return imdb_id

        omdb_data = payload.get("omdbData")
        if isinstance(omdb_data, dict):
            imdb_id = omdb_data.get("imdbID")
            if isinstance(imdb_id, str) and imdb_id:
                return imdb_id

        return None

    # ------------------------------------------------------------------
    # Searches
    # ------------------------------------------------------------------

    def _search_movie(
        self, title: str, year: Optional[int] = None
    ) -> List[MatchCandidate]:
        """Search OMDB for movies matching the title."""
        if not self.omdb_api_key:
            logger.warning("OMDB API key not configured (MEDIA_LIBRARY_OMDB_API_KEY)")
            return []

        candidates = []
        try:
            params = {
                "apikey": self.omdb_api_key,
                "s": title,
                "type": "movie",
            }

            response = requests.get(
                self.omdb_base_url,
                params=params,
                timeout=self.request_timeout,
            )
            response.raise_for_status()

            data = response.json()
            if data.get("Response") != "True" or "Search" not in data:
                return candidates

            for result in data.get("Search", [])[:10]:
                candidate = MatchCandidate(
                    source="omdb",
                    media_id=result.get("imdbID", ""),
                    title=result.get("Title", ""),
                    media_type="movie",
                    year=self._parse_year(result.get("Year")),
                    imdb_id=result.get("imdbID"),
                    raw_data=result,
                )
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("OMDB API request failed", title=title, error=str(exc))

        return candidates

    def _search_series(
        self,
        title: str,
        year: Optional[int] = None,
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[MatchCandidate]:
        """Search OMDB for TV series matching the title."""
        if not self.omdb_api_key:
            logger.warning("OMDB API key not configured (MEDIA_LIBRARY_OMDB_API_KEY)")
            return []

        candidates = []
        try:
            params = {
                "apikey": self.omdb_api_key,
                "s": title,
                "type": "series",
            }

            response = requests.get(
                self.omdb_base_url,
                params=params,
                timeout=self.request_timeout,
            )
            response.raise_for_status()

            data = response.json()
            if data.get("Response") != "True" or "Search" not in data:
                return candidates

            for result in data.get("Search", [])[:10]:
                candidate = MatchCandidate(
                    source="omdb",
                    media_id=result.get("imdbID", ""),
                    title=result.get("Title", ""),
                    media_type="series",
                    year=self._parse_year(result.get("Year")),
                    season=season,
                    episode=episode,
                    imdb_id=result.get("imdbID"),
                    raw_data=result,
                )
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("OMDB API request failed", title=title, error=str(exc))

        return candidates

    def _search_tmdb_movie(
        self, title: str, year: Optional[int] = None
    ) -> List[MatchCandidate]:
        """Search TMDB for movies matching the title."""
        if not self.tmdb_api_key:
            return []

        candidates = []
        try:
            params: Dict[str, Any] = {
                "api_key": self.tmdb_api_key,
                "query": title,
            }
            if year:
                params["year"] = year

            response = requests.get(
                f"{self.tmdb_base_url}/search/movie",
                params=params,
                timeout=self.request_timeout,
            )
            response.raise_for_status()

            data = response.json()
            for result in data.get("results", [])[:10]:
                candidates.append(self._tmdb_result_to_candidate(result, "movie"))

        except requests.RequestException as exc:
            logger.error("TMDB movie search failed", title=title, error=str(exc))

        return candidates

    def _search_tmdb_series(
        self,
        title: str,
        year: Optional[int] = None,
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[MatchCandidate]:
        """Search TMDB for TV series matching the title."""
        if not self.tmdb_api_key:
            return []

        candidates = []
        try:
            params: Dict[str, Any] = {
                "api_key": self.tmdb_api_key,
                "query": title,
            }
            if year:
                params["first_air_date_year"] = year

            response = requests.get(
                f"{self.tmdb_base_url}/search/tv",
                params=params,
                timeout=self.request_timeout,
            )
            response.raise_for_status()

            data = response.json()
            for result in data.get("results", [])[:10]:
                candidate = self._tmdb_result_to_candidate(result, "series")
                candidate.season = season
                candidate.episode = episode
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("TMDB series search failed", title=title, error=str(exc))

        return candidates

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def _score_candidate(
        self, candidate: MatchCandidate, parsed_info: Dict[str, Any]
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """Return (score 0-100, breakdown) for a candidate."""
        breakdown: List[Dict[str, Any]] = []
        score = 0

        parsed_title = parsed_info.get("title") or ""
        parsed_year = parsed_info.get("year")
        parsed_season = parsed_info.get("season")
        parsed_episode = parsed_info.get("episode")
        parsed_media_type = parsed_info.get("media_type")

        if not parsed_title:
            return 0, [{"rule": "no_title", "points": 0, "note": "nothing to compare"}]

        title_similarity = self._fuzzy_match_titles(parsed_title, candidate.title)
        title_points = int(round(title_similarity * TITLE_POINTS_MAX))
        score += title_points
        breakdown.append({
            "rule": "title_similarity",
            "points": title_points,
            "note": f"'{parsed_title}' vs '{candidate.title}' = {title_similarity:.0%}",
        })

        if parsed_year and candidate.year:
            year_diff = abs(parsed_year - candidate.year)
            if year_diff == 0:
                score += YEAR_EXACT_POINTS
                breakdown.append({"rule": "year_exact", "points": YEAR_EXACT_POINTS, "note": f"{candidate.year}"})
            elif year_diff == 1:
                score += YEAR_OFF_BY_ONE_POINTS
                breakdown.append({"rule": "year_off_by_one", "points": YEAR_OFF_BY_ONE_POINTS,
                                  "note": f"{parsed_year} vs {candidate.year}"})
            elif year_diff <= 2:
                score += YEAR_OFF_BY_TWO_POINTS
                breakdown.append({"rule": "year_off_by_two", "points": YEAR_OFF_BY_TWO_POINTS,
                                  "note": f"{parsed_year} vs {candidate.year}"})
            else:
                breakdown.append({"rule": "year_mismatch", "points": 0, "note": f"{parsed_year} vs {candidate.year}"})
        elif parsed_year and not candidate.year:
            breakdown.append({"rule": "year_unknown", "points": 0, "note": "candidate has no year"})
        else:
            breakdown.append({"rule": "year_not_parsed", "points": 0, "note": "no year in filename or folder"})

        if parsed_season is not None or parsed_media_type == "episode":
            if candidate.media_type == "series":
                score += SERIES_KIND_POINTS
                breakdown.append({"rule": "series_kind", "points": SERIES_KIND_POINTS, "note": "episode file, series candidate"})
            if parsed_episode is not None:
                score += EPISODE_PRESENT_POINTS
                breakdown.append({"rule": "episode_number", "points": EPISODE_PRESENT_POINTS,
                                  "note": f"S{parsed_season if parsed_season is not None else '?'}E{parsed_episode}"})

        if candidate.source == "postgres":
            # Prefer internal DB candidates when they carry stable external ids.
            bonus = 20 if candidate.imdb_id else 5
            score += bonus
            breakdown.append({"rule": "library_entry", "points": bonus, "note": "already in catalog"})
            raw_data = candidate.raw_data or {}
            if raw_data.get("has_existing_files"):
                score += 15
                breakdown.append({"rule": "library_has_files", "points": 15, "note": ""})
            associated_episode_file_count = raw_data.get("associated_episode_file_count")
            if isinstance(associated_episode_file_count, int) and associated_episode_file_count > 0:
                score += 15
                breakdown.append({"rule": "library_has_episode_files", "points": 15, "note": ""})

        score = max(0, min(score, 100))
        return score, breakdown

    def _calculate_confidence(
        self, candidate: MatchCandidate, parsed_info: Dict[str, Any]
    ) -> int:
        """Calculate and return confidence score (0-100) for a candidate."""
        score, _ = self._score_candidate(candidate, parsed_info)
        return score

    @staticmethod
    def _format_reason(breakdown: List[Dict[str, Any]]) -> str:
        parts = []
        for entry in breakdown:
            points = entry.get("points")
            note = entry.get("note") or ""
            rule = str(entry.get("rule") or "").replace("_", " ")
            if points:
                parts.append(f"{rule} {points:+d}" + (f" ({note})" if note else ""))
            elif note:
                parts.append(f"{rule}: {note}")
        return "; ".join(parts)

    def _fuzzy_match_titles(self, title1: str, title2: str) -> float:
        """Return fuzzy match ratio (0.0-1.0) between two titles."""
        norm1 = self._normalize_title(title1)
        norm2 = self._normalize_title(title2)

        matcher = SequenceMatcher(None, norm1, norm2)
        return matcher.ratio()

    def _normalize_title(self, title: str) -> str:
        """Normalize title for comparison."""
        normalized = (title or "").lower().strip().replace("&", " and ")
        normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized.strip()

    def _parse_year(self, year_str: Optional[str]) -> Optional[int]:
        """Extract year from various formats."""
        if not year_str:
            return None

        match = re.search(r"(\d{4})", str(year_str))
        if match:
            return int(match.group(1))
        return None
