"""
Assignment orchestrator for automated ingress pipeline.

Creates assignment records for high-confidence ingress queue items and links them
to existing media records when possible.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from utils.logging import logger


class AssignmentOrchestrator:
    """Coordinates automatic assignment creation for matched ingress items."""

    def __init__(
        self,
        firestore_service: Optional[Any] = None,
        file_organization_service: Optional[Any] = None,
        auto_organize_enabled: bool = True,
    ):
        self.firestore_service = firestore_service
        self.file_organization_service = file_organization_service
        self.auto_organize_enabled = auto_organize_enabled

    async def auto_assign(
        self,
        queue_item: Dict[str, Any],
        force_organize: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Create an automatic assignment for a queue item when confidence is high.

        Returns:
            Assignment result payload if assignment was created, otherwise None
        """
        if not self.firestore_service:
            return None

        if not getattr(self.firestore_service, "_initialized", False):
            return None

        best_match = queue_item.get("best_match") or {}
        imdb_id = best_match.get("imdb_id") or best_match.get("media_id")
        if not imdb_id:
            return None

        parsed_info = queue_item.get("parsed_info") or {}
        parsed_media_type = parsed_info.get("media_type")
        matched_media_type = (best_match.get("media_type") or "").lower()

        if parsed_media_type == "movie" or matched_media_type == "movie":
            media_type = "movie"
        elif parsed_media_type in ("episode", "series", "tv") or matched_media_type in (
            "episode",
            "series",
            "tv",
        ):
            media_type = "episode"
        elif best_match.get("season") is not None or best_match.get("episode") is not None:
            media_type = "episode"
        else:
            media_type = "movie"
        resolved_media = self._find_existing_media(media_type=media_type, imdb_id=imdb_id)

        assignment_id = str(uuid.uuid4())
        source_file_payload = {
            "filePath": queue_item.get("file_path"),
            "fileName": queue_item.get("file_name"),
            "fileSize": queue_item.get("file_size"),
            "ingressPath": queue_item.get("ingress_path"),
        }

        assignment_doc = {
            "id": assignment_id,
            "status": "auto_assigned",
            "mediaType": media_type,
            "mediaId": resolved_media.get("id") if resolved_media else imdb_id,
            "organizationStatus": "pending",
            "dateAssigned": datetime.utcnow().isoformat(),
            "source": "ingress_pipeline",
            "confidenceScore": queue_item.get("confidence_score"),
            "match": {
                "source": best_match.get("source"),
                "title": best_match.get("title"),
                "imdbId": imdb_id,
                "mediaType": media_type,
                "raw": best_match.get("raw_data"),
            },
            # Keep both keys for compatibility with existing readers.
            "file": source_file_payload,
            "sourceFile": source_file_payload,
            "parsedInfo": queue_item.get("parsed_info"),
            "queueItemId": queue_item.get("id"),
            "isOrganized": False,
            "targetFolder": None,
            "organizationHistory": [],
            "resolvedMedia": resolved_media,
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        }

        if media_type == "episode":
            season_number = parsed_info.get("season")
            if season_number is None:
                season_number = best_match.get("season")

            episode_number = parsed_info.get("episode")
            if episode_number is None:
                episode_number = best_match.get("episode")

            if season_number is not None:
                assignment_doc["seasonNumber"] = season_number
            if episode_number is not None:
                assignment_doc["episodeNumber"] = episode_number

        media_payload = self._build_media_payload(best_match, parsed_info, media_type)

        try:
            self.firestore_service.db.collection("media_assignments").document(
                assignment_id
            ).set(assignment_doc)
            logger.info(
                "Auto-assignment created",
                assignment_id=assignment_id,
                queue_item_id=queue_item.get("id"),
                imdb_id=imdb_id,
            )

            organization_result = None
            should_organize = force_organize or self.auto_organize_enabled
            if should_organize and self.file_organization_service is not None:
                organization_result = await self.file_organization_service.organize_assignment(
                    assignment_doc,
                    media_payload,
                )

                self.firestore_service.db.collection("media_assignments").document(
                    assignment_id
                ).update(
                    {
                        "organizationStatus": (
                            "completed" if organization_result.get("success") else "failed"
                        ),
                        "organizationResult": organization_result,
                        "isOrganized": bool(organization_result.get("success")),
                        "updatedAt": datetime.utcnow().isoformat(),
                    }
                )

            return {
                "assignment_id": assignment_id,
                "organized": bool(organization_result and organization_result.get("success")),
                "organization_result": organization_result,
            }
        except Exception as exc:
            logger.error(
                "Failed to create auto-assignment",
                queue_item_id=queue_item.get("id"),
                error=str(exc),
            )
            return None

    def _build_media_payload(
        self,
        best_match: Dict[str, Any],
        parsed_info: Dict[str, Any],
        media_type: str,
    ) -> Dict[str, Any]:
        if media_type == "movie":
            return {
                "title": best_match.get("title") or parsed_info.get("title"),
                "year": best_match.get("year") or parsed_info.get("year"),
                "imdbId": best_match.get("imdb_id") or best_match.get("media_id"),
            }

        return {
            "title": parsed_info.get("title"),
            "seriesTitle": best_match.get("title") or parsed_info.get("title"),
            "year": best_match.get("year") or parsed_info.get("year"),
            "imdbId": best_match.get("imdb_id") or best_match.get("media_id"),
        }

    def _find_existing_media(self, media_type: str, imdb_id: str) -> Optional[Dict[str, Any]]:
        """Best-effort lookup of existing movie/series by imdb id."""
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
                "collection": collection,
                "id": doc.id,
                "title": payload.get("title"),
            }
        except Exception:
            return None
