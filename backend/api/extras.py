"""
Extras review API — lets a human confirm or correct the extras-taxonomy
category (deleted scene, trailer, behind-the-scenes, etc.) that was
auto-suggested for a non-main-feature file, before it's moved into its
final Jellyfin subfolder. See services/extras_taxonomy.py and
services/file_organization_service.py::_get_source_files (which only
includes confirmed extras when organizing an assignment).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from db.database import get_db
from db.models import AssignmentExtraFile, MediaFile
from api.auth import require_session
from services.extras_taxonomy import CATEGORIES

router = APIRouter(prefix="/api/media/extras", tags=["Extras Review"])


def _row_to_dict(extra: AssignmentExtraFile, media_file: MediaFile) -> dict:
    return {
        "id": extra.id,
        "assignmentId": extra.assignment_id,
        "mediaFileId": extra.media_file_id,
        "category": extra.category,
        "source": extra.source,
        "confirmed": extra.confirmed,
        "createdAt": extra.created_at.isoformat() if extra.created_at else None,
        "fileName": media_file.file_name,
        "filePath": media_file.file_path,
        "fileSize": media_file.file_size,
    }


@router.get("/categories")
async def list_categories() -> list[str]:
    return CATEGORIES


@router.get("/pending")
async def list_pending_extras(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Unconfirmed extras awaiting human review, newest first."""
    result = await db.execute(
        select(AssignmentExtraFile, MediaFile)
        .join(MediaFile, AssignmentExtraFile.media_file_id == MediaFile.id)
        .where(AssignmentExtraFile.confirmed.is_(False))
        .order_by(AssignmentExtraFile.created_at.desc())
    )
    return [_row_to_dict(extra, media_file) for extra, media_file in result.all()]


@router.patch("/{extra_id}", dependencies=[Depends(require_session)])
async def update_extra(extra_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """
    Set/correct an extra's category and/or confirm it. Confirming here is
    what allows file_organization_service to actually move the file — see
    _get_source_files's `AssignmentExtraFile.confirmed.is_(True)` filter.
    """
    result = await db.execute(select(AssignmentExtraFile).where(AssignmentExtraFile.id == extra_id))
    extra = result.scalar_one_or_none()
    if extra is None:
        raise HTTPException(status_code=404, detail="Extra not found")

    if "category" in body:
        category = body["category"]
        if category is not None and category not in CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
        extra.category = category
        extra.source = "manual"

    if "confirmed" in body:
        if body["confirmed"] and not extra.category:
            raise HTTPException(status_code=400, detail="Cannot confirm an extra with no category set")
        extra.confirmed = bool(body["confirmed"])

    await db.commit()
    await db.refresh(extra)

    media_file_result = await db.execute(select(MediaFile).where(MediaFile.id == extra.media_file_id))
    media_file = media_file_result.scalar_one_or_none()
    return _row_to_dict(extra, media_file) if media_file else {"id": extra.id, "confirmed": extra.confirmed}
