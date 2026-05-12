"""
Auto-matcher service for OMDB/TMDB integration.

Searches external APIs for parsed media info and returns match candidates
with confidence scores for assignment decision-making.
"""

import os
import re
import time
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

import requests

from utils.logging import logger


@dataclass
class MatchCandidate:
    """A potential match result from an external source."""

    source: str  # omdb, tmdb, firebase
    media_id: str
    title: str
    media_type: str  # movie, series, episode
    year: Optional[int] = None
    season: Optional[int] = None
    episode: Optional[int] = None
    imdb_id: Optional[str] = None
    confidence_score: int = 0
    match_reason: str = ""
    raw_data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AutoMatcherService:
    """Matches parsed media info against OMDB/TMDB to find best candidates."""

    def __init__(
        self,
        omdb_api_key: Optional[str] = None,
        tmdb_api_key: Optional[str] = None,
        firestore_service: Optional[Any] = None,
        metadata_source: str = "library_then_omdb",
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
        self.firestore_service = firestore_service
        self.metadata_source = self._normalize_metadata_source(metadata_source)

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

        if not title:
            return {"status": "no_title", "candidates": []}

        candidates: List[MatchCandidate] = []
        mode = self.metadata_source

        firebase_candidates: List[MatchCandidate] = []
        if mode in ("library_then_omdb", "library_only"):
            try:
                firebase_candidates = self._search_firebase(title, year, parsed_info)
                candidates.extend(firebase_candidates)
            except Exception as exc:
                logger.warning(
                    "Firebase search failed",
                    title=title,
                    error=str(exc),
                )

        should_call_omdb = mode in ("library_then_omdb", "omdb_only")
        if mode == "library_then_omdb":
            # External lookup when no internal candidates or all are missing imdb ids.
            should_call_omdb = len(firebase_candidates) == 0 or all(not c.imdb_id for c in firebase_candidates)

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
            candidate.confidence_score = self._calculate_confidence(
                candidate, parsed_info
            )

        candidates.sort(key=lambda c: -c.confidence_score)

        best_candidate = candidates[0] if candidates else None
        return {
            "status": "success",
            "found": len(candidates) > 0,
            "candidates": [c.to_dict() for c in candidates[:5]],
            "best_match": best_candidate.to_dict() if best_candidate else None,
        }

    def _search_firebase(
        self,
        title: str,
        year: Optional[int],
        parsed_info: Dict[str, Any],
    ) -> List[MatchCandidate]:
        """Search internal Firebase records before external providers."""
        if not self.firestore_service:
            return []

        if not getattr(self.firestore_service, "_initialized", False):
            return []

        media_type = parsed_info.get("media_type")
        if media_type == "episode":
            return self._search_firebase_series(title, year, parsed_info)

        return self._search_firebase_movies(title, year)

    def _search_firebase_movies(
        self,
        title: str,
        year: Optional[int],
    ) -> List[MatchCandidate]:
        candidates: List[MatchCandidate] = []

        try:
            docs = self.firestore_service.db.collection("movies").limit(120).get()
            for doc in docs:
                payload = doc.to_dict() or {}
                candidate_title = payload.get("title") or ""
                if not candidate_title:
                    continue

                title_similarity = self._fuzzy_match_titles(title, candidate_title)
                if title_similarity < 0.6:
                    continue

                candidate_year = self._extract_year_from_doc(payload)
                file_count = self._extract_file_association_count(payload)

                candidate = MatchCandidate(
                    source="firebase",
                    media_id=doc.id,
                    title=candidate_title,
                    media_type="movie",
                    year=candidate_year,
                    imdb_id=self._extract_imdb_id(payload),
                    match_reason=(
                        "firebase_title_match"
                        if file_count <= 0
                        else "firebase_title_match_with_existing_files"
                    ),
                    raw_data={
                        "collection": "movies",
                        "has_existing_files": file_count > 0,
                        "associated_file_count": file_count,
                    },
                )
                candidates.append(candidate)
        except Exception as exc:
            logger.warning("Firebase movie search failed", title=title, error=str(exc))

        return candidates

    def _search_firebase_series(
        self,
        title: str,
        year: Optional[int],
        parsed_info: Dict[str, Any],
    ) -> List[MatchCandidate]:
        candidates: List[MatchCandidate] = []
        season = parsed_info.get("season")
        episode = parsed_info.get("episode")

        try:
            docs = self.firestore_service.db.collection("series").limit(120).get()
            for doc in docs:
                payload = doc.to_dict() or {}
                candidate_title = payload.get("title") or ""
                if not candidate_title:
                    continue

                title_similarity = self._fuzzy_match_titles(title, candidate_title)
                if title_similarity < 0.6:
                    continue

                candidate_year = self._extract_year_from_doc(payload)
                total_file_count = self._extract_file_association_count(payload)
                episode_file_count = self._count_episode_level_assignments(
                    series_id=doc.id,
                    season=season,
                    episode=episode,
                )

                has_existing_files = total_file_count > 0 or episode_file_count > 0
                candidate = MatchCandidate(
                    source="firebase",
                    media_id=doc.id,
                    title=candidate_title,
                    media_type="series",
                    year=candidate_year,
                    season=season,
                    episode=episode,
                    imdb_id=self._extract_imdb_id(payload),
                    match_reason=(
                        "firebase_series_match"
                        if not has_existing_files
                        else "firebase_series_match_with_existing_files"
                    ),
                    raw_data={
                        "collection": "series",
                        "has_existing_files": has_existing_files,
                        "associated_file_count": total_file_count,
                        "associated_episode_file_count": episode_file_count,
                    },
                )
                candidates.append(candidate)
        except Exception as exc:
            logger.warning("Firebase series search failed", title=title, error=str(exc))

        return candidates

    def _count_episode_level_assignments(
        self,
        series_id: str,
        season: Optional[int],
        episode: Optional[int],
    ) -> int:
        if season is None or episode is None:
            return 0

        try:
            docs = (
                self.firestore_service.db.collection("media_assignments")
                .where("mediaType", "==", "episode")
                .where("seriesId", "==", series_id)
                .where("seasonNumber", "==", season)
                .where("episodeNumber", "==", episode)
                .limit(50)
                .get()
            )
            return len(docs)
        except Exception:
            return 0

    def _extract_file_association_count(self, payload: Dict[str, Any]) -> int:
        assignment_summary = payload.get("assignmentSummary") or {}
        if isinstance(assignment_summary, dict):
            total_files = assignment_summary.get("totalFiles")
            if isinstance(total_files, int):
                return max(total_files, 0)

        file_count = payload.get("fileCount")
        if isinstance(file_count, int):
            return max(file_count, 0)

        library_files = payload.get("libraryFiles")
        if isinstance(library_files, list):
            return len(library_files)

        return 0

    def _extract_year_from_doc(self, payload: Dict[str, Any]) -> Optional[int]:
        external_year = payload.get("year")
        if isinstance(external_year, int):
            return external_year

        omdb_data = payload.get("omdbData")
        if isinstance(omdb_data, dict):
            return self._parse_year(str(omdb_data.get("Year") or ""))

        release_date = payload.get("releaseDate")
        if isinstance(release_date, str):
            return self._parse_year(release_date)

        running_dates = payload.get("runningDates")
        if isinstance(running_dates, str):
            return self._parse_year(running_dates)

        return None

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
                release_year = None
                release_date = result.get("release_date", "")
                if release_date:
                    m = re.match(r"(\d{4})", release_date)
                    if m:
                        release_year = int(m.group(1))

                candidate = MatchCandidate(
                    source="tmdb",
                    media_id=str(result.get("id", "")),
                    title=result.get("title", ""),
                    media_type="movie",
                    year=release_year,
                    raw_data=result,
                )
                candidates.append(candidate)

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
                first_air_year = None
                first_air_date = result.get("first_air_date", "")
                if first_air_date:
                    m = re.match(r"(\d{4})", first_air_date)
                    if m:
                        first_air_year = int(m.group(1))

                candidate = MatchCandidate(
                    source="tmdb",
                    media_id=str(result.get("id", "")),
                    title=result.get("name", ""),
                    media_type="series",
                    year=first_air_year,
                    season=season,
                    episode=episode,
                    raw_data=result,
                )
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("TMDB series search failed", title=title, error=str(exc))

        return candidates

    def _calculate_confidence(
        self, candidate: MatchCandidate, parsed_info: Dict[str, Any]
    ) -> int:
        """Calculate and return confidence score (0-100) for a candidate."""
        score = 0

        parsed_title = parsed_info.get("title") or ""
        parsed_year = parsed_info.get("year")
        parsed_season = parsed_info.get("season")
        parsed_episode = parsed_info.get("episode")

        if not parsed_title:
            return 0

        title_similarity = self._fuzzy_match_titles(
            parsed_title, candidate.title
        )
        score += int(title_similarity * 50)

        if parsed_year and candidate.year:
            year_diff = abs(parsed_year - candidate.year)
            if year_diff == 0:
                score += 20
            elif year_diff == 1:
                score += 10
            elif year_diff <= 2:
                score += 5

        if parsed_season is not None:
            if candidate.media_type == "series":
                score += 15
            if parsed_episode is not None:
                score += 10

        if candidate.source == "firebase":
            # Prefer firebase strongly only when it carries stable external ids.
            # Sparse rows without imdb ids should not outrank high-quality OMDB matches.
            score += 20 if candidate.imdb_id else 5
            raw_data = candidate.raw_data or {}
            if raw_data.get("has_existing_files"):
                score += 15
            associated_episode_file_count = raw_data.get("associated_episode_file_count")
            if isinstance(associated_episode_file_count, int) and associated_episode_file_count > 0:
                score += 15

        score = min(score, 100)
        return max(0, score)

    def _fuzzy_match_titles(self, title1: str, title2: str) -> float:
        """Return fuzzy match ratio (0.0-1.0) between two titles."""
        norm1 = self._normalize_title(title1)
        norm2 = self._normalize_title(title2)

        matcher = SequenceMatcher(None, norm1, norm2)
        return matcher.ratio()

    def _normalize_title(self, title: str) -> str:
        """Normalize title for comparison."""
        normalized = title.lower().strip()
        normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized

    def _parse_year(self, year_str: str) -> Optional[int]:
        """Extract year from various formats."""
        if not year_str:
            return None

        match = re.search(r"(\d{4})", year_str)
        if match:
            return int(match.group(1))
        return None
