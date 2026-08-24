"""
Generic Data Store API — CRUD for arbitrary collections stored in the
`generic_data` table.  Acts as a drop-in replacement for the Firebase
Firestore collections used by the admin forms (actors, directors, writers,
AllMedia, MyMedia, etc.).

Catalog collections (movies, series, discs) are NOT routed here — they
have their own dedicated endpoints in catalog.py.

Endpoints:
    GET    /api/data/{collection}        — list all documents in a collection
    GET    /api/data/{collection}/{id}   — get single document
    PUT    /api/data/{collection}/{id}   — upsert document  (auth required)
    DELETE /api/data/{collection}/{id}   — delete document  (auth required)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Any

from db.database import get_db
from db.models import GenericDataStore
from api.auth import require_session

router = APIRouter(prefix="/api/data", tags=["Generic Data"])

# Collections that have their own dedicated endpoints — refuse to serve them
# here to avoid confusion.
_BLOCKED = {"movies", "series", "discs"}


def _row_to_dict(row: GenericDataStore) -> dict:
    data: dict = dict(row.data or {})
    data["id"] = row.id
    return data


@router.get("/{collection}")
async def list_collection(collection: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    if collection in _BLOCKED:
        raise HTTPException(status_code=400, detail=f"Use /api/catalog/{collection} for this collection.")
    result = await db.execute(
        select(GenericDataStore)
        .where(GenericDataStore.collection == collection)
        .order_by(GenericDataStore.created_at)
    )
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.get("/{collection}/{doc_id}")
async def get_document(collection: str, doc_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    if collection in _BLOCKED:
        raise HTTPException(status_code=400, detail=f"Use /api/catalog/{collection} for this collection.")
    result = await db.execute(
        select(GenericDataStore)
        .where(GenericDataStore.collection == collection, GenericDataStore.id == doc_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return _row_to_dict(row)


@router.put("/{collection}/{doc_id}", dependencies=[Depends(require_session)])
async def upsert_document(
    collection: str,
    doc_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> dict:
    if collection in _BLOCKED:
        raise HTTPException(status_code=400, detail=f"Use /api/catalog/{collection} for this collection.")
    result = await db.execute(
        select(GenericDataStore)
        .where(GenericDataStore.collection == collection, GenericDataStore.id == doc_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = GenericDataStore(id=doc_id, collection=collection)
        db.add(row)

    body["id"] = doc_id
    row.data = body

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{collection}/{doc_id}", dependencies=[Depends(require_session)])
async def delete_document(collection: str, doc_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    if collection in _BLOCKED:
        raise HTTPException(status_code=400, detail=f"Use /api/catalog/{collection} for this collection.")
    await db.execute(
        delete(GenericDataStore)
        .where(GenericDataStore.collection == collection, GenericDataStore.id == doc_id)
    )
    await db.commit()
    return {"deleted": doc_id, "collection": collection}
