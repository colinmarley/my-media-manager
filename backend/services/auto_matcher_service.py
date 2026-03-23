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

    def __init__(self, omdb_api_key: Optional[str] = None):
        self.omdb_api_key = omdb_api_key or os.environ.get("OMDB_API_KEY", "")
        self.omdb_base_url = "http://www.omdbapi.com"
        self.request_timeout = 10

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

        candidates = []
        try:
            if media_type == "episode":
                candidates = self._search_series(title, year)
            else:
                candidates = self._search_movie(title, year)
        except Exception as exc:
            logger.warning(
                "OMDB search failed",
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

    def _search_movie(
        self, title: str, year: Optional[int] = None
    ) -> List[MatchCandidate]:
        """Search OMDB for movies matching the title."""
        if not self.omdb_api_key:
            logger.warning("OMDB_API_KEY not configured")
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
        self, title: str, year: Optional[int] = None
    ) -> List[MatchCandidate]:
        """Search OMDB for TV series matching the title."""
        if not self.omdb_api_key:
            logger.warning("OMDB_API_KEY not configured")
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
                    imdb_id=result.get("imdbID"),
                    raw_data=result,
                )
                candidates.append(candidate)

        except requests.RequestException as exc:
            logger.error("OMDB API request failed", title=title, error=str(exc))

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
