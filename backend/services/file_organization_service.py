"""
File Organization Service for Phase 4

Handles:
- Jellyfin destination path calculation
- Folder structure creation
- File movement from encoded to Jellyfin paths
- Organization status tracking
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from config.settings import settings
from utils.logging import logger


class FileOrganizationService:
    """Organizes files into Jellyfin-compliant folder structures."""

    # Base path constants
    ENCODED_SOURCE_PATH = "/data/media/encoded"
    DEFAULT_JELLYFIN_DEST_BASE = "/mnt/beelink-media"

    def __init__(
        self, filesystem_manager: Optional[Any] = None,
        firestore_service: Optional[Any] = None,
        jellyfin_dest_base: Optional[str] = None,
    ):
        self.filesystem_manager = filesystem_manager
        self.firestore_service = firestore_service
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
            if not target_path:
                raise ValueError("Could not calculate target path")

            # Get source files from assignment
            source_files = self._get_source_files(assignment)
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
                        source_file, target_path, media_type
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

            result = {
                "success": all_successful,
                "assignmentId": assignment.get("id"),
                "mediaType": media_type,
                "targetPath": target_path,
                "filesMoved": sum(1 for r in move_results if r.get("success")),
                "totalFiles": len(move_results),
                "folderCreated": folder_result.get("folderPath"),
                "operations": move_results,
                "timestamp": datetime.utcnow().isoformat(),
            }

            # Update assignment status in Firestore
            if self.firestore_service and self.firestore_service._initialized:
                await self._update_assignment_status(
                    assignment.get("id"),
                    all_successful,
                    target_path,
                    result,
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

    def _calculate_jellyfin_path(
        self,
        media: Dict[str, Any],
        assignment: Dict[str, Any],
        media_type: str,
        jellyfin_root_override: Optional[str] = None,
    ) -> Optional[str]:
        """Calculate Jellyfin destination path based on media type."""
        try:
            target_structure = assignment.get("targetFolderStructure", {})
            library_root = (
                jellyfin_root_override
                or target_structure.get("libraryRoot")
                or self.jellyfin_dest_base
            ).rstrip("/")

            title = media.get("title", "Unknown")
            title_sanitized = self._sanitize_path(title)

            if media_type == "movie":
                # Format: /mnt/beelink-media/movies/Movie Title (YYYY)/
                year_str = ""
                if media.get("year"):
                    year_str = f" ({media.get('year')})"
                elif media.get("releaseDate"):
                    try:
                        year = int(media["releaseDate"][:4])
                        year_str = f" ({year})"
                    except (ValueError, TypeError, IndexError):
                        pass

                folder_name = f"{title_sanitized}{year_str}"
                imdb_info = ""
                if media.get("imdbId"):
                    imdb_info = f" [imdbid-{media['imdbId']}]"

                return f"{library_root}/movies/{folder_name}{imdb_info}"

            elif media_type == "episode":
                # Format: /mnt/beelink-media/shows/Series Name (YYYY)/Season XX/
                series_title = media.get("seriesTitle") or title
                series_sanitized = self._sanitize_path(series_title)

                year_str = ""
                if media.get("year"):
                    year_str = f" ({media.get('year')})"

                folder_name = f"{series_sanitized}{year_str}"
                imdb_info = ""
                if media.get("imdbId"):
                    imdb_info = f" [imdbid-{media['imdbId']}]"

                season_num = assignment.get("seasonNumber", 1)
                season_str = f"Season {season_num:02d}"

                return f"{library_root}/shows/{folder_name}{imdb_info}/{season_str}"

            else:
                logger.error("Unknown media type", media_type=media_type)
                return None

        except Exception as e:
            logger.error(
                "Error calculating Jellyfin path",
                media_type=media_type,
                error=str(e),
            )
            return None

    def _get_source_files(self, assignment: Dict[str, Any]) -> List[str]:
        """Extract source file paths from assignment."""
        files = []

        # Get primary file
        primary_file = assignment.get("sourceFile", {}).get("filePath")
        if primary_file:
            files.append(primary_file)

        # Get extra files (subtitles, etc)
        extra_files = assignment.get("extraFileIds", [])
        for extra_id in extra_files:
            # In a real scenario, should look up file from Firestore
            # For now, just note that extra files would be handled
            pass

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
        self, source_file: str, target_dir: str, media_type: str
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

            # Extract filename
            filename = os.path.basename(source_file)

            # Build destination path
            destination = os.path.join(target_dir, filename)

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

            self.firestore_service.db.collection("media_assignments").document(
                assignment_id
            ).update(update_data)

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
