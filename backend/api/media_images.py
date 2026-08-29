"""
Media cover-image endpoints
============================
Generalized photo upload for movie/series/disc/tape cover art, modeled on
the existing tape-image pattern in api/tape_ingest.py but (a) covering all
four catalog types via a single parameterized router and (b) writing the
resulting URL into the row's image_files/raw_data.imageFiles columns so
existing detail screens pick it up with no extra fetch.

Storage is kept separate from tape_archive_path (the pre-existing
tape-digitization workflow) under its own settings.media_archive_path, so
this feature can't disturb that working flow.

  GET    /api/media-images/{media_type}/{media_id}                 list
  POST   /api/media-images/{media_type}/{media_id}                 upload (auth)
  GET    /api/media-images/{media_type}/{media_id}/{filename}/file  serve
  DELETE /api/media-images/{media_type}/{media_id}/{filename}       delete (auth)

media_type is one of: movie, series, disc, tape
"""

import os
import re
import shutil
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from api.mobile_auth import require_any_auth
from config.settings import settings
from db.database import get_db
from db.models import Movie, Series, Disc, Tape
from utils.logging import logger

router = APIRouter(prefix="/api/media-images", tags=["Media Images"])

_MEDIA_MODELS: dict = {
    "movie": Movie,
    "series": Series,
    "disc": Disc,
    "tape": Tape,
}

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".tiff", ".bmp"}

_FILENAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]+$")


class MediaImageInfo(BaseModel):
    filename: str
    size_bytes: int
    url: str


def _require_media_type(media_type: str) -> None:
    if media_type not in _MEDIA_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown media type '{media_type}'.")


def _media_image_dir(media_type: str, media_id: str) -> str:
    if not re.match(r"^[A-Za-z0-9_\-]+$", media_id):
        raise HTTPException(status_code=400, detail="media_id may only contain letters, digits, underscores, and hyphens")
    d = os.path.join(settings.media_archive_path, media_type, media_id)
    os.makedirs(d, exist_ok=True)
    return d


async def _get_row(media_type: str, media_id: str, db: AsyncSession):
    model = _MEDIA_MODELS[media_type]
    result = await db.execute(select(model).where(model.id == media_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail=f"{media_type.capitalize()} not found")
    return row


def _append_image_file(row, url: str) -> None:
    raw: dict = dict(row.raw_data or {})
    image_files = list(raw.get("imageFiles") or [])
    image_files.append({"fileName": url})
    raw["imageFiles"] = image_files
    row.raw_data = raw
    if hasattr(row, "image_files"):
        row.image_files = image_files
    flag_modified(row, "raw_data")


def _remove_image_file(row, url: str) -> None:
    raw: dict = dict(row.raw_data or {})
    image_files = [
        img for img in list(raw.get("imageFiles") or [])
        if not (isinstance(img, dict) and img.get("fileName") == url)
    ]
    raw["imageFiles"] = image_files
    row.raw_data = raw
    if hasattr(row, "image_files"):
        row.image_files = image_files
    flag_modified(row, "raw_data")


@router.get("/{media_type}/{media_id}", response_model=list[MediaImageInfo])
async def list_media_images(media_type: str, media_id: str):
    """List all cover images stored for a catalog item."""
    _require_media_type(media_type)
    d = _media_image_dir(media_type, media_id)
    images: list[MediaImageInfo] = []
    for fname in sorted(os.listdir(d)):
        if os.path.splitext(fname)[1].lower() not in ALLOWED_IMAGE_EXTS:
            continue
        fpath = os.path.join(d, fname)
        if os.path.isfile(fpath):
            images.append(MediaImageInfo(
                filename=fname,
                size_bytes=os.path.getsize(fpath),
                url=f"/api/media-images/{media_type}/{media_id}/{fname}/file",
            ))
    return images


@router.post("/{media_type}/{media_id}", response_model=MediaImageInfo, dependencies=[Depends(require_any_auth)])
async def upload_media_image(
    media_type: str,
    media_id: str,
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(...),
):
    """Upload a cover photo for a catalog item and record it on the row."""
    _require_media_type(media_type)
    row = await _get_row(media_type, media_id, db)

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTS))}",
        )
    d = _media_image_dir(media_type, media_id)

    safe_name = file.filename or f"image_{uuid4().hex[:8]}{ext}"
    dest = os.path.join(d, safe_name)
    if os.path.exists(dest):
        stem, suffix = os.path.splitext(safe_name)
        safe_name = f"{stem}_{uuid4().hex[:6]}{suffix}"
        dest = os.path.join(d, safe_name)

    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    url = f"/api/media-images/{media_type}/{media_id}/{safe_name}/file"
    _append_image_file(row, url)
    await db.commit()

    logger.info("Media image uploaded", media_type=media_type, media_id=media_id, filename=safe_name)
    return MediaImageInfo(filename=safe_name, size_bytes=os.path.getsize(dest), url=url)


@router.get("/{media_type}/{media_id}/{filename}/file")
async def get_media_image(media_type: str, media_id: str, filename: str):
    """Serve a cover image file."""
    _require_media_type(media_type)
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = os.path.join(settings.media_archive_path, media_type, media_id, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(fpath)


@router.delete("/{media_type}/{media_id}/{filename}", dependencies=[Depends(require_any_auth)])
async def delete_media_image(media_type: str, media_id: str, filename: str, db: AsyncSession = Depends(get_db)):
    """Delete a cover image from disk and remove it from the row."""
    _require_media_type(media_type)
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = os.path.join(settings.media_archive_path, media_type, media_id, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="Image not found")

    row = await _get_row(media_type, media_id, db)
    url = f"/api/media-images/{media_type}/{media_id}/{filename}/file"
    _remove_image_file(row, url)
    await db.commit()

    os.remove(fpath)
    logger.info("Media image deleted", media_type=media_type, media_id=media_id, filename=filename)
    return {"deleted": filename}
