"""
Media Resolution Service for Phase 4

Resolves unmatched items by searching for or creating media records in Firestore.
Handles:
- Looking up existing media by IMDB ID
- Creating placeholder media records for new titles
- Resolving episodes to series and seasons
"""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional
from utils.logging import logger


class MediaResolutionService:
    """Resolves assignment references to actual media records in Firestore."""

    def __init__(self, firestore_service: Optional[Any] = None):
        self.firestore_service = firestore_service

    async def resolve_assignment_media(
        self, assignment: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Resolve media references in an assignment.

        For items with best_match info but no media in database,
        searches for existing media or creates placeholder records.

        Args:
            assignment: Media assignment document

        Returns:
            Updated assignment with resolved media info
        """
        if not self.firestore_service or not self.firestore_service._initialized:
            logger.warning("Firestore not initialized - cannot resolve media")
            return assignment

        media_id = assignment.get("mediaId")
        media_type = assignment.get("mediaType", "movie")

        # If media already exists in Firestore, we're done
        if media_id and await self._media_exists(media_id, media_type):
            logger.info(
                "Media already exists",
                media_id=media_id,
                media_type=media_type,
            )
            return assignment

        # Try to resolve from best_match
        best_match = assignment.get("match", {})
        imdb_id = best_match.get("imdbId") or best_match.get("media_id")

        if not imdb_id:
            logger.warning("No IMDB ID available for resolution")
            return assignment

        # Search for existing media by IMDB ID
        existing_media = await self._find_media_by_imdb_id(imdb_id, media_type)
        if existing_media:
            logger.info(
                "Found existing media by IMDB ID",
                imdb_id=imdb_id,
                media_id=existing_media["id"],
            )
            assignment["mediaId"] = existing_media["id"]
            assignment["resolvedMedia"] = existing_media
            return assignment

        # Create placeholder media record
        logger.info(
            "Creating placeholder media record",
            title=best_match.get("title"),
            imdb_id=imdb_id,
        )
        created_media = await self._create_placeholder_media(best_match, media_type)
        assignment["mediaId"] = created_media["id"]
        assignment["resolvedMedia"] = created_media
        assignment["isPlaceholder"] = True

        return assignment

    async def resolve_episode_assignment(
        self, assignment: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Resolve episode assignments to series and season.

        Args:
            assignment: Episode assignment document

        Returns:
            Updated assignment with series and season resolved
        """
        if not self.firestore_service or not self.firestore_service._initialized:
            logger.warning("Firestore not initialized - cannot resolve episode")
            return assignment

        # First resolve series
        if not assignment.get("seriesId"):
            match = assignment.get("match", {})
            series_imdb_id = match.get("imdbId") or match.get("media_id")

            if series_imdb_id:
                existing_series = await self._find_media_by_imdb_id(
                    series_imdb_id, "series"
                )
                if existing_series:
                    assignment["seriesId"] = existing_series["id"]
                else:
                    created_series = await self._create_placeholder_media(
                        match, "series"
                    )
                    assignment["seriesId"] = created_series["id"]
                    assignment["isPlaceholder"] = True

        # Then resolve or create season
        season_number = assignment.get("seasonNumber")
        series_id = assignment.get("seriesId")

        if season_number is not None and series_id:
            season_id = await self._resolve_season(series_id, season_number)
            assignment["seasonId"] = season_id

        return assignment

    async def _media_exists(self, media_id: str, media_type: str) -> bool:
        """Check if media exists in Firestore."""
        try:
            collection = "movies" if media_type == "movie" else "series"
            doc = self.firestore_service.db.collection(collection).document(
                media_id
            ).get()
            return doc.exists
        except Exception as e:
            logger.error(
                "Error checking media existence",
                media_id=media_id,
                error=str(e),
            )
            return False

    async def _find_media_by_imdb_id(
        self, imdb_id: str, media_type: str
    ) -> Optional[Dict[str, Any]]:
        """Search for existing media by IMDB ID."""
        try:
            collection = "movies" if media_type == "movie" else "series"
            docs = (
                self.firestore_service.db.collection(collection)
                .where("externalIds.imdbId", "==", imdb_id)
                .limit(1)
                .get()
            )

            if not docs:
                return None

            doc = docs[0]
            payload = doc.to_dict() or {}
            return {
                "id": doc.id,
                "title": payload.get("title"),
                "type": media_type,
                "imdbId": imdb_id,
            }
        except Exception as e:
            logger.error(
                "Error finding media by IMDB ID",
                imdb_id=imdb_id,
                error=str(e),
            )
            return None

    async def _create_placeholder_media(
        self, match_data: Dict[str, Any], media_type: str
    ) -> Dict[str, Any]:
        """Create a placeholder media record for unmatched items."""
        try:
            media_id = str(uuid.uuid4())
            now = datetime.utcnow().isoformat()

            media_doc = {
                "id": media_id,
                "title": match_data.get("title", "Unknown Title"),
                "type": media_type,
                "isPlaceholder": True,
                "externalIds": {
                    "imdbId": match_data.get("imdbId") or match_data.get("media_id"),
                },
                "matchData": match_data,
                "createdAt": now,
                "updatedAt": now,
                "createdViaOrganization": True,
            }

            # Additional fields for series
            if media_type == "series":
                media_doc["seasons"] = []
                media_doc["episodeCount"] = 0

            collection = "movies" if media_type == "movie" else "series"
            self.firestore_service.db.collection(collection).document(media_id).set(
                media_doc
            )

            logger.info(
                "Placeholder media created",
                media_id=media_id,
                title=media_doc["title"],
                type=media_type,
            )

            return {
                "id": media_id,
                "title": media_doc["title"],
                "type": media_type,
                "isPlaceholder": True,
            }
        except Exception as e:
            logger.error(
                "Failed to create placeholder media",
                title=match_data.get("title"),
                error=str(e),
            )
            raise

    async def _resolve_season(self, series_id: str, season_number: int) -> str:
        """Get or create a season document."""
        try:
            # Try to find existing season
            docs = (
                self.firestore_service.db.collection("seasons")
                .where("seriesId", "==", series_id)
                .where("seasonNumber", "==", season_number)
                .limit(1)
                .get()
            )

            if docs:
                return docs[0].id

            # Create new season
            season_id = str(uuid.uuid4())
            now = datetime.utcnow().isoformat()

            season_doc = {
                "id": season_id,
                "seriesId": series_id,
                "seasonNumber": season_number,
                "episodes": [],
                "createdAt": now,
                "updatedAt": now,
            }

            self.firestore_service.db.collection("seasons").document(season_id).set(
                season_doc
            )

            logger.info(
                "Season created",
                season_id=season_id,
                series_id=series_id,
                season_number=season_number,
            )

            return season_id
        except Exception as e:
            logger.error(
                "Failed to resolve season",
                series_id=series_id,
                season_number=season_number,
                error=str(e),
            )
            raise
