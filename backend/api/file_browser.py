"""
File Browser API Endpoints
Provides file system browsing capabilities for the frontend
"""

import os
import platform
import re
import shutil
import mimetypes
import xml.etree.ElementTree as ET
from typing import List, Dict, Optional
from xml.sax.saxutils import escape
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from config.settings import settings
from services.jellyfin_movie_organizer import JellyfinMovieOrganizer
from services.jellyfin_show_organizer import JellyfinShowOrganizer

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

            # Add common Linux mount locations to make external drives easier to discover.
            shortcuts = [
                ("Home", os.path.expanduser("~")),
                ("ARK", "/ark"),
                ("Media", "/media"),
                ("Run Media", "/run/media"),
                ("MNT", "/mnt"),
            ]
            for name, path in shortcuts:
                if os.path.exists(path):
                    roots.append(DirectoryEntry(
                        name=name,
                        path=path,
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


@router.get("/dest-folder")
async def get_dest_folder_info():
    """Return the configured media destination base path and category folder names."""
    dest = settings.jellyfin_dest_base
    exists = os.path.exists(dest)
    return {
        "success": True,
        "data": {
            "destBase": dest,
            "exists": exists,
            "writable": os.access(dest, os.W_OK) if exists else False,
            "categoryFolders": {
                "movie": settings.folder_movies,
                "series": settings.folder_tv_shows,
                "documentary": settings.folder_documentaries,
                "live_performance": settings.folder_live_performances,
            },
        },
    }


class DestBrowseRequest(BaseModel):
    path: str


@router.post("/dest-folder/browse")
async def browse_dest_folder(request: DestBrowseRequest):
    """Browse the media destination folder returning both files and sub-directories.

    The requested path must be inside the configured jellyfin_dest_base.
    """
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    try:
        requested = os.path.realpath(request.path)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    # Security: restrict browsing to within dest_base
    if not requested.startswith(dest_base + os.sep) and requested != dest_base:
        raise HTTPException(status_code=403, detail="Path is outside the media destination folder")

    if not os.path.exists(requested):
        raise HTTPException(status_code=404, detail="Path does not exist")

    if not os.path.isdir(requested):
        raise HTTPException(status_code=400, detail="Path is not a directory")

    entries = []
    try:
        for entry_name in sorted(os.listdir(requested), key=str.lower):
            try:
                entry_path = os.path.join(requested, entry_name)
                if not os.path.exists(entry_path):
                    continue
                is_dir = os.path.isdir(entry_path)
                size = 0
                try:
                    size = os.path.getsize(entry_path)
                except OSError:
                    pass
                entries.append({
                    "name": entry_name,
                    "path": entry_path,
                    "isDirectory": is_dir,
                    "size": size,
                })
            except (PermissionError, OSError):
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {
        "success": True,
        "data": entries,
    }


@router.get("/dest-folder/stream")
async def stream_dest_file(path: str, range_header: Optional[str] = Header(default=None, alias="Range")):
    """Stream a file under jellyfin_dest_base with HTTP range support for video seeking."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    try:
        requested = os.path.realpath(path)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    # Security: restrict access to files inside the destination root.
    if not requested.startswith(dest_base + os.sep) and requested != dest_base:
        raise HTTPException(status_code=403, detail="Path is outside the media destination folder")

    if not os.path.exists(requested):
        raise HTTPException(status_code=404, detail="File does not exist")

    if not os.path.isfile(requested):
        raise HTTPException(status_code=400, detail="Path is not a file")

    file_size = os.path.getsize(requested)
    if file_size <= 0:
        raise HTTPException(status_code=404, detail="File is empty")

    content_type = mimetypes.guess_type(requested)[0] or "application/octet-stream"
    chunk_size = 1024 * 1024

    def iter_file(start: int, end: int):
        with open(requested, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                read_size = min(chunk_size, remaining)
                data = f.read(read_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Accept-Ranges": "bytes",
    }

    if range_header:
        # Expected format: bytes=start-end
        m = re.match(r"bytes=(\d*)-(\d*)", range_header.strip())
        if not m:
            raise HTTPException(status_code=416, detail="Invalid range header")

        start_str, end_str = m.groups()
        if not start_str and not end_str:
            raise HTTPException(status_code=416, detail="Invalid range values")

        if start_str:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
        else:
            # Suffix range: bytes=-N
            suffix_len = int(end_str)
            if suffix_len <= 0:
                raise HTTPException(status_code=416, detail="Invalid suffix range")
            start = max(file_size - suffix_len, 0)
            end = file_size - 1

        if start >= file_size:
            raise HTTPException(status_code=416, detail="Range start is beyond file size")

        end = min(end, file_size - 1)
        if end < start:
            raise HTTPException(status_code=416, detail="Invalid range order")

        length = end - start + 1
        headers.update({
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        })

        return StreamingResponse(
            iter_file(start, end),
            status_code=206,
            media_type=content_type,
            headers=headers,
        )

    headers["Content-Length"] = str(file_size)
    return StreamingResponse(
        iter_file(0, file_size - 1),
        status_code=200,
        media_type=content_type,
        headers=headers,
    )


class NfoRequest(BaseModel):
    folderPath: str


@router.post("/dest-folder/nfo")
async def read_nfo_from_folder(request: NfoRequest):
    """Read and parse a Jellyfin .nfo file from the given media folder.

    The folder must be inside the configured jellyfin_dest_base.
    Returns the NFO contents as a JSON object, or null if no .nfo is found.
    """
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    try:
        requested = os.path.realpath(request.folderPath)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not requested.startswith(dest_base + os.sep) and requested != dest_base:
        raise HTTPException(status_code=403, detail="Path is outside the media destination folder")

    if not os.path.isdir(requested):
        raise HTTPException(status_code=404, detail="Folder does not exist")

    # Find the first .nfo file in the folder
    nfo_path = None
    try:
        for name in os.listdir(requested):
            if name.lower().endswith(".nfo"):
                nfo_path = os.path.join(requested, name)
                break
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    if not nfo_path:
        return {"success": True, "data": None}

    try:
        tree = ET.parse(nfo_path)
        root = tree.getroot()

        def elem_to_dict(el: ET.Element) -> dict:
            result: dict = {}
            for child in el:
                tag = child.tag
                if len(child):
                    val = elem_to_dict(child)
                else:
                    val = child.text or ""
                if tag in result:
                    existing = result[tag]
                    if isinstance(existing, list):
                        existing.append(val)
                    else:
                        result[tag] = [existing, val]
                else:
                    result[tag] = val
            # Include element attributes
            result.update(root.attrib if el is root else child.attrib if False else {})
            return result

        nfo_data = {root.tag: elem_to_dict(root)}
        return {"success": True, "data": nfo_data}
    except ET.ParseError as e:
        return {"success": True, "data": {"_parseError": str(e), "_raw": open(nfo_path).read(4096)}}


# ---------------------------------------------------------------------------
# Disk reassignment — rename folder/files and rewrite the NFO to match new media
# ---------------------------------------------------------------------------

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".flv", ".webm"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt", ".ass", ".ssa", ".sub", ".idx"}


def _sanitize_filename(name: str) -> str:
    invalid = '<>:"/\\|?*'
    for ch in invalid:
        name = name.replace(ch, "")
    return name.strip()


def _build_jellyfin_folder_name(title: str, year: Optional[str], imdb_id: Optional[str]) -> str:
    safe_title = _sanitize_filename(title)
    year_str = f" ({year})" if year else ""
    imdb_str = f" [imdbid-{imdb_id}]" if imdb_id else ""
    return f"{safe_title}{year_str}{imdb_str}"


def _normalize_year(year: Optional[str]) -> Optional[str]:
    if not year:
        return None

    match = re.search(r"(19|20)\d{2}", year)
    if match:
        return match.group(0)

    return None


def _normalize_imdb_id(imdb_id: Optional[str]) -> Optional[str]:
    if not imdb_id:
        return None
    imdb_id = imdb_id.strip()
    if re.fullmatch(r"tt\d+", imdb_id):
        return imdb_id
    return None


def _validate_reassign_outcome(
    *,
    target_dir: str,
    expected_folder_name: str,
    expected_imdb_id: str,
    expected_file_path: Optional[str] = None,
) -> List[str]:
    """Validate that folder/file names match expected Jellyfin naming with IMDb id."""
    errors: List[str] = []

    if os.path.basename(target_dir) != expected_folder_name:
        errors.append(
            f"Folder name mismatch: expected '{expected_folder_name}', got '{os.path.basename(target_dir)}'"
        )

    if f"[imdbid-{expected_imdb_id}]" not in os.path.basename(target_dir):
        errors.append("Folder name is missing required imdbid tag")

    if expected_file_path is not None:
        if not os.path.isfile(expected_file_path):
            errors.append(f"Expected target file not found: {expected_file_path}")
        else:
            stem = os.path.splitext(os.path.basename(expected_file_path))[0]
            if stem != expected_folder_name:
                errors.append(
                    f"File name mismatch: expected '{expected_folder_name}', got '{stem}'"
                )
    else:
        try:
            entries = os.listdir(target_dir)
        except OSError as exc:
            errors.append(f"Could not list target folder: {exc}")
            return errors

        found_any_media = False
        for entry in entries:
            ext_lower = os.path.splitext(entry)[1].lower()
            if ext_lower in VIDEO_EXTENSIONS or ext_lower in SUBTITLE_EXTENSIONS:
                found_any_media = True
                stem = os.path.splitext(entry)[0]
                if stem != expected_folder_name:
                    errors.append(
                        f"File name mismatch: expected stem '{expected_folder_name}', got '{stem}'"
                    )

        if not found_any_media:
            errors.append("No media/subtitle files found in reassigned folder")

    return errors


def _build_movie_nfo(title: str, year: Optional[str], imdb_id: Optional[str]) -> str:
    safe_title = escape(title)
    lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        "<movie>",
        f"  <title>{safe_title}</title>",
    ]
    if year:
        lines.append(f"  <year>{escape(str(year))}</year>")
    if imdb_id:
        sid = escape(imdb_id)
        lines.append(f"  <id>{sid}</id>")
        lines.append(f"  <imdbid>{sid}</imdbid>")
        lines.append(f'  <uniqueid type="imdb" default="true">{sid}</uniqueid>')
    lines.append("</movie>")
    return "\n".join(lines) + "\n"


def _build_episode_nfo(series_title: str, season_number: int, episode_number: int, episode_title: Optional[str]) -> str:
    safe_show_title = escape(series_title)
    safe_episode_title = escape(episode_title or f"{series_title} S{season_number:02d}E{episode_number:02d}")
    return "\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<episodedetails>',
        f'  <title>{safe_episode_title}</title>',
        f'  <showtitle>{safe_show_title}</showtitle>',
        f'  <season>{season_number}</season>',
        f'  <episode>{episode_number}</episode>',
        '</episodedetails>',
        '',
    ])


def _merge_dir_into(src_dir: str, dst_dir: str, ops: List[str]) -> None:
    """Recursively merge *src_dir* into *dst_dir*, then remove *src_dir*.

    Handles SMB/CIFS mounts where os.rename() on a non-empty directory fails
    with ENOTEMPTY instead of EXDEV, causing shutil.move() to raise rather than
    falling back to copy+delete.
    """
    os.makedirs(dst_dir, exist_ok=True)
    for entry in os.listdir(src_dir):
        src_entry = os.path.join(src_dir, entry)
        if os.path.isdir(src_entry):
            _merge_dir_into(src_entry, os.path.join(dst_dir, entry), ops)
        else:
            unique_dst = _ensure_unique_path(os.path.join(dst_dir, entry))
            shutil.move(src_entry, unique_dst)
            ops.append(f"Merged {entry} → {os.path.relpath(unique_dst, dst_dir)}")
    shutil.rmtree(src_dir)


def _ensure_unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path

    base, ext = os.path.splitext(path)
    suffix = 2
    while True:
        candidate = f"{base} ({suffix}){ext}"
        if not os.path.exists(candidate):
            return candidate
        suffix += 1


def _find_existing_imdb_folder(dest_base: str, category_sub: str, imdb_id: str) -> Optional[str]:
    parent_dir = os.path.join(dest_base, category_sub)
    if not os.path.isdir(parent_dir):
        return None

    imdb_tag = f"[imdbid-{imdb_id}]"
    candidates: List[tuple[int, int, str]] = []

    for entry in os.listdir(parent_dir):
        entry_path = os.path.join(parent_dir, entry)
        if not os.path.isdir(entry_path) or imdb_tag not in entry:
            continue

        has_year = 1 if re.search(r"\((19|20)\d{2}\)\s*\[imdbid-", entry) else 0
        has_nfo = 1 if os.path.exists(os.path.join(entry_path, "movie.nfo")) else 0
        candidates.append((has_year, has_nfo, entry_path))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    return candidates[0][2]


def _build_series_episode_filename(
    *,
    series_title: str,
    ext: str,
    season_number: Optional[int],
    episode_number: Optional[int],
    episode_end_number: Optional[int] = None,
    part_number: Optional[int] = None,
    episode_title: Optional[str] = None,
    keep_original_name: bool = False,
    original_name: Optional[str] = None,
) -> str:
    if keep_original_name or season_number is None or episode_number is None:
        return original_name or f"{_sanitize_filename(series_title)}{ext}"

    base_name = f"{_sanitize_filename(series_title)} S{int(season_number):02d}E{int(episode_number):02d}"
    if episode_end_number is not None and int(episode_end_number) > int(episode_number):
        base_name = f"{base_name}-E{int(episode_end_number):02d}"
    if part_number is not None and int(part_number) > 0:
        base_name = f"{base_name} Part {int(part_number)}"
    if episode_title:
        safe_episode_title = _sanitize_filename(episode_title)
        if safe_episode_title:
            base_name = f"{base_name} {safe_episode_title}"
    return f"{base_name}{ext}"


class ReassignFolderRequest(BaseModel):
    """Rename an entire media folder and rewrite its NFO to match new media."""
    currentFolderPath: str
    newTitle: str
    newYear: Optional[str] = None
    newImdbId: Optional[str] = None
    allowCustomName: bool = False
    mediaType: str = "movie"  # movie | documentary | live_performance


class ReassignFileRequest(BaseModel):
    """Move a single file to the correct media folder (creating it if needed) and write/update the NFO."""
    filePath: str
    newTitle: str
    newYear: Optional[str] = None
    newImdbId: Optional[str] = None
    allowCustomName: bool = False
    mediaType: str = "movie"
    fileCategory: str = "main_feature"  # main_feature | special_feature | unknown | episode


class AssignEpisodeFileRequest(BaseModel):
    """Move a series file into the correct season/episode location."""
    filePath: str
    seriesFolderPath: str
    seriesTitle: str
    seasonNumber: Optional[int] = None
    episodeNumber: Optional[int] = None
    episodeEndNumber: Optional[int] = None
    partNumber: Optional[int] = None
    episodeTitle: Optional[str] = None
    keepOriginalName: bool = False


class MovieOrganizationOverride(BaseModel):
    sourcePath: str
    category: Optional[str] = None
    targetFileName: Optional[str] = None


class MovieOrganizationPreviewFolderRequest(BaseModel):
    folderPath: str
    overrides: List[MovieOrganizationOverride] = []


class MovieOrganizationPreviewAllRequest(BaseModel):
    moviesRoot: Optional[str] = None


class MovieOrganizationApplyFolderRequest(BaseModel):
    folderPath: str
    overrides: List[MovieOrganizationOverride] = []


class MovieOrganizationApplyAllRequest(BaseModel):
    moviesRoot: Optional[str] = None
    overrides: List[MovieOrganizationOverride] = []


class ShowOrganizationOverride(BaseModel):
    sourcePath: str
    category: Optional[str] = None
    targetFileName: Optional[str] = None
    seasonNumber: Optional[int] = None
    episodeStart: Optional[int] = None
    episodeEnd: Optional[int] = None
    partNumber: Optional[int] = None


class ShowOrganizationPreviewFolderRequest(BaseModel):
    folderPath: str
    overrides: List[ShowOrganizationOverride] = []


class ShowOrganizationPreviewAllRequest(BaseModel):
    showsRoot: Optional[str] = None


class ShowOrganizationApplyFolderRequest(BaseModel):
    folderPath: str
    overrides: List[ShowOrganizationOverride] = []


class ShowOrganizationApplyAllRequest(BaseModel):
    showsRoot: Optional[str] = None
    overrides: List[ShowOrganizationOverride] = []


def _check_in_dest(path: str, dest_base: str) -> str:
    """Resolve path and verify it is within dest_base. Returns realpath."""
    try:
        real = os.path.realpath(path)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid path: {path}")
    if not real.startswith(dest_base + os.sep) and real != dest_base:
        raise HTTPException(status_code=403, detail=f"Path is outside the media destination folder: {path}")
    return real


def _category_subfolder(media_type: str) -> str:
    m = {
        "movie": settings.folder_movies,
        "documentary": settings.folder_documentaries,
        "live_performance": settings.folder_live_performances,
        "series": settings.folder_tv_shows,
    }
    return m.get(media_type, settings.folder_movies)


@router.post("/dest-folder/reassign-folder")
async def reassign_folder(request: ReassignFolderRequest):
    """Rename a media folder and every file inside it to match the new media, and rewrite the NFO.

    - Folder is renamed to Jellyfin format: Title (Year) [imdbid-ttXXX]
    - All video/subtitle files are renamed to match the new folder name
    - movie.nfo is overwritten with the new metadata
    - The folder is moved into the correct category subfolder if its current parent differs
    """
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    current_path = _check_in_dest(request.currentFolderPath, dest_base)

    if not os.path.isdir(current_path):
        raise HTTPException(status_code=404, detail="Folder does not exist")

    imdb_id = _normalize_imdb_id(request.newImdbId)
    is_custom_mode = bool(request.allowCustomName and not imdb_id)
    if not imdb_id and not is_custom_mode:
        raise HTTPException(status_code=400, detail="A valid IMDb ID (tt...) is required for reassignment")

    normalized_year = _normalize_year(request.newYear)
    if is_custom_mode:
        custom_title = _sanitize_filename(request.newTitle)
        if not custom_title:
            raise HTTPException(status_code=400, detail="A custom title is required")
        new_folder_name = f"{custom_title}{f' ({normalized_year})' if normalized_year else ''}"
    else:
        new_folder_name = _build_jellyfin_folder_name(request.newTitle, normalized_year, imdb_id)
    category_sub = _category_subfolder(request.mediaType)
    new_parent = os.path.join(dest_base, category_sub)
    new_folder_path = os.path.join(new_parent, new_folder_name)

    ops: List[str] = []
    errors: List[str] = []

    try:
        # 1. Rename / move the folder
        os.makedirs(new_parent, exist_ok=True)
        merged_into_existing = False
        if new_folder_path != current_path:
            if os.path.exists(new_folder_path):
                # Target folder already exists — recursively merge source into it.
                # Use _merge_dir_into for subdirectories so that SMB/CIFS mounts (which
                # reject os.rename on non-empty dirs with ENOTEMPTY rather than EXDEV)
                # are handled correctly via copy+delete instead of atomic rename.
                for entry in os.listdir(current_path):
                    src_entry = os.path.join(current_path, entry)
                    if os.path.isdir(src_entry):
                        _merge_dir_into(src_entry, os.path.join(new_folder_path, entry), ops)
                        ops.append(f"Merged subdirectory: {entry}")
                    else:
                        dst_entry = _ensure_unique_path(os.path.join(new_folder_path, entry))
                        shutil.move(src_entry, dst_entry)
                        ops.append(f"Merged {entry} → {os.path.basename(dst_entry)}")
                # rmtree handles any hidden SMB metadata files (._*) left behind
                shutil.rmtree(current_path)
                ops.append(f"Removed source folder: {current_path}")
                merged_into_existing = True
            else:
                shutil.move(current_path, new_folder_path)
                ops.append(f"Moved folder → {new_folder_path}")
        else:
            ops.append("Folder path unchanged")

        # 2. Rename media files inside the new folder (skip when merging — existing files
        #    in the target folder are already correctly named).
        if not merged_into_existing:
            for entry in os.listdir(new_folder_path):
                ext_lower = os.path.splitext(entry)[1].lower()
                if ext_lower in VIDEO_EXTENSIONS or ext_lower in SUBTITLE_EXTENSIONS:
                    new_filename = new_folder_name + os.path.splitext(entry)[1]
                    src = os.path.join(new_folder_path, entry)
                    dst = os.path.join(new_folder_path, new_filename)
                    if src != dst:
                        os.rename(src, dst)
                        ops.append(f"Renamed {entry} → {new_filename}")

        if is_custom_mode:
            ops.append("Custom naming mode: skipped IMDb validation and NFO overwrite")
            validation_errors = []
        else:
            # 3. Overwrite the NFO
            nfo_path = os.path.join(new_folder_path, "movie.nfo")
            nfo_content = _build_movie_nfo(request.newTitle, normalized_year, imdb_id)
            with open(nfo_path, "w", encoding="utf-8") as f:
                f.write(nfo_content)
            ops.append(f"Wrote {nfo_path}")

            validation_errors = _validate_reassign_outcome(
                target_dir=new_folder_path,
                expected_folder_name=new_folder_name,
                expected_imdb_id=imdb_id,
            )
        if merged_into_existing:
            ops.append("Merge complete — files added to existing folder")
        elif validation_errors:
            errors.extend(validation_errors)
        else:
            ops.append("Validation passed: folder and file names match expected naming")

    except HTTPException:
        raise
    except Exception as exc:
        errors.append(str(exc))

    return {
        "success": len(errors) == 0,
        "data": {
            "newFolderPath": new_folder_path,
            "operations": ops,
            "errors": errors,
        },
    }


@router.post("/dest-folder/reassign-file")
async def reassign_file(request: ReassignFileRequest):
    """Move a single file to the correct media folder and write/update the NFO.

    - Calculates the Jellyfin destination folder from newTitle/year/imdbId
    - Creates the folder if it doesn't exist
    - Moves the file into it, renaming it to match the folder
    - Writes a movie.nfo if one doesn't already exist
    """
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    file_path = _check_in_dest(request.filePath, dest_base)

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File does not exist")

    imdb_id = _normalize_imdb_id(request.newImdbId)
    is_custom_mode = bool(request.allowCustomName and not imdb_id)
    if not imdb_id and not is_custom_mode:
        raise HTTPException(status_code=400, detail="A valid IMDb ID (tt...) is required for reassignment")

    ext = os.path.splitext(file_path)[1]
    original_name = os.path.basename(file_path)
    normalized_year = _normalize_year(request.newYear)
    if is_custom_mode:
        custom_title = _sanitize_filename(request.newTitle)
        if not custom_title:
            raise HTTPException(status_code=400, detail="A custom title is required")
        new_folder_name = f"{custom_title}{f' ({normalized_year})' if normalized_year else ''}"
    else:
        new_folder_name = _build_jellyfin_folder_name(request.newTitle, normalized_year, imdb_id)
    category_sub = _category_subfolder(request.mediaType)
    generated_target_dir = os.path.join(dest_base, category_sub, new_folder_name)
    existing_target_dir = _find_existing_imdb_folder(dest_base, category_sub, imdb_id) if imdb_id else None
    target_dir = existing_target_dir or generated_target_dir
    file_category = (request.fileCategory or "main_feature").lower()

    # Default target_file for error-path reporting
    target_file = os.path.join(target_dir, new_folder_name + ext)

    ops: List[str] = []
    errors: List[str] = []

    try:
        folder_preexisted = os.path.exists(target_dir)
        os.makedirs(target_dir, exist_ok=True)
        ops.append(f"{'Using existing' if folder_preexisted else 'Created'} folder: {target_dir}")
        if existing_target_dir and existing_target_dir != generated_target_dir:
            ops.append(f"Resolved existing IMDb-matched folder instead of creating {generated_target_dir}")

        # Determine placement directory and filename based on category
        if file_category == "special_feature":
            place_dir = os.path.join(target_dir, "Featurettes")
            os.makedirs(place_dir, exist_ok=True)
            target_file = _ensure_unique_path(os.path.join(place_dir, original_name))
        elif file_category == "episode":
            place_dir = os.path.join(target_dir, "Season 00")
            os.makedirs(place_dir, exist_ok=True)
            target_file = _ensure_unique_path(os.path.join(place_dir, original_name))
        elif file_category == "unknown":
            target_file = _ensure_unique_path(os.path.join(target_dir, original_name))
        else:  # main_feature
            target_file = _ensure_unique_path(os.path.join(target_dir, new_folder_name + ext))

        shutil.move(file_path, target_file)
        ops.append(f"Moved file → {target_file}")

        # Write NFO only for main_feature, and only if one doesn't exist yet.
        if file_category == "main_feature":
            if is_custom_mode:
                ops.append("Custom naming mode: skipped IMDb validation and NFO write")
            else:
                nfo_path = os.path.join(target_dir, "movie.nfo")
                if not os.path.exists(nfo_path):
                    nfo_content = _build_movie_nfo(request.newTitle, normalized_year, imdb_id)
                    with open(nfo_path, "w", encoding="utf-8") as f:
                        f.write(nfo_content)
                    ops.append(f"Created {nfo_path}")

                # Skip strict naming validation when adding to a pre-existing folder —
                # the folder already passed validation when it was originally created.
                if not folder_preexisted:
                    validation_errors = _validate_reassign_outcome(
                        target_dir=target_dir,
                        expected_folder_name=new_folder_name,
                        expected_imdb_id=imdb_id,
                        expected_file_path=target_file,
                    )
                    if validation_errors:
                        errors.extend(validation_errors)
                    else:
                        ops.append("Validation passed: folder and file names match expected naming")
                else:
                    ops.append("Validation skipped: file added to existing folder")
        else:
            ops.append(f"Placed as {file_category}: {target_file}")

    except HTTPException:
        raise
    except Exception as exc:
        errors.append(str(exc))

    return {
        "success": len(errors) == 0,
        "data": {
            "targetFile": target_file,
            "targetDir": target_dir,
            "operations": ops,
            "errors": errors,
        },
    }


@router.post("/dest-folder/assign-episode")
async def assign_episode_file(request: AssignEpisodeFileRequest):
    """Move a file into the correct series season folder and optionally rename it to an episode."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    file_path = _check_in_dest(request.filePath, dest_base)
    series_root = _check_in_dest(request.seriesFolderPath, dest_base)

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File does not exist")

    if not os.path.isdir(series_root):
        raise HTTPException(status_code=404, detail="Series folder does not exist")

    season_number = request.seasonNumber
    if season_number is not None and season_number < 0:
        season_number = 0

    target_season_dir = os.path.join(series_root, f"Season {int(season_number or 0):02d}")
    ext = os.path.splitext(file_path)[1]
    original_name = os.path.basename(file_path)
    new_filename = _build_series_episode_filename(
        series_title=request.seriesTitle,
        ext=ext,
        season_number=season_number,
        episode_number=request.episodeNumber,
        episode_end_number=request.episodeEndNumber,
        part_number=request.partNumber,
        episode_title=request.episodeTitle,
        keep_original_name=request.keepOriginalName,
        original_name=original_name,
    )

    target_file = _ensure_unique_path(os.path.join(target_season_dir, new_filename))
    ops: List[str] = []
    errors: List[str] = []

    try:
        os.makedirs(target_season_dir, exist_ok=True)
        ops.append(f"Ensured folder: {target_season_dir}")

        if os.path.realpath(file_path) != os.path.realpath(target_file):
            shutil.move(file_path, target_file)
            ops.append(f"Moved file → {target_file}")
        else:
            ops.append("File already in the correct location")

        if (
            not request.keepOriginalName
            and season_number is not None
            and request.episodeNumber is not None
            and request.episodeEndNumber is None
        ):
            nfo_path = os.path.splitext(target_file)[0] + ".nfo"
            with open(nfo_path, "w", encoding="utf-8") as f:
                f.write(
                    _build_episode_nfo(
                        request.seriesTitle,
                        int(season_number),
                        int(request.episodeNumber),
                        request.episodeTitle,
                    )
                )
            ops.append(f"Wrote {nfo_path}")
        elif request.episodeEndNumber is not None:
            ops.append("Skipped episode NFO for multi-episode range file")

    except Exception as exc:
        errors.append(str(exc))

    return {
        "success": len(errors) == 0,
        "data": {
            "targetFile": target_file,
            "targetDir": target_season_dir,
            "operations": ops,
            "errors": errors,
        },
    }


@router.post("/dest-folder/organize-shows/preview-folder")
async def preview_show_folder_organization(request: ShowOrganizationPreviewFolderRequest):
    """Preview proposed organization changes for a specific processed show folder."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    folder_path = _check_in_dest(request.folderPath, dest_base)

    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Show folder does not exist")

    organizer = JellyfinShowOrganizer(dry_run=True)
    result = organizer.preview_show_folder(
        folder_path,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-shows/preview-all")
async def preview_all_show_organization(request: ShowOrganizationPreviewAllRequest):
    """Preview proposed organization changes for all processed show folders."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    shows_root = request.showsRoot
    if shows_root:
        shows_root = _check_in_dest(shows_root, dest_base)

    organizer = JellyfinShowOrganizer(dry_run=True)
    result = organizer.preview_all_shows(shows_root=shows_root)

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-shows/apply-folder")
async def apply_show_folder_organization(request: ShowOrganizationApplyFolderRequest):
    """Apply organization changes to a specific show folder, honoring optional overrides."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    folder_path = _check_in_dest(request.folderPath, dest_base)

    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Show folder does not exist")

    organizer = JellyfinShowOrganizer(dry_run=False)
    result = organizer.apply_show_folder(
        folder_path,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-shows/apply-all")
async def apply_all_show_organization(request: ShowOrganizationApplyAllRequest):
    """Apply organization changes to all show folders under the Shows root."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    shows_root = request.showsRoot
    if shows_root:
        shows_root = _check_in_dest(shows_root, dest_base)

    organizer = JellyfinShowOrganizer(dry_run=False)
    result = organizer.apply_all_shows(
        shows_root=shows_root,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-movies/preview-folder")
async def preview_movie_folder_organization(request: MovieOrganizationPreviewFolderRequest):
    """Preview proposed organization changes for a specific processed movie folder."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    folder_path = _check_in_dest(request.folderPath, dest_base)

    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Movie folder does not exist")

    organizer = JellyfinMovieOrganizer(dry_run=True)
    result = organizer.preview_movie_folder(
        folder_path,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-movies/preview-all")
async def preview_all_movie_organization(request: MovieOrganizationPreviewAllRequest):
    """Preview proposed organization changes for all processed movie folders."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    movies_root = request.moviesRoot
    if movies_root:
        movies_root = _check_in_dest(movies_root, dest_base)

    organizer = JellyfinMovieOrganizer(dry_run=True)
    result = organizer.preview_all_movies(movies_root=movies_root)

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-movies/apply-folder")
async def apply_movie_folder_organization(request: MovieOrganizationApplyFolderRequest):
    """Apply organization changes to a specific movie folder, honoring optional overrides."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    folder_path = _check_in_dest(request.folderPath, dest_base)

    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Movie folder does not exist")

    organizer = JellyfinMovieOrganizer(dry_run=False)
    result = organizer.apply_movie_folder(
        folder_path,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }


@router.post("/dest-folder/organize-movies/apply-all")
async def apply_all_movie_organization(request: MovieOrganizationApplyAllRequest):
    """Apply organization changes to all movie folders under the Movies root."""
    dest_base = os.path.realpath(settings.jellyfin_dest_base)
    movies_root = request.moviesRoot
    if movies_root:
        movies_root = _check_in_dest(movies_root, dest_base)

    organizer = JellyfinMovieOrganizer(dry_run=False)
    result = organizer.apply_all_movies(
        movies_root=movies_root,
        overrides=[o.dict() for o in request.overrides],
    )

    return {
        "success": bool(result.get("success")),
        "data": result,
    }

