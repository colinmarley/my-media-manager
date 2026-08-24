"""
File Organization Service for Phase 4

Handles:
- Jellyfin destination path calculation
- Folder structure creation
- File movement from encoded to Jellyfin paths
- Organization status tracking
"""

import os
import re
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional
from xml.sax.saxutils import escape
from config.settings import settings
from utils.logging import logger


class FileOrganizationService:
    """Organizes files into Jellyfin-compliant folder structures."""

    # Base path constants
    ENCODED_SOURCE_PATH = "/data/media/encoded"
    DEFAULT_JELLYFIN_DEST_BASE = "/ark/media/jellyfin"
    VIDEO_EXTENSIONS = {
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv",
        ".webm", ".m2ts", ".mts", ".ts", ".mpg", ".mpeg", ".iso", ".strm",
    }

    def __init__(
        self,
        filesystem_manager: Optional[Any] = None,
        jellyfin_dest_base: Optional[str] = None,
        db_session_factory: Optional[Callable] = None,
    ):
        self.filesystem_manager = filesystem_manager
        self.db_session_factory = db_session_factory
        self.jellyfin_dest_base = (
            jellyfin_dest_base
            or settings.jellyfin_dest_base
            or self.DEFAULT_JELLYFIN_DEST_BASE
        ).rstrip("/")

    async def organize_assignment(
        self,
        assignment: Dict[str, Any],
        media: Dict[str, Any],
        jellyfin_root_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Organize files according to assignment and media info.

        Args:
            assignment: Media assignment from Firestore
            media: Resolved media information

        Returns:
            Organization result with status and details
        """
        try:
            media_type = assignment.get("mediaType", "movie")

            # Calculate target path
            target_path = self._calculate_jellyfin_path(
                media,
                assignment,
                media_type,
                jellyfin_root_override,
            )

            # If the path cannot be resolved, route to the staging folder so no
            # file is ever silently dropped.
            needs_review = False
            if not target_path:
                source_file_name = (
                    (assignment.get("sourceFile") or assignment.get("file") or {}).get("fileName")
                    or "unknown"
                )
                stem, ext = os.path.splitext(source_file_name)
                safe_stem = self._sanitize_path(stem) or "file"
                needs_review = True
                target_path = os.path.join(
                    self.jellyfin_dest_base,
                    settings.folder_needs_review,
                )
                assignment = dict(assignment)
                assignment["_reviewFileName"] = f"{safe_stem} - NEEDS REVIEW{ext}"
                logger.warning(
                    "Could not calculate target path — routing to NeedsReview",
                    media_type=media_type,
                    source_file=source_file_name,
                )

            # Get source files from assignment
            source_files = await self._get_source_files(assignment)
            if not source_files:
                raise ValueError("No source files in assignment")

            # Create folder structure
            folder_result = await self._create_jel_folder_structure(target_path)
            if not folder_result["success"]:
                raise ValueError(f"Failed to create folder: {folder_result.get('error')}")

            # Move files
            move_results = []
            for source_file in source_files:
                try:
                    result = await self._move_file_to_jellyfin(
                        source_file,
                        target_path,
                        media_type,
                        assignment,
                        media,
                    )
                    move_results.append(result)

                    if not result["success"]:
                        logger.warning(
                            "File move failed",
                            source=source_file,
                            target=target_path,
                            error=result.get("error"),
                        )
                except Exception as e:
                    move_results.append({
                        "success": False,
                        "source": source_file,
                        "error": str(e),
                    })

            # Check if all moves succeeded
            all_successful = all(r.get("success", False) for r in move_results)
            move_errors = [str(r.get("error")) for r in move_results if not r.get("success") and r.get("error")]

            # Create local NFO metadata files for Jellyfin when at least one file moved.
            nfo_files_created: List[str] = []
            if all_successful:
                nfo_files_created = self._create_jellyfin_nfo_files(
                    media_type=media_type,
                    target_path=target_path,
                    move_results=move_results,
                    assignment=assignment,
                    media=media,
                )

            result = {
                "success": all_successful,
                "assignmentId": assignment.get("id"),
                "mediaType": media_type,
                "targetPath": target_path,
                "needsReview": needs_review,
                "filesMoved": sum(1 for r in move_results if r.get("success")),
                "totalFiles": len(move_results),
                "folderCreated": folder_result.get("folderPath"),
                "nfoFilesCreated": nfo_files_created,
                "operations": move_results,
                "moveErrors": move_errors,
                "error": "; ".join(move_errors[:10]) if move_errors else None,
                "timestamp": datetime.utcnow().isoformat(),
            }

            # Write jellyfinInfo back to the PostgreSQL catalog so My Library reflects
            # the organized state without needing Firebase.
            if all_successful and not needs_review and self.db_session_factory:
                await self._upsert_catalog_jellyfin_info(
                    media_type=media_type,
                    media_id=assignment.get("mediaId"),
                    folder_path=target_path,
                    organized_at=datetime.utcnow().isoformat(),
                    media=media,
                    file_count=result.get("filesMoved"),
                )

            # Update assignment status in Firestore

            return result

        except Exception as e:
            logger.error(
                "File organization failed",
                assignment_id=assignment.get("id"),
                error=str(e),
            )
            return {
                "success": False,
                "assignmentId": assignment.get("id"),
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat(),
            }

    def _calculate_jellyfin_path(
        self,
        media: Dict[str, Any],
        assignment: Dict[str, Any],
        media_type: str,
        jellyfin_root_override: Optional[str] = None,
    ) -> Optional[str]:
        """Calculate destination path based on media type.

        Supports: movie, episode, documentary, live_performance.
        Returns None for unrecognised types so the caller can route to _NeedsReview.
        """
        try:
            target_structure = assignment.get("targetFolderStructure", {})
            library_root = (
                jellyfin_root_override
                or target_structure.get("libraryRoot")
                or self.jellyfin_dest_base
            ).rstrip("/")

            title = media.get("title", "Unknown")
            title_sanitized = self._sanitize_path(title)

            # Compute year suffix once
            year_str = ""
            if media.get("year"):
                year_str = f" ({media.get('year')})"
            elif media.get("releaseDate"):
                try:
                    year = int(media["releaseDate"][:4])
                    year_str = f" ({year})"
                except (ValueError, TypeError, IndexError):
                    pass

            # Compute IMDb tag once
            imdb_info = ""
            if media.get("imdbId"):
                imdb_info = f" [imdbid-{media['imdbId']}]"

            # Map media type to the configured destination subfolder name
            _folder_map: Dict[str, str] = {
                "movie":            settings.folder_movies,
                "episode":          settings.folder_tv_shows,
                "documentary":      settings.folder_documentaries,
                "live_performance": settings.folder_live_performances,
            }

            if media_type in ("movie", "documentary", "live_performance"):
                subfolder = _folder_map[media_type]
                folder_name = f"{title_sanitized}{year_str}{imdb_info}"
                return f"{library_root}/{subfolder}/{folder_name}"

            elif media_type == "episode":
                subfolder = _folder_map["episode"]
                series_title = media.get("seriesTitle") or title
                series_sanitized = self._sanitize_path(series_title)
                folder_name = f"{series_sanitized}{year_str}{imdb_info}"

                season_num_raw = assignment.get("seasonNumber")
                if season_num_raw is None:
                    season_num_raw = 0 if assignment.get("unknownEpisodeLabel") else 1
                try:
                    season_num = int(season_num_raw)
                except (TypeError, ValueError):
                    season_num = 0 if assignment.get("unknownEpisodeLabel") else 1
                if season_num < 0:
                    season_num = 0

                # Season 0 uses "Specials" per Jellyfin convention
                season_str = "Specials" if season_num == 0 else f"Season {season_num:02d}"

                return f"{library_root}/{subfolder}/{folder_name}/{season_str}"

            else:
                logger.error("Unknown media type — will route to NeedsReview", media_type=media_type)
                return None

        except Exception as e:
            logger.error(
                "Error calculating destination path",
                media_type=media_type,
                error=str(e),
            )
            return None

    async def _get_source_files(self, assignment: Dict[str, Any]) -> List[str]:
        """Extract source file paths from assignment, including confirmed extras."""
        files = []

        # Get primary file. Accept both legacy/new payload keys.
        source_file_payload = assignment.get("sourceFile") or assignment.get("file") or {}
        primary_file = source_file_payload.get("filePath")
        if primary_file:
            files.append(primary_file)

        # Get extra files (deleted scenes, trailers, etc). Only files whose
        # AssignmentExtraFile row has been confirmed (via the extras review UI)
        # are included — unconfirmed extras stay put until a human classifies
        # them, per the extras taxonomy review workflow.
        extra_file_ids = assignment.get("extraFileIds", [])
        if extra_file_ids and self.db_session_factory:
            from sqlalchemy import select
            from db.models import AssignmentExtraFile, MediaFile

            async with self.db_session_factory() as session:
                result = await session.execute(
                    select(MediaFile.file_path)
                    .join(AssignmentExtraFile, AssignmentExtraFile.media_file_id == MediaFile.id)
                    .where(
                        AssignmentExtraFile.media_file_id.in_(extra_file_ids),
                        AssignmentExtraFile.confirmed.is_(True),
                    )
                )
                files.extend(row[0] for row in result.all() if row[0])

        return files

    async def _create_jel_folder_structure(
        self, target_path: str
    ) -> Dict[str, Any]:
        """Create necessary folder structure."""
        try:
            if not self.filesystem_manager:
                logger.warning(
                    "FileSystemManager not available - cannot create folder",
                    target_path=target_path,
                )
                return {
                    "success": False,
                    "error": "FileSystemManager not available",
                }

            # Create directory
            os.makedirs(target_path, exist_ok=True)
            logger.info("Jellyfin folder created", path=target_path)

            return {
                "success": True,
                "folderPath": target_path,
            }

        except Exception as e:
            logger.error(
                "Failed to create folder structure",
                target_path=target_path,
                error=str(e),
            )
            return {
                "success": False,
                "error": str(e),
            }

    async def _move_file_to_jellyfin(
        self,
        source_file: str,
        target_dir: str,
        media_type: str,
        assignment: Optional[Dict[str, Any]] = None,
        media: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Move a file to Jellyfin directory."""
        try:
            if not self.filesystem_manager:
                return {
                    "success": False,
                    "source": source_file,
                    "error": "FileSystemManager not available",
                }

            # Check source exists
            if not os.path.exists(source_file):
                return {
                    "success": False,
                    "source": source_file,
                    "error": f"Source file not found: {source_file}",
                }

            # Build Jellyfin-compliant filename
            filename = self._build_jellyfin_filename(
                source_file=source_file,
                target_dir=target_dir,
                media_type=media_type,
                assignment=assignment or {},
                media=media or {},
            )

            # Build destination path
            destination = os.path.join(target_dir, filename)
            destination = self._resolve_unique_destination(destination, source_file)

            # Move file
            result = self.filesystem_manager.move_file(source_file, destination)

            if result.get("success"):
                logger.info(
                    "File moved to Jellyfin",
                    source=source_file,
                    destination=destination,
                )
                return {
                    "success": True,
                    "source": source_file,
                    "destination": destination,
                }
            else:
                error_msg = result.get("error", "Unknown error")
                logger.warning(
                    "File move failed",
                    source=source_file,
                    error=error_msg,
                )
                return {
                    "success": False,
                    "source": source_file,
                    "destination": destination,
                    "error": error_msg,
                }

        except Exception as e:
            logger.error(
                "Error moving file to Jellyfin",
                source=source_file,
                error=str(e),
            )
            return {
                "success": False,
                "source": source_file,
                "error": str(e),
            }

    def _resolve_unique_destination(self, destination: str, source_file: str) -> str:
        """Return a collision-free destination path without overwriting existing files."""
        if not os.path.exists(destination):
            return destination

        base, ext = os.path.splitext(destination)
        source_stem = self._sanitize_path(os.path.splitext(os.path.basename(source_file))[0]) or "copy"

        preferred = f"{base} - {source_stem}{ext}"
        if preferred != destination and not os.path.exists(preferred):
            return preferred

        suffix = 2
        while True:
            candidate = f"{base} ({suffix}){ext}"
            if not os.path.exists(candidate):
                return candidate
            suffix += 1

    def _build_jellyfin_filename(
        self,
        source_file: str,
        target_dir: str,
        media_type: str,
        assignment: Dict[str, Any],
        media: Dict[str, Any],
    ) -> str:
        """
        Build a filename aligned with Jellyfin guidance.

        Movies / Documentaries / Live Performances: filename matches folder name.
          If assignment carries isAlternateVersion + versionNumber, a " - Version N" suffix
          is appended.
        Shows: <Series Folder Name> SxxExx[ Episode Title].ext when episode data exists.
          If no episode number can be resolved, uses "Unknown Episode N" suffix.
        NeedsReview: uses the _reviewFileName set on the assignment dict.
        """
        ext = os.path.splitext(source_file)[1]
        source_name = os.path.basename(source_file)

        # Catch-all: file routed to _NeedsReview has a pre-computed name
        if assignment.get("_reviewFileName"):
            return str(assignment["_reviewFileName"])

        if media_type in ("movie", "documentary", "live_performance"):
            folder_name = self._sanitize_path(os.path.basename(target_dir))
            if assignment.get("isAlternateVersion"):
                version_num = assignment.get("versionNumber", 2)
                return f"{folder_name} - Version {version_num}{ext}"
            if folder_name:
                return f"{folder_name}{ext}"
            return source_name

        if media_type == "episode":
            season_dir = os.path.basename(target_dir)
            series_dir = os.path.basename(os.path.dirname(target_dir))
            series_name = self._sanitize_path(series_dir)

            season_raw = assignment.get("seasonNumber")
            if season_raw is None:
                season_raw = assignment.get("parsedInfo", {}).get("season")
            if season_raw is None and season_dir.lower().startswith("season "):
                season_raw = season_dir.split(" ", 1)[1]

            episode_raw = assignment.get("episodeNumber")
            if episode_raw is None:
                episode_raw = assignment.get("parsedInfo", {}).get("episode")

            try:
                season_num = int(season_raw)
            except (TypeError, ValueError):
                season_num = None

            try:
                episode_num = int(episode_raw)
            except (TypeError, ValueError):
                episode_num = None

            if season_num is not None and season_num < 0:
                season_num = 0
            if episode_num is not None and episode_num < 0:
                episode_num = 0

            episode_title = (
                assignment.get("parsedInfo", {}).get("episode_title")
                or media.get("episodeTitle")
                or ""
            )
            episode_title = self._sanitize_path(str(episode_title)).strip()

            if series_name and episode_num is not None:
                if season_num is None:
                    # Anime absolute-episode numbering: no season available
                    base_name = f"{series_name} E{episode_num:03d}"
                    episode_end_raw = (
                        assignment.get("parsedInfo", {}).get("episode_end")
                        or assignment.get("episodeEnd")
                    )
                    try:
                        episode_end_num = int(episode_end_raw)
                        if episode_end_num > episode_num:
                            base_name = f"{base_name}E{episode_end_num:03d}"
                    except (TypeError, ValueError):
                        pass
                else:
                    base_name = f"{series_name} S{season_num:02d}E{episode_num:02d}"
                    # Multi-episode file: append the ending episode number
                    episode_end_raw = (
                        assignment.get("parsedInfo", {}).get("episode_end")
                        or assignment.get("episodeEnd")
                    )
                    try:
                        episode_end_num = int(episode_end_raw)
                        if episode_end_num > episode_num:
                            base_name = f"{base_name}E{episode_end_num:02d}"
                    except (TypeError, ValueError):
                        pass
                if episode_title:
                    base_name = f"{base_name} {episode_title}"
                return f"{base_name}{ext}"

            # Episode number unknown — use pre-computed unknown label if present,
            # otherwise fall back to a generic suffix.
            if series_name:
                unknown_label = assignment.get("unknownEpisodeLabel")
                if unknown_label:
                    return f"{self._sanitize_path(str(unknown_label))}{ext}"
                return f"{series_name} - Unknown Episode{ext}"

        return source_name

    async def _update_assignment_status(
        self,
        assignment_id: str,
        success: bool,
        target_path: str,
        operation_result: Dict[str, Any],
    ) -> None:
        """Update assignment status in Firestore."""
        try:
            update_data = {
                "organizationStatus": "completed" if success else "failed",
                "targetPath": target_path,
                "isOrganized": success,
                "organizationDate": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }

            if not success:
                update_data["organizationError"] = operation_result.get("error", "Unknown error")


            logger.info(
                "Assignment status updated",
                assignment_id=assignment_id,
                status=update_data["organizationStatus"],
            )

        except Exception as e:
            logger.error(
                "Failed to update assignment status",
                assignment_id=assignment_id,
                error=str(e),
            )

    async def _upsert_catalog_jellyfin_info(
        self,
        media_type: str,
        media_id: Optional[str],
        folder_path: str,
        organized_at: str,
        media: Dict[str, Any],
        file_count: Optional[int] = None,
    ) -> None:
        """Upsert jellyfinInfo into PostgreSQL catalog after a successful move.

        This creates the catalog record when it doesn't already exist, which makes
        newly organized items appear in My Library without manual seeding.
        """
        try:
            from sqlalchemy import select
            from db.models import Movie, Series

            # episode type maps to the Series catalog table
            Model = Series if media_type in ("episode", "series") else Movie
            canonical_folder_path = folder_path
            if media_type == "episode":
                leaf = os.path.basename(folder_path.rstrip("/"))
                if re.match(r"^Season\s+\d+$", leaf, re.IGNORECASE):
                    canonical_folder_path = os.path.dirname(folder_path.rstrip("/"))

            title = media.get("seriesTitle") if Model is Series else media.get("title")
            if not title:
                title = media.get("title") or "Untitled"
            imdb_id = media.get("imdbId")
            year = media.get("year")
            omdb_data = media.get("omdbData") if isinstance(media.get("omdbData"), dict) else None
            tmdb_data = media.get("tmdbData") if isinstance(media.get("tmdbData"), dict) else None
            image_files = media.get("imageFiles") if isinstance(media.get("imageFiles"), list) else None
            external_ids = media.get("externalIds") if isinstance(media.get("externalIds"), dict) else {}
            files_moved = int(file_count) if isinstance(file_count, int) and file_count >= 0 else 0

            jellyfin_info = {
                "folderPath": canonical_folder_path,
                "organizedAt": organized_at,
                "isOrganized": True,
            }

            async with self.db_session_factory() as session:
                row = None
                if media_id:
                    result = await session.execute(select(Model).where(Model.id == media_id))
                    row = result.scalar_one_or_none()

                if row is None and imdb_id:
                    result = await session.execute(select(Model).where(Model.imdb_id == imdb_id).limit(1))
                    row = result.scalar_one_or_none()

                # Last-resort dedupe for sparse auto-matches (no imdb/media id yet):
                # reuse an existing record with the same title instead of creating one per file.
                if row is None and title:
                    result = await session.execute(select(Model).where(Model.title == title).limit(1))
                    row = result.scalar_one_or_none()

                if row is None:
                    generated_id = media_id or imdb_id or str(uuid.uuid4())
                    row = Model(id=generated_id, title=title)
                    if imdb_id:
                        row.imdb_id = imdb_id
                    session.add(row)

                row.title = title or row.title
                if imdb_id and not row.imdb_id:
                    row.imdb_id = imdb_id

                existing_jellyfin = dict(row.jellyfin_info or {})
                existing_jellyfin.update(jellyfin_info)
                row.jellyfin_info = existing_jellyfin

                linked_video_files = self._collect_video_file_entries(canonical_folder_path)
                linked_file_paths = [entry["filePath"] for entry in linked_video_files]
                total_file_size = sum(int(entry.get("fileSize") or 0) for entry in linked_video_files)
                existing_summary = dict(row.assignment_summary or {})

                raw = dict(row.raw_data or {})
                raw["id"] = row.id
                raw["title"] = row.title
                raw["titleLower"] = (row.title or "").lower()
                raw["mediaType"] = "series" if Model is Series else "movie"
                if year is not None:
                    raw["year"] = year
                raw["folderPath"] = canonical_folder_path
                raw["isOrganized"] = True
                raw["lastOrganized"] = organized_at
                raw["jellyfinInfo"] = existing_jellyfin
                raw["linkedVideoFiles"] = linked_video_files
                raw["videoFiles"] = linked_video_files
                raw["sourceFiles"] = linked_file_paths
                raw["primaryVideoPath"] = linked_file_paths[0] if linked_file_paths else None

                if Model is Series:
                    series_summary_data = self._summarize_series_files(canonical_folder_path)
                    summary = dict(existing_summary)
                    summary.update(series_summary_data.get("assignmentSummary") or {})
                    resolved_total_files = max(
                        int(summary.get("totalFiles") or 0),
                        len(linked_video_files),
                        files_moved,
                    )
                    summary.update({
                        "totalFiles": resolved_total_files,
                        "assignedFiles": resolved_total_files,
                        "unassignedFiles": 0,
                        "totalFileSize": total_file_size,
                        "linkedFiles": linked_file_paths,
                        "lastUpdated": organized_at,
                    })
                    raw["assignmentSummary"] = summary
                    raw["seriesSummary"] = series_summary_data.get("seriesSummary") or {}
                    raw["fileCount"] = resolved_total_files
                else:
                    resolved_total_files = max(len(linked_video_files), files_moved)
                    summary = dict(existing_summary)
                    summary.update({
                        "totalFiles": resolved_total_files,
                        "assignedFiles": resolved_total_files,
                        "unassignedFiles": 0,
                        "totalFileSize": total_file_size,
                        "linkedFiles": linked_file_paths,
                        "lastUpdated": organized_at,
                    })
                    raw["assignmentSummary"] = summary
                    raw["fileCount"] = resolved_total_files

                merged_external_ids = dict(raw.get("externalIds") or {})
                merged_external_ids.update(external_ids)
                if imdb_id:
                    merged_external_ids["imdbId"] = imdb_id
                if merged_external_ids:
                    raw["externalIds"] = merged_external_ids

                if omdb_data:
                    raw["omdbData"] = omdb_data
                if tmdb_data:
                    raw["tmdbData"] = tmdb_data

                if image_files:
                    raw["imageFiles"] = image_files
                elif omdb_data:
                    poster = omdb_data.get("Poster")
                    if isinstance(poster, str) and poster and poster != "N/A":
                        raw["imageFiles"] = [{
                            "fileName": poster,
                            "fileSize": 0,
                            "resolution": "",
                            "format": "jpg",
                        }]

                row.raw_data = raw
                row.assignment_summary = raw.get("assignmentSummary") or {}
                row.jellyfin_info = existing_jellyfin
                row.image_files = raw.get("imageFiles") or row.image_files
                if omdb_data:
                    row.omdb_data = omdb_data
                if tmdb_data:
                    row.tmdb_data = tmdb_data

                await session.commit()
                logger.info(
                    "Catalog entry upserted after organization",
                    media_id=row.id,
                    media_type=media_type,
                    folder_path=folder_path,
                )
        except Exception as exc:
            # Non-fatal: organization succeeded even if catalog update fails
            logger.warning(
                "Failed to upsert catalog jellyfinInfo",
                media_id=media_id,
                error=str(exc),
            )

    def _collect_video_file_entries(self, root_path: str) -> List[Dict[str, Any]]:
        """Return linked video-file metadata for all organized files under a media root."""
        entries: List[Dict[str, Any]] = []

        if not root_path or not os.path.isdir(root_path):
            return entries

        for current_root, _, files in os.walk(root_path):
            for file_name in sorted(files):
                ext = os.path.splitext(file_name)[1].lower()
                if ext not in self.VIDEO_EXTENSIONS:
                    continue

                file_path = os.path.join(current_root, file_name)
                try:
                    file_size = os.path.getsize(file_path)
                except OSError:
                    file_size = 0

                entries.append(
                    {
                        "fileName": file_name,
                        "filePath": file_path,
                        "relativePath": os.path.relpath(file_path, root_path).replace("\\", "/"),
                        "fileSize": file_size,
                    }
                )

        entries.sort(key=lambda item: item.get("relativePath") or item.get("fileName") or "")
        return entries

    def _summarize_series_files(self, series_root_path: str) -> Dict[str, Any]:
        """Build assignment/coverage summary by scanning video files under a series root."""
        total_files = 0
        seasons_with_files = set()
        episodes_with_files = set()
        season_dirs = set()

        if not os.path.isdir(series_root_path):
            return {
                "assignmentSummary": {
                    "totalFiles": 0,
                    "assignedFiles": 0,
                    "unassignedFiles": 0,
                    "seasonsWithFiles": 0,
                    "episodesWithFiles": 0,
                },
                "seriesSummary": {
                    "totalSeasons": 0,
                    "totalEpisodes": 0,
                },
            }

        for root, dirs, files in os.walk(series_root_path):
            for d in dirs:
                m = re.match(r"^Season\s+(\d+)$", d, re.IGNORECASE)
                if m:
                    season_dirs.add(int(m.group(1)))

            for file_name in files:
                ext = os.path.splitext(file_name)[1].lower()
                if ext not in self.VIDEO_EXTENSIONS:
                    continue

                total_files += 1
                normalized_root = root.replace("\\", "/")

                season_from_path = None
                m_path = re.search(r"/Season\s+(\d+)(?:/|$)", normalized_root, re.IGNORECASE)
                if m_path:
                    season_from_path = int(m_path.group(1))
                    seasons_with_files.add(season_from_path)

                m_episode = re.search(r"[Ss](\d{1,2})[Ee](\d{1,3})", file_name)
                if m_episode:
                    season_num = int(m_episode.group(1))
                    episode_num = int(m_episode.group(2))
                    seasons_with_files.add(season_num)
                    episodes_with_files.add((season_num, episode_num))
                elif season_from_path is not None:
                    # Episode number couldn't be parsed, but still count the season coverage.
                    episodes_with_files.add((season_from_path, total_files))

        total_seasons = max(len(season_dirs), len(seasons_with_files))
        total_episodes = len(episodes_with_files)

        return {
            "assignmentSummary": {
                "totalFiles": total_files,
                "assignedFiles": total_files,
                "unassignedFiles": 0,
                "seasonsWithFiles": len(seasons_with_files),
                "episodesWithFiles": total_episodes,
            },
            "seriesSummary": {
                "totalSeasons": total_seasons,
                "totalEpisodes": total_episodes,
            },
        }

    def _create_jellyfin_nfo_files(
        self,
        media_type: str,
        target_path: str,
        move_results: List[Dict[str, Any]],
        assignment: Dict[str, Any],
        media: Dict[str, Any],
    ) -> List[str]:
        """Create Jellyfin-compatible NFO files after successful organization."""
        created: List[str] = []

        try:
            if media_type in ("movie", "documentary", "live_performance"):
                movie_nfo_path = os.path.join(target_path, "movie.nfo")
                if self._write_nfo_if_missing(movie_nfo_path, self._build_movie_nfo(media)):
                    created.append(movie_nfo_path)

            elif media_type == "episode":
                series_dir = os.path.dirname(target_path.rstrip("/"))

                tvshow_nfo_path = os.path.join(series_dir, "tvshow.nfo")
                if self._write_nfo_if_missing(tvshow_nfo_path, self._build_tvshow_nfo(media)):
                    created.append(tvshow_nfo_path)

                for item in move_results:
                    if not item.get("success"):
                        continue
                    destination = item.get("destination")
                    if not destination:
                        continue
                    stem, _ = os.path.splitext(destination)
                    episode_nfo_path = f"{stem}.nfo"
                    xml_text = self._build_episode_nfo(media, assignment)
                    if self._write_nfo_if_missing(episode_nfo_path, xml_text):
                        created.append(episode_nfo_path)
        except Exception as exc:
            logger.warning("Failed to create NFO files", error=str(exc), target_path=target_path)

        return created

    def _write_nfo_if_missing(self, path: str, content: str) -> bool:
        """Write NFO only when not already present to avoid clobbering hand-edited metadata."""
        try:
            if os.path.exists(path):
                return False
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info("NFO file created", path=path)
            return True
        except Exception as exc:
            logger.warning("Failed to write NFO file", path=path, error=str(exc))
            return False

    def _build_movie_nfo(self, media: Dict[str, Any]) -> str:
        title = escape(str(media.get("title") or "Unknown"))
        year = media.get("year")
        imdb_id = media.get("imdbId")

        lines = [
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<movie>",
            f"  <title>{title}</title>",
        ]

        if year is not None:
            lines.append(f"  <year>{escape(str(year))}</year>")
        if imdb_id:
            safe_id = escape(str(imdb_id))
            lines.append(f"  <id>{safe_id}</id>")
            lines.append(f"  <imdbid>{safe_id}</imdbid>")
            lines.append(f"  <uniqueid type=\"imdb\" default=\"true\">{safe_id}</uniqueid>")

        lines.append("</movie>")
        return "\n".join(lines) + "\n"

    def _build_tvshow_nfo(self, media: Dict[str, Any]) -> str:
        title = escape(str(media.get("seriesTitle") or media.get("title") or "Unknown"))
        year = media.get("year")
        imdb_id = media.get("imdbId")

        lines = [
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<tvshow>",
            f"  <title>{title}</title>",
        ]

        if year is not None:
            lines.append(f"  <year>{escape(str(year))}</year>")
        if imdb_id:
            safe_id = escape(str(imdb_id))
            lines.append(f"  <imdb_id>{safe_id}</imdb_id>")
            lines.append(f"  <uniqueid type=\"imdb\" default=\"true\">{safe_id}</uniqueid>")

        lines.append("</tvshow>")
        return "\n".join(lines) + "\n"

    def _build_episode_nfo(self, media: Dict[str, Any], assignment: Dict[str, Any]) -> str:
        show_title = escape(str(media.get("seriesTitle") or media.get("title") or "Unknown"))

        season_number = assignment.get("seasonNumber")
        episode_number = assignment.get("episodeNumber")

        try:
            season_number = int(season_number)
        except (TypeError, ValueError):
            season_number = 1

        try:
            episode_number = int(episode_number)
        except (TypeError, ValueError):
            episode_number = 1

        episode_title = assignment.get("parsedInfo", {}).get("episode_title") or ""
        if episode_title:
            safe_episode_title = escape(str(episode_title))
        else:
            safe_episode_title = f"{show_title} S{season_number:02d}E{episode_number:02d}"

        lines = [
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<episodedetails>",
            f"  <title>{safe_episode_title}</title>",
            f"  <showtitle>{show_title}</showtitle>",
            f"  <season>{season_number}</season>",
            f"  <episode>{episode_number}</episode>",
        ]

        lines.append("</episodedetails>")
        return "\n".join(lines) + "\n"

    def _sanitize_path(self, name: str) -> str:
        """Sanitize name for use in file paths."""
        # Remove problematic characters
        invalid_chars = r'<>:"/\|?*'
        for char in invalid_chars:
            name = name.replace(char, "")

        # Remove leading/trailing spaces
        name = name.strip()

        # Replace multiple spaces with single space
        while "  " in name:
            name = name.replace("  ", " ")

        return name
