"""
Metadata Operations API Router

This module provides REST API endpoints for media file metadata extraction
using FFmpeg/FFprobe. Supports video, audio, and subtitle stream analysis.

Key Features:
    - FFprobe-based metadata extraction
    - Video stream information (codec, resolution, bitrate, fps)
    - Audio stream detection (codec, channels, sample rate)
    - Subtitle track enumeration
    - Thumbnail generation at specified timestamps
    - Batch processing support
    - Format validation

Endpoints:
    POST /extract - Extract comprehensive media metadata
    POST /batch-extract - Extract metadata from multiple files
    POST /thumbnail - Generate video thumbnail
    POST /batch-thumbnails - Generate multiple thumbnails
    GET /supported-formats - List supported file formats

Technical Details:
    - Uses FFprobe for metadata parsing
    - Configurable extraction timeout
    - Handles various container formats (MP4, MKV, AVI, etc.)
    - Extracts chapter information when available
    - Provides detailed stream information
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import time

from utils.exceptions import MetadataExtractionError, PathSecurityError
from utils.logging import logger

router = APIRouter()

# ============================================================================
# Request/Response Models
# ============================================================================

class ExtractMetadataRequest(BaseModel):
    """
    Request model for extracting media file metadata.
    
    Attributes:
        filePath: Full path to the media file
        extractThumbnail: If True, generate a thumbnail image
        thumbnailTimestamp: Timestamp in seconds for thumbnail capture
    """
    filePath: str
    extractThumbnail: bool = False
    thumbnailTimestamp: float = 10.0

class BatchExtractRequest(BaseModel):
    filePaths: List[str]
    extractThumbnails: bool = False

class ApiResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str

@router.post("/extract")
async def extract_metadata(request: ExtractMetadataRequest, req: Request):
    """Extract metadata from a media file"""
    try:
        file_manager = req.app.state.file_manager
        metadata_extractor = req.app.state.metadata_extractor
        
        # Validate path security
        if not file_manager.validate_path_security(request.filePath):
            raise PathSecurityError(f"Path not allowed: {request.filePath}")
        
        # Get basic file metadata
        file_metadata = file_manager.get_file_metadata(request.filePath)
        
        # Extract media-specific metadata
        media_metadata = None
        thumbnail_path = None
        
        try:
            media_metadata = metadata_extractor.extract_video_metadata(request.filePath)
            
            # Generate thumbnail if requested
            if request.extractThumbnail:
                thumbnail_path = metadata_extractor.get_video_thumbnail(
                    request.filePath,
                    request.thumbnailTimestamp
                )
        except Exception as e:
            logger.warning("Media metadata extraction failed", 
                          path=request.filePath, error=str(e))
        
        result = {
            "filePath": request.filePath,
            "fileMetadata": file_metadata,
            "mediaMetadata": media_metadata,
            "thumbnailPath": thumbnail_path
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except PathSecurityError as e:
        raise HTTPException(status_code=403, detail={
            "type": "PathSecurityError",
            "message": str(e),
            "code": "INVALID_PATH"
        })
    except MetadataExtractionError as e:
        raise HTTPException(status_code=400, detail={
            "type": "MetadataExtractionError",
            "message": str(e),
            "code": "EXTRACTION_FAILED"
        })
    except Exception as e:
        logger.error("Unexpected error extracting metadata", 
                    path=request.filePath, error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Metadata extraction failed",
            "code": "INTERNAL_ERROR"
        })

@router.post("/batch")
async def batch_extract_metadata(request: BatchExtractRequest, req: Request):
    """Extract metadata from multiple files"""
    try:
        file_manager = req.app.state.file_manager
        metadata_extractor = req.app.state.metadata_extractor
        
        results = []
        for file_path in request.filePaths:
            try:
                # Validate path security
                if not file_manager.validate_path_security(file_path):
                    results.append({
                        "filePath": file_path,
                        "success": False,
                        "error": "Path not allowed"
                    })
                    continue
                
                # Get basic file metadata
                file_metadata = file_manager.get_file_metadata(file_path)
                
                # Extract media metadata
                media_metadata = None
                thumbnail_path = None
                
                try:
                    media_metadata = metadata_extractor.extract_video_metadata(file_path)
                    
                    if request.extractThumbnails:
                        thumbnail_path = metadata_extractor.get_video_thumbnail(file_path)
                except Exception:
                    pass  # Continue even if media extraction fails
                
                results.append({
                    "filePath": file_path,
                    "success": True,
                    "fileMetadata": file_metadata,
                    "mediaMetadata": media_metadata,
                    "thumbnailPath": thumbnail_path
                })
                
            except Exception as e:
                results.append({
                    "filePath": file_path,
                    "success": False,
                    "error": str(e)
                })
        
        # Summary statistics
        summary = {
            "total": len(request.filePaths),
            "successful": len([r for r in results if r.get("success")]),
            "failed": len([r for r in results if not r.get("success")])
        }
        
        result = {
            "results": results,
            "summary": summary
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error in batch metadata extraction", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Batch extraction failed",
            "code": "INTERNAL_ERROR"
        })

@router.get("/formats")
async def get_supported_formats(req: Request):
    """Get list of supported media file formats"""
    try:
        from config.settings import settings
        
        result = {
            "videoFormats": settings.supported_video_extensions,
            "audioFormats": settings.supported_audio_extensions,
            "subtitleFormats": settings.supported_subtitle_extensions,
            "allFormats": (
                settings.supported_video_extensions +
                settings.supported_audio_extensions +
                settings.supported_subtitle_extensions
            )
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error getting supported formats", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to get formats",
            "code": "INTERNAL_ERROR"
        })