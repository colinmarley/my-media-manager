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

    def __init__(self, firestore_service: Optional[Any] = None):
        self.firestore_service = firestore_service

    async def auto_assign(self, queue_item: Dict[str, Any]) -> Optional[str]:
        """
        Create an automatic assignment for a queue item when confidence is high.

        Returns:
            assignment_id if assignment was created, otherwise None
        """
        if not self.firestore_service:
            return None

        if not getattr(self.firestore_service, "_initialized", False):
            return None

        best_match = queue_item.get("best_match") or {}
        imdb_id = best_match.get("imdb_id") or best_match.get("media_id")
        if not imdb_id:
            return None

        media_type = best_match.get("media_type") or "movie"
        resolved_media = self._find_existing_media(media_type=media_type, imdb_id=imdb_id)

        assignment_id = str(uuid.uuid4())
        assignment_doc = {
            "id": assignment_id,
            "status": "auto_assigned",
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
            "file": {
                "filePath": queue_item.get("file_path"),
                "fileName": queue_item.get("file_name"),
                "fileSize": queue_item.get("file_size"),
                "ingressPath": queue_item.get("ingress_path"),
            },
            "parsedInfo": queue_item.get("parsed_info"),
            "queueItemId": queue_item.get("id"),
            "isOrganized": False,
            "targetFolder": None,
            "organizationHistory": [],
            "resolvedMedia": resolved_media,
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        }

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
            return assignment_id
        except Exception as exc:
            logger.error(
                "Failed to create auto-assignment",
                queue_item_id=queue_item.get("id"),
                error=str(exc),
            )
            return None

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
