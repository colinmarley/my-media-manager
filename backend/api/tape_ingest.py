"""
Tape Ingest API
===============
Endpoints for the VHS / VHS-C / Mini DV digitization workflow:
  GET  /scan-roots          — candidate source directories on this machine
  POST /scan                — scan a directory for video files (ffprobe metadata)
  GET  /thumbnail           — generate a JPEG thumbnail for a video file
  POST /process             — start a background copy/transcode job
  GET  /process/{task_id}   — poll job status
  POST /sessions            — persist a completed tape session to the DB
  GET  /sessions            — list past tape sessions
  GET  /known-people        — distinct people names from past home video metadata
"""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import require_session
from config.settings import settings
from db.database import get_db
from db.models import TapeSession, TapeSessionFile
from services.tape_ingest_service import TapeIngestService
from utils.logging import logger

router = APIRouter(prefix="/api/tape-ingest", tags=["Tape Ingest"])
_service = TapeIngestService()


# ---------------------------------------------------------------------------
# Source directory listing
# ---------------------------------------------------------------------------

@router.get("/scan-roots", response_model=List[str])
async def list_scan_roots():
    """Return candidate source directories (ingress folder + allowed_base_paths that exist)."""
    return _service.list_scan_roots()


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    source_path: str


@router.post("/scan")
async def scan_source(request: ScanRequest):
    """Scan a directory for video files and return ffprobe metadata per file."""
    if not os.path.exists(request.source_path):
        raise HTTPException(status_code=400, detail=f"Path does not exist: {request.source_path}")
    logger.info("Tape ingest scan started", path=request.source_path)
    items = _service.scan_path(request.source_path)
    logger.info("Tape ingest scan complete", path=request.source_path, count=len(items))
    return items


# ---------------------------------------------------------------------------
# Thumbnail
# ---------------------------------------------------------------------------

@router.get("/thumbnail")
async def get_thumbnail(file_path: str):
    """Generate and return a JPEG thumbnail for a video file."""
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    thumb = _service.generate_thumbnail(file_path)
    if not thumb:
        raise HTTPException(status_code=500, detail="Thumbnail generation failed")
    return FileResponse(thumb, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Process
# ---------------------------------------------------------------------------

class ProcessRequest(BaseModel):
    items: List[Dict[str, Any]]
    destination_base: str
    apply_ffmpeg: bool = False
    tape_type: str = "vhs"


class ProcessResponse(BaseModel):
    task_id: str


@router.post("/process", response_model=ProcessResponse)
async def start_process(request: ProcessRequest):
    """Start a background processing job. Returns a task_id for polling."""
    if not request.items:
        raise HTTPException(status_code=400, detail="No items provided")
    task_id = _service.start_process_job(request.model_dump())
    logger.info("Tape ingest processing started", task_id=task_id, count=len(request.items))
    return ProcessResponse(task_id=task_id)


@router.get("/process/{task_id}")
async def get_process_status(task_id: str):
    """Poll status of a processing job."""
    status = _service.get_job_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Job not found: {task_id}")
    return status


# ---------------------------------------------------------------------------
# Session persistence
# ---------------------------------------------------------------------------

class TapeSessionFileCreate(BaseModel):
    file_path: str
    file_name: str
    content_type: str
    duration_seconds: Optional[float] = None
    resolution: Optional[str] = None
    codec: Optional[str] = None
    file_size_bytes: Optional[int] = None
    destination_path: Optional[str] = None
    processing_status: str = "pending"
    tape_id: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = None


class TapeSessionCreate(BaseModel):
    tape_type: str
    brand: Optional[str] = None
    condition: Optional[str] = None
    recording_speed: Optional[str] = None
    label_notes: Optional[str] = None
    source_path: str
    destination_base: str
    apply_ffmpeg: bool = False
    files: List[TapeSessionFileCreate] = Field(default_factory=list)


class TapeSessionResponse(BaseModel):
    id: str
    created_at: datetime
    tape_type: str
    brand: Optional[str]
    condition: Optional[str]
    recording_speed: Optional[str]
    label_notes: Optional[str]
    source_path: str
    destination_base: str
    apply_ffmpeg: bool
    file_count: int

    model_config = {"from_attributes": True}


@router.post("/sessions", response_model=TapeSessionResponse)
async def create_session(body: TapeSessionCreate, db: AsyncSession = Depends(get_db)):
    """Persist a completed tape session and its files to the database."""
    session = TapeSession(
        tape_type=body.tape_type,
        brand=body.brand,
        condition=body.condition,
        recording_speed=body.recording_speed,
        label_notes=body.label_notes,
        source_path=body.source_path,
        destination_base=body.destination_base,
        apply_ffmpeg=body.apply_ffmpeg,
    )
    db.add(session)
    await db.flush()

    for f in body.files:
        db.add(TapeSessionFile(
            session_id=session.id,
            file_path=f.file_path,
            file_name=f.file_name,
            content_type=f.content_type,
            duration_seconds=f.duration_seconds,
            resolution=f.resolution,
            codec=f.codec,
            file_size_bytes=f.file_size_bytes,
            destination_path=f.destination_path,
            processing_status=f.processing_status,
            tape_id=f.tape_id,
            metadata_json=f.metadata_json,
        ))

    await db.commit()
    await db.refresh(session)
    logger.info("Tape session saved", session_id=session.id, files=len(body.files))

    return TapeSessionResponse(
        id=session.id,
        created_at=session.created_at,
        tape_type=session.tape_type,
        brand=session.brand,
        condition=session.condition,
        recording_speed=session.recording_speed,
        label_notes=session.label_notes,
        source_path=session.source_path,
        destination_base=session.destination_base,
        apply_ffmpeg=session.apply_ffmpeg,
        file_count=len(body.files),
    )


@router.get("/sessions", response_model=List[TapeSessionResponse])
async def list_sessions(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Return paginated list of past tape sessions, newest first."""
    result = await db.execute(
        select(TapeSession)
        .order_by(TapeSession.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = result.scalars().all()

    # Fetch file counts in one query
    count_result = await db.execute(
        select(TapeSessionFile.session_id, func.count(TapeSessionFile.id).label("cnt"))
        .where(TapeSessionFile.session_id.in_([r.id for r in rows]))
        .group_by(TapeSessionFile.session_id)
    )
    counts = {row.session_id: row.cnt for row in count_result}

    return [
        TapeSessionResponse(
            id=r.id,
            created_at=r.created_at,
            tape_type=r.tape_type,
            brand=r.brand,
            condition=r.condition,
            recording_speed=r.recording_speed,
            label_notes=r.label_notes,
            source_path=r.source_path,
            destination_base=r.destination_base,
            apply_ffmpeg=r.apply_ffmpeg,
            file_count=counts.get(r.id, 0),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Known people (for Home Video autocomplete)
# ---------------------------------------------------------------------------

@router.get("/known-people", response_model=List[str])
async def get_known_people(db: AsyncSession = Depends(get_db)):
    """Return sorted, deduplicated people names from past home video sessions."""
    result = await db.execute(
        select(TapeSessionFile.metadata_json)
        .where(
            TapeSessionFile.content_type == "home_video",
            TapeSessionFile.metadata_json.isnot(None),
        )
    )
    people: set = set()
    for (meta,) in result:
        if isinstance(meta, dict):
            for name in meta.get("people", []):
                if isinstance(name, str) and name.strip():
                    people.add(name.strip())
    return sorted(people)


# ---------------------------------------------------------------------------
# Tape archive images  (photos of the physical tape and case)
# Stored on disk under: {tape_archive_path}/{tape_id}/
# ---------------------------------------------------------------------------

import shutil as _shutil
from fastapi import File, UploadFile
from fastapi.responses import FileResponse as _FileResponse

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".tiff", ".bmp"}


def _tape_image_dir(tape_id: str) -> str:
    """Return the directory for a tape ID's images, creating it if needed."""
    import re
    if not re.match(r"^[A-Za-z0-9_\-]+$", tape_id):
        raise HTTPException(status_code=400, detail="tape_id may only contain letters, digits, underscores, and hyphens")
    d = os.path.join(settings.tape_archive_path, tape_id)
    os.makedirs(d, exist_ok=True)
    return d


class TapeImageInfo(BaseModel):
    filename: str
    size_bytes: int
    url: str


@router.get("/tape-images/{tape_id}", response_model=List[TapeImageInfo])
async def list_tape_images(tape_id: str):
    """List all images stored for a tape ID."""
    d = _tape_image_dir(tape_id)
    images: List[TapeImageInfo] = []
    for fname in sorted(os.listdir(d)):
        if os.path.splitext(fname)[1].lower() not in ALLOWED_IMAGE_EXTS:
            continue
        fpath = os.path.join(d, fname)
        if os.path.isfile(fpath):
            images.append(TapeImageInfo(
                filename=fname,
                size_bytes=os.path.getsize(fpath),
                url=f"/api/tape-ingest/tape-images/{tape_id}/{fname}/file",
            ))
    return images


@router.post("/tape-images/{tape_id}", response_model=TapeImageInfo)
async def upload_tape_image(tape_id: str, file: UploadFile = File(...)):
    """Upload an image (photo of the tape or case) for a tape ID."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTS))}",
        )
    d = _tape_image_dir(tape_id)

    # Avoid filename collisions by appending a short uuid suffix when needed
    from uuid import uuid4
    safe_name = file.filename or f"image_{uuid4().hex[:8]}{ext}"
    dest = os.path.join(d, safe_name)
    if os.path.exists(dest):
        stem, suffix = os.path.splitext(safe_name)
        safe_name = f"{stem}_{uuid4().hex[:6]}{suffix}"
        dest = os.path.join(d, safe_name)

    with open(dest, "wb") as out:
        _shutil.copyfileobj(file.file, out)

    logger.info("Tape image uploaded", tape_id=tape_id, filename=safe_name)
    return TapeImageInfo(
        filename=safe_name,
        size_bytes=os.path.getsize(dest),
        url=f"/api/tape-ingest/tape-images/{tape_id}/{safe_name}/file",
    )


@router.get("/tape-images/{tape_id}/{filename}/file")
async def get_tape_image(tape_id: str, filename: str):
    """Serve an image file for a tape ID."""
    import re
    if not re.match(r"^[A-Za-z0-9_\-. ]+$", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = os.path.join(settings.tape_archive_path, tape_id, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Image not found")
    return _FileResponse(fpath)


@router.delete("/tape-images/{tape_id}/{filename}")
async def delete_tape_image(tape_id: str, filename: str):
    """Delete an image from a tape ID's archive."""
    import re
    if not re.match(r"^[A-Za-z0-9_\-. ]+$", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = os.path.join(settings.tape_archive_path, tape_id, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Image not found")
    os.remove(fpath)
    logger.info("Tape image deleted", tape_id=tape_id, filename=filename)
    return {"deleted": filename}
