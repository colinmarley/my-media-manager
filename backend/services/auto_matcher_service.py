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

TMDB-first: a title search queries TMDB and falls back to an OMDb search only
when TMDB is not configured or returns nothing. The leading candidates are
then checked against the provider: TMDB details (with ``external_ids``) supply
the IMDb id and runtime, OMDb is asked *by IMDb id* for whatever TMDB lacks,
the parsed season/episode is validated against ``/tv/{id}/season/{s}``, and
the file's duration (``media_duration_ms``) is compared with the provider
runtime. Each check adds its own ``score_breakdown`` entry.
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
# A year further off is evidence against the candidate, not just missing evidence:
# without it a same-named show or remake from decades later ("Unsolved Mysteries"
# 1988 vs 2020) lands within the ambiguity margin once both scores hit the 100 cap.
YEAR_MISMATCH_POINTS = -20
SERIES_KIND_POINTS = 15
EPISODE_PRESENT_POINTS = 10
ID_MATCH_POINTS = 100
DEFAULT_AMBIGUITY_MARGIN = 10

# Provider checks (weights from section 6.5 of
# docs/architecture/INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md).
RUNTIME_WITHIN_5PCT_POINTS = 15
EPISODE_RUNTIME_WITHIN_10PCT_POINTS = 10
RUNTIME_OFF_OVER_25PCT_POINTS = -30
SEASON_EXISTS_POINTS = 8
EPISODE_EXISTS_POINTS = 8
EPISODE_MISSING_POINTS = -30
SEASON_MISSING_POINTS = -30
# Provider checks cost extra HTTP calls, so only the best few candidates of the
# initial title/year scoring get them.
PROVIDER_CHECK_TOP_N = 3


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
    runtime_minutes: Optional[int] = None
    episode_title: Optional[str] = None
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
                id_candidate = self._lookup_by_id(
                    imdb_id, tmdb_id, media_type, season, episode,
                    media_duration_ms=parsed_info.get("media_duration_ms"),
                )
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

        # TMDB is the primary search; OMDb searches only when TMDB is not
        # configured or finds nothing. "omdb_only"/"library_only" keep the
        # OMDb-only search and "tmdb_only" never calls OMDb.
        use_tmdb = mode in ("library_then_omdb", "tmdb_only") and bool(self.tmdb_api_key)
        use_omdb = mode != "tmdb_only"

        if use_tmdb:
            try:
                if media_type == "episode":
                    candidates.extend(self._search_tmdb_series(title, year, season=season, episode=episode))
                else:
                    candidates.extend(self._search_tmdb_movie(title, year))
            except Exception as exc:
                logger.warning("TMDB lookup failed", title=title, error=str(exc))

        if not candidates and use_omdb:
            try:
                if media_type == "episode":
                    candidates.extend(self._search_series(title, year, season=season, episode=episode))
                else:
                    candidates.extend(self._search_movie(title, year))
                if candidates and use_tmdb:
                    logger.info("OMDb fallback returned candidates", title=title, count=len(candidates), mode=mode)
            except Exception as exc:
                logger.warning("OMDB search failed", title=title, error=str(exc))

        # Calculate confidence for each candidate
        for candidate in candidates:
            score, breakdown = self._score_candidate(candidate, parsed_info)
            candidate.confidence_score = score
            candidate.score_breakdown = breakdown
            candidate.match_reason = self._format_reason(breakdown)

        candidates.sort(key=lambda c: -c.confidence_score)

        # Provider checks for the leading candidates: enrich (IMDb id, runtime),
        # validate season/episode, compare runtimes. They can reorder the list.
        season_cache: Dict[Tuple[str, int], Optional[Dict[str, Any]]] = {}
        for candidate in candidates[:PROVIDER_CHECK_TOP_N]:
            try:
                self._apply_provider_checks(candidate, parsed_info, season_cache, allow_omdb=use_omdb)
            except Exception as exc:
                logger.warning(
                    "Provider checks failed",
                    title=candidate.title,
                    source=candidate.source,
                    error=str(exc),
                )
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
        media_duration_ms: Optional[float] = None,
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
                    candidate.runtime_minutes = self._tmdb_runtime_minutes(data)
                    source_note = f"tmdb id {tmdb_id} resolved via TMDB"

        if candidate is None:
            return None

        candidate.season = season
        candidate.episode = episode
        candidate.confidence_score = ID_MATCH_POINTS
        candidate.score_breakdown = [{"rule": "id_tag", "points": ID_MATCH_POINTS, "note": source_note}]
        if candidate.runtime_minutes is None and candidate.source == "omdb":
            candidate.runtime_minutes = self._parse_runtime_minutes((candidate.raw_data or {}).get("Runtime"))
        # The id settles identity. A runtime mismatch only says the file may be
        # an extra rather than the feature, so it is shown but not scored.
        if candidate.media_type == "movie" and media_duration_ms:
            entry = self._runtime_entry(media_duration_ms, candidate.runtime_minutes, episode=False)
            if entry is not None:
                if entry["points"] < 0:
                    entry["note"] += "; not scored, the id tag settles identity (the file may be an extra)"
                entry["points"] = 0
                candidate.score_breakdown.append(entry)
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

    def _tmdb_search_results(self, kind: str, title: str, year: Optional[int]) -> List[Dict[str, Any]]:
        """Run a TMDB title search, filtered by year first.

        TMDB treats the year as a hard filter, and a folder year is often one off
        from TMDB's date (a series dated by its first special, a film by its
        festival premiere): "Unsolved Mysteries (1987)" first aired in 1988 on
        TMDB, so the filtered search finds nothing. When that happens the search
        is repeated without the year; the scorer still rewards a close year and
        penalises a distant one.
        """
        year_param = "first_air_date_year" if kind == "tv" else "year"
        attempts = [{year_param: year}, {}] if year else [{}]
        results: List[Dict[str, Any]] = []
        for extra in attempts:
            response = requests.get(
                f"{self.tmdb_base_url}/search/{kind}",
                params={"api_key": self.tmdb_api_key, "query": title, **extra},
                timeout=self.request_timeout,
            )
            response.raise_for_status()
            results = response.json().get("results", []) or []
            if results:
                break
        return results

    def _search_tmdb_movie(
        self, title: str, year: Optional[int] = None
    ) -> List[MatchCandidate]:
        """Search TMDB for movies matching the title."""
        if not self.tmdb_api_key:
            return []

        candidates = []
        try:
            for result in self._tmdb_search_results("movie", title, year)[:10]:
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
            for result in self._tmdb_search_results("tv", title, year)[:10]:
                candidate = self._tmdb_result_to_candidate(result, "series")
                candidate.season = season
                candidate.episode = episode
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("TMDB series search failed", title=title, error=str(exc))

        return candidates

    # ------------------------------------------------------------------
    # Provider checks (enrichment, season/episode, runtime)
    # ------------------------------------------------------------------

    def _apply_provider_checks(
        self,
        candidate: MatchCandidate,
        parsed_info: Dict[str, Any],
        season_cache: Dict[Tuple[str, int], Optional[Dict[str, Any]]],
        allow_omdb: bool = True,
    ) -> None:
        """Enrich one candidate from its provider and add the check entries to its breakdown."""
        media_duration_ms = parsed_info.get("media_duration_ms")
        parsed_season = parsed_info.get("season")
        parsed_episode = parsed_info.get("episode")
        is_episode = parsed_info.get("media_type") == "episode" or parsed_season is not None
        added: List[Dict[str, Any]] = []

        if candidate.source == "tmdb":
            self._enrich_from_tmdb(candidate)
        # OMDb by IMDb id for whatever TMDB did not supply, and for the runtime
        # of an OMDb search hit (search responses never carry one).
        needs_omdb = bool(candidate.imdb_id) and (
            candidate.year is None or (bool(media_duration_ms) and candidate.runtime_minutes is None)
        )
        if allow_omdb and needs_omdb and self.omdb_api_key:
            self._enrich_from_omdb(candidate)

        expected_runtime = candidate.runtime_minutes
        runtime_is_episode = False
        if is_episode and candidate.media_type == "series":
            runtime_is_episode = True
            if candidate.source == "tmdb" and parsed_season is not None:
                episode_entries, episode_runtime = self._check_tmdb_episode(
                    candidate, parsed_season, parsed_episode, parsed_info.get("episode_end"), season_cache
                )
                added.extend(episode_entries)
                if episode_runtime is not None:
                    expected_runtime = episode_runtime

        if media_duration_ms:
            entry = self._runtime_entry(media_duration_ms, expected_runtime, episode=runtime_is_episode)
            if entry is not None:
                added.append(entry)

        if not added:
            return
        candidate.score_breakdown.extend(added)
        total = sum(int(entry.get("points") or 0) for entry in candidate.score_breakdown)
        candidate.confidence_score = max(0, min(total, 100))
        candidate.match_reason = self._format_reason(candidate.score_breakdown)

    def _enrich_from_tmdb(self, candidate: MatchCandidate) -> None:
        """Fetch TMDB details with external ids: the IMDb id and the runtime."""
        if not self.tmdb_api_key or not candidate.media_id:
            return
        kind = "tv" if candidate.media_type == "series" else "movie"
        response = requests.get(
            f"{self.tmdb_base_url}/{kind}/{candidate.media_id}",
            params={"api_key": self.tmdb_api_key, "append_to_response": "external_ids"},
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        details = response.json() or {}
        if not details.get("id"):
            return
        imdb_id = details.get("imdb_id") or (details.get("external_ids") or {}).get("imdb_id")
        if imdb_id and not candidate.imdb_id:
            candidate.imdb_id = imdb_id
        if candidate.runtime_minutes is None:
            candidate.runtime_minutes = self._tmdb_runtime_minutes(details)
        if candidate.year is None:
            candidate.year = self._parse_year(details.get("release_date") or details.get("first_air_date"))
        raw = dict(candidate.raw_data or {})
        raw.update({key: value for key, value in details.items() if key not in ("seasons", "credits")})
        candidate.raw_data = raw

    def _enrich_from_omdb(self, candidate: MatchCandidate) -> None:
        """Ask OMDb by IMDb id for the fields the candidate is still missing."""
        response = requests.get(
            self.omdb_base_url,
            params={"apikey": self.omdb_api_key, "i": candidate.imdb_id},
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        data = response.json() or {}
        if data.get("Response") != "True":
            return
        if candidate.runtime_minutes is None:
            candidate.runtime_minutes = self._parse_runtime_minutes(data.get("Runtime"))
        if candidate.year is None:
            candidate.year = self._parse_year(data.get("Year"))
        raw = dict(candidate.raw_data or {})
        if candidate.source == "omdb":
            raw.update({key: value for key, value in data.items() if key not in raw})
        else:
            raw["omdbData"] = data
        candidate.raw_data = raw

    def _fetch_tmdb_season(
        self,
        tv_id: str,
        season: int,
        cache: Dict[Tuple[str, int], Optional[Dict[str, Any]]],
    ) -> Optional[Dict[str, Any]]:
        """Return the TMDB season payload, or None when the season does not exist."""
        key = (str(tv_id), int(season))
        if key in cache:
            return cache[key]
        response = requests.get(
            f"{self.tmdb_base_url}/tv/{tv_id}/season/{season}",
            params={"api_key": self.tmdb_api_key},
            timeout=self.request_timeout,
        )
        if getattr(response, "status_code", 200) == 404:
            cache[key] = None
            return None
        response.raise_for_status()
        data = response.json() or {}
        payload = data if isinstance(data.get("episodes"), list) else None
        cache[key] = payload
        return payload

    def _check_tmdb_episode(
        self,
        candidate: MatchCandidate,
        season: int,
        episode: Optional[int],
        episode_end: Optional[int],
        cache: Dict[Tuple[str, int], Optional[Dict[str, Any]]],
    ) -> Tuple[List[Dict[str, Any]], Optional[int]]:
        """Validate the parsed season/episode against TMDB.

        Returns the breakdown entries and the expected runtime in minutes of
        the episode (summed over a multi-episode file) when TMDB knows it.
        """
        if not self.tmdb_api_key or not candidate.media_id:
            return [], None
        season_data = self._fetch_tmdb_season(candidate.media_id, season, cache)
        if season_data is None:
            return [{
                "rule": "season_missing",
                "points": SEASON_MISSING_POINTS,
                "note": f"'{candidate.title}' has no season {season} on TMDB",
            }], None

        episodes = {
            ep.get("episode_number"): ep
            for ep in season_data.get("episodes") or []
            if isinstance(ep, dict) and ep.get("episode_number") is not None
        }
        entries: List[Dict[str, Any]] = [{
            "rule": "season_exists",
            "points": SEASON_EXISTS_POINTS,
            "note": f"season {season} has {len(episodes)} episodes on TMDB",
        }]
        if episode is None:
            return entries, None

        last = episode_end if isinstance(episode_end, int) and episode_end >= episode else episode
        wanted = list(range(episode, last + 1))
        label = f"S{season:02d}E{episode:02d}" + (f"-E{last:02d}" if last != episode else "")
        if any(number not in episodes for number in wanted):
            entries.append({
                "rule": "episode_missing",
                "points": EPISODE_MISSING_POINTS,
                "note": f"{label} not on TMDB (season {season} has {len(episodes)} episodes)",
            })
            return entries, None

        candidate.episode_title = episodes[episode].get("name") or None
        entries.append({
            "rule": "episode_exists",
            "points": EPISODE_EXISTS_POINTS,
            "note": label + (f" '{candidate.episode_title}'" if candidate.episode_title else ""),
        })
        runtimes = [episodes[number].get("runtime") for number in wanted]
        known = [float(r) for r in runtimes if isinstance(r, (int, float)) and r > 0]
        if len(known) == len(wanted):
            return entries, int(sum(known))
        return entries, None

    @staticmethod
    def _runtime_entry(
        media_duration_ms: Any,
        provider_minutes: Optional[int],
        episode: bool,
    ) -> Optional[Dict[str, Any]]:
        """Compare the file duration with the provider runtime; None when either is unknown."""
        try:
            file_minutes = float(media_duration_ms) / 60000.0
        except (TypeError, ValueError):
            return None
        if file_minutes <= 0 or not provider_minutes or provider_minutes <= 0:
            return None
        diff = abs(file_minutes - provider_minutes) / float(provider_minutes)
        note = f"file {file_minutes:.0f} min vs {provider_minutes} min (off {diff:.0%})"
        if diff <= 0.05:
            return {"rule": "runtime_within_5pct", "points": RUNTIME_WITHIN_5PCT_POINTS, "note": note}
        if episode and diff <= 0.10:
            return {"rule": "episode_runtime_within_10pct", "points": EPISODE_RUNTIME_WITHIN_10PCT_POINTS,
                    "note": note}
        if diff > 0.25:
            return {"rule": "runtime_off_over_25pct", "points": RUNTIME_OFF_OVER_25PCT_POINTS, "note": note}
        return {"rule": "runtime_differs", "points": 0, "note": note}

    @staticmethod
    def _tmdb_runtime_minutes(details: Dict[str, Any]) -> Optional[int]:
        runtime = details.get("runtime")
        if isinstance(runtime, (int, float)) and runtime > 0:
            return int(runtime)
        episode_run_time = details.get("episode_run_time")
        if isinstance(episode_run_time, list):
            values = [v for v in episode_run_time if isinstance(v, (int, float)) and v > 0]
            if values:
                return int(round(sum(values) / len(values)))
        return None

    @staticmethod
    def _parse_runtime_minutes(value: Any) -> Optional[int]:
        """Parse an OMDb runtime such as '136 min'; None for 'N/A'."""
        if not value:
            return None
        match = re.search(r"(\d+)", str(value))
        if not match:
            return None
        minutes = int(match.group(1))
        return minutes if minutes > 0 else None

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
                score += YEAR_MISMATCH_POINTS
                breakdown.append({"rule": "year_mismatch", "points": YEAR_MISMATCH_POINTS,
                                  "note": f"{parsed_year} vs {candidate.year}"})
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
