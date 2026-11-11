"""
The To-Do (attention) list.

- ``GET /api/attention/summary`` — ``{counts: {<kind>: n}, total, generatedAt}``;
  ``total`` leaves out ``unripped_disc`` and ``unprobed``. Cached in process
  for about a minute; dismiss, review and rename writes clear it.
- ``GET /api/attention/items?kind=&mediaType=&mediaId=&limit=&offset=`` —
  ``{items, total}``. ``mediaType`` + ``mediaId`` narrow it to one title, with
  the same id forms as ``/api/catalog/media/{type}/{id}/detail``.
- ``POST /api/attention/dismiss`` ``{kind, subjectType, subjectId, days?, note?}``
  — hides the item until its fact changes (``days`` null) or for ``days`` days.
- ``DELETE /api/attention/dismiss/{id}`` — undo a dismissal.
- ``GET /api/attention/dismissals`` — every stored dismissal.

See services/attention_service.py for the kinds and the item shape.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import AttentionDismissal
from services import attention_service

router = APIRouter(
    prefix="/api/attention",
    tags=["Attention"],
    dependencies=[Depends(require_any_auth)],
)

MAX_LIMIT = 500


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"type": "AttentionError", "code": code, "message": message})


def _threshold(req: Request) -> Optional[int]:
    """The queue's live auto-assign threshold (runtime config), else the setting."""
    service = getattr(req.app.state, "ingress_queue_service", None)
    value = getattr(service, "auto_assign_threshold", None)
    return value if isinstance(value, int) else None


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return None


def dismissal_to_dict(row: AttentionDismissal) -> Dict[str, Any]:
    return {
        "id": row.id,
        "itemId": attention_service.item_id(row.kind, row.subject_type, row.subject_id),
        "kind": row.kind,
        "subjectType": row.subject_type,
        "subjectId": row.subject_id,
        "fingerprint": row.fingerprint,
        "dismissedUntil": _iso(row.dismissed_until),
        "note": row.note,
        "createdAt": _iso(row.created_at),
    }


@router.get("/summary")
async def get_summary(req: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    async def build() -> Dict[str, Any]:
        items = await attention_service.collect_items(db, threshold=_threshold(req))
        return attention_service.summarize(items)

    return await attention_service.summary_cache.get(build)


@router.get("/items")
async def get_items(
    req: Request,
    kind: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None, alias="mediaType"),
    media_id: Optional[str] = Query(None, alias="mediaId"),
    limit: int = Query(100, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    kinds = None
    if kind:
        kinds = [k.strip() for k in kind.split(",") if k.strip()]
        unknown = [k for k in kinds if k not in attention_service.KINDS]
        if unknown:
            raise _error(400, "UNKNOWN_KIND", f"kind must be one of: {', '.join(attention_service.KINDS)}")
    if bool(media_type) != bool(media_id):
        raise _error(400, "MEDIA_FILTER", "mediaType and mediaId go together")

    title_key = None
    if media_type and media_id:
        from api.media_files import resolve_record

        catalog_kind, row, _, _ = await resolve_record(db, media_type, media_id)
        title_key = (catalog_kind, row.id)

    items = await attention_service.collect_items(db, threshold=_threshold(req))
    if kinds:
        items = [i for i in items if i["kind"] in kinds]
    if title_key:
        items = [i for i in items if (i.get("catalogType"), i.get("mediaId")) == title_key]
    page = items[offset: offset + limit]
    await attention_service.attach_file_dtos(db, page)
    return {"items": [attention_service.public(i) for i in page], "total": len(items)}


class DismissRequest(BaseModel):
    kind: str
    subjectType: str
    subjectId: str
    days: Optional[float] = None
    note: Optional[str] = None


@router.post("/dismiss")
async def dismiss(body: DismissRequest, req: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if body.kind not in attention_service.KINDS:
        raise _error(400, "UNKNOWN_KIND", f"kind must be one of: {', '.join(attention_service.KINDS)}")
    if body.subjectType not in attention_service.SUBJECT_TYPES:
        raise _error(400, "UNKNOWN_SUBJECT_TYPE", f"subjectType must be one of: {', '.join(attention_service.SUBJECT_TYPES)}")
    if body.days is not None and body.days <= 0:
        raise _error(422, "INVALID_DAYS", "days must be a positive number, or null for 'until it changes'")

    wanted = attention_service.item_id(body.kind, body.subjectType, body.subjectId)
    items = await attention_service.collect_items(db, threshold=_threshold(req), include_dismissed=True)
    item = next((i for i in items if i["id"] == wanted), None)
    if item is None:
        raise _error(404, "ITEM_NOT_FOUND", f"There is no open {body.kind} item for {body.subjectType} {body.subjectId}")
    if not item.get("dismissible", True):
        raise _error(422, "NOT_DISMISSIBLE", "This item cannot be dismissed; resolve it instead (e.g. clear the review flag)")

    now = datetime.now(timezone.utc)
    until = now + timedelta(days=body.days) if body.days is not None else None
    existing = (await db.execute(
        select(AttentionDismissal).where(
            AttentionDismissal.kind == body.kind,
            AttentionDismissal.subject_type == body.subjectType,
            AttentionDismissal.subject_id == body.subjectId,
        )
    )).scalar_one_or_none()
    row = existing or AttentionDismissal(kind=body.kind, subject_type=body.subjectType, subject_id=body.subjectId)
    row.fingerprint = item.get("fingerprint")
    row.dismissed_until = until
    row.note = body.note
    row.created_at = now
    if existing is None:
        db.add(row)
    await db.commit()
    attention_service.invalidate_summary()
    return dismissal_to_dict(row)


@router.delete("/dismiss/{dismissal_id}")
async def undismiss(dismissal_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(AttentionDismissal, dismissal_id)
    if row is None:
        raise _error(404, "DISMISSAL_NOT_FOUND", f"Dismissal not found: {dismissal_id}")
    result = dismissal_to_dict(row)
    await db.delete(row)
    await db.commit()
    attention_service.invalidate_summary()
    return {"success": True, "dismissal": result}


@router.get("/dismissals")
async def list_dismissals(db: AsyncSession = Depends(get_db)) -> Dict[str, List[Dict[str, Any]]]:
    rows = await attention_service.load_dismissals(db)
    rows.sort(key=lambda r: _iso(r.created_at) or "", reverse=True)
    return {"dismissals": [dismissal_to_dict(r) for r in rows]}
