"""
Assignment orchestrator for automated ingress pipeline.

Creates assignment records for high-confidence ingress queue items and links them
to existing media records when possible.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from db.models import MediaAssignment as DBMediaAssignment
from services.metadata_enrichment_service import metadata_enrichment_service
from utils.logging import logger


class AssignmentOrchestrator:
    """Coordinates automatic assignment creation for matched ingress items."""

    def __init__(
        self,
        file_organization_service: Optional[Any] = None,
        auto_organize_enabled: bool = True,
        db_session_factory: Optional[Any] = None,
    ):
        self.file_organization_service = file_organization_service
        self.auto_organize_enabled = auto_organize_enabled
        self.db_session_factory = db_session_factory

    async def auto_assign(
        self,
        queue_item: Dict[str, Any],
        force_organize: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Create an automatic assignment for a queue item when confidence is high.

        Creates assignments and persists them to PostgreSQL.
        the assignment document is persisted there; otherwise the assignment lives
        only in memory for the duration of the organize call.

        Returns:
            Assignment result payload if assignment was created, otherwise None
        """
        best_match = queue_item.get("best_match") or {}
        imdb_id = best_match.get("imdb_id") or best_match.get("media_id")
        explicit_media_id = best_match.get("media_id") or queue_item.get("media_id")

        parsed_info = queue_item.get("parsed_info") or {}
        parsed_media_type = parsed_info.get("media_type")
        matched_media_type = (best_match.get("media_type") or "").lower()
        # Genres returned by OMDB/TMDB (comma-separated string or list)
        raw_genres = best_match.get("genres") or best_match.get("genre") or ""
        if isinstance(raw_genres, list):
            genres_lower = {g.lower() for g in raw_genres}
        else:
            genres_lower = {g.strip().lower() for g in str(raw_genres).split(",")}

        # Resolve media type in priority order: explicit > parsed > genre-based
        if matched_media_type in ("documentary",) or parsed_media_type == "documentary":
            media_type = "documentary"
        elif matched_media_type == "live_performance" or parsed_media_type in ("live_performance", "concert"):
            media_type = "live_performance"
        elif parsed_media_type == "movie" or matched_media_type == "movie":
            media_type = "movie"
        elif parsed_media_type in ("episode", "series", "tv") or matched_media_type in (
            "episode",
            "series",
            "tv",
        ):
            media_type = "episode"
        elif best_match.get("season") is not None or best_match.get("episode") is not None:
            media_type = "episode"
        elif "documentary" in genres_lower:
            media_type = "documentary"
        elif "music" in genres_lower and any(
            kw in (best_match.get("title") or "").lower()
            for kw in ("concert", "live", "tour", "performance")
        ):
            media_type = "live_performance"
        else:
            media_type = "movie"

        resolved_media = self._find_existing_media(media_type=media_type, imdb_id=imdb_id) if imdb_id else None

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
            # Prefer explicit selected catalog ID when available. This keeps
            # manual assignments linked to the intended catalog row even when

            "mediaId": resolved_media.get("id") if resolved_media else (explicit_media_id or imdb_id),
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
            # Alternate version fields (set externally when a duplicate is detected)
            "isAlternateVersion": queue_item.get("is_alternate_version", False),
            "versionNumber": queue_item.get("version_number"),
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
            elif queue_item.get("unknown_episode_label"):
                assignment_doc["seasonNumber"] = 0
            if episode_number is not None:
                assignment_doc["episodeNumber"] = episode_number
            # Multi-episode file: store the ending episode number for filename building
            episode_end = parsed_info.get("episode_end")
            if episode_end is not None:
                assignment_doc["episodeEnd"] = episode_end
            # Unknown episode: carry the pre-built label so the filename builder can use it
            if queue_item.get("unknown_episode_label"):
                assignment_doc["unknownEpisodeLabel"] = queue_item["unknown_episode_label"]

        media_payload = self._build_media_payload(best_match, parsed_info, media_type)
        canonical_title = media_payload.get("seriesTitle") or media_payload.get("title") or best_match.get("title")
        canonical_year = media_payload.get("year") or best_match.get("year") or parsed_info.get("year")
        canonical_imdb_id = media_payload.get("imdbId") or imdb_id

        assignment_doc["mediaId"] = resolved_media.get("id") if resolved_media else (explicit_media_id or canonical_imdb_id)
        assignment_doc["match"]["title"] = canonical_title
        assignment_doc["match"]["imdbId"] = canonical_imdb_id
        assignment_doc["match"]["raw"] = media_payload

        organization_result = None
        try:
            # Persist to PostgreSQL
            if self.db_session_factory is not None:
                async with self.db_session_factory() as session:
                    db_assignment = await session.get(DBMediaAssignment, assignment_id)
                    if db_assignment is None:
                        db_assignment = DBMediaAssignment(
                            id=assignment_id,
                            media_type=media_type,
                            media_id=str(assignment_doc.get("mediaId") or ""),
                        )
                        session.add(db_assignment)

                    db_assignment.media_type = media_type
                    db_assignment.media_id = str(assignment_doc.get("mediaId") or "")
                    db_assignment.series_id = assignment_doc.get("seriesId")
                    db_assignment.season_id = assignment_doc.get("seasonId")
                    db_assignment.season_number = assignment_doc.get("seasonNumber")
                    db_assignment.episode_number = assignment_doc.get("episodeNumber")
                    db_assignment.organization_status = "pending"
                    db_assignment.assigned_by = assignment_doc.get("source")
                    db_assignment.assigned_date = datetime.utcnow()
                    db_assignment.confidence = queue_item.get("confidence_score") or 0
                    db_assignment.is_manual_assignment = (best_match.get("source") == "manual")
                    db_assignment.match_data = assignment_doc.get("match") or {}
                    await session.commit()

            logger.info(
                "Auto-assignment created",
                assignment_id=assignment_id,
                queue_item_id=queue_item.get("id"),
                media_type=media_type,
            )

            should_organize = force_organize or self.auto_organize_enabled
            if should_organize and self.file_organization_service is not None:
                organization_result = await self.file_organization_service.organize_assignment(
                    assignment_doc,
                    media_payload,
                )

                if self.db_session_factory is not None and organization_result:
                    async with self.db_session_factory() as session:
                        db_assignment = await session.get(DBMediaAssignment, assignment_id)
                        if db_assignment is not None:
                            db_assignment.organization_status = (
                                "completed" if organization_result.get("success") else "failed"
                            )
                            db_assignment.organization_date = datetime.utcnow()
                            db_assignment.organization_error = organization_result.get("error")
                            db_assignment.operations = organization_result.get("operations") or []
                            await session.commit()


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
        raw_match_data = best_match.get("raw_data") if isinstance(best_match.get("raw_data"), dict) else {}
        enriched = metadata_enrichment_service.enrich_payload(
            source=best_match.get("source"),
            media_type=media_type,
            title=best_match.get("title") or parsed_info.get("title"),
            year=best_match.get("year") or parsed_info.get("year"),
            imdb_id=best_match.get("imdb_id") or best_match.get("media_id"),
            tmdb_id=best_match.get("media_id") if best_match.get("source") == "tmdb" else None,
            raw_data=raw_match_data,
        )

        canonical_title = enriched.get("title") or best_match.get("title") or parsed_info.get("title")
        canonical_year = enriched.get("year") or best_match.get("year") or parsed_info.get("year")
        canonical_imdb_id = enriched.get("imdbId") or best_match.get("imdb_id") or best_match.get("media_id")

        payload: Dict[str, Any] = {
            "year": canonical_year,
            "imdbId": canonical_imdb_id,
        }
        if enriched.get("omdbData"):
            payload["omdbData"] = enriched.get("omdbData")
        if enriched.get("tmdbData"):
            payload["tmdbData"] = enriched.get("tmdbData")
        if enriched.get("imageFiles"):
            payload["imageFiles"] = enriched.get("imageFiles")
        if enriched.get("externalIds"):
            payload["externalIds"] = enriched.get("externalIds")

        if media_type in ("movie", "documentary", "live_performance"):
            payload["title"] = canonical_title
            return payload

        payload["title"] = parsed_info.get("title") or canonical_title
        payload["seriesTitle"] = canonical_title
        return payload

    def _find_existing_media(self, media_type: str, imdb_id: str):
        """Media resolution via Firestore was removed; Postgres lookup not yet implemented."""
        return None
