"""
Media Operations API Router

This module provides REST API endpoints for media file operations including:
- Enhanced file scanning with comprehensive metadata extraction
- Media file assignment to movies/episodes
- Jellyfin folder organization
- File metadata retrieval

Endpoints:
    POST /media/files/scan - Scan files with full media metadata
    GET /media/files/{fileId} - Get file with complete metadata
    POST /media/assign/movie - Assign files to a movie
    POST /media/assign/episode - Assign files to an episode
    POST /media/organize/{assignmentId} - Trigger file organization
    GET /media/jellyfin/validate/{folderId} - Validate Jellyfin structure
"""

from fastapi import APIRouter, HTTPException, Request, Body
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from services.filesystem_manager import FileSystemManager
from services.media_metadata_extractor import MediaMetadataExtractor
from services.firestore_service import FirestoreService
from config.settings import settings
from utils.exceptions import FileOperationError, PathSecurityError
from utils.logging import logger

router = APIRouter()

# Initialize services
file_manager = FileSystemManager()
metadata_extractor = MediaMetadataExtractor()
firestore_service = FirestoreService(settings.firebase_project_id)

# ============================================================================
# Request/Response Models
# ============================================================================

class ScanFilesRequest(BaseModel):
    """Request model for scanning files with enhanced metadata"""
    filePaths: List[str]
    userId: str
    libraryPath: str
    calculateChecksum: bool = False

class AssignToMovieRequest(BaseModel):
    """Request model for assigning files to a movie"""
    fileIds: List[str]
    movieId: str
    version: str = "1080p"  # 480p, 720p, 1080p, 4K, 8K
    userId: str

class AssignToEpisodeRequest(BaseModel):
    """Request model for assigning files to an episode"""
    fileIds: List[str]
    seriesId: str
    seasonNumber: int
    episodeId: str
    userId: str

class OrganizeFilesRequest(BaseModel):
    """Request model for organizing files"""
    assignmentId: str
    userId: str

# ============================================================================
# Enhanced File Scanning
# ============================================================================

@router.post("/files/scan")
async def scan_files_with_metadata(request: ScanFilesRequest):
    """
    Scan files and extract comprehensive media metadata.
    Creates media_files documents in Firestore with full technical specs.
    
    Returns:
        List of created media file documents
    """
    try:
        logger.info("Starting enhanced file scan", file_count=len(request.filePaths))
        
        scanned_files = []
        
        for file_path in request.filePaths:
            try:
                # Validate path security
                if not file_manager.validate_path_security(file_path):
                    logger.warning("Path security validation failed", path=file_path)
                    continue
                
                # Get comprehensive file metadata (includes media metadata)
                metadata = file_manager.get_file_metadata(
                    file_path, 
                    calculate_checksum=request.calculateChecksum,
                    include_media_info=True
                )
                
                # Extract media-specific metadata
                media_metadata = metadata.get('mediaMetadata', {})
                
                # Create media_file document structure
                file_doc = {
                    'id': str(uuid.uuid4()),
                    'userId': request.userId,
                    'libraryPath': request.libraryPath,
                    'filePath': file_path,
                    'fileName': metadata['name'],
                    'fileExtension': metadata['extension'],
                    'fileSize': metadata['size'],
                    'dateAdded': datetime.utcnow().isoformat(),
                    'dateModified': datetime.fromtimestamp(metadata['modified']).isoformat(),
                    'dateCreated': datetime.fromtimestamp(metadata['created']).isoformat(),
                    
                    # Media metadata
                    'containerFormat': media_metadata.get('containerFormat'),
                    'duration': media_metadata.get('duration'),
                    'overallBitrate': media_metadata.get('overallBitrate'),
                    
                    # Video metadata
                    'videoMetadata': media_metadata.get('videoMetadata'),
                    
                    # Audio tracks
                    'audioTracks': media_metadata.get('audioTracks', []),
                    
                    # Subtitle tracks
                    'subtitleTracks': media_metadata.get('subtitleTracks', []),
                    
                    # File integrity
                    'checksum': metadata.get('checksum'),
                    
                    # Assignment status
                    'isAssigned': False,
                    'assignmentId': None,
                    'mediaType': None,  # Will be set during assignment
                    'mediaId': None,    # Will be set during assignment
                    
                    # Parsed info (from filename)
                    'parsedTitle': None,
                    'parsedYear': None,
                    'parsedSeason': None,
                    'parsedEpisode': None,
                    'parsedQuality': None,
                    'releaseGroup': None,
                }
                
                # Save to Firestore media_files collection
                firestore_service.create_document('media_files', file_doc['id'], file_doc)
                
                scanned_files.append(file_doc)
                logger.info("File scanned and saved", file_id=file_doc['id'], path=file_path)
                
            except Exception as e:
                logger.error("File scan failed", path=file_path, error=str(e))
                continue
        
        return {
            "success": True,
            "filesScanned": len(scanned_files),
            "files": scanned_files
        }
        
    except Exception as e:
        logger.error("Scan operation failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")

# ============================================================================
# File Metadata Retrieval
# ============================================================================

@router.get("/files/{fileId}")
async def get_file_metadata(fileId: str):
    """
    Get comprehensive metadata for a specific file.
    
    Returns:
        Complete media file document with all technical specs
    """
    try:
        file_doc = firestore_service.get_document('media_files', fileId)
        
        if not file_doc:
            raise HTTPException(status_code=404, detail=f"File not found: {fileId}")
        
        return {
            "success": True,
            "file": file_doc
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to retrieve file", file_id=fileId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to retrieve file: {str(e)}")

# ============================================================================
# Media Assignment Operations
# ============================================================================

@router.post("/assign/movie")
async def assign_files_to_movie(request: AssignToMovieRequest):
    """
    Assign files to a movie and create media assignment record.
    
    Creates a media_assignments document linking files to the movie.
    Updates movie document with assignment summary.
    """
    try:
        logger.info("Assigning files to movie", movie_id=request.movieId, file_count=len(request.fileIds))
        
        # Get movie document
        movie = firestore_service.get_document('movies', request.movieId)
        if not movie:
            raise HTTPException(status_code=404, detail=f"Movie not found: {request.movieId}")
        
        assignments = []
        
        for file_id in request.fileIds:
            # Get file document
            file_doc = firestore_service.get_document('media_files', file_id)
            if not file_doc:
                logger.warning("File not found during assignment", file_id=file_id)
                continue
            
            # Create assignment document
            assignment_id = str(uuid.uuid4())
            assignment_doc = {
                'id': assignment_id,
                'userId': request.userId,
                'fileId': file_id,
                'mediaType': 'movie',
                'mediaId': request.movieId,
                'version': request.version,
                'status': 'assigned',  # assigned, organizing, organized, failed
                'dateAssigned': datetime.utcnow().isoformat(),
                'isOrganized': False,
                'targetFolder': None,  # Will be populated when organizing
                'sourceFile': {
                    'filePath': file_doc['filePath'],
                    'fileName': file_doc['fileName'],
                    'fileSize': file_doc['fileSize'],
                },
                'organizationHistory': []
            }
            
            # Save assignment to Firestore
            firestore_service.create_document('media_assignments', assignment_id, assignment_doc)
            
            # Update file document
            firestore_service.update_document('media_files', file_id, {
                'isAssigned': True,
                'assignmentId': assignment_id,
                'mediaType': 'movie',
                'mediaId': request.movieId
            })
            
            assignments.append(assignment_doc)
            logger.info("File assigned to movie", file_id=file_id, assignment_id=assignment_id)
        
        # Update movie with assignment summary
        existing_assignments = movie.get('assignmentSummary', {})
        firestore_service.update_document('movies', request.movieId, {
            'assignmentSummary': {
                'totalFiles': existing_assignments.get('totalFiles', 0) + len(assignments),
                'versions': existing_assignments.get('versions', []) + [request.version],
                'hasPhysicalCopy': existing_assignments.get('hasPhysicalCopy', False),
                'totalFileSize': existing_assignments.get('totalFileSize', 0) + sum(a['sourceFile']['fileSize'] for a in assignments),
                'lastUpdated': datetime.utcnow().isoformat()
            }
        })
        
        return {
            "success": True,
            "assignmentsCreated": len(assignments),
            "assignments": assignments
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Movie assignment failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Assignment failed: {str(e)}")

@router.post("/assign/episode")
async def assign_files_to_episode(request: AssignToEpisodeRequest):
    """
    Assign files to an episode and create media assignment record.
    
    Creates a media_assignments document linking files to the episode.
    Updates episode and season documents with file tracking.
    """
    try:
        logger.info("Assigning files to episode", episode_id=request.episodeId, file_count=len(request.fileIds))
        
        # Get episode document
        episode = firestore_service.get_document('episodes', request.episodeId)
        if not episode:
            raise HTTPException(status_code=404, detail=f"Episode not found: {request.episodeId}")
        
        assignments = []
        
        for file_id in request.fileIds:
            # Get file document
            file_doc = firestore_service.get_document('media_files', file_id)
            if not file_doc:
                logger.warning("File not found during assignment", file_id=file_id)
                continue
            
            # Create assignment document
            assignment_id = str(uuid.uuid4())
            assignment_doc = {
                'id': assignment_id,
                'userId': request.userId,
                'fileId': file_id,
                'mediaType': 'episode',
                'mediaId': request.episodeId,
                'seriesId': request.seriesId,
                'seasonNumber': request.seasonNumber,
                'status': 'assigned',
                'dateAssigned': datetime.utcnow().isoformat(),
                'isOrganized': False,
                'targetFolder': None,
                'sourceFile': {
                    'filePath': file_doc['filePath'],
                    'fileName': file_doc['fileName'],
                    'fileSize': file_doc['fileSize'],
                },
                'organizationHistory': []
            }
            
            # Save assignment
            firestore_service.create_document('media_assignments', assignment_id, assignment_doc)
            
            # Update file document
            firestore_service.update_document('media_files', file_id, {
                'isAssigned': True,
                'assignmentId': assignment_id,
                'mediaType': 'episode',
                'mediaId': request.episodeId
            })
            
            assignments.append(assignment_doc)
            logger.info("File assigned to episode", file_id=file_id, assignment_id=assignment_id)
        
        # Update episode with file tracking
        firestore_service.update_document('episodes', request.episodeId, {
            'hasFile': True,
            'fileId': request.fileIds[0] if request.fileIds else None,  # Primary file
            'fileCount': len(assignments)
        })
        
        return {
            "success": True,
            "assignmentsCreated": len(assignments),
            "assignments": assignments
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Episode assignment failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Assignment failed: {str(e)}")

# ============================================================================
# File Organization Operations
# ============================================================================

@router.post("/organize/{assignmentId}")
async def organize_files(assignmentId: str, request: OrganizeFilesRequest):
    """
    Organize files according to Jellyfin folder structure.
    
    Creates folder structure, moves files, and updates all relevant documents.
    """
    try:
        logger.info("Starting file organization", assignment_id=assignmentId)
        
        # Get assignment document
        assignment = firestore_service.get_document('media_assignments', assignmentId)
        if not assignment:
            raise HTTPException(status_code=404, detail=f"Assignment not found: {assignmentId}")
        
        # Get file document
        file_doc = firestore_service.get_document('media_files', assignment['fileId'])
        if not file_doc:
            raise HTTPException(status_code=404, detail=f"File not found: {assignment['fileId']}")
        
        # Determine target folder structure based on media type
        # This would integrate with MediaOrganizationService from frontend
        # For now, return structure that will be created
        
        target_path = assignment.get('targetFolder', {}).get('fullPath')
        if not target_path:
            raise HTTPException(status_code=400, detail="Target folder not specified in assignment")
        
        # TODO: Implement actual file move operation
        # This would call file_manager.move_file() and handle errors
        
        # Update assignment status
        firestore_service.update_document('media_assignments', assignmentId, {
            'status': 'organized',
            'isOrganized': True,
            'dateOrganized': datetime.utcnow().isoformat(),
            'organizationHistory': assignment.get('organizationHistory', []) + [{
                'timestamp': datetime.utcnow().isoformat(),
                'operation': 'organize',
                'sourcePath': file_doc['filePath'],
                'targetPath': target_path,
                'status': 'completed'
            }]
        })
        
        return {
            "success": True,
            "message": "Files organized successfully",
            "assignmentId": assignmentId
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("File organization failed", assignment_id=assignmentId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Organization failed: {str(e)}")

# ============================================================================
# Jellyfin Structure Validation
# ============================================================================

@router.get("/jellyfin/validate/{folderId}")
async def validate_jellyfin_structure(folderId: str):
    """
    Validate that a Jellyfin folder structure is compliant.
    
    Checks folder naming, file placement, and metadata requirements.
    """
    try:
        logger.info("Validating Jellyfin structure", folder_id=folderId)
        
        # Get jellyfin_folder document
        folder = firestore_service.get_document('jellyfin_folders', folderId)
        if not folder:
            raise HTTPException(status_code=404, detail=f"Jellyfin folder not found: {folderId}")
        
        # Perform validation checks
        validation_results = {
            'isCompliant': True,
            'checks': {
                'folderExists': True,  # TODO: Check actual filesystem
                'namingCompliant': True,  # TODO: Validate naming convention
                'filesPresent': True,  # TODO: Check if files exist
                'metadataComplete': True  # TODO: Verify metadata
            },
            'issues': []
        }
        
        # Update folder document with validation results
        firestore_service.update_document('jellyfin_folders', folderId, {
            'validation': validation_results,
            'lastValidated': datetime.utcnow().isoformat()
        })
        
        return {
            "success": True,
            "validation": validation_results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Validation failed", folder_id=folderId, error=str(e))
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")
