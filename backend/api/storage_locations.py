"""
Storage locations
=================
Boxes and binders as manageable things: a human name, a capacity, notes,
and the ability to rename one (move every disc/tape in it to a new ID).

  GET    /api/storage-locations                       all locations: metadata + item counts
  PUT    /api/storage-locations/{type}/{id}           set name/capacity/notes (auth)
  DELETE /api/storage-locations/{type}/{id}           drop metadata; items untouched (auth)
  POST   /api/storage-locations/{type}/{id}/rename    move all items to a new ID (auth)

A location *exists* whenever an item references it (discs/tapes carry
storage_type + storage_id, see migration 3c4d5e6f7a8b) — metadata is
optional and lives in generic_data (collection "storage_locations",
document id "{type}:{id}") so this needed no new table.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import Disc, GenericDataStore, Tape

router = APIRouter(prefix="/api/storage-locations", tags=["Storage Locations"])

COLLECTION = "storage_locations"
StorageType = Literal["Box", "Binder"]
_ID_PATTERN = r"^[A-Za-z0-9_\-. ]{1,40}$"


class LocationMeta(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    capacity: int | None = Field(default=None, ge=1, le=10000)
    notes: str | None = Field(default=None, max_length=1000)


class RenameRequest(BaseModel):
    newId: str = Field(..., pattern=_ID_PATTERN)


def _doc_id(storage_type: str, storage_id: str) -> str:
    return f"{storage_type}:{storage_id}"


@router.get("")
async def list_locations(db: AsyncSession = Depends(get_db)) -> list[dict]:
    counts: dict[tuple[str, str], dict] = {}
    for model, key in ((Disc, "discCount"), (Tape, "tapeCount")):
        rows = await db.execute(
            select(model.storage_type, model.storage_id, func.count(model.id))
            .where(model.storage_type.isnot(None), model.storage_id.isnot(None), model.storage_id != "")
            .group_by(model.storage_type, model.storage_id)
        )
        for storage_type, storage_id, count in rows.all():
            entry = counts.setdefault((storage_type, storage_id), {"discCount": 0, "tapeCount": 0})
            entry[key] = count

    meta_rows = await db.execute(select(GenericDataStore).where(GenericDataStore.collection == COLLECTION))
    meta = {row.id: row.data or {} for row in meta_rows.scalars().all()}

    keys = set(counts) | {tuple(doc_id.split(":", 1)) for doc_id in meta if ":" in doc_id}
    locations = []
    for storage_type, storage_id in keys:
        c = counts.get((storage_type, storage_id), {"discCount": 0, "tapeCount": 0})
        m = meta.get(_doc_id(storage_type, storage_id), {})
        locations.append({
            "storageType": storage_type,
            "storageId": storage_id,
            "name": m.get("name"),
            "capacity": m.get("capacity"),
            "notes": m.get("notes"),
            **c,
            "itemCount": c["discCount"] + c["tapeCount"],
        })
    locations.sort(key=lambda loc: (loc["storageType"] != "Box", loc["storageId"]))
    return locations


@router.put("/{storage_type}/{storage_id}", dependencies=[Depends(require_any_auth)])
async def set_location_meta(
    storage_type: StorageType, storage_id: str, body: LocationMeta, db: AsyncSession = Depends(get_db)
) -> dict:
    doc_id = _doc_id(storage_type, storage_id)
    result = await db.execute(
        select(GenericDataStore).where(GenericDataStore.collection == COLLECTION, GenericDataStore.id == doc_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = GenericDataStore(id=doc_id, collection=COLLECTION)
        db.add(row)
    row.data = {"storageType": storage_type, "storageId": storage_id, **body.model_dump(exclude_none=True)}
    await db.commit()
    return row.data


@router.delete("/{storage_type}/{storage_id}", dependencies=[Depends(require_any_auth)])
async def delete_location_meta(storage_type: StorageType, storage_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(
        delete(GenericDataStore).where(
            GenericDataStore.collection == COLLECTION, GenericDataStore.id == _doc_id(storage_type, storage_id)
        )
    )
    await db.commit()
    return {"deleted": _doc_id(storage_type, storage_id)}


@router.post("/{storage_type}/{storage_id}/rename", dependencies=[Depends(require_any_auth)])
async def rename_location(
    storage_type: StorageType, storage_id: str, body: RenameRequest, db: AsyncSession = Depends(get_db)
) -> dict:
    """Move every disc/tape in this box/binder to a new ID, in one transaction.

    Updates both the storage_id column and raw_data.storageId — list
    endpoints serve raw_data, so leaving it stale would make the app show
    the old ID. Refuses to merge into an ID that's already in use."""
    new_id = body.newId.strip()
    if new_id == storage_id:
        raise HTTPException(status_code=400, detail="New ID is the same as the current one.")

    for model in (Disc, Tape):
        clash = await db.execute(
            select(func.count(model.id)).where(model.storage_type == storage_type, model.storage_id == new_id)
        )
        if clash.scalar_one():
            raise HTTPException(status_code=409, detail=f"{storage_type} {new_id} already has items in it.")

    target_meta = await db.execute(
        select(GenericDataStore.id).where(
            GenericDataStore.collection == COLLECTION, GenericDataStore.id == _doc_id(storage_type, new_id)
        )
    )
    if target_meta.scalar_one_or_none() is not None:
        # Empty, but already named/described — inserting over it was a
        # primary-key 500.
        raise HTTPException(status_code=409, detail=f"{storage_type} {new_id} already exists. Delete it first or pick another ID.")

    moved = 0
    for model in (Disc, Tape):
        rows = await db.execute(select(model).where(model.storage_type == storage_type, model.storage_id == storage_id))
        for row in rows.scalars().all():
            row.storage_id = new_id
            raw = dict(row.raw_data or {})
            raw["storageId"] = new_id
            raw["storageType"] = storage_type
            row.raw_data = raw
            flag_modified(row, "raw_data")
            moved += 1

    # Carry the metadata (name/capacity/notes) over to the new key.
    old_doc = await db.execute(
        select(GenericDataStore).where(
            GenericDataStore.collection == COLLECTION, GenericDataStore.id == _doc_id(storage_type, storage_id)
        )
    )
    old_meta = old_doc.scalar_one_or_none()
    if old_meta is not None:
        data = {**(old_meta.data or {}), "storageId": new_id}
        await db.delete(old_meta)
        db.add(GenericDataStore(id=_doc_id(storage_type, new_id), collection=COLLECTION, data=data))

    await db.commit()
    return {"storageType": storage_type, "from": storage_id, "to": new_id, "moved": moved}
