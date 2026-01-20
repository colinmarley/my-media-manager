"""
File Operations API Router

This module provides REST API endpoints for direct file system operations,
including file/folder manipulation, metadata retrieval, and batch operations.

Key Features:
    - Safe file operations with path validation
    - Permission checking before operations
    - Trash bin support for file deletion
    - Bulk operations for efficiency
    - File locking detection
    - Comprehensive error handling

Endpoints:
    POST /rename - Rename file preserving extension
    POST /move - Move files/folders with merge support
    POST /delete - Delete files with optional trash
    POST /create-folder - Create new directories
    POST /list - List directory contents
    POST /metadata - Get file metadata
    POST /exists - Check path existence
    POST /bulk-move - Move multiple files
    POST /verify - Verify multiple paths

Security:
    - Path traversal prevention
    - Allowed base path validation
    - Permission verification
    - File lock detection
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import time

from utils.exceptions import (
    PathSecurityError,
    InsufficientPermissionsError,
    FileOperationError
)
from utils.logging import logger

router = APIRouter()

# ============================================================================
# Request/Response Models
# ============================================================================

class RenameFileRequest(BaseModel):
    """
    Request model for renaming a file.
    
    Attributes:
        currentPath: Full path to the file to rename
        newName: New name for the file (extension preserved automatically)
    """
    currentPath: str
    newName: str

class MoveFileRequest(BaseModel):
    sourcePath: str
    destinationPath: str
    mergeContents: bool = False  # If True and destination exists, move contents instead of failing

class DeleteFileRequest(BaseModel):
    filePath: str
    useTrash: bool = True

class CreateFolderRequest(BaseModel):
    parentPath: str
    folderName: str

class ListDirectoryRequest(BaseModel):
    path: str

class FileMetadataRequest(BaseModel):
    filePath: str

class PathExistsRequest(BaseModel):
    path: str

class BulkMoveRequest(BaseModel):
    sourcePaths: List[str]
    destinationPath: str
    mergeContents: bool = False

class ApiResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str

@router.post("/rename")
async def rename_file(request: RenameFileRequest, req: Request):
    """Rename a file while preserving extension"""
    try:
        file_manager = req.app.state.file_manager
        result = file_manager.rename_file(request.currentPath, request.newName)
        
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
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })
    except Exception as e:
        logger.error("Unexpected error in rename_file", error=str(e))
        raise HTTPException(status_code=500, detail={
            "type": "InternalServerError",
            "message": "An unexpected error occurred",
            "code": "INTERNAL_ERROR"
        })

@router.post("/move")
async def move_file(request: MoveFileRequest, req: Request):
    """Move a file to a new location"""
    try:
        file_manager = req.app.state.file_manager
        result = file_manager.move_file(
            request.sourcePath, 
            request.destinationPath, 
            request.mergeContents
        )
        
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
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/delete")
async def delete_file(request: DeleteFileRequest, req: Request):
    """Delete a file safely"""
    try:
        file_manager = req.app.state.file_manager
        result = file_manager.delete_file(request.filePath, request.useTrash)
        
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
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/metadata")
async def get_file_metadata(request: FileMetadataRequest, req: Request):
    """Get file metadata including size, dates, etc."""
    try:
        file_manager = req.app.state.file_manager
        metadata = file_manager.get_file_metadata(request.filePath)
        
        return ApiResponse(
            success=True,
            data=metadata,
            timestamp=str(int(time.time()))
        )
        
    except PathSecurityError as e:
        raise HTTPException(status_code=403, detail={
            "type": "PathSecurityError",
            "message": str(e),
            "code": "INVALID_PATH"
        })
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

# Folder operations
@router.post("/folders/rename")
async def rename_folder(request: RenameFileRequest, req: Request):
    """Rename a folder"""
    # Reuse the rename_file logic for folders
    return await rename_file(request, req)

@router.post("/folders/move")
async def move_folder(request: MoveFileRequest, req: Request):
    """Move a folder to new location"""
    try:
        file_manager = req.app.state.file_manager
        result = file_manager.move_file(
            request.sourcePath, 
            request.destinationPath, 
            request.mergeContents
        )
        
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
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/folders/create")
async def create_folder(request: CreateFolderRequest, req: Request):
    """Create a new folder"""
    import os
    import time
    
    try:
        file_manager = req.app.state.file_manager
        
        # Validate security
        full_path = os.path.join(request.parentPath, request.folderName)
        if not file_manager.validate_path_security(full_path):
            raise PathSecurityError(f"Path not allowed: {full_path}")
        
        # Create folder
        os.makedirs(full_path, exist_ok=True)
        
        result = {
            "folderPath": full_path,
            "operation": "create_folder"
        }
        
        return ApiResponse(
            success=True,
            data=result,
            timestamp=str(int(time.time()))
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/folders/list")
async def list_directory(request: ListDirectoryRequest, req: Request):
    """List directory contents"""
    import time
    
    try:
        file_manager = req.app.state.file_manager
        items = file_manager.list_directory(request.path)
        
        return ApiResponse(
            success=True,
            data={"items": items},
            timestamp=str(int(time.time()))
        )
        
    except PathSecurityError as e:
        raise HTTPException(status_code=403, detail={
            "type": "PathSecurityError",
            "message": str(e),
            "code": "INVALID_PATH"
        })
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/bulk/move")
async def bulk_move(request: BulkMoveRequest, req: Request):
    """Move multiple files/folders to a destination"""
    try:
        file_manager = req.app.state.file_manager
        result = file_manager.bulk_move(
            request.sourcePaths, 
            request.destinationPath, 
            request.mergeContents
        )
        
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
    except FileOperationError as e:
        raise HTTPException(status_code=400, detail={
            "type": "FileOperationError",
            "message": str(e),
            "code": "OPERATION_FAILED"
        })

@router.post("/path/exists")
async def path_exists(request: PathExistsRequest, req: Request):
    """Check if a path exists"""
    import os
    import time
    
    try:
        file_manager = req.app.state.file_manager
        
        # Validate security
        if not file_manager.validate_path_security(request.path):
            raise PathSecurityError(f"Path not allowed: {request.path}")
        
        exists = os.path.exists(request.path)
        is_directory = os.path.isdir(request.path) if exists else None
        
        result = {
            "exists": exists,
            "isDirectory": is_directory
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