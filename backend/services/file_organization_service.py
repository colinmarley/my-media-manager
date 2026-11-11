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
from services.ingest_operations import (
    OP_MKDIR,
    OP_MOVE,
    OP_WRITE_NFO,
    OperationLog,
    OperationRecorder,
)
from services import storage_paths
from services.path_builder import PathBuilder
from utils.logging import logger


class FileOrganizationService:
    """Organizes files into Jellyfin-compliant folder structures."""

    # Base path constants
    ENCODED_SOURCE_PATH = "/data/media/encoded"
    VIDEO_EXTENSIONS = {
        ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv",
        ".webm", ".m2ts", ".mts", ".ts", ".mpg", ".mpeg", ".iso", ".strm",
    }

    def __init__(
        self,
        filesystem_manager: Optional[Any] = None,
        jellyfin_dest_base: Optional[str] = None,
        db_session_factory: Optional[Callable] = None,
        operation_log: Optional[Any] = None,
    ):
        self.filesystem_manager = filesystem_manager
        self.db_session_factory = db_session_factory
        # Every filesystem step of a plan is recorded in ingest_operations so it
        # can be undone. Without a database (tests, scripts) nothing is recorded.
        self.operation_log = operation_log or (
            OperationLog(db_session_factory) if db_session_factory else None
        )
        # An explicit root pins this instance (tests, scripts); otherwise the
        # library root is resolved on every use, so a config change applies.
        self._jellyfin_dest_base: Optional[str] = (
            jellyfin_dest_base.rstrip("/") if jellyfin_dest_base else None
        )

    @property
    def jellyfin_dest_base(self) -> str:
        return self._jellyfin_dest_base or storage_paths.library_root()

    @jellyfin_dest_base.setter
    def jellyfin_dest_base(self, value: Optional[str]) -> None:
        self._jellyfin_dest_base = value.rstrip("/") if value else None

    async def organize_assignment(
        self,
        assignment: Dict[str, Any],
        media: Dict[str, Any],
        jellyfin_root_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Organize files according to assignment and media info.

        Args:
            assignment: Media assignment record
            media: Resolved media information

        Returns:
            Organization result with status and details
        """
        try:
            media_type = assignment.get("mediaType", "movie")

            # The queue's proposal is the plan: the primary file goes exactly
            # where the proposal said. Only an assignment without one (not from
            # the queue) has its destination built here, by the same builder.
            planned_file = self._planned_destination(assignment, media_type, jellyfin_root_override)
            if planned_file:
                target_path = os.path.dirname(planned_file)
            else:
                target_path = self._calculate_jellyfin_path(
                    media,
                    assignment,
                    media_type,
                    jellyfin_root_override,
                )

            # If the path cannot be resolved the file stays exactly where it is.
            # It used to be renamed into a flat _NeedsReview folder, which threw
            # away the parent folders (title, year, [imdbid-...] tag, Season N)
            # that a person or a later pass needs to identify it.
            if not target_path:
                source_file_name = (
                    (assignment.get("sourceFile") or assignment.get("file") or {}).get("fileName")
                    or "unknown"
                )
                error = (
                    f"No destination could be resolved for media type '{media_type}'; "
                    "file left in place for review"
                )
                logger.warning(
                    "Could not calculate target path - leaving file in place",
                    media_type=media_type,
                    source_file=source_file_name,
                )
                return {
                    "success": False,
                    "assignmentId": assignment.get("id"),
                    "mediaType": media_type,
                    "targetPath": None,
                    "needsReview": True,
                    "filesMoved": 0,
                    "totalFiles": 0,
                    "operations": [],
                    "moveErrors": [error],
                    "error": error,
                    "timestamp": datetime.utcnow().isoformat(),
                }

            # Get source files from assignment
            source_files = await self._get_source_files(assignment)
            if not source_files:
                raise ValueError("No source files in assignment")

            recorder = OperationRecorder(
                self.operation_log,
                queue_item_id=assignment.get("queueItemId"),
                assignment_id=assignment.get("id"),
            )

            # Create folder structure
            folder_result = await self._create_jel_folder_structure(target_path, recorder)
            if not folder_result["success"]:
                raise ValueError(f"Failed to create folder: {folder_result.get('error')}")

            # Move files. A failed step stops the plan: the moves before it stay
            # done and recorded, the ones after it are not attempted.
            move_results = []
            for index, source_file in enumerate(source_files):
                try:
                    result = await self._move_file_to_jellyfin(
                        source_file,
                        target_path,
                        media_type,
                        assignment,
                        media,
                        planned_destination=planned_file if index == 0 else None,
                        recorder=recorder,
                    )
                except Exception as e:
                    result = {
                        "success": False,
                        "source": source_file,
                        "error": str(e),
                    }
                move_results.append(result)
                if not result.get("success"):
                    logger.warning(
                        "File move failed - stopping the plan",
                        source=source_file,
                        target=target_path,
                        error=result.get("error"),
                        not_attempted=len(source_files) - index - 1,
                    )
                    break

            # Check if all moves succeeded
            all_successful = all(r.get("success", False) for r in move_results)
            move_errors = [str(r.get("error")) for r in move_results if not r.get("success") and r.get("error")]

            # Create local NFO metadata files for Jellyfin when at least one file moved.
            nfo_files_created: List[str] = []
            if all_successful:
                nfo_files_created = await self._create_jellyfin_nfo_files(
                    media_type=media_type,
                    target_path=target_path,
                    move_results=move_results,
                    assignment=assignment,
                    media=media,
                    recorder=recorder,
                )

            result = {
                "success": all_successful,
                "assignmentId": assignment.get("id"),
                "mediaType": media_type,
                "targetPath": target_path,
                "needsReview": False,
                "filesMoved": sum(1 for r in move_results if r.get("success")),
                "totalFiles": len(source_files),
                "folderCreated": folder_result.get("folderPath"),
                "nfoFilesCreated": nfo_files_created,
                "operations": move_results,
                "moveErrors": move_errors,
                "error": "; ".join(move_errors[:10]) if move_errors else None,
                "timestamp": datetime.utcnow().isoformat(),
            }

            # Write jellyfinInfo back to the PostgreSQL catalog so My Library reflects
            # the organized state without needing Firebase.
            if all_successful and self.db_session_factory:
                result["catalogId"] = await self._upsert_catalog_jellyfin_info(
                    media_type=media_type,
                    media_id=assignment.get("mediaId"),
                    folder_path=target_path,
                    organized_at=datetime.utcnow().isoformat(),
                    media=media,
                    file_count=result.get("filesMoved"),
                )


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

    def _library_root(
        self,
        assignment: Dict[str, Any],
        jellyfin_root_override: Optional[str] = None,
    ) -> str:
        target_structure = assignment.get("targetFolderStructure") or {}
        return (
            jellyfin_root_override
            or target_structure.get("libraryRoot")
            or self.jellyfin_dest_base
        ).rstrip("/")

    @staticmethod
    def _primary_source(assignment: Dict[str, Any]) -> str:
        payload = assignment.get("sourceFile") or assignment.get("file") or {}
        return payload.get("filePath") or payload.get("fileName") or ""

    def _planned_destination(
        self,
        assignment: Dict[str, Any],
        media_type: str,
        jellyfin_root_override: Optional[str] = None,
    ) -> Optional[str]:
        """Absolute destination of the primary file from the stored proposal, if any."""
        proposed = assignment.get("proposedPath")
        if not proposed or PathBuilder.subfolder(media_type) is None:
            return None
        return PathBuilder.absolute(self._library_root(assignment, jellyfin_root_override), str(proposed))

    def _calculate_jellyfin_path(
        self,
        media: Dict[str, Any],
        assignment: Dict[str, Any],
        media_type: str,
        jellyfin_root_override: Optional[str] = None,
    ) -> Optional[str]:
        """Destination folder for an assignment, built by the shared PathBuilder.

        Supports: movie, episode, documentary, live_performance.
        Returns None for unrecognised types; the caller then leaves the file in place.
        """
        try:
            if PathBuilder.subfolder(media_type) is None:
                logger.error("Unknown media type - file will be left in place", media_type=media_type)
                return None
            spec = PathBuilder.spec_from_assignment(
                assignment, media, media_type, self._primary_source(assignment)
            )
            relative_dir = PathBuilder.relative_dir(spec)
            if relative_dir is None:
                return None
            return PathBuilder.absolute(self._library_root(assignment, jellyfin_root_override), relative_dir)
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
        self, target_path: str, recorder: Optional[OperationRecorder] = None
    ) -> Dict[str, Any]:
        """Create necessary folder structure, one recorded mkdir per missing level."""
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

            await self._make_recorded_dirs(target_path, recorder)
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

    @staticmethod
    async def _make_recorded_dirs(target_path: str, recorder: Optional[OperationRecorder]) -> None:
        """Create the levels of ``target_path`` that do not exist yet, top down,
        each as its own recorded mkdir, so undo removes exactly the folders the
        plan made."""
        missing: List[str] = []
        current = os.path.normpath(target_path)
        while current and not os.path.isdir(current):
            missing.append(current)
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent
        for folder in reversed(missing):
            op_id = await recorder.before(OP_MKDIR, dst=folder) if recorder else None
            try:
                os.makedirs(folder, exist_ok=True)
            except Exception as exc:
                if recorder:
                    await recorder.failed(op_id, str(exc))
                raise
            if recorder:
                await recorder.done(op_id)

    async def _move_file_to_jellyfin(
        self,
        source_file: str,
        target_dir: str,
        media_type: str,
        assignment: Optional[Dict[str, Any]] = None,
        media: Optional[Dict[str, Any]] = None,
        planned_destination: Optional[str] = None,
        recorder: Optional[OperationRecorder] = None,
    ) -> Dict[str, Any]:
        """Move a file to Jellyfin directory.

        ``planned_destination`` is the proposal's exact file path. It is used
        as is; only if something appeared there since the plan was resolved is
        a free variant taken, and the result then reports ``deviatedFromPlan``.

        With a ``recorder`` the move is written to ``ingest_operations`` before
        it runs and updated after; if that row cannot be written the file is
        not moved.
        """
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

            if planned_destination:
                planned = planned_destination
            else:
                filename = self._build_jellyfin_filename(
                    source_file=source_file,
                    target_dir=target_dir,
                    media_type=media_type,
                    assignment=assignment or {},
                    media=media or {},
                )
                planned = os.path.join(target_dir, filename)
            destination = self._resolve_unique_destination(planned, source_file)

            op_id = None
            if recorder:
                try:
                    # A destination in a new subfolder (an extras folder, say)
                    # gets its mkdir recorded before the move that needs it.
                    await self._make_recorded_dirs(os.path.dirname(destination), recorder)
                    op_id = await recorder.before(
                        OP_MOVE,
                        src=source_file,
                        dst=destination,
                        planned_dst=planned,
                        size_before=self._file_size(source_file),
                    )
                except Exception as exc:
                    return {
                        "success": False,
                        "source": source_file,
                        "destination": destination,
                        "error": f"Could not record the move, file left in place: {exc}",
                    }

            # Move file
            try:
                result = self.filesystem_manager.move_file(source_file, destination)
            except Exception as exc:
                result = {"success": False, "error": str(exc)}

            if result.get("success"):
                logger.info(
                    "File moved to Jellyfin",
                    source=source_file,
                    destination=destination,
                )
                size = self._file_size(destination)
                move_result = {
                    "success": True,
                    "op": "move",
                    "source": source_file,
                    "destination": destination,
                    "plannedDestination": planned,
                    "deviatedFromPlan": bool(planned_destination) and destination != planned,
                    "size": size,
                }
                if recorder:
                    try:
                        await recorder.done(op_id, dst=destination, size=size)
                    except Exception as exc:
                        # The file moved but undo cannot see it: stop the plan here.
                        move_result["success"] = False
                        move_result["error"] = f"Moved but the operation record could not be completed: {exc}"
                    if op_id:
                        move_result["operationId"] = op_id
                return move_result
            else:
                error_msg = result.get("error", "Unknown error")
                logger.warning(
                    "File move failed",
                    source=source_file,
                    error=error_msg,
                )
                if recorder:
                    await recorder.failed(op_id, str(error_msg))
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

    @staticmethod
    def _file_size(path: str) -> Optional[int]:
        try:
            return os.path.getsize(path)
        except OSError:
            return None

    def _resolve_unique_destination(self, destination: str, source_file: str) -> str:
        """Return a collision-free destination path without overwriting existing files."""
        return PathBuilder.unique_path(destination, source_file)

    def _build_jellyfin_filename(
        self,
        source_file: str,
        target_dir: str,
        media_type: str,
        assignment: Dict[str, Any],
        media: Dict[str, Any],
    ) -> str:
        """File name for an assignment without a stored proposal, from the shared PathBuilder.

        Movies / Documentaries / Live Performances: the folder name, `` - Version N``
        for an alternate version, ``Special Feature N`` for an extra.
        Shows: ``<Series Folder> SxxExx[ Episode Title].ext``; a file whose
        episode is unknown keeps its label or original name.
        """
        if PathBuilder.subfolder(media_type) is None:
            return os.path.basename(source_file)
        spec = PathBuilder.spec_from_assignment(assignment, media, media_type, source_file)
        return PathBuilder.file_name(spec)

    async def _upsert_catalog_jellyfin_info(
        self,
        media_type: str,
        media_id: Optional[str],
        folder_path: str,
        organized_at: str,
        media: Dict[str, Any],
        file_count: Optional[int] = None,
    ) -> Optional[str]:
        """Upsert jellyfinInfo into PostgreSQL catalog after a successful move.

        This creates the catalog record when it doesn't already exist, which makes
        newly organized items appear in My Library without manual seeding.

        Returns the catalog row's id (``movies.id`` or ``series.id``), None if
        the write failed.
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
                return row.id
        except Exception as exc:
            # Non-fatal: organization succeeded even if catalog update fails
            logger.warning(
                "Failed to upsert catalog jellyfinInfo",
                media_id=media_id,
                error=str(exc),
            )
        return None

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

    async def _create_jellyfin_nfo_files(
        self,
        media_type: str,
        target_path: str,
        move_results: List[Dict[str, Any]],
        assignment: Dict[str, Any],
        media: Dict[str, Any],
        recorder: Optional[OperationRecorder] = None,
    ) -> List[str]:
        """Create Jellyfin-compatible NFO files after successful organization."""
        created: List[str] = []

        try:
            if media_type in ("movie", "documentary", "live_performance"):
                movie_nfo_path = os.path.join(target_path, "movie.nfo")
                if await self._write_nfo_if_missing(movie_nfo_path, self._build_movie_nfo(media), recorder):
                    created.append(movie_nfo_path)

            elif media_type == "episode":
                series_dir = os.path.dirname(target_path.rstrip("/"))

                tvshow_nfo_path = os.path.join(series_dir, "tvshow.nfo")
                if await self._write_nfo_if_missing(tvshow_nfo_path, self._build_tvshow_nfo(media), recorder):
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
                    if await self._write_nfo_if_missing(episode_nfo_path, xml_text, recorder):
                        created.append(episode_nfo_path)
        except Exception as exc:
            logger.warning("Failed to create NFO files", error=str(exc), target_path=target_path)

        return created

    async def _write_nfo_if_missing(
        self, path: str, content: str, recorder: Optional[OperationRecorder] = None
    ) -> bool:
        """Write NFO only when not already present to avoid clobbering hand-edited metadata."""
        op_id = None
        try:
            if os.path.exists(path):
                return False
            if recorder:
                op_id = await recorder.before(OP_WRITE_NFO, dst=path)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info("NFO file created", path=path)
            if recorder:
                await recorder.done(op_id, size=self._file_size(path))
            return True
        except Exception as exc:
            logger.warning("Failed to write NFO file", path=path, error=str(exc))
            if recorder:
                await recorder.failed(op_id, str(exc))
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
        return PathBuilder.sanitize(name)
