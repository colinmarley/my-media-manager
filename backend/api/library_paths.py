"""
Library Paths API — CRUD endpoints for user-defined library scan paths.

Replaces the legacy `user_library_paths` collection previously used by
the catalog service / useLibraryPaths.

Endpoints:
    GET    /api/library-paths           — list all paths
    POST   /api/library-paths           — create a new path  (auth required)
    PATCH  /api/library-paths/{id}      — update a path      (auth required)
    DELETE /api/library-paths/{id}      — delete a path      (auth required)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Any
import uuid

from db.database import get_db
from db.models import LibraryPath
from api.auth import require_session

router = APIRouter(prefix="/api/library-paths", tags=["Library Paths"])


def _row_to_dict(row: LibraryPath) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "rootPath": row.root_path,
        "mediaType": row.media_type,
        "isActive": row.is_active,
        "lastScanned": row.last_scanned.isoformat() if row.last_scanned else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
async def list_library_paths(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(LibraryPath).order_by(LibraryPath.created_at))
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.post("", dependencies=[Depends(require_session)])
async def create_library_path(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    row = LibraryPath(
        id=str(uuid.uuid4()),
        name=body.get("name") or "Unnamed",
        root_path=body.get("rootPath") or body.get("root_path") or "",
        media_type=body.get("mediaType") or body.get("media_type") or "mixed",
        is_active=body.get("isActive", body.get("is_active", True)),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.patch("/{path_id}", dependencies=[Depends(require_session)])
async def update_library_path(
    path_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)
) -> dict:
    result = await db.execute(select(LibraryPath).where(LibraryPath.id == path_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Library path not found")

    if "name" in body:
        row.name = body["name"]
    if "rootPath" in body or "root_path" in body:
        row.root_path = body.get("rootPath") or body.get("root_path")
    if "mediaType" in body or "media_type" in body:
        row.media_type = body.get("mediaType") or body.get("media_type")
    if "isActive" in body or "is_active" in body:
        row.is_active = body.get("isActive", body.get("is_active"))
    if "lastScanned" in body or "last_scanned" in body:
        from datetime import datetime, timezone
        val = body.get("lastScanned") or body.get("last_scanned")
        if isinstance(val, str):
            row.last_scanned = datetime.fromisoformat(val)
        elif isinstance(val, datetime):
            row.last_scanned = val

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{path_id}", dependencies=[Depends(require_session)])
async def delete_library_path(path_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(LibraryPath).where(LibraryPath.id == path_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Library path not found")
    await db.execute(delete(LibraryPath).where(LibraryPath.id == path_id))
    await db.commit()
    return {"deleted": path_id}
