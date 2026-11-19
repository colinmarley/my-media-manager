"""
Releases API — the thing that was bought: one barcode, one case, 1..N discs
and the titles they hold.

A release is a ``disc_sets`` row (the table keeps its name so ``discs.set_id``
and the ``/disc-sets`` endpoints keep working). ``release_contents`` says what
it contains, per movie, series or season. Design:
docs/architecture/PHYSICAL_RELEASES_AND_DISC_LINKING.md.

``POST /api/catalog/releases`` takes the release, its contents and its discs
in one request and saves them in one transaction, so a phone on a bad
connection has one step to retry.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import catalog as catalog_api
from api.catalog import PACKAGING_LOOSE, PACKAGINGS
from api.mobile_auth import require_any_auth
from db.database import get_db
from db.models import Disc, DiscSet, MediaFile, ReleaseContent, Tape

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])

MAX_DISCS_PER_RELEASE = 100
# "loose" is only ever set by the server, on the wrapper it makes for a disc saved without a set.
CHOSEN_PACKAGINGS = tuple(p for p in PACKAGINGS if p != PACKAGING_LOOSE)

# camelCase body key -> column, for the plain text fields.
_TEXT_FIELDS = {
    "barcode": "barcode",
    "edition": "edition",
    "publisher": "publisher",
    "regionCode": "region_code",
    "purchaseDate": "purchase_date",
    "condition": "condition",
    "notes": "notes",
}
# Keys with their own endpoint or column handling; never stored in raw_data.
_NOT_STORED = ("id", "contents", "discs", "discCount", "tapeCount", "linkedFileCount", "allowDuplicateBarcode")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _release_to_dict(row: DiscSet) -> dict:
    """Release DTO: raw_data (photos and client-only flags) under the columns."""
    return {
        **dict(row.raw_data or {}),
        "id": row.id,
        "title": row.title,
        "barcode": row.barcode,
        "edition": row.edition,
        "packaging": row.packaging,
        "publisher": row.publisher,
        "releaseYear": row.release_year,
        "regionCode": row.region_code,
        "expectedDiscCount": row.expected_disc_count,
        "storageType": row.storage_type,
        "storageId": row.storage_id,
        "imageFiles": list(row.image_files or []),
        "purchaseDate": row.purchase_date,
        "condition": row.condition,
        "notes": row.notes,
    }


def _content_to_dict(row: ReleaseContent, titles: dict[tuple[str, str], str]) -> dict:
    return {
        "id": row.id,
        "mediaType": row.media_type,
        "mediaId": row.media_id,
        "title": titles.get((row.media_type, row.media_id)),
        "seasonNumber": row.season_number,
        "episodeStart": row.episode_start,
        "episodeEnd": row.episode_end,
    }


def _normalize_release_body(body: dict[str, Any]) -> dict[str, Any]:
    """Validate and clean the release's own fields (not contents or discs)."""
    body = dict(body)
    if "title" in body:
        body["title"] = _clean_text(body["title"])
        if not body["title"]:
            raise HTTPException(status_code=422, detail="A release needs a title.")
    for key in _TEXT_FIELDS:
        if key in body:
            body[key] = _clean_text(body[key])
    if "packaging" in body:
        body["packaging"] = _clean_text(body["packaging"])
        if body["packaging"] is not None and body["packaging"] not in CHOSEN_PACKAGINGS:
            raise HTTPException(
                status_code=422, detail=f"Packaging must be one of: {', '.join(CHOSEN_PACKAGINGS)}.",
            )
    if "releaseYear" in body:
        body["releaseYear"] = catalog_api._int_or_none(body["releaseYear"], "Release year")
    if "expectedDiscCount" in body:
        count = catalog_api._int_or_none(body["expectedDiscCount"], "Expected disc count")
        if count is not None and not 1 <= count <= MAX_DISCS_PER_RELEASE:
            raise HTTPException(
                status_code=422, detail=f"Expected disc count must be between 1 and {MAX_DISCS_PER_RELEASE}.",
            )
        body["expectedDiscCount"] = count
    if "storageType" in body:
        body["storageType"] = _clean_text(body["storageType"])
    if "storageId" in body:
        storage_id = _clean_text(body["storageId"])
        if storage_id is not None and not catalog_api._STORAGE_ID_RE.match(storage_id):
            raise HTTPException(
                status_code=422,
                detail="Box/binder ID may only use letters, numbers, spaces, '-', '_' and '.' (max 40).",
            )
        body["storageId"] = storage_id
    if "imageFiles" in body and not isinstance(body["imageFiles"], list):
        raise HTTPException(status_code=422, detail="imageFiles must be a list.")
    return body


def _apply_release_fields(row: DiscSet, body: dict[str, Any]) -> None:
    """Sync the columns from a full release body. Callers pass the whole
    record (PUT lays the request over the stored one first when merging)."""
    row.title = body.get("title") or "Untitled"
    for key, column in _TEXT_FIELDS.items():
        setattr(row, column, body.get(key))
    row.packaging = body.get("packaging")
    row.release_year = body.get("releaseYear")
    row.expected_disc_count = body.get("expectedDiscCount")
    row.storage_type = body.get("storageType")
    row.storage_id = body.get("storageId")
    row.image_files = list(body.get("imageFiles") or [])
    row.raw_data = {k: v for k, v in body.items() if k not in _NOT_STORED}


def _content_rows(release_id: str, items: Any) -> list[ReleaseContent]:
    """Validated ReleaseContent rows for a ``contents`` list. The same title
    and scope twice is collapsed to one row."""
    if items is None:
        return []
    if not isinstance(items, list):
        raise HTTPException(status_code=422, detail="contents must be a list.")
    rows: list[ReleaseContent] = []
    seen: set[tuple] = set()
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="Each content entry must be an object.")
        media_type = item.get("mediaType")
        media_id = _clean_text(item.get("mediaId"))
        if media_type not in ("movie", "series") or not media_id:
            raise HTTPException(
                status_code=422, detail="Each content entry needs mediaType ('movie'|'series') and mediaId.",
            )
        scope = catalog_api.content_scope(item)
        key = (media_type, media_id, scope["season_number"], scope["episode_start"], scope["episode_end"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(ReleaseContent(
            id=str(uuid.uuid4()), release_id=release_id, media_type=media_type, media_id=media_id, **scope,
        ))
    return rows


async def _reject_duplicate_release_barcode(body: dict[str, Any], db: AsyncSession) -> None:
    """409 when a release already has this barcode. The client asks first and
    resends with ``allowDuplicateBarcode`` for a real second copy."""
    barcode = _clean_text(body.get("barcode"))
    if not barcode:
        return
    existing = (await db.execute(
        select(DiscSet.id, DiscSet.title).where(DiscSet.barcode == barcode).limit(1)
    )).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_barcode",
                "message": f"You already have a release with this barcode: {existing.title}.",
                "existingId": existing.id,
                "existingTitle": existing.title,
            },
        )


async def _get_release_or_404(db: AsyncSession, release_id: str) -> DiscSet:
    row = (await db.execute(select(DiscSet).where(DiscSet.id == release_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Release not found")
    return row


async def _release_detail(db: AsyncSession, row: DiscSet) -> dict:
    """The release with its contents, its discs (each with ``linkedFileCount``)
    and ``linkedFileCount``: every file that names the release, through one of
    its discs or directly."""
    contents = (await db.execute(
        select(ReleaseContent).where(ReleaseContent.release_id == row.id)
        .order_by(ReleaseContent.media_type, ReleaseContent.media_id, ReleaseContent.season_number)
    )).scalars().all()
    titles = await catalog_api._titles_for_media(db, [(c.media_type, c.media_id) for c in contents])
    discs = (await db.execute(
        select(Disc).where(Disc.set_id == row.id).order_by(Disc.disc_number, Disc.title)
    )).scalars().all()
    disc_counts = dict((await db.execute(
        select(MediaFile.disc_id, func.count(MediaFile.id))
        .where(MediaFile.disc_id.in_([d.id for d in discs]))
        .group_by(MediaFile.disc_id)
    )).all()) if discs else {}
    file_count = (await db.execute(
        select(func.count(MediaFile.id)).where(MediaFile.release_id == row.id)
    )).scalar_one()
    return {
        **_release_to_dict(row),
        "contents": [_content_to_dict(c, titles) for c in contents],
        "discs": [
            {**catalog_api._row_to_dict(d), "linkedFileCount": disc_counts.get(d.id, 0)} for d in discs
        ],
        "linkedFileCount": file_count,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/releases")
async def list_releases(
    title: str | None = Query(default=None),
    barcode: str | None = Query(default=None),
    include_loose: bool = Query(default=True),
    limit: int = Query(default=200, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Releases, optionally filtered by title or exact barcode, each with its
    ``discCount`` and ``linkedFileCount``. ``include_loose=false`` leaves out
    the automatic one-disc wrappers."""
    stmt = select(DiscSet).order_by(DiscSet.title)
    if title:
        stmt = stmt.where(DiscSet.title.ilike(f"%{title}%"))
    if barcode:
        stmt = stmt.where(DiscSet.barcode == barcode.strip())
    if not include_loose:
        stmt = stmt.where(or_(DiscSet.packaging.is_(None), DiscSet.packaging != PACKAGING_LOOSE))
    rows = (await db.execute(stmt.limit(limit))).scalars().all()
    if not rows:
        return []
    ids = [r.id for r in rows]
    disc_counts = dict((await db.execute(
        select(Disc.set_id, func.count(Disc.id)).where(Disc.set_id.in_(ids)).group_by(Disc.set_id)
    )).all())
    file_counts = dict((await db.execute(
        select(MediaFile.release_id, func.count(MediaFile.id))
        .where(MediaFile.release_id.in_(ids)).group_by(MediaFile.release_id)
    )).all())
    return [
        {**_release_to_dict(r), "discCount": disc_counts.get(r.id, 0), "linkedFileCount": file_counts.get(r.id, 0)}
        for r in rows
    ]


@router.get("/releases/{release_id}")
async def get_release(release_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    return await _release_detail(db, await _get_release_or_404(db, release_id))


@router.post("/releases", dependencies=[Depends(require_any_auth)])
async def create_release(
    body: dict[str, Any],
    check_duplicates: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a release with its contents and discs in one transaction.

    Body: the release fields plus ``contents`` (``[{mediaType, mediaId,
    seasonNumber?, episodeStart?, episodeEnd?}]``) and ``discs`` (disc bodies
    as ``POST /discs`` takes them). A disc without a title is named after the
    release; a disc without a number gets its position in the list.
    ``expectedDiscCount`` defaults to the number of discs sent.
    """
    if check_duplicates and not body.get("allowDuplicateBarcode"):
        await _reject_duplicate_release_barcode(body, db)
    disc_bodies = body.get("discs") or []
    if not isinstance(disc_bodies, list) or not all(isinstance(d, dict) for d in disc_bodies):
        raise HTTPException(status_code=422, detail="discs must be a list of disc objects.")
    if len(disc_bodies) > MAX_DISCS_PER_RELEASE:
        raise HTTPException(status_code=422, detail=f"A release can have at most {MAX_DISCS_PER_RELEASE} discs.")

    release_body = _normalize_release_body(body)
    if not release_body.get("title"):
        raise HTTPException(status_code=422, detail="A release needs a title.")
    if release_body.get("expectedDiscCount") is None and disc_bodies:
        release_body["expectedDiscCount"] = len(disc_bodies)

    release = DiscSet(id=str(uuid.uuid4()))
    _apply_release_fields(release, release_body)
    contents = _content_rows(release.id, body.get("contents"))
    db.add(release)
    # Discs and contents reference the release by a plain foreign key (no ORM
    # relationship), so it has to be inserted before them.
    await db.flush()
    db.add_all(contents)

    multi = len(disc_bodies) > 1
    for position, disc_body in enumerate(disc_bodies, start=1):
        disc_body = {k: v for k, v in disc_body.items() if k not in ("id", "setId", "set_id", "linkedFileCount")}
        disc_body = await catalog_api._normalize_physical_body(disc_body, db)
        if disc_body.get("discNumber") is None and disc_body.get("disc_number") is None:
            disc_body["discNumber"] = position
        if not _clean_text(disc_body.get("title")):
            number = disc_body.get("discNumber") or disc_body.get("disc_number")
            disc_body["title"] = f"{release.title} - Disc {number}" if multi else release.title
        disc_body["setId"] = release.id
        if multi:
            disc_body["isPartOfSet"] = True
        disc = Disc(id=str(uuid.uuid4()))
        catalog_api._apply_disc_fields(disc, disc_body)
        db.add(disc)

    await db.commit()
    await db.refresh(release)
    return await _release_detail(db, release)


@router.put("/releases/{release_id}", dependencies=[Depends(require_any_auth)])
async def update_release(release_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """Edit a release's own fields. Only the keys sent change; a key sent as
    null clears it. ``contents``, when sent, replaces the whole list. Discs
    are edited through the disc endpoints."""
    row = await _get_release_or_404(db, release_id)
    if row.packaging == PACKAGING_LOOSE and "packaging" not in body:
        # Editing a loose release as a thing of its own makes it a catalogued one.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "loose_release",
                "message": "This is the automatic wrapper of a loose disc. Edit the disc, or send a packaging to turn it into a release.",
            },
        )
    changes = _normalize_release_body(body)
    merged = {**_release_to_dict(row), **{k: v for k, v in changes.items() if k not in _NOT_STORED}}
    _apply_release_fields(row, merged)
    if "contents" in body:
        contents = _content_rows(release_id, body["contents"])
        await db.execute(delete(ReleaseContent).where(ReleaseContent.release_id == release_id))
        db.add_all(contents)
    await db.commit()
    await db.refresh(row)
    return await _release_detail(db, row)


@router.delete("/releases/{release_id}", dependencies=[Depends(require_any_auth)])
async def delete_release(release_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Delete an empty release. One that still has discs or tapes is refused
    (409): delete or move those first, so no disc is left without a release."""
    await _get_release_or_404(db, release_id)
    discs = (await db.execute(select(func.count(Disc.id)).where(Disc.set_id == release_id))).scalar_one()
    tapes = (await db.execute(select(func.count(Tape.id)).where(Tape.set_id == release_id))).scalar_one()
    if discs or tapes:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "release_not_empty",
                "message": "This release still has discs or tapes. Delete or move them first.",
                "discCount": discs,
                "tapeCount": tapes,
            },
        )
    await db.execute(delete(DiscSet).where(DiscSet.id == release_id))
    await db.commit()
    return {"deleted": release_id}
