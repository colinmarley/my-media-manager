"""Shared metadata enrichment for assignment flows.

This service normalizes sparse search results into catalog-ready payloads. It
prefers full OMDb metadata whenever possible and only uses TMDb details when
OMDb is unavailable or the selected source is explicitly TMDb.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

import requests

from config.settings import settings
from utils.logging import logger


class MetadataEnrichmentService:
    """Build canonical metadata payloads for movies and series."""

    def __init__(self) -> None:
        self.omdb_api_key = settings.omdb_api_key
        self.tmdb_api_key = settings.tmdb_api_key
        self.omdb_base_url = "http://www.omdbapi.com"
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.request_timeout = 10

    @staticmethod
    def has_poster(raw_data: Dict[str, Any]) -> bool:
        if not isinstance(raw_data, dict):
            return False

        poster = raw_data.get("Poster")
        if isinstance(poster, str) and poster and poster != "N/A":
            return True

        nested_omdb = raw_data.get("omdbData")
        if isinstance(nested_omdb, dict):
            nested_poster = nested_omdb.get("Poster")
            if isinstance(nested_poster, str) and nested_poster and nested_poster != "N/A":
                return True

        image_files = raw_data.get("imageFiles") or []
        return any(
            isinstance(img, dict)
            and isinstance(img.get("fileName"), str)
            and img.get("fileName")
            and img.get("fileName") != "N/A"
            for img in image_files
        )

    @staticmethod
    def has_omdb_details(raw_data: Dict[str, Any]) -> bool:
        if not isinstance(raw_data, dict):
            return False

        nested_omdb = raw_data.get("omdbData")
        if isinstance(nested_omdb, dict) and any(
            nested_omdb.get(key) for key in ("Plot", "Director", "Actors", "Genre", "Runtime")
        ):
            return True

        return any(raw_data.get(key) for key in ("Plot", "Director", "Actors", "Genre", "Runtime"))

    @staticmethod
    def _parse_year(value: Any) -> Optional[int]:
        if value is None:
            return None
        match = re.search(r"(19|20)\d{2}", str(value))
        return int(match.group(0)) if match else None

    @staticmethod
    def _extract_imdb_id(raw_data: Dict[str, Any]) -> Optional[str]:
        if not isinstance(raw_data, dict):
            return None

        candidates = []
        external_ids = raw_data.get("externalIds")
        if isinstance(external_ids, dict):
            candidates.append(external_ids.get("imdbId"))

        omdb = raw_data.get("omdbData")
        if isinstance(omdb, dict):
            candidates.append(omdb.get("imdbID"))

        candidates.extend([
            raw_data.get("imdbId"),
            raw_data.get("imdbID"),
        ])

        for value in candidates:
            if isinstance(value, str) and re.fullmatch(r"tt\d+", value.strip()):
                return value.strip()
        return None

    @staticmethod
    def _extract_tmdb_id(raw_data: Dict[str, Any]) -> Optional[str]:
        if not isinstance(raw_data, dict):
            return None

        candidates = []
        external_ids = raw_data.get("externalIds")
        if isinstance(external_ids, dict):
            candidates.append(external_ids.get("tmdbId"))

        tmdb = raw_data.get("tmdbData")
        if isinstance(tmdb, dict):
            candidates.append(tmdb.get("id"))

        candidates.extend([
            raw_data.get("tmdbId"),
            raw_data.get("id") if raw_data.get("poster_path") or raw_data.get("name") or raw_data.get("title") else None,
        ])

        for value in candidates:
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return None

    @staticmethod
    def _extract_omdb_payload(raw_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(raw_data, dict):
            return None
        nested = raw_data.get("omdbData")
        if isinstance(nested, dict):
            return dict(nested)
        if any(key in raw_data for key in ("Title", "Year", "imdbID", "Poster", "Plot", "Director")):
            return dict(raw_data)
        return None

    @staticmethod
    def _extract_tmdb_payload(raw_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(raw_data, dict):
            return None
        nested = raw_data.get("tmdbData")
        if isinstance(nested, dict):
            return dict(nested)
        if any(key in raw_data for key in ("poster_path", "release_date", "first_air_date", "name", "title")):
            return dict(raw_data)
        return None

    def fetch_omdb_metadata(
        self,
        imdb_id: Optional[str],
        title: Optional[str],
        year: Optional[int],
        media_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.omdb_api_key:
            return None

        params: Dict[str, Any] = {"apikey": self.omdb_api_key, "plot": "full"}
        normalized_type = "series" if media_type in ("episode", "series", "tv") else "movie"
        if imdb_id:
            params["i"] = imdb_id
        elif title:
            params["t"] = title
            if year is not None:
                params["y"] = year
            params["type"] = normalized_type
        else:
            return None

        try:
            response = requests.get(self.omdb_base_url, params=params, timeout=self.request_timeout)
            response.raise_for_status()
            payload = response.json()
            if payload.get("Response") == "True":
                return payload
        except Exception as exc:
            logger.warning(
                "Failed to hydrate OMDb metadata",
                title=title,
                imdb_id=imdb_id,
                error=str(exc),
            )
        return None

    def fetch_tmdb_metadata(
        self,
        tmdb_id: Optional[str],
        title: Optional[str],
        year: Optional[int],
        media_type: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if not self.tmdb_api_key:
            return None

        normalized_type = "tv" if media_type in ("episode", "series", "tv") else "movie"
        try:
            if tmdb_id:
                response = requests.get(
                    f"{self.tmdb_base_url}/{normalized_type}/{tmdb_id}",
                    params={"api_key": self.tmdb_api_key, "append_to_response": "external_ids"},
                    timeout=self.request_timeout,
                )
                response.raise_for_status()
                return response.json()

            if not title:
                return None

            search_endpoint = "tv" if normalized_type == "tv" else "movie"
            params: Dict[str, Any] = {"api_key": self.tmdb_api_key, "query": title}
            if year is not None:
                params["first_air_date_year" if search_endpoint == "tv" else "year"] = year

            response = requests.get(
                f"{self.tmdb_base_url}/search/{search_endpoint}",
                params=params,
                timeout=self.request_timeout,
            )
            response.raise_for_status()
            data = response.json()
            results = data.get("results") or []
            if not results:
                return None

            candidate_id = results[0].get("id")
            if not candidate_id:
                return dict(results[0])

            detail_response = requests.get(
                f"{self.tmdb_base_url}/{normalized_type}/{candidate_id}",
                params={"api_key": self.tmdb_api_key, "append_to_response": "external_ids"},
                timeout=self.request_timeout,
            )
            detail_response.raise_for_status()
            return detail_response.json()
        except Exception as exc:
            logger.warning(
                "Failed to hydrate TMDb metadata",
                title=title,
                tmdb_id=tmdb_id,
                error=str(exc),
            )
        return None

    def enrich_payload(
        self,
        *,
        source: Optional[str],
        media_type: Optional[str],
        title: Optional[str],
        year: Optional[int],
        imdb_id: Optional[str],
        tmdb_id: Optional[str] = None,
        raw_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Return a canonical metadata payload for assignment and catalog writes."""
        raw: Dict[str, Any] = dict(raw_data or {})
        source_value = (source or "manual").strip().lower()
        normalized_media_type = "series" if media_type in ("episode", "series", "tv") else "movie"

        resolved_imdb_id = imdb_id or self._extract_imdb_id(raw)
        resolved_tmdb_id = tmdb_id or self._extract_tmdb_id(raw)
        resolved_title = title or raw.get("title") or raw.get("Title") or raw.get("name")
        resolved_year = year or self._parse_year(raw.get("year") or raw.get("Year") or raw.get("release_date") or raw.get("first_air_date"))

        omdb_data = self._extract_omdb_payload(raw)
        tmdb_data = self._extract_tmdb_payload(raw)

        use_omdb_by_default = source_value != "tmdb"
        if use_omdb_by_default and (not self.has_omdb_details(raw) or not self.has_poster(raw)):
            hydrated_omdb = self.fetch_omdb_metadata(resolved_imdb_id, resolved_title, resolved_year, normalized_media_type)
            if hydrated_omdb:
                omdb_data = hydrated_omdb
                resolved_imdb_id = hydrated_omdb.get("imdbID") or resolved_imdb_id

        if (source_value == "tmdb" or (not omdb_data and resolved_tmdb_id)) and (not tmdb_data or not self.has_poster(raw)):
            hydrated_tmdb = self.fetch_tmdb_metadata(resolved_tmdb_id, resolved_title, resolved_year, normalized_media_type)
            if hydrated_tmdb:
                tmdb_data = hydrated_tmdb
                external_ids = hydrated_tmdb.get("external_ids") or {}
                resolved_imdb_id = external_ids.get("imdb_id") or resolved_imdb_id
                resolved_tmdb_id = str(hydrated_tmdb.get("id") or resolved_tmdb_id or "") or resolved_tmdb_id

        if use_omdb_by_default and omdb_data:
            resolved_title = omdb_data.get("Title") or resolved_title
            resolved_year = self._parse_year(omdb_data.get("Year")) or resolved_year
        elif tmdb_data:
            resolved_title = tmdb_data.get("title") or tmdb_data.get("name") or resolved_title
            resolved_year = self._parse_year(tmdb_data.get("release_date") or tmdb_data.get("first_air_date")) or resolved_year

        image_files = list(raw.get("imageFiles") or [])
        poster_url = None
        if omdb_data:
            poster = omdb_data.get("Poster")
            if isinstance(poster, str) and poster and poster != "N/A":
                poster_url = poster
        if not poster_url and tmdb_data:
            poster_path = tmdb_data.get("poster_path")
            if isinstance(poster_path, str) and poster_path:
                poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}"

        if poster_url and not any(
            isinstance(img, dict) and img.get("fileName") == poster_url for img in image_files
        ):
            image_files.insert(0, {
                "fileName": poster_url,
                "fileSize": 0,
                "resolution": "",
                "format": "jpg",
            })

        external_ids = dict(raw.get("externalIds") or {})
        if resolved_imdb_id:
            external_ids["imdbId"] = resolved_imdb_id
        if resolved_tmdb_id:
            external_ids["tmdbId"] = str(resolved_tmdb_id)

        enriched: Dict[str, Any] = {
            **raw,
            "title": resolved_title or title or "Untitled",
            "year": resolved_year,
            "mediaType": normalized_media_type,
            "externalIds": external_ids,
            "imageFiles": image_files,
        }

        if resolved_imdb_id:
            enriched["imdbId"] = resolved_imdb_id
            enriched["imdbID"] = resolved_imdb_id
        if resolved_tmdb_id:
            enriched["tmdbId"] = str(resolved_tmdb_id)
        if omdb_data:
            enriched["omdbData"] = omdb_data
            enriched.setdefault("releaseDate", omdb_data.get("Released") or omdb_data.get("Year") or "")
            enriched.setdefault("runtime", omdb_data.get("Runtime") or "")
            enriched.setdefault("genres", [g for g in str(omdb_data.get("Genre") or "").split(", ") if g])
            enriched.setdefault("countries", [c for c in str(omdb_data.get("Country") or "").split(", ") if c])
            enriched.setdefault("languages", [l for l in str(omdb_data.get("Language") or "").split(", ") if l])
        if tmdb_data:
            enriched["tmdbData"] = tmdb_data

        return enriched


metadata_enrichment_service = MetadataEnrichmentService()
