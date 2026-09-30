"""
Wishlist
========
Titles the collector wants but doesn't own yet — for checking "do I already
have this?" while standing in a store, and for the mobile app's "Add to
wishlist" after scanning a barcode that isn't in the collection.

  GET    /api/wishlist        list, oldest first
  POST   /api/wishlist        add an item (auth)
  DELETE /api/wishlist/{id}   remove an item (auth)

Stored as documents in the existing generic_data table (collection
"wishlist") rather than a new table: it's a small flat list with no
relations, so it doesn't warrant a migration. Unlike /api/data/*, writes
accept the mobile bearer token (require_any_auth), not only a browser
session.
"""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import GenericDataStore

router = APIRouter(prefix="/api/wishlist", tags=["Wishlist"])

COLLECTION = "wishlist"


class WishlistItemIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    format: str | None = Field(default=None, max_length=40)
    year: str | None = Field(default=None, max_length=10)
    barcode: str | None = Field(default=None, pattern=r"^\d{8,14}$")
    imdbId: str | None = Field(default=None, pattern=r"^tt\d+$")
    notes: str | None = Field(default=None, max_length=1000)


def _row_to_item(row: GenericDataStore) -> dict:
    return {**(row.data or {}), "id": row.id}


@router.get("")
async def list_wishlist(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(
        select(GenericDataStore)
        .where(GenericDataStore.collection == COLLECTION)
        .order_by(GenericDataStore.created_at)
    )
    return [_row_to_item(row) for row in result.scalars().all()]


@router.post("", dependencies=[Depends(require_any_auth)], status_code=201)
async def add_wishlist_item(body: WishlistItemIn, db: AsyncSession = Depends(get_db)) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title is required.")
    item_id = str(uuid4())
    data = {
        **body.model_dump(exclude_none=True),
        "title": title,
        "id": item_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    row = GenericDataStore(id=item_id, collection=COLLECTION, data=data)
    db.add(row)
    await db.commit()
    return data


@router.delete("/{item_id}", dependencies=[Depends(require_any_auth)])
async def delete_wishlist_item(item_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        delete(GenericDataStore).where(GenericDataStore.collection == COLLECTION, GenericDataStore.id == item_id)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Wishlist item not found")
    return {"deleted": item_id}
