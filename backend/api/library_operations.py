"""
Library Operations API Router

This module provides REST API endpoints for library scanning operations,
including starting scans, monitoring progress, and retrieving scan results.

Key Features:
    - Asynchronous library scanning with real-time progress tracking
    - Duplicate detection with composite key strategy (libraryPath:path)
    - Offline and online duplicate checking modes
    - Configurable metadata extraction
    - Scan lifecycle management (start, stop, cleanup)
    - Batch file verification

Endpoints:
    POST /scan - Start a new library scan
    GET /scan/status/{scanId} - Get scan progress and results
    POST /scan/stop - Stop a running scan
    GET /scans/active - List all active scans
    POST /scans/cleanup - Cleanup old scan data
    POST /files - Get scanned files with filtering
    POST /directories - Get scanned directories with filtering
    POST /verify-files - Verify existence of multiple files
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import time

from utils.exceptions import ScanOperationError, PathSecurityError
from utils.logging import logger

router = APIRouter()

# ============================================================================
# Request/Response Models
# ============================================================================

class StartScanRequest(BaseModel):
    """
    Request model for initiating a library scan.
    
    Attributes:
        libraryPath: Root directory path to scan
        userId: User identifier for duplicate detection context
        extractMetadata: If True, extract detailed FFmpeg metadata (slower)
        checkDuplicates: If True, perform duplicate detection and generate difference report
        existingFiles: List of existing file records from frontend (for offline duplicate checking)
        existingDirectories: List of existing directory records from frontend (for offline duplicate checking)
        
    Note:
        When existingFiles/existingDirectories are provided, the system performs
        offline duplicate detection. Otherwise, it queries Firestore (if available).
    """
    libraryPath: str
    userId: Optional[str] = None
    extractMetadata: Optional[bool] = False
    checkDuplicates: Optional[bool] = False
    existingFiles: Optional[List[Dict[str, Any]]] = None
    existingDirectories: Optional[List[Dict[str, Any]]] = None

class ScanStatusRequest(BaseModel):
    """Request model for retrieving scan status."""
    scanId: str

class StopScanRequest(BaseModel):
    """Request model for stopping a running scan."""
    scanId: str

class VerifyFilesRequest(BaseModel):
    """Request model for verifying multiple file paths exist."""
    filePaths: List[str]

class GetScannedFilesRequest(BaseModel):
    """
    Request model for retrieving scanned files with optional filtering.
    
    Attributes:
        scanId: Filter by specific scan ID
        libraryPath: Filter by library path
        limit: Maximum number of results to return
        offset: Number of results to skip (for pagination)
    """
    scanId: Optional[str] = None
    libraryPath: Optional[str] = None
    limit: Optional[int] = 100
    offset: Optional[int] = 0

class GetScannedDirectoriesRequest(BaseModel):
    """
    Request model for retrieving scanned directories with optional filtering.
    
    Attributes:
        scanId: Filter by specific scan ID
        libraryPath: Filter by library path
        limit: Maximum number of results to return
        offset: Number of results to skip (for pagination)
    """
    scanId: Optional[str] = None
    libraryPath: Optional[str] = None
    limit: Optional[int] = 100
    offset: Optional[int] = 0

class ApiResponse(BaseModel):
    """
    Standardized API response model for all endpoints.
    
    Attributes:
        success: Whether the operation succeeded
        data: Response payload (null on error)
        error: Error details (null on success)
        timestamp: Unix timestamp of response
    """
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str

# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/scan")
async def start_library_scan(request: StartScanRequest, req: Request):
    """
    Start a new library scan operation.
    
    This endpoint initiates an asynchronous scan of the specified library path.
    The scan runs in the background and its progress can be monitored via the
    status endpoint.
    
    Features:
        - Asynchronous execution (non-blocking)
        - Optional metadata extraction
        - Duplicate detection with composite key strategy
        - Supports both online (Firestore) and offline (provided data) duplicate checking
        
    Duplicate Detection Strategy:
        Uses composite keys in format: "{libraryPath}:{path}"
        This ensures files with the same path in different libraries are
        treated as separate entities, preventing false duplicate detection.
        
    Args:
        request: StartScanRequest containing scan configuration
        req: FastAPI Request object for accessing app state
        
    Returns:
        ApiResponse with scanId and initial status
        
    Raises:
        HTTPException 403: Invalid or unauthorized path
        HTTPException 400: Scan operation failed (e.g., max concurrent scans reached)
        HTTPException 500: Unexpected internal error
        
    Example Request:
        {
            "libraryPath": "/media/movies",
            "userId": "user123",
            "extractMetadata": true,
            "checkDuplicates": true,
            "existingFiles": [...],
            "existingDirectories": [...]
        }
        
    Example Response:
        {
            "success": true,
            "data": {
                "scanId": "abc-123-def",
                "libraryPath": "/media/movies",
                "status": "started"
            },
            "timestamp": "1702304400"
        }
    """
    try:
        library_scanner = req.app.state.library_scanner
        
        # Start the scan
        scan_id = await library_scanner.start_scan(
            library_path=request.libraryPath,
            extract_metadata=request.extractMetadata,
            check_duplicates=request.checkDuplicates,
            user_id=request.userId,
            existing_files=request.existingFiles,
            existing_directories=request.existingDirectories
        )
        
        result = {
            "scanId": scan_id,
            "libraryPath": request.libraryPath,
            "status": "started"
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
    except ScanOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "ScanOperationError",
            "message": str(e),
            "code": "SCAN_FAILED"
        })
    except Exception as e:
        logger.error("Unexpected error starting scan", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to start scan",
            "code": "INTERNAL_ERROR"
        })

@router.get("/scan/status/{scan_id}")
async def get_scan_status(scan_id: str, req: Request):
    """
    Get current status and progress of a running or completed scan.
    
    This endpoint provides real-time progress tracking for library scans,
    including item counts, scan results, duplicate reports, and error information.
    
    Status Values:
        - "pending": Scan queued but not started
        - "scanning": Currently scanning directories
        - "completed": Scan finished successfully
        - "failed": Scan encountered fatal error
        - "stopped": Scan manually cancelled
        
    Progress Information:
        - total_items: Total files/directories to process
        - processed_items: Items processed so far
        - files_found: Number of files discovered
        - directories_found: Number of directories discovered
        - elapsed_time: Seconds since scan started
        
    Args:
        scan_id: Unique identifier for the scan operation
        req: FastAPI Request object for accessing app state
        
    Returns:
        ApiResponse containing comprehensive scan status information
        
    Raises:
        HTTPException 404: Scan ID not found
        HTTPException 500: Error retrieving scan status
        
    Example Response:
        {
            "success": true,
            "data": {
                "scanId": "abc-123",
                "status": "scanning",
                "progress": 45.5,
                "totalItems": 1000,
                "processedItems": 455,
                "filesFound": 380,
                "directoriesFound": 75,
                "duplicateReport": {...},
                "errors": []
            },
            "timestamp": "1702304400"
        }
    """
    try:
        library_scanner = req.app.state.library_scanner
        status = library_scanner.get_scan_status(scan_id)
        
        if status is None:
            raise HTTPException(status_code=404, detail={
                "type": "NotFoundError",
                "message": f"Scan not found: {scan_id}",
                "code": "SCAN_NOT_FOUND"
            })
        
        return ApiResponse(
            success=True,
            data=status,
            timestamp=str(int(time.time()))
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting scan status", scan_id=scan_id, error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to get scan status",
            "code": "INTERNAL_ERROR"
        })

@router.get("/scan/results/{scan_id}")
async def get_scan_results(scan_id: str, req: Request):
    """Get scan results for a completed scan"""
    try:
        library_scanner = req.app.state.library_scanner
        results = library_scanner.get_scan_results(scan_id)
        
        if results is None:
            raise HTTPException(status_code=404, detail={
                "type": "NotFoundError", 
                "message": f"Scan results not found: {scan_id}",
                "code": "SCAN_RESULTS_NOT_FOUND"
            })
        
        # Separate files and directories
        files = [r for r in results if r.get('type') == 'file']
        directories = [r for r in results if r.get('type') == 'directory']
        
        return ApiResponse(
            success=True,
            data={
                "scanId": scan_id,
                "files": files,
                "directories": directories,
                "totalFiles": len(files),
                "totalDirectories": len(directories)
            },
            timestamp=str(int(time.time()))
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting scan results", scan_id=scan_id, error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to get scan results", 
            "code": "INTERNAL_ERROR"
        })

@router.post("/scan/stop")
async def stop_scan(request: StopScanRequest, req: Request):
    """Stop a running scan operation"""
    try:
        library_scanner = req.app.state.library_scanner
        success = library_scanner.stop_scan(request.scanId)
        
        if not success:
            raise HTTPException(status_code=404, detail={
                "type": "NotFoundError",
                "message": f"Scan not found or not running: {request.scanId}",
                "code": "SCAN_NOT_FOUND"
            })
        
        result = {
            "scanId": request.scanId,
            "status": "stopped"
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error stopping scan", scan_id=request.scanId, error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to stop scan",
            "code": "INTERNAL_ERROR"
        })

@router.get("/scans")
async def list_scans(status_filter: Optional[str] = None, req: Request = None):
    """List all scans, optionally filtered by status"""
    try:
        library_scanner = req.app.state.library_scanner
        
        # Get all scans
        all_scans = []
        for scan_id, progress in library_scanner.running_scans.items():
            if status_filter is None or progress.status == status_filter:
                scan_data = library_scanner.get_scan_status(scan_id)
                if scan_data:
                    all_scans.append(scan_data)
        
        return ApiResponse(
            success=True,
            data={"scans": all_scans},
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error listing scans", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to list scans",
            "code": "INTERNAL_ERROR"
        })

@router.post("/verify")
async def verify_files(request: VerifyFilesRequest, req: Request):
    """Verify that files still exist and are accessible"""
    try:
        file_manager = req.app.state.file_manager
        
        verification_results = []
        for file_path in request.filePaths:
            try:
                # Check if file exists and get metadata
                if file_manager.validate_path_security(file_path):
                    metadata = file_manager.get_file_metadata(file_path)
                    verification_results.append({
                        "path": file_path,
                        "exists": True,
                        "accessible": True,
                        "metadata": metadata
                    })
                else:
                    verification_results.append({
                        "path": file_path,
                        "exists": False,
                        "accessible": False,
                        "error": "Path not allowed"
                    })
            except Exception as e:
                verification_results.append({
                    "path": file_path,
                    "exists": False,
                    "accessible": False,
                    "error": str(e)
                })
        
        result = {
            "verificationResults": verification_results,
            "summary": {
                "total": len(request.filePaths),
                "accessible": len([r for r in verification_results if r.get("accessible")]),
                "missing": len([r for r in verification_results if not r.get("exists")])
            }
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error verifying files", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to verify files",
            "code": "INTERNAL_ERROR"
        })

@router.delete("/scan/cleanup/{scan_id}")
async def cleanup_scan(scan_id: str, req: Request):
    """Clean up completed scan data from memory"""
    try:
        library_scanner = req.app.state.library_scanner
        
        if scan_id in library_scanner.running_scans:
            del library_scanner.running_scans[scan_id]
            
        if scan_id in library_scanner.scan_callbacks:
            del library_scanner.scan_callbacks[scan_id]
            
        return ApiResponse(
            success=True,
            data={"message": f"Scan {scan_id} cleaned up successfully"},
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error cleaning up scan", scan_id=scan_id, error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to cleanup scan",
            "code": "INTERNAL_ERROR"
        })

@router.delete("/scans/cleanup")
async def cleanup_old_scans(max_age_hours: int = 24, req: Request = None):
    """Cleanup old completed scans"""
    try:
        library_scanner = req.app.state.library_scanner
        library_scanner.cleanup_completed_scans(max_age_hours)
        
        return ApiResponse(
            success=True,
            data={"message": "Cleanup completed"},
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error during cleanup", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Cleanup failed",
            "code": "INTERNAL_ERROR"
        })

@router.post("/scanned-files")
async def get_scanned_files(request: GetScannedFilesRequest, req: Request):
    """Get scanned media files from database"""
    try:
        library_scanner = req.app.state.library_scanner
        
        files = await library_scanner.firestore_service.get_scanned_files(
            scan_id=request.scanId,
            library_path=request.libraryPath,
            limit=request.limit,
            offset=request.offset
        )
        
        result = {
            "files": files,
            "count": len(files),
            "offset": request.offset,
            "limit": request.limit
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error getting scanned files", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError", 
            "message": "Failed to get scanned files",
            "code": "INTERNAL_ERROR"
        })

@router.post("/scanned-directories")
async def get_scanned_directories(request: GetScannedDirectoriesRequest, req: Request):
    """Get scanned media directories from database"""
    try:
        library_scanner = req.app.state.library_scanner
        
        directories = await library_scanner.firestore_service.get_scanned_directories(
            scan_id=request.scanId,
            library_path=request.libraryPath,
            limit=request.limit,
            offset=request.offset
        )
        
        result = {
            "directories": directories,
            "count": len(directories),
            "offset": request.offset,
            "limit": request.limit
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        logger.error("Error getting scanned directories", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "Failed to get scanned directories", 
            "code": "INTERNAL_ERROR"
        })