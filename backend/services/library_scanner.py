"""
Library Scanner Service

This service provides intelligent media library scanning with real-time progress
tracking, duplicate detection, and comprehensive file/directory cataloging.

Key Features:
    - Asynchronous recursive directory scanning
    - Real-time progress tracking and callbacks
    - Composite key duplicate detection (libraryPath:path)
    - Dual-mode duplicate checking (online via Firestore, offline via provided data)
    - Configurable metadata extraction
    - Error tracking and recovery
    - Concurrent scan management
    - Automatic cleanup of old scan data

Duplicate Detection Strategy:
    Uses composite keys to prevent false duplicates across different libraries:
    - Format: "{libraryPath}:{path}"
    - Example: "/media/library-a:/movies/film.mp4" vs "/media/library-b:/movies/film.mp4"
    - These are treated as SEPARATE files (different composite keys)
    - Only true duplicates within the same library are detected

Architecture:
    - Two-pass scanning (count items, then process)
    - Thread pool for parallel processing
    - Async/await for non-blocking I/O
    - Progress callbacks for UI updates
    - Graceful cancellation support

Author: Media Manager Team
Version: 2.0.0
"""

import os
import asyncio
import time
from typing import List, Dict, Any, Callable, Optional
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, asdict
from uuid import uuid4

from services.filesystem_manager import FileSystemManager
from services.metadata_extractor import MetadataExtractor
from services.media_metadata_extractor import MediaMetadataExtractor
from services.firestore_service import FirestoreService
from config.settings import settings
from utils.exceptions import ScanOperationError
from utils.logging import log_scan_progress, logger

@dataclass
class ScanProgress:
    """
    Data class for tracking scan operation progress and results.
    
    This class maintains the complete state of a scan operation, including
    progress metrics, results, errors, and duplicate detection reports.
    
    Attributes:
        scan_id: Unique identifier for this scan operation
        total_items: Total number of files/directories to process
        processed_items: Number of items processed so far
        current_path: Path currently being scanned
        status: Current scan status (scanning, completed, error, cancelled)
        errors: List of errors encountered during scanning
        start_time: Unix timestamp when scan started
        end_time: Unix timestamp when scan completed (None if still running)
        files_found: Number of files discovered
        directories_found: Number of directories discovered
        scan_results: List of discovered files and directories
        duplicate_report: Report of duplicate files/directories found
        
    Properties:
        percentage: Calculated completion percentage (0-100)
        elapsed_time: Seconds elapsed since scan started
    """
    scan_id: str
    total_items: int = 0
    processed_items: int = 0
    current_path: str = ""
    status: str = "scanning"  # scanning, completed, error, cancelled
    errors: List[Dict[str, Any]] = None
    start_time: float = 0
    end_time: Optional[float] = None
    files_found: int = 0
    directories_found: int = 0
    scan_results: List[Dict[str, Any]] = None
    duplicate_report: Optional[Dict[str, Any]] = None
    
    def __post_init__(self):
        """Initialize mutable default values."""
        if self.errors is None:
            self.errors = []
        if self.scan_results is None:
            self.scan_results = []
    
    @property
    def percentage(self) -> float:
        """Calculate and return scan completion percentage."""
        if self.total_items == 0:
            return 0
        return round((self.processed_items / self.total_items) * 100, 2)
    
    @property
    def elapsed_time(self) -> float:
        """Calculate and return elapsed time in seconds."""
        end = self.end_time or time.time()
        return end - self.start_time

class LibraryScanner:
    """
    Service class for managing media library scanning operations.
    
    This class orchestrates the scanning of media libraries, providing progress
    tracking, duplicate detection, and metadata extraction capabilities.
    """
    def __init__(self, file_manager: FileSystemManager, metadata_extractor: MetadataExtractor):
        """
        Initialize the LibraryScanner with required dependencies.
        
        Args:
            file_manager: FileSystemManager instance for file operations
            metadata_extractor: MetadataExtractor instance for media metadata
        """
        self.file_manager = file_manager
        self.metadata_extractor = metadata_extractor
        self.media_metadata_extractor = MediaMetadataExtractor()  # Enhanced metadata extraction
        self.executor = ThreadPoolExecutor(max_workers=settings.scan_worker_threads)
        self.running_scans: Dict[str, ScanProgress] = {}  # Active and completed scans
        self.scan_callbacks: Dict[str, Callable] = {}  # Progress callbacks
        self.firestore_service = FirestoreService(settings.firebase_project_id)
        
    async def start_scan(
        self, 
        library_path: str, 
        callback: Optional[Callable[[ScanProgress], None]] = None,
        extract_metadata: bool = False,
        check_duplicates: bool = False,
        user_id: Optional[str] = None,
        existing_files: Optional[List[Dict[str, Any]]] = None,
        existing_directories: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        Start an asynchronous library scan operation.
        
        This method initiates a background scan of the specified library path,
        creating a unique scan ID for progress tracking. The scan runs asynchronously
        and can be monitored via get_scan_status().
        
        Duplicate Detection Modes:
            1. Offline Mode (existingFiles/existingDirectories provided):
               - Uses frontend-provided data for duplicate checking
               - No Firestore queries required
               - Ideal for development/testing environments
               
            2. Online Mode (no existing data provided):
               - Queries Firestore for existing files/directories
               - Requires Firebase credentials
               - Production mode with centralized data
        
        Composite Key Strategy:
            - Keys format: "{libraryPath}:{path}"
            - Prevents false duplicates across different libraries
            - Example: "/media/lib-a:/movie.mp4" != "/media/lib-b:/movie.mp4"
        
        Args:
            library_path: Root directory path to scan (must be within allowed base paths)
            callback: Optional callback function for real-time progress updates
            extract_metadata: If True, extract detailed FFmpeg metadata (slower)
            check_duplicates: If True, perform duplicate detection and generate report
            user_id: User identifier for Firestore queries (online mode)
            existing_files: List of existing file records (offline mode)
            existing_directories: List of existing directory records (offline mode)
            
        Returns:
            str: Unique scan ID for tracking progress and retrieving results
            
        Raises:
            ScanOperationError: If max concurrent scans reached or path invalid
            PathSecurityError: If path is outside allowed base paths
            
        Example:
            scan_id = await scanner.start_scan(
                library_path="/media/movies",
                extract_metadata=True,
                check_duplicates=True,
                user_id="user123",
                existing_files=[...],
                existing_directories=[...]
            )
        """
        # Check if we've reached the max concurrent scans
        active_scans = [s for s in self.running_scans.values() if s.status == "scanning"]
        if len(active_scans) >= settings.max_concurrent_scans:
            raise ScanOperationError("Maximum concurrent scans reached")
        
        # Validate path security
        if not self.file_manager.validate_path_security(library_path):
            raise ScanOperationError(f"Path not allowed: {library_path}")
        
        # Create scan ID and progress tracker
        scan_id = str(uuid4())
        progress = ScanProgress(
            scan_id=scan_id,
            current_path=library_path,
            start_time=time.time()
        )
        
        self.running_scans[scan_id] = progress
        if callback:
            self.scan_callbacks[scan_id] = callback
        
        # Start scan in background
        asyncio.create_task(self._run_scan_async(
            scan_id, library_path, extract_metadata, check_duplicates, user_id, 
            existing_files, existing_directories
        ))
        
        logger.info("Scan started", scan_id=scan_id, path=library_path)
        return scan_id
    
    async def _run_scan_async(self, scan_id: str, library_path: str, extract_metadata: bool = False, 
                            check_duplicates: bool = False, user_id: Optional[str] = None,
                            existing_files: Optional[List[Dict[str, Any]]] = None,
                            existing_directories: Optional[List[Dict[str, Any]]] = None):
        """Run scan operation asynchronously"""
        progress = self.running_scans[scan_id]
        
        try:
            # First pass: count total items
            total_items = await self._count_items_async(library_path)
            progress.total_items = total_items
            
            # Second pass: scan and process
            scan_results = await self._scan_directory_async(scan_id, library_path, extract_metadata)
            
            # Store scan results in progress object instead of database
            progress.scan_results = scan_results
            progress.files_found = len([r for r in scan_results if r.get('type') == 'file'])
            progress.directories_found = len([r for r in scan_results if r.get('type') == 'directory'])
            
            # Perform duplicate checking if requested
            if check_duplicates and user_id:
                try:
                    if existing_files is not None or existing_directories is not None:
                        # Use provided existing data for offline duplicate checking
                        duplicate_report = await self._check_duplicates_with_existing(
                            scan_results, user_id, library_path, existing_files, existing_directories
                        )
                    else:
                        # Use Firestore for online duplicate checking
                        duplicate_report = await self._check_duplicates(scan_results, user_id, library_path)
                    
                    progress.duplicate_report = duplicate_report
                    
                    # Filter out duplicates - only keep new items for database saving
                    if duplicate_report and duplicate_report.get('duplicatesFound', 0) > 0:
                        # Get paths of duplicate items
                        duplicate_paths = set()
                        for diff_item in duplicate_report.get('differences', []):
                            duplicate_paths.add(diff_item.get('path', ''))
                        
                        # Also get paths that have exact duplicates (no differences)
                        existing_files = await self.firestore_service.get_existing_file_paths(user_id)
                        existing_dirs = await self.firestore_service.get_existing_directory_paths(user_id)
                        
                        for result in scan_results:
                            result_path = result.get('path', '')
                            if result.get('type') == 'file' and result_path in existing_files:
                                duplicate_paths.add(result_path)
                            elif result.get('type') == 'directory' and result_path in existing_dirs:
                                duplicate_paths.add(result_path)
                        
                        # Filter scan results to only include new items
                        original_count = len(scan_results)
                        progress.scan_results = [
                            result for result in scan_results 
                            if result.get('path', '') not in duplicate_paths
                        ]
                        filtered_count = len(progress.scan_results)
                        
                        # Update counts to reflect filtered results
                        progress.files_found = len([r for r in progress.scan_results if r.get('type') == 'file'])
                        progress.directories_found = len([r for r in progress.scan_results if r.get('type') == 'directory'])
                        
                        logger.info(
                            "Filtered out duplicate items from scan results",
                            scan_id=scan_id,
                            original_items=original_count,
                            filtered_items=filtered_count,
                            duplicates_removed=original_count - filtered_count
                        )
                    
                    logger.info(
                        "Duplicate check completed for scan",
                        scan_id=scan_id,
                        duplicates_found=duplicate_report.get('duplicatesFound', 0),
                        new_items=duplicate_report.get('newItems', 0),
                        differences=len(duplicate_report.get('differences', []))
                    )
                        
                except Exception as e:
                    logger.error("Duplicate checking failed", scan_id=scan_id, error=str(e))
                    # Don't fail the entire scan if duplicate checking fails
                    progress.errors.append({
                        'type': 'duplicate_check_error',
                        'message': str(e),
                        'timestamp': time.time()
                    })
            
            progress.status = "completed"
            progress.end_time = time.time()
            
            logger.info(
                "Scan completed", 
                scan_id=scan_id, 
                total_items=total_items,
                processed_items=progress.processed_items,
                elapsed_time=progress.elapsed_time
            )
            
        except Exception as e:
            progress.status = "error"
            progress.end_time = time.time()
            progress.errors.append({
                'type': 'scan_error',
                'message': str(e),
                'path': library_path,
                'timestamp': time.time()
            })
            logger.error("Scan failed", scan_id=scan_id, error=str(e))
        
        # Notify callback if registered
        if scan_id in self.scan_callbacks:
            try:
                self.scan_callbacks[scan_id](progress)
            except Exception as e:
                logger.error("Callback failed", scan_id=scan_id, error=str(e))
    
    async def _count_items_async(self, path: str) -> int:
        """Count total items for progress tracking"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, self._count_items_sync, path)
    
    def _count_items_sync(self, path: str) -> int:
        """Synchronous item counting"""
        total = 0
        try:
            for root, dirs, files in os.walk(path):
                # Filter directories and files
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['@eaDir']]
                
                total += len(dirs)
                total += len([f for f in files if self._is_media_file(f)])
                
                # Respect max depth
                depth = root[len(path):].count(os.sep)
                if depth >= settings.max_scan_depth:
                    dirs.clear()
        except Exception as e:
            logger.warning("Count failed for path", path=path, error=str(e))
        
        return total
    
    async def _scan_directory_async(self, scan_id: str, directory_path: str, extract_metadata: bool = False) -> List[Dict[str, Any]]:
        """Scan directory asynchronously"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor, 
            self._scan_directory_sync, 
            scan_id, 
            directory_path,
            extract_metadata
        )
    
    def _scan_directory_sync(self, scan_id: str, directory_path: str, extract_metadata: bool = False) -> List[Dict[str, Any]]:
        """Synchronous directory scanning"""
        results = []
        progress = self.running_scans[scan_id]
        
        try:
            for root, dirs, files in os.walk(directory_path):
                # Check if scan was cancelled
                if progress.status == "cancelled":
                    break
                
                # Filter directories
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['@eaDir']]
                
                # Update progress
                progress.current_path = root
                
                # Process directories
                for dir_name in dirs:
                    if progress.status == "cancelled":
                        break
                    
                    dir_path = os.path.join(root, dir_name)
                    try:
                        dir_info = self._process_directory(dir_path)
                        if dir_info:
                            results.append(dir_info)
                    except Exception as e:
                        self._add_scan_error(progress, 'directory_error', str(e), dir_path)
                    
                    progress.processed_items += 1
                    self._notify_progress(scan_id, progress)
                
                # Process files
                for file_name in files:
                    if progress.status == "cancelled":
                        break
                    
                    if not self._is_media_file(file_name):
                        continue
                    
                    file_path = os.path.join(root, file_name)
                    try:
                        file_info = self._process_file(file_path, extract_metadata)
                        if file_info:
                            results.append(file_info)
                    except Exception as e:
                        self._add_scan_error(progress, 'file_error', str(e), file_path)
                    
                    progress.processed_items += 1
                    self._notify_progress(scan_id, progress)
                
                # Respect max depth
                depth = root[len(directory_path):].count(os.sep)
                if depth >= settings.max_scan_depth:
                    dirs.clear()
        
        except Exception as e:
            self._add_scan_error(progress, 'scan_error', str(e), directory_path)
        
        return results
    
    def _process_directory(self, dir_path: str) -> Optional[Dict[str, Any]]:
        """Process a directory and extract information"""
        try:
            dir_metadata = self.file_manager.get_file_metadata(dir_path, calculate_checksum=False)
            
            # Determine directory type (movie folder, season folder, etc.)
            dir_name = os.path.basename(dir_path)
            media_type = self._determine_directory_type(dir_name, dir_path)
            
            return {
                'type': 'directory',
                'path': dir_path,
                'name': dir_name,
                'media_type': media_type,
                'metadata': dir_metadata
            }
        except Exception as e:
            logger.warning("Directory processing failed", path=dir_path, error=str(e))
            return None
    
    def _process_file(self, file_path: str, extract_metadata: bool = False) -> Optional[Dict[str, Any]]:
        """Process a media file and extract information"""
        try:
            # Get basic file metadata (skip checksum for performance)
            file_metadata = self.file_manager.get_file_metadata(file_path, calculate_checksum=False)
            
            # Extract media metadata if it's a video file and metadata extraction is enabled
            media_metadata = None
            if extract_metadata and self._is_video_file(file_path):
                try:
                    media_metadata = self.metadata_extractor.extract_video_metadata(file_path)
                except Exception as e:
                    logger.warning("Media metadata extraction failed", path=file_path, error=str(e))
            
            # Parse filename for title/episode information
            parsed_info = self._parse_filename(os.path.basename(file_path))
            
            return {
                'type': 'file',
                'path': file_path,
                'name': os.path.basename(file_path),
                'extension': os.path.splitext(file_path)[1],
                'media_type': self._determine_file_media_type(file_path),
                'metadata': file_metadata,
                'media_metadata': media_metadata,
                'parsed_info': parsed_info
            }
        except Exception as e:
            logger.warning("File processing failed", path=file_path, error=str(e))
            return None
    
    async def _check_duplicates_with_existing(
        self, 
        scan_results: List[Dict[str, Any]], 
        user_id: str,
        library_path: str,
        existing_files: Optional[List[Dict[str, Any]]] = None,
        existing_directories: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Check for duplicate files and directories using provided existing data"""
        try:
            # Initialize duplicate report structure
            duplicate_report = {
                "duplicatesFound": 0,
                "newItems": 0,
                "differences": []
            }
            
            # Convert existing files and directories to lookup dictionaries
            # Use combination of libraryPath and path as the key for proper duplicate detection
            existing_file_keys = {}
            for item in (existing_files or []):
                key = f"{item.get('libraryPath', '')}:{item.get('path', '')}"
                existing_file_keys[key] = item
                
            existing_dir_keys = {}
            for item in (existing_directories or []):
                key = f"{item.get('libraryPath', '')}:{item.get('path', '')}"
                existing_dir_keys[key] = item
            
            new_items = 0
            duplicates_found = 0
            differences = []
            
            for item in scan_results:
                item_path = item.get('path', '')
                print(f"Processing item: {item_path}")
                item_type = item.get('type', '')
                
                # Create the composite key for this item using the current scan's library path
                item_key = f"{library_path}:{item_path}"
                
                if item_type == 'file':
                    existing_item = existing_file_keys.get(item_key)
                elif item_type == 'directory':
                    existing_item = existing_dir_keys.get(item_key)
                else:
                    continue
                
                if existing_item:
                    # Found duplicate, compare data
                    duplicates_found += 1
                    differences_found = self._compare_item_data(item, existing_item)
                    
                    if differences_found:
                        differences.append({
                            "path": item_path,
                            "type": item_type,
                            "differences": differences_found
                        })
                else:
                    # New item
                    new_items += 1
            
            duplicate_report["duplicatesFound"] = duplicates_found
            duplicate_report["newItems"] = new_items
            duplicate_report["differences"] = differences
            
            logger.info("Duplicate check completed using provided existing data", 
                       duplicates=duplicates_found, 
                       new_items=new_items, 
                       differences=len(differences))
            
            return duplicate_report
            
        except Exception as e:
            logger.error("Duplicate checking failed", error=str(e))
            return {
                "duplicatesFound": 0,
                "newItems": len(scan_results),
                "differences": [],
                "error": str(e)
            }
    
    async def _check_duplicates(self, scan_results: List[Dict[str, Any]], user_id: str, library_path: str) -> Dict[str, Any]:
        """Check for duplicate files and directories in the database"""
        try:
            # Initialize duplicate report structure
            duplicate_report = {
                "duplicatesFound": 0,
                "newItems": 0,
                "differences": []
            }
            
            # Get existing files and directories from Firestore
            existing_files = await self.firestore_service.get_existing_file_paths(user_id)
            existing_dirs = await self.firestore_service.get_existing_directory_paths(user_id)
            
            new_items = 0
            duplicates_found = 0
            differences = []
            
            for item in scan_results:
                item_path = item.get('path', '')
                item_type = item.get('type', '')
                
                if item_type == 'file':
                    existing_item = existing_files.get(item_path)
                elif item_type == 'directory':
                    existing_item = existing_dirs.get(item_path)
                else:
                    continue
                
                if existing_item:
                    # Found duplicate, compare data
                    duplicates_found += 1
                    differences_found = self._compare_item_data(item, existing_item)
                    
                    if differences_found:
                        differences.append({
                            "path": item_path,
                            "type": item_type,
                            "differences": differences_found
                        })
                else:
                    # New item
                    new_items += 1
            
            duplicate_report["duplicatesFound"] = duplicates_found
            duplicate_report["newItems"] = new_items
            duplicate_report["differences"] = differences
            
            logger.info("Duplicate check completed", 
                       duplicates=duplicates_found, 
                       new_items=new_items, 
                       differences=len(differences))
            
            return duplicate_report
            
        except Exception as e:
            logger.error("Duplicate checking failed", error=str(e))
            return {
                "duplicatesFound": 0,
                "newItems": len(scan_results),
                "differences": [],
                "error": str(e)
            }
    
    def _compare_item_data(self, new_item: Dict[str, Any], existing_item: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Compare new item data with existing item data and return differences"""
        differences = []
        
        # Compare metadata fields
        new_metadata = new_item.get('metadata', {})
        existing_metadata = existing_item.get('metadata', {})
        
        # Size comparison
        new_size = new_metadata.get('size', 0)
        existing_size = existing_metadata.get('size', 0)
        if new_size != existing_size:
            differences.append({
                "field": "size",
                "newValue": new_size,
                "existingValue": existing_size
            })
        
        # Modified time comparison
        new_mtime = new_metadata.get('modified_time')
        existing_mtime = existing_metadata.get('modified_time')
        if new_mtime != existing_mtime:
            differences.append({
                "field": "modified_time",
                "newValue": new_mtime,
                "existingValue": existing_mtime
            })
        
        # Media type comparison
        new_media_type = new_item.get('media_type')
        existing_media_type = existing_item.get('media_type')
        if new_media_type != existing_media_type:
            differences.append({
                "field": "media_type",
                "newValue": new_media_type,
                "existingValue": existing_media_type
            })
        
        return differences
    
    def _determine_directory_type(self, dir_name: str, dir_path: str) -> str:
        """Determine the type of directory (series, season, etc.)"""
        if dir_name.lower().startswith('season'):
            return 'season'
        elif '(' in dir_name and ')' in dir_name:
            # Check if it's a series or movie folder
            if any(self._is_video_file(f) for f in os.listdir(dir_path) if os.path.isfile(os.path.join(dir_path, f))):
                return 'movie'
            else:
                return 'series'
        else:
            return 'unknown'
    
    def _determine_file_media_type(self, file_path: str) -> str:
        """Determine media type from filename patterns"""
        filename = os.path.basename(file_path)
        
        # Check for episode pattern (S01E01)
        if 'S' in filename.upper() and 'E' in filename.upper():
            import re
            if re.search(r'S\d+E\d+', filename, re.IGNORECASE):
                return 'episode'
        
        # Check for movie pattern (has year)
        if '(' in filename and ')' in filename:
            import re
            if re.search(r'\(\d{4}\)', filename):
                return 'movie'
        
        return 'unknown'
    
    def _parse_filename(self, filename: str) -> Dict[str, Any]:
        """Parse filename to extract title, year, season, episode info"""
        import re
        
        result = {
            'title': '',
            'year': None,
            'season': None,
            'episode': None
        }
        
        # Remove extension
        name_without_ext = os.path.splitext(filename)[0]
        
        # Extract year
        year_match = re.search(r'\((\d{4})\)', name_without_ext)
        if year_match:
            result['year'] = int(year_match.group(1))
        
        # Extract season/episode
        episode_match = re.search(r'S(\d+)E(\d+)', name_without_ext, re.IGNORECASE)
        if episode_match:
            result['season'] = int(episode_match.group(1))
            result['episode'] = int(episode_match.group(2))
        
        # Extract title (everything before year or episode info)
        title = name_without_ext
        if year_match:
            title = title[:year_match.start()].strip()
        elif episode_match:
            title = title[:episode_match.start()].strip()
        
        result['title'] = title
        return result
    
    def _is_media_file(self, filename: str) -> bool:
        """Check if file is a supported media file"""
        extension = os.path.splitext(filename)[1].lower()
        return extension in (settings.supported_video_extensions + 
                           settings.supported_audio_extensions + 
                           settings.supported_subtitle_extensions)
    
    def _is_video_file(self, filename: str) -> bool:
        """Check if file is a video file"""
        extension = os.path.splitext(filename)[1].lower()
        return extension in settings.supported_video_extensions
    
    def _add_scan_error(self, progress: ScanProgress, error_type: str, message: str, path: str):
        """Add error to scan progress"""
        progress.errors.append({
            'type': error_type,
            'message': message,
            'path': path,
            'timestamp': time.time()
        })
    
    def _notify_progress(self, scan_id: str, progress: ScanProgress):
        """Notify progress callback"""
        if scan_id in self.scan_callbacks:
            try:
                self.scan_callbacks[scan_id](progress)
            except Exception:
                pass  # Don't fail scan if callback fails
        
        # Log progress periodically
        if progress.processed_items % 100 == 0:  # Every 100 items
            log_scan_progress(
                scan_id,
                progress.current_path,
                progress.processed_items,
                progress.total_items
            )
    
    def get_scan_results(self, scan_id: str) -> Optional[List[Dict[str, Any]]]:
        """Get scan results for a completed scan"""
        if scan_id in self.running_scans:
            progress = self.running_scans[scan_id]
            if progress.status == "completed" and hasattr(progress, 'scan_results'):
                return progress.scan_results
        return None

    def get_scan_status(self, scan_id: str) -> Optional[Dict[str, Any]]:
        """Get current scan status"""
        if scan_id not in self.running_scans:
            return None
        
        progress = self.running_scans[scan_id]
        status_dict = asdict(progress)
        # Add computed properties
        status_dict['percentage'] = progress.percentage
        status_dict['elapsed_time'] = progress.elapsed_time
        return status_dict
    
    def stop_scan(self, scan_id: str) -> bool:
        """Stop a running scan"""
        if scan_id not in self.running_scans:
            return False
        
        progress = self.running_scans[scan_id]
        if progress.status == "scanning":
            progress.status = "cancelled"
            progress.end_time = time.time()
            logger.info("Scan cancelled", scan_id=scan_id)
            return True
        
        return False
    
    def cleanup_completed_scans(self, max_age_hours: int = 24):
        """Remove old completed/cancelled scans from memory"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        
        to_remove = []
        for scan_id, progress in self.running_scans.items():
            if (progress.status in ['completed', 'cancelled', 'error'] and 
                progress.end_time and 
                (current_time - progress.end_time) > max_age_seconds):
                to_remove.append(scan_id)
        
        for scan_id in to_remove:
            del self.running_scans[scan_id]
            if scan_id in self.scan_callbacks:
                del self.scan_callbacks[scan_id]
        
        logger.info("Cleaned up scans", removed_count=len(to_remove))
    
    async def _check_duplicates(self, scan_results: List[Dict[str, Any]], user_id: str, library_path: str) -> Dict[str, Any]:
        """Check for duplicate files and directories in the database"""
        try:
            # Initialize duplicate report structure
            duplicate_report = {
                "duplicatesFound": 0,
                "newItems": 0,
                "differences": []
            }
            
            # Get existing files and directories from Firestore
            existing_files = await self.firestore_service.get_existing_file_paths(user_id)
            existing_dirs = await self.firestore_service.get_existing_directory_paths(user_id)
            
            # Create composite keys for existing data (libraryPath:path)
            existing_file_keys = {}
            for file_path in existing_files:
                # Assume existing files have both path and libraryPath
                key = f"{file_path.get('libraryPath', '')}:{file_path.get('path', '')}"
                existing_file_keys[key] = file_path
                
            existing_dir_keys = {}
            for dir_path in existing_dirs:
                # Assume existing directories have both path and libraryPath  
                key = f"{dir_path.get('libraryPath', '')}:{dir_path.get('path', '')}"
                existing_dir_keys[key] = dir_path
            
            new_items = 0
            duplicates_found = 0
            differences = []
            
            for item in scan_results:
                item_path = item.get('path', '')
                item_type = item.get('type', '')
                
                # Create composite key for current scan item
                item_key = f"{library_path}:{item_path}"
                
                if item_type == 'file':
                    existing_item = existing_file_keys.get(item_key)
                elif item_type == 'directory':
                    existing_item = existing_dir_keys.get(item_key)
                else:
                    continue
                
                if existing_item:
                    # Found duplicate, compare data
                    duplicates_found += 1
                    differences_found = self._compare_item_data(item, existing_item)
                    
                    if differences_found:
                        differences.append({
                            "path": item_path,
                            "type": item_type,
                            "differences": differences_found
                        })
                else:
                    # New item
                    new_items += 1
            
            duplicate_report["duplicatesFound"] = duplicates_found
            duplicate_report["newItems"] = new_items
            duplicate_report["differences"] = differences
            
            logger.info("Duplicate check completed using Firestore", 
                       duplicates=duplicates_found, 
                       new_items=new_items, 
                       differences=len(differences))
            
            return duplicate_report
            
        except Exception as e:
            logger.error("Firestore duplicate checking failed", error=str(e))
            return {
                "duplicatesFound": 0,
                "newItems": len(scan_results),
                "differences": [],
                "error": str(e)
            }
    
    async def _save_scan_results_to_database(self, scan_id: str, library_path: str, scan_results: List[Dict[str, Any]], progress: ScanProgress):
        """Save scan results to Firestore database"""
        try:
            # Try to initialize Firestore service
            await self.firestore_service.initialize()
            
            # Separate files and directories
            files = [item for item in scan_results if item.get('type') == 'file']
            directories = [item for item in scan_results if item.get('type') == 'directory']
            
            logger.info("Saving scan results to database", 
                       scan_id=scan_id, 
                       files_count=len(files), 
                       directories_count=len(directories))
            
            # Save scan summary
            scan_result = {
                'scanId': scan_id,
                'libraryPath': library_path,
                'status': progress.status,
                'totalItems': progress.total_items,
                'processedItems': progress.processed_items,
                'filesFound': len(files),
                'directoriesFound': len(directories),
                'startTime': progress.start_time,
                'endTime': progress.end_time,
                'elapsedTime': progress.elapsed_time,
                'errors': progress.errors
            }
            
            await self.firestore_service.save_scan_result(scan_result)
            
            # Save files to database
            if files:
                await self.firestore_service.save_media_files(files, scan_id)
            
            # Save directories to database  
            if directories:
                await self.firestore_service.save_media_directories(directories, scan_id)
            
            # Update library path scan status
            await self.firestore_service.update_library_path_scan_status(
                library_path, scan_id, progress.status
            )
            
            logger.info("Scan results saved to database successfully", scan_id=scan_id)
            
        except Exception as e:
            logger.warning(f"Failed to save scan results to database: {str(e)}")
            logger.info("Scan completed successfully but results were not saved to database")
            # Don't fail the scan if database save fails
            progress.errors.append({
                'type': 'database_save_error',
                'message': str(e),
                'timestamp': time.time()
            })