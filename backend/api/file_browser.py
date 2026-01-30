"""
File Browser API Endpoints
Provides file system browsing capabilities for the frontend
"""

import os
import platform
from typing import List, Dict
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/files", tags=["files"])


class BrowseRequest(BaseModel):
    path: str


class DirectoryEntry(BaseModel):
    name: str
    path: str
    isDirectory: bool
    size: int = 0


@router.get("/roots")
async def get_drive_roots():
    """Get available drive roots based on operating system"""
    try:
        roots = []
        system = platform.system()
        
        if system == "Windows":
            # Get all available drives on Windows
            import string
            from ctypes import windll
            
            drives = []
            bitmask = windll.kernel32.GetLogicalDrives()
            for letter in string.ascii_uppercase:
                if bitmask & 1:
                    drive_path = f"{letter}:\\"
                    if os.path.exists(drive_path):
                        drives.append(DirectoryEntry(
                            name=f"{letter}: Drive",
                            path=drive_path,
                            isDirectory=True,
                            size=0
                        ))
                bitmask >>= 1
            roots = drives
            
        else:
            # Unix-like systems start from root
            roots = [DirectoryEntry(
                name="Root",
                path="/",
                isDirectory=True,
                size=0
            )]
            
            # Add common locations
            home = os.path.expanduser("~")
            if os.path.exists(home):
                roots.append(DirectoryEntry(
                    name="Home",
                    path=home,
                    isDirectory=True,
                    size=0
                ))
        
        return {
            "success": True,
            "data": [root.dict() for root in roots]
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/browse")
async def browse_directory(request: BrowseRequest):
    """Browse directories at the given path"""
    try:
        path = request.path
        
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="Path does not exist")
        
        if not os.path.isdir(path):
            raise HTTPException(status_code=400, detail="Path is not a directory")
        
        entries = []
        
        try:
            # List directory contents
            for entry_name in os.listdir(path):
                try:
                    entry_path = os.path.join(path, entry_name)
                    
                    # Skip if we can't access it
                    if not os.path.exists(entry_path):
                        continue
                    
                    is_dir = os.path.isdir(entry_path)
                    
                    # Only include directories for folder browsing
                    if is_dir:
                        size = 0
                        try:
                            size = os.path.getsize(entry_path)
                        except:
                            pass
                        
                        entries.append(DirectoryEntry(
                            name=entry_name,
                            path=entry_path,
                            isDirectory=True,
                            size=size
                        ))
                        
                except (PermissionError, OSError):
                    # Skip entries we can't access
                    continue
        
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied")
        
        # Sort directories alphabetically
        entries.sort(key=lambda x: x.name.lower())
        
        return {
            "success": True,
            "data": [entry.dict() for entry in entries]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
