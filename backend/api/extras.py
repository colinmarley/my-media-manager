"""
Extras review API — lets a human confirm or correct the extras-taxonomy
category (deleted scene, trailer, behind-the-scenes, etc.) of a
non-main-feature file before it is filed in the library.

Two kinds of pending extras are listed together:

- **Ripped extras held in the ingest queue.** The rip page picks a type
  without showing the video, so a ripped extra waits in the queue (status
  ``needs_review``) until its type is confirmed here. Their id is the queue
  item id. Confirming sets the type, which decides the library file name
  (``Title (Year)-blooper.mkv``), and then accepts the queue item, which files
  it. ``GET /{id}/contact-sheet`` is a 4x3 sheet of frames to judge the type by.
- **AssignmentExtraFile rows** (older flow, see services/extras_taxonomy.py and
  services/file_organization_service.py::_get_source_files, which only includes
  confirmed extras when organizing an assignment).
"""

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import AssignmentExtraFile, MediaFile
from api.auth import require_session
from services import contact_sheet
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


def _queue_service(req: Request) -> Optional[Any]:
    return getattr(req.app.state, "ingress_queue_service", None)


def _held_to_dict(view: dict) -> dict:
    """A held queue item in the shape of a pending extra, plus what the review needs to show."""
    parsed_info = view.get("parsed_info") or {}
    rip = parsed_info.get("rip") or {}
    best_match = view.get("best_match") or {}
    category = parsed_info.get("extras_category")
    return {
        "id": view.get("id"),
        "assignmentId": None,
        "mediaFileId": None,
        "queueItemId": view.get("id"),
        "category": category if category in CATEGORIES else None,
        "source": "rip",
        "confirmed": False,
        "createdAt": None,
        "fileName": view.get("file_name"),
        "filePath": view.get("file_path"),
        "fileSize": view.get("file_size"),
        "durationMs": view.get("media_duration_ms"),
        "title": best_match.get("title") or parsed_info.get("title"),
        "year": best_match.get("year") or parsed_info.get("year"),
        "proposedPath": view.get("proposed_path"),
        "discTitleIndex": rip.get("title_index"),
        "hasContactSheet": True,
    }


@router.get("/categories")
async def list_categories() -> list[str]:
    return CATEGORIES


@router.get("/pending")
async def list_pending_extras(req: Request, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Extras awaiting human review: ripped extras held in the queue, then unconfirmed
    AssignmentExtraFile rows, each newest first."""
    queue_service = _queue_service(req)
    held = [_held_to_dict(view) for view in queue_service.held_extras()] if queue_service is not None else []
    result = await db.execute(
        select(AssignmentExtraFile, MediaFile)
        .join(MediaFile, AssignmentExtraFile.media_file_id == MediaFile.id)
        .where(AssignmentExtraFile.confirmed.is_(False))
        .order_by(AssignmentExtraFile.created_at.desc())
    )
    return held + [_row_to_dict(extra, media_file) for extra, media_file in result.all()]


@router.get("/{extra_id}/contact-sheet", dependencies=[Depends(require_session)])
async def get_contact_sheet(extra_id: str, req: Request) -> FileResponse:
    """A JPEG of twelve evenly spaced frames from a held extra (made on first request, then cached)."""
    queue_service = _queue_service(req)
    view = None
    if queue_service is not None:
        view = next((v for v in queue_service.held_extras() if v.get("id") == extra_id), None)
    if view is None:
        raise HTTPException(status_code=404, detail="Extra not found")
    duration_ms = view.get("media_duration_ms") or 0
    sheet = await asyncio.to_thread(contact_sheet.build, view.get("file_path") or "", duration_ms / 1000.0)
    if sheet is None:
        raise HTTPException(status_code=422, detail="Could not read frames from this file")
    return FileResponse(sheet, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


async def _update_held_extra(queue_service: Any, extra_id: str, body: dict[str, Any]) -> Optional[dict]:
    """Apply a review update to a held queue item; None when ``extra_id`` is not one."""
    if queue_service is None or not any(v.get("id") == extra_id for v in queue_service.held_extras()):
        return None
    confirmed = bool(body.get("confirmed"))
    try:
        item = await queue_service.set_extras_category(extra_id, body.get("category"), confirmed=confirmed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        return None
    if confirmed:
        # The same accept a person gives in Queue & Review: files the item under its proposed name.
        item = await queue_service.mark_complete(extra_id, manual_action=True) or item
    view = queue_service._item_view(item)
    return {
        **_held_to_dict(view),
        "confirmed": confirmed,
        "queueStatus": view.get("status"),
        "error": view.get("last_error"),
    }


@router.patch("/{extra_id}", dependencies=[Depends(require_session)])
async def update_extra(extra_id: str, body: dict[str, Any], req: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """
    Set/correct an extra's category and/or confirm it.

    For a ripped extra held in the queue, confirming files it in the library
    under the name for its type. For an AssignmentExtraFile row, confirming is
    what allows file_organization_service to move the file — see
    _get_source_files's `AssignmentExtraFile.confirmed.is_(True)` filter.
    """
    held = await _update_held_extra(_queue_service(req), extra_id, body)
    if held is not None:
        return held

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
