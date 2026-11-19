"""
Catalog API — CRUD endpoints for the media catalog (movies, series, discs).

All endpoints return data in the same shape the frontend catalog hooks
previously expected, so no frontend type changes are required.  The full
catalog document is stored in the `raw_data` JSONB column and returned
as the payload, with the PostgreSQL primary-key `id` guaranteed to be set.
"""

import os
import re
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update, or_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import Any

from db.database import get_db
from db.models import Movie, Series, Disc, DiscSet, DiscMediaLink, Tape, TapeMediaLink, MediaFile, ReleaseContent
from api.mobile_auth import require_any_auth
from services.catalog_stats import RECENT_DAYS_DEFAULT, build_catalog_stats
from config.settings import settings
from services import media_file_index, release_coverage, storage_paths
from utils.logging import logger

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])


async def _move_folder_to_ingest(folder_path: str, record_id: str, kind: str, req: Request) -> str:
    """Move an organized library folder into the first ingest root, held for review.

    The folder keeps its name (and with it the ``[imdbid-...]`` tag), so the
    auto-processor would match it straight back into the library. Every video
    in it is therefore queued with a hold (``IngressQueueService.
    hold_files_for_review``): matched, proposal pre-filled, but left at
    ``needs_review`` until a person assigns or ignores it.
    """
    library_root = os.path.realpath(storage_paths.library_root())
    real_src = os.path.realpath(folder_path)
    if not real_src.startswith(library_root + os.sep):
        raise HTTPException(status_code=403, detail="Folder is outside the media destination.")
    ingest_root = storage_paths.primary_ingest_root()
    if not ingest_root:
        raise HTTPException(status_code=409, detail="No ingest folder is configured to move the files to.")

    os.makedirs(ingest_root, exist_ok=True)
    dest = os.path.join(ingest_root, os.path.basename(real_src))
    if os.path.exists(dest):
        dest = dest + f"__{record_id[:8]}"
    shutil.move(real_src, dest)

    queue_service = getattr(req.app.state, "ingress_queue_service", None)
    if queue_service is None:
        logger.warning("No ingress queue to hold removed files for review", folder=dest)
        return dest
    file_paths = [
        os.path.join(root, name)
        for root, _dirs, names in os.walk(dest)
        for name in sorted(names)
    ]
    try:
        await queue_service.hold_files_for_review(
            file_paths,
            reason=f"removed from library ({kind} {record_id})",
            ingress_path=ingest_root,
        )
    except Exception:
        logger.error("Could not queue removed files for review", folder=dest, exc_info=True)
    return dest


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _row_to_dict(row, id_field: str = "id") -> dict:
    """Return the raw_data blob with id guaranteed."""
    data: dict = dict(row.raw_data or {})
    data["id"] = getattr(row, id_field)
    if isinstance(row, Disc):
        # Always set, also for a loose disc whose record has no setId.
        data["releaseId"] = row.set_id
    return data


# Same rule as storage_locations.RenameRequest.newId — an id saved with any
# other character could never be renamed later.
_STORAGE_ID_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,40}$")

# Flags a client sends in the body that aren't part of the stored record.
# releaseId and linkedFileCount are computed into the disc DTO; a client
# echoing a fetched record back must not get them stored.
_CONTROL_KEYS = ("allowDuplicateBarcode", "releaseId", "linkedFileCount", "ripState")

# Releases (disc_sets rows) — see docs/architecture/PHYSICAL_RELEASES_AND_DISC_LINKING.md.
PACKAGING_LOOSE = "loose"
PACKAGINGS = ("case", "box_set", "combo_pack", PACKAGING_LOOSE)
DISC_CONTENT_ROLES = ("feature", "episodes", "bonus", "duplicate_format", "other")
RIP_INTENTS = ("rip", "skip")
SOURCE_KINDS = ("disc", "tape", "digital")


def _int_or_none(value: Any, label: str) -> int | None:
    """Coerce a whole-number field ('3', 3, 3.0) or reject it with a 422 —
    passing a string straight into an Integer column was a 500."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{label} must be a whole number.")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        return int(value)
    raise HTTPException(status_code=422, detail=f"{label} must be a whole number (got {value!r}).")


def _normalize_int(body: dict[str, Any], camel: str, snake: str, label: str) -> None:
    for key in (camel, snake):
        if key in body:
            body[key] = _int_or_none(body[key], label)


async def _normalize_physical_body(body: dict[str, Any], db: AsyncSession) -> dict[str, Any]:
    """Validate/clean a disc or tape body before it touches the columns.

    Turns what used to be database 500s (a non-numeric disc number, a setId
    pointing at a deleted set) into 422s with a message, and trims the
    storage id so "MED0001 " doesn't become its own box."""
    body = {k: v for k, v in body.items() if k not in _CONTROL_KEYS}
    _normalize_int(body, "discNumber", "disc_number", "Disc number")

    for key in ("storageId", "storage_id"):
        if key in body:
            value = body[key].strip() if isinstance(body[key], str) else body[key]
            if value in (None, ""):
                body[key] = None
            elif not isinstance(value, str) or not _STORAGE_ID_RE.match(value):
                raise HTTPException(
                    status_code=422,
                    detail="Box/binder ID may only use letters, numbers, spaces, '-', '_' and '.' (max 40).",
                )
            else:
                body[key] = value

    for key in ("contentRole", "content_role"):
        if body.get(key) in ("", None):
            body.pop(key, None)
        elif body[key] not in DISC_CONTENT_ROLES:
            raise HTTPException(
                status_code=422, detail=f"Disc role must be one of: {', '.join(DISC_CONTENT_ROLES)}.",
            )
    for key in ("ripIntent", "rip_intent"):
        if body.get(key) in ("", None):
            body.pop(key, None)
        elif body[key] not in RIP_INTENTS:
            raise HTTPException(status_code=422, detail=f"Rip intent must be one of: {', '.join(RIP_INTENTS)}.")

    set_id = body.get("setId") or body.get("set_id")
    if set_id:
        exists = await db.execute(select(DiscSet.id).where(DiscSet.id == set_id))
        if exists.scalar_one_or_none() is None:
            raise HTTPException(status_code=422, detail="That boxed set no longer exists. Pick another set or remove it.")
    return body


async def _attach_disc_release(db: AsyncSession, disc: Disc, previous_set_id: str | None = None) -> None:
    """Every disc belongs to a release. Called after ``_apply_disc_fields``:
    a disc the body left without a set keeps the ``loose`` release it already
    had, or gets a new one-disc loose release.

    A loose release is only ever in the ``set_id`` column, never in the
    record's ``setId``: to clients a loose disc is "not in a set", exactly as
    before releases existed. ``releaseId`` in the disc DTO carries it."""
    if disc.set_id:
        return
    if previous_set_id:
        previous = (await db.execute(select(DiscSet).where(DiscSet.id == previous_set_id))).scalar_one_or_none()
        if previous is not None and previous.packaging == PACKAGING_LOOSE:
            disc.set_id = previous_set_id
            _mirror_disc(previous, disc)
            return
    release = DiscSet(id=str(uuid.uuid4()), packaging=PACKAGING_LOOSE, raw_data={})
    _mirror_disc(release, disc)
    db.add(release)
    # No ORM relationship ties a disc to its release, so the unit of work does
    # not know to insert the release first.
    await db.flush()
    disc.set_id = release.id


def _mirror_disc(release: DiscSet, disc: Disc) -> None:
    """A loose release is a wrapper around its one disc, so it mirrors the
    disc's title, barcode and edition. Without this an edited barcode would
    still be found under the old one through the release."""
    release.title = disc.title or "Untitled"
    release.barcode = disc.barcode
    release.edition = disc.edition


async def _drop_empty_loose_release(db: AsyncSession, set_id: str | None) -> None:
    """Delete an auto-made loose release once its last disc has left it (the
    disc joined a real release, or was deleted). Other releases are kept:
    an empty box set is still something a person catalogued."""
    if not set_id:
        return
    release = (await db.execute(select(DiscSet).where(DiscSet.id == set_id))).scalar_one_or_none()
    if release is None or release.packaging != PACKAGING_LOOSE:
        return
    if (await db.execute(select(Disc.id).where(Disc.set_id == set_id).limit(1))).scalar_one_or_none() is not None:
        return
    if (await db.execute(select(Tape.id).where(Tape.set_id == set_id).limit(1))).scalar_one_or_none() is not None:
        return
    await db.execute(delete(DiscSet).where(DiscSet.id == set_id))


async def _reject_duplicate_barcode(model, body: dict[str, Any], db: AsyncSession) -> None:
    """409 when another disc/tape already has this barcode. Opt-in per
    request (?check_duplicates=true): owning two copies is legitimate, and
    service callers like disc-ripper-service keep the old behavior."""
    barcode = (body.get("barcode") or "").strip()
    if not barcode:
        return
    existing = (await db.execute(
        select(model.id, model.title).where(model.barcode == barcode).limit(1)
    )).first()
    if existing:
        kind = "disc" if model is Disc else "tape"
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_barcode",
                "message": f"You already have a {kind} with this barcode: {existing.title}.",
                "existingId": existing.id,
                "existingTitle": existing.title,
            },
        )


def _merged(row, body: dict[str, Any]) -> dict[str, Any]:
    """body laid over the row's current raw_data — for ?merge=true edits that
    send only the fields that changed (keys sent as null still clear)."""
    return {**dict(row.raw_data or {}), **body}


def _apply_disc_fields(row: Disc, body: dict[str, Any]) -> None:
    """Sync the flattened Disc columns from body, used by both create and
    edit — search_discs() filters on these columns directly, not raw_data,
    so an edit that only touched raw_data would silently go stale there."""
    row.title = body.get("title") or "Untitled"
    row.format = body.get("format")
    row.barcode = body.get("barcode")
    row.condition = body.get("condition")
    row.region_code = body.get("regionCode") or body.get("region_code")
    row.disc_number = body.get("discNumber") or body.get("disc_number")
    row.set_id = body.get("setId") or body.get("set_id")
    row.edition = body.get("edition")
    row.storage_type = body.get("storageType") or body.get("storage_type")
    row.storage_id = body.get("storageId") or body.get("storage_id")
    row.language = body.get("language")
    row.purchase_date = body.get("purchaseDate") or body.get("purchase_date")
    row.release_date = body.get("releaseDate") or body.get("release_date")
    row.is_part_of_set = bool(body.get("isPartOfSet") or body.get("is_part_of_set") or False)
    row.is_rental_disc = bool(body.get("isRentalDisc") or body.get("is_rental_disc") or False)
    row.contains_special_features = bool(
        body.get("containsSpecialFeatures") or body.get("contains_special_features") or False
    )
    row.content_role = body.get("contentRole") or body.get("content_role")
    row.rip_intent = body.get("ripIntent") or body.get("rip_intent") or "rip"
    row.rip_skip_reason = body.get("ripSkipReason") or body.get("rip_skip_reason")
    row.raw_data = body


def _apply_tape_fields(row: Tape, body: dict[str, Any]) -> None:
    """Sync the flattened Tape columns from body — same rationale as
    _apply_disc_fields (search_tapes() filters on tape_label directly)."""
    row.title = body.get("title") or "Untitled"
    row.tape_type = body.get("tapeType") or body.get("tape_type")
    row.tape_label = body.get("tapeLabel") or body.get("tape_label")
    row.barcode = body.get("barcode")
    row.set_id = body.get("setId") or body.get("set_id")
    row.edition = body.get("edition")
    row.brand = body.get("brand")
    row.condition = body.get("condition")
    row.recording_speed = body.get("recordingSpeed") or body.get("recording_speed")
    row.label_notes = body.get("labelNotes") or body.get("label_notes")
    row.purchase_date = body.get("purchaseDate") or body.get("purchase_date")
    row.storage_type = body.get("storageType") or body.get("storage_type")
    row.storage_id = body.get("storageId") or body.get("storage_id")
    row.raw_data = body


# Movie/series fields other flows own (photo uploads, the assignment
# orchestrator, Jellyfin organizing). A PUT that simply didn't mention them
# used to reset them to empty — now they carry over unless sent explicitly.
_KEPT_BLOBS = {
    "imageFiles": "image_files",
    "assignmentSummary": "assignment_summary",
    "jellyfinInfo": "jellyfin_info",
    "seriesSummary": "series_summary",
}


def _with_kept_blobs(row, body: dict[str, Any]) -> dict[str, Any]:
    raw = dict(row.raw_data or {})
    kept = dict(body)
    for camel, snake in _KEPT_BLOBS.items():
        if camel not in body and snake not in body and raw.get(camel) is not None:
            kept[camel] = raw[camel]
    return kept


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _source_summary(row: Any, format_field: str) -> dict | None:
    """``{id, title, format}`` of a linked disc (``format``) or tape (``tape_type``)."""
    if row is None:
        return None
    return {"id": row.id, "title": row.title, "format": getattr(row, format_field, None)}


def _media_file_to_dict(row: MediaFile, disc: Any = None, tape: Any = None) -> dict:
    """File DTO. The first nine keys are the original shape (the mobile app
    reads them); everything after is additive. ``disc`` / ``tape`` are filled
    only when the caller passes the linked rows, else null."""
    return {
        "id": row.id,
        "fileName": row.file_name,
        "filePath": row.file_path,
        "fileSize": row.file_size,
        "detectedMediaType": row.detected_media_type,
        "assignmentStatus": row.assignment_status,
        "targetPath": row.target_path,
        "organizationStatus": row.organization_status,
        "createdAt": _iso(row.created_at),
        # Inventory (additive).
        "relativePath": row.relative_path,
        "role": row.role,
        "seasonNumber": row.season_number,
        "episodeNumber": row.episode_number,
        "episodeEndNumber": row.episode_end_number,
        "location": row.location,
        "container": row.container,
        "videoCodec": row.video_codec,
        "resolutionCategory": row.resolution_category,
        "width": row.width,
        "height": row.height,
        "hdrFormat": row.hdr_format,
        "audioCodec": row.audio_codec,
        "audioChannels": row.audio_channels,
        "durationMs": row.duration_ms,
        "bitrate": row.bitrate,
        "probedAt": _iso(row.probed_at),
        "probeError": row.probe_error,
        "isAvailable": row.is_available,
        "missingSince": _iso(row.missing_since),
        "discId": row.disc_id,
        "tapeId": row.tape_id,
        "releaseId": row.release_id,
        "sourceKind": row.source_kind,
        "movieId": row.movie_id,
        "seriesId": row.series_id,
        "disc": _source_summary(disc, "format"),
        "tape": _source_summary(tape, "tape_type"),
        # Review flag (additive).
        "needsReview": bool(getattr(row, "needs_review", False)),
        "reviewNote": getattr(row, "review_note", None),
        "reviewedAt": _iso(getattr(row, "reviewed_at", None)),
    }


# ---------------------------------------------------------------------------
# Movies
# ---------------------------------------------------------------------------

@router.get("/movies")
async def list_movies(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Movie).order_by(Movie.title))
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.get("/movies/lookup")
async def lookup_movie(
    imdb_id: str | None = Query(None, alias="imdbId"),
    title_lower: str | None = Query(None, alias="titleLower"),
    db: AsyncSession = Depends(get_db),
) -> dict | None:
    """Return the first matching movie by imdbId or titleLower, or null."""
    conditions = []
    if imdb_id:
        conditions.append(Movie.imdb_id == imdb_id)
    if title_lower:
        conditions.append(Movie.title == title_lower)
    if not conditions:
        raise HTTPException(status_code=400, detail="Provide imdbId or titleLower")
    result = await db.execute(select(Movie).where(or_(*conditions)).limit(1))
    row = result.scalar_one_or_none()
    return _row_to_dict(row) if row else None


@router.get("/movies/{movie_id}")
async def get_movie(movie_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Movie not found")
    return _row_to_dict(row)


@router.put("/movies/{movie_id}", dependencies=[Depends(require_any_auth)])
async def upsert_movie(
    movie_id: str,
    body: dict[str, Any],
    create_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create or replace. With ?create_only=true (the mobile "add" flow) an
    existing id is a 409 instead of a silent overwrite of the stored record."""
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Movie(id=movie_id)
        db.add(row)
    else:
        if create_only:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "already_exists",
                    "message": f"{row.title} is already in your catalog.",
                    "existingId": row.id,
                    "existingTitle": row.title,
                },
            )
        body = _with_kept_blobs(row, body)

    def _na(val: Any) -> Any:
        """Return None for OMDB sentinel 'N/A' strings, else return the value."""
        return None if val in (None, "N/A", "") else val

    omdb = body.get("omdbData") or {}
    tmdb = body.get("tmdbData") or {}

    row.title           = body.get("title") or body.get("raw_data", {}).get("title") or "Untitled"
    row.release_date    = body.get("releaseDate") or body.get("release_date")
    row.runtime         = body.get("runtime") or _na(omdb.get("Runtime"))
    row.genres          = body.get("genres") or []
    row.languages       = body.get("languages") or []
    row.countries       = body.get("countryOfOrigin") or body.get("countries") or []
    row.awards          = _na(omdb.get("Awards"))
    row.content_rating  = _na(omdb.get("Rated"))
    row.imdb_rating     = _na(omdb.get("imdbRating"))
    row.imdb_votes      = _na(omdb.get("imdbVotes"))
    row.metascore       = _na(omdb.get("Metascore"))
    row.box_office      = _na(omdb.get("BoxOffice"))
    row.tagline         = _na(tmdb.get("tagline")) if tmdb else None
    row.tmdb_rating     = str(tmdb["vote_average"]) if tmdb.get("vote_average") is not None else None
    row.tmdb_vote_count = tmdb.get("vote_count") if tmdb.get("vote_count") is not None else None
    row.imdb_id         = (body.get("externalIds") or {}).get("imdbId") or body.get("imdbId") or body.get("imdb_id")
    row.tmdb_id         = str(tmdb["id"]) if tmdb.get("id") else (body.get("externalIds") or {}).get("tmdbId") or row.tmdb_id
    row.collection_id   = body.get("collectionId") or body.get("collection_id")
    row.collection_name = body.get("collectionName") or body.get("collection_name")
    row.collection_order = _int_or_none(body.get("collectionOrder") or body.get("collection_order"), "Collection order")
    row.omdb_data       = omdb if omdb else row.omdb_data
    row.tmdb_data       = tmdb if tmdb else row.tmdb_data
    row.image_files     = body.get("imageFiles") or body.get("image_files") or []
    row.assignment_summary = body.get("assignmentSummary") or body.get("assignment_summary") or {}
    row.jellyfin_info   = body.get("jellyfinInfo") or body.get("jellyfin_info") or {}
    row.raw_data        = body

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.patch("/movies/{movie_id}/folder-path", dependencies=[Depends(require_any_auth)])
async def patch_movie_folder_path(movie_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """Update only the folderPath field on a movie record (in raw_data)."""
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Movie not found")
    new_folder_path = body.get("folderPath")
    raw = dict(row.raw_data or {})
    raw["folderPath"] = new_folder_path
    raw["mediaType"] = "movie"
    jellyfin_info = dict(raw.get("jellyfinInfo") or {})
    jellyfin_info["folderPath"] = new_folder_path
    raw["jellyfinInfo"] = jellyfin_info
    row.raw_data = raw
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(row, "raw_data")
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.post("/movies/{movie_id}/remove-to-review", dependencies=[Depends(require_any_auth)])
async def remove_movie_to_review(movie_id: str, req: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Move the movie's folder into the ingest root (held for review), then delete the catalog record."""
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Movie not found")

    raw = dict(row.raw_data or {})
    folder_path = raw.get("folderPath") or (raw.get("jellyfinInfo") or {}).get("folderPath")

    move_result = None
    if folder_path and os.path.isdir(folder_path):
        move_result = await _move_folder_to_ingest(folder_path, movie_id, "movie", req)

    await db.execute(delete(Movie).where(Movie.id == movie_id))
    await db.commit()
    return {"deleted": movie_id, "movedTo": move_result}


@router.delete("/movies/{movie_id}", dependencies=[Depends(require_any_auth)])
async def delete_movie(movie_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(Movie).where(Movie.id == movie_id))
    await db.commit()
    return {"deleted": movie_id}


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------

@router.get("/series")
async def list_series(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Series).order_by(Series.title))
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.get("/series/lookup")
async def lookup_series(
    imdb_id: str | None = Query(None, alias="imdbId"),
    title_lower: str | None = Query(None, alias="titleLower"),
    db: AsyncSession = Depends(get_db),
) -> dict | None:
    """Return the first matching series by imdbId or titleLower, or null."""
    conditions = []
    if imdb_id:
        conditions.append(Series.imdb_id == imdb_id)
    if title_lower:
        conditions.append(Series.title == title_lower)
    if not conditions:
        raise HTTPException(status_code=400, detail="Provide imdbId or titleLower")
    result = await db.execute(select(Series).where(or_(*conditions)).limit(1))
    row = result.scalar_one_or_none()
    return _row_to_dict(row) if row else None


@router.get("/series/{series_id}")
async def get_series(series_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")
    return _row_to_dict(row)


@router.put("/series/{series_id}", dependencies=[Depends(require_any_auth)])
async def upsert_series(
    series_id: str,
    body: dict[str, Any],
    create_only: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create or replace. With ?create_only=true (the mobile "add" flow) an
    existing id is a 409 instead of a silent overwrite of the stored record."""
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Series(id=series_id)
        db.add(row)
    else:
        if create_only:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "already_exists",
                    "message": f"{row.title} is already in your catalog.",
                    "existingId": row.id,
                    "existingTitle": row.title,
                },
            )
        body = _with_kept_blobs(row, body)

    def _na(val: Any) -> Any:
        return None if val in (None, "N/A", "") else val

    omdb = body.get("omdbData") or {}
    tmdb = body.get("tmdbData") or {}
    networks = tmdb.get("networks") or []

    row.title           = body.get("title") or "Untitled"
    row.genres          = body.get("genres") or []
    row.languages       = body.get("languages") or []
    row.countries       = body.get("countryOfOrigin") or body.get("countries") or []
    row.running_years   = body.get("runningYears") or body.get("running_years") or []
    row.awards          = _na(omdb.get("Awards"))
    row.content_rating  = _na(omdb.get("Rated"))
    row.imdb_rating     = _na(omdb.get("imdbRating"))
    row.imdb_votes      = _na(omdb.get("imdbVotes"))
    row.metascore       = _na(omdb.get("Metascore"))
    row.status          = _na(tmdb.get("status")) if tmdb.get("status") else None
    row.network         = networks[0].get("name") if networks else None
    row.tagline         = _na(tmdb.get("tagline")) if tmdb else None
    row.tmdb_rating     = str(tmdb["vote_average"]) if tmdb.get("vote_average") is not None else None
    row.tmdb_vote_count = tmdb.get("vote_count") if tmdb.get("vote_count") is not None else None
    raw_total = _na(omdb.get("totalSeasons")) or _na(str(omdb.get("TotalSeasons", "")))
    row.total_seasons   = int(raw_total) if raw_total and str(raw_total).isdigit() else tmdb.get("number_of_seasons")
    row.total_episodes  = tmdb.get("number_of_episodes")
    row.imdb_id         = (body.get("externalIds") or {}).get("imdbId") or body.get("imdbId") or body.get("imdb_id")
    row.tmdb_id         = str(tmdb["id"]) if tmdb.get("id") else (body.get("externalIds") or {}).get("tmdbId") or row.tmdb_id
    row.omdb_data       = omdb if omdb else row.omdb_data
    row.tmdb_data       = tmdb if tmdb else row.tmdb_data
    row.image_files     = body.get("imageFiles") or body.get("image_files") or []
    row.series_summary  = body.get("seriesSummary") or body.get("series_summary") or {}
    row.assignment_summary = body.get("assignmentSummary") or body.get("assignment_summary") or {}
    row.jellyfin_info   = body.get("jellyfinInfo") or body.get("jellyfin_info") or {}
    row.raw_data        = body

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.patch("/series/{series_id}/folder-path", dependencies=[Depends(require_any_auth)])
async def patch_series_folder_path(series_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """Update only the folderPath field on a series record (in raw_data)."""
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")
    new_folder_path = body.get("folderPath")
    raw = dict(row.raw_data or {})
    raw["folderPath"] = new_folder_path
    raw["mediaType"] = "series"
    jellyfin_info = dict(raw.get("jellyfinInfo") or {})
    jellyfin_info["folderPath"] = new_folder_path
    raw["jellyfinInfo"] = jellyfin_info
    row.raw_data = raw
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(row, "raw_data")
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.post("/series/{series_id}/remove-to-review", dependencies=[Depends(require_any_auth)])
async def remove_series_to_review(series_id: str, req: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Move the series' folder into the ingest root (held for review), then delete the catalog record."""
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")

    raw = dict(row.raw_data or {})
    folder_path = raw.get("folderPath") or (raw.get("jellyfinInfo") or {}).get("folderPath")

    move_result = None
    if folder_path and os.path.isdir(folder_path):
        move_result = await _move_folder_to_ingest(folder_path, series_id, "series", req)

    await db.execute(delete(Series).where(Series.id == series_id))
    await db.commit()
    return {"deleted": series_id, "movedTo": move_result}


@router.delete("/series/{series_id}", dependencies=[Depends(require_any_auth)])
async def delete_series(series_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(Series).where(Series.id == series_id))
    await db.commit()
    return {"deleted": series_id}


# ---------------------------------------------------------------------------
# Discs
# ---------------------------------------------------------------------------

@router.get("/discs")
async def list_discs(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Disc).order_by(Disc.title))
    discs = result.scalars().all()

    # Real "has this been ripped" signal — media_files.disc_id is what
    # /link-source and the manual connect-file flow actually populate;
    # discs.video_files (folded into raw_data by _row_to_dict) is not
    # written by either, so it can't be trusted for this (see
    # my-library's getFileCountFromDiscIds, which this field now backs).
    counts_result = await db.execute(
        select(MediaFile.disc_id, func.count(MediaFile.id))
        .where(MediaFile.disc_id.isnot(None))
        .group_by(MediaFile.disc_id)
    )
    counts = dict(counts_result.all())

    # ripState: ripped / covered (its release has the files) / skipped (never
    # meant to be ripped) / unripped. linkedFileCount only knows "ripped".
    linked_files = (await db.execute(
        select(
            MediaFile.id, MediaFile.disc_id, MediaFile.release_id, MediaFile.movie_id, MediaFile.series_id,
            MediaFile.season_number, MediaFile.episode_number, MediaFile.is_available,
        ).where(or_(MediaFile.disc_id.isnot(None), MediaFile.release_id.isnot(None)))
    )).all()
    disc_links = (await db.execute(select(DiscMediaLink))).scalars().all()
    index = release_coverage.CoverageIndex(discs=discs, disc_links=disc_links, files=linked_files)

    return [
        {**_row_to_dict(row), "linkedFileCount": counts.get(row.id, 0), "ripState": index.disc_state(row)}
        for row in discs
    ]


@router.get("/discs/search")
async def search_discs(
    title: str | None = Query(default=None),
    barcode: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Look up existing discs by title and/or barcode. Used by disc-ripper-service
    (and the disc-ripper UI's "link to existing disc" flow) to find a
    previously-catalogued disc before creating a new one.
    """
    if not title and not barcode:
        return []

    conditions = []
    if title:
        conditions.append(Disc.title.ilike(f"%{title}%"))
    if barcode:
        conditions.append(Disc.barcode == barcode)
        # The barcode of a multi-disc release is on the release, not its discs.
        conditions.append(Disc.set_id.in_(select(DiscSet.id).where(DiscSet.barcode == barcode)))

    result = await db.execute(
        select(Disc).where(or_(*conditions)).order_by(Disc.title, Disc.disc_number).limit(25)
    )
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.post("/discs")
async def create_disc(
    body: dict[str, Any],
    check_duplicates: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Create a new disc record with a server-generated id. Unlike PUT /discs/{id}
    (which requires the caller to supply an id, awkward for service-to-service
    creation from disc-ripper-service), this is a plain create.

    Deliberately NOT behind require_any_auth: this endpoint's primary caller
    is disc-ripper-service (a trusted LAN service with no browser session or
    mobile token), and this codebase has no service-to-service auth
    mechanism (API keys, etc.) to build on. This matches the existing trust
    model of the read endpoints (GET /discs, GET /discs/{id} are also
    unauthenticated) rather than the require_any_auth pattern used for
    browser/mobile-driven mutations (PUT/DELETE).
    """
    if check_duplicates and not body.get("allowDuplicateBarcode"):
        await _reject_duplicate_barcode(Disc, body, db)
    body = await _normalize_physical_body(body, db)
    row = Disc(id=str(uuid.uuid4()))
    _apply_disc_fields(row, body)
    await _attach_disc_release(db, row)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/discs/{disc_id}")
async def get_disc(disc_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Disc).where(Disc.id == disc_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Disc not found")
    return _row_to_dict(row)


@router.get("/discs/{disc_id}/files")
async def list_disc_files(disc_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Media files ripped/scanned from this physical disc (media_files.disc_id)."""
    result = await db.execute(select(MediaFile).where(MediaFile.disc_id == disc_id))
    return [_media_file_to_dict(row) for row in result.scalars().all()]


@router.put("/discs/{disc_id}", dependencies=[Depends(require_any_auth)])
async def upsert_disc(
    disc_id: str,
    body: dict[str, Any],
    merge: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create or replace. ?merge=true lays the body over the stored record
    instead, so an edit that sends only changed fields can't wipe photos,
    loans or rip-queue state it never loaded."""
    body = await _normalize_physical_body(body, db)
    result = await db.execute(select(Disc).where(Disc.id == disc_id))
    row = result.scalar_one_or_none()

    previous_set_id = None
    is_new = row is None
    if is_new:
        row = Disc(id=disc_id)
    else:
        previous_set_id = row.set_id
        if merge:
            body = _merged(row, body)
        elif "setId" not in body and "set_id" not in body:
            # A replace that says nothing about the set (the web edit dialog)
            # keeps the set the record names. An explicit null takes it out.
            kept = (row.raw_data or {}).get("setId")
            if kept:
                body["setId"] = kept

    _apply_disc_fields(row, body)
    # The release is flushed in there, so a new disc is added only afterwards.
    await _attach_disc_release(db, row, previous_set_id)
    if is_new:
        db.add(row)
    if previous_set_id and previous_set_id != row.set_id:
        await db.flush()
        await db.execute(update(MediaFile).where(MediaFile.disc_id == disc_id).values(release_id=row.set_id))
        await _drop_empty_loose_release(db, previous_set_id)

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/discs/{disc_id}", dependencies=[Depends(require_any_auth)])
async def delete_disc(disc_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    set_id = (await db.execute(select(Disc.set_id).where(Disc.id == disc_id))).scalar_one_or_none()
    await db.execute(delete(Disc).where(Disc.id == disc_id))
    await _drop_empty_loose_release(db, set_id)
    await db.commit()
    return {"deleted": disc_id}


# ---------------------------------------------------------------------------
# Disc Sets (boxed sets — main feature + special features, theatrical vs.
# director's cut, a multi-disc season, etc. — grouped via discs.set_id)
# ---------------------------------------------------------------------------

def _disc_set_to_dict(row: DiscSet) -> dict:
    return {"id": row.id, "title": row.title}


@router.get("/disc-sets")
async def search_disc_sets(
    title: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List disc sets, optionally filtered by title — backs the "join an
    existing set" picker when adding a disc."""
    # Loose releases are the automatic one-disc wrappers, not sets to join.
    stmt = select(DiscSet).where(
        or_(DiscSet.packaging.is_(None), DiscSet.packaging != PACKAGING_LOOSE)
    ).order_by(DiscSet.title)
    if title:
        stmt = stmt.where(DiscSet.title.ilike(f"%{title}%"))
    result = await db.execute(stmt.limit(50))
    return [_disc_set_to_dict(row) for row in result.scalars().all()]


@router.get("/disc-sets/{set_id}")
async def get_disc_set(set_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(DiscSet).where(DiscSet.id == set_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Disc set not found")
    return _disc_set_to_dict(row)


@router.post("/disc-sets", dependencies=[Depends(require_any_auth)])
async def create_disc_set(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    row = DiscSet(id=str(uuid.uuid4()), title=title)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _disc_set_to_dict(row)


@router.get("/disc-sets/{set_id}/discs")
async def list_discs_in_set(set_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Other discs in this boxed set — backs an "other discs in this set"
    section on a disc's detail view."""
    result = await db.execute(select(Disc).where(Disc.set_id == set_id).order_by(Disc.disc_number, Disc.title))
    return [_row_to_dict(row) for row in result.scalars().all()]


# ---------------------------------------------------------------------------
# Disc <-> Media Links (a disc containing more than one movie/series, e.g.
# a double-feature disc — additive many-to-many, independent of the
# pre-existing single-valued disc.raw_data.mediaId/mediaType set by
# reassign-discs)
# ---------------------------------------------------------------------------

async def _titles_for_media(db: AsyncSession, refs: list[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """Batch-resolve {(mediaType, mediaId): title} for a list of refs."""
    movie_ids = [media_id for media_type, media_id in refs if media_type == "movie"]
    series_ids = [media_id for media_type, media_id in refs if media_type == "series"]
    titles: dict[tuple[str, str], str] = {}
    if movie_ids:
        result = await db.execute(select(Movie.id, Movie.title).where(Movie.id.in_(movie_ids)))
        for media_id, title in result.all():
            titles[("movie", media_id)] = title
    if series_ids:
        result = await db.execute(select(Series.id, Series.title).where(Series.id.in_(series_ids)))
        for media_id, title in result.all():
            titles[("series", media_id)] = title
    return titles


@router.get("/discs/{disc_id}/links")
async def list_disc_links(disc_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(DiscMediaLink).where(DiscMediaLink.disc_id == disc_id))
    links = result.scalars().all()
    titles = await _titles_for_media(db, [(link.media_type, link.media_id) for link in links])
    return [
        {
            "mediaType": link.media_type,
            "mediaId": link.media_id,
            "title": titles.get((link.media_type, link.media_id)),
            "seasonNumber": link.season_number,
            "episodeStart": link.episode_start,
            "episodeEnd": link.episode_end,
        }
        for link in links
    ]


def content_scope(body: dict[str, Any]) -> dict[str, int | None]:
    """The optional season / episode-range scope of a title on a release or
    disc, validated: a range needs a season, only a series has a scope, and
    the range must not run backwards."""
    scope = {
        "season_number": _int_or_none(body.get("seasonNumber"), "Season number"),
        "episode_start": _int_or_none(body.get("episodeStart"), "First episode"),
        "episode_end": _int_or_none(body.get("episodeEnd"), "Last episode"),
    }
    if any(value is not None and value < 0 for value in scope.values()):
        raise HTTPException(status_code=422, detail="Season and episode numbers cannot be negative.")
    has_range = scope["episode_start"] is not None or scope["episode_end"] is not None
    if has_range and scope["season_number"] is None:
        raise HTTPException(status_code=422, detail="An episode range needs a season number.")
    if scope["season_number"] is not None and body.get("mediaType") != "series":
        raise HTTPException(status_code=422, detail="Only a series can have a season or episode range.")
    if (
        scope["episode_start"] is not None and scope["episode_end"] is not None
        and scope["episode_end"] < scope["episode_start"]
    ):
        raise HTTPException(status_code=422, detail="The last episode cannot come before the first.")
    return scope


@router.post("/discs/{disc_id}/links", dependencies=[Depends(require_any_auth)])
async def add_disc_link(disc_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """Link a disc to a title. ``seasonNumber`` / ``episodeStart`` /
    ``episodeEnd`` optionally say which part of a series the disc holds;
    sending them for a link that exists updates its scope."""
    media_type = body.get("mediaType")
    media_id = body.get("mediaId")
    if media_type not in ("movie", "series") or not media_id:
        raise HTTPException(status_code=400, detail="mediaType ('movie'|'series') and mediaId are required")
    scope = content_scope(body)

    disc_result = await db.execute(select(Disc.id).where(Disc.id == disc_id))
    if disc_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Disc not found")

    # ON CONFLICT, not check-then-insert: a retried save racing the first
    # attempt would otherwise hit the primary key and 500.
    stmt = pg_insert(DiscMediaLink).values(disc_id=disc_id, media_type=media_type, media_id=media_id, **scope)
    if any(key in body for key in ("seasonNumber", "episodeStart", "episodeEnd")):
        stmt = stmt.on_conflict_do_update(
            index_elements=[DiscMediaLink.disc_id, DiscMediaLink.media_type, DiscMediaLink.media_id],
            set_=scope,
        )
    else:
        stmt = stmt.on_conflict_do_nothing()
    await db.execute(stmt)
    await db.commit()
    return {
        "discId": disc_id, "mediaType": media_type, "mediaId": media_id,
        "seasonNumber": scope["season_number"],
        "episodeStart": scope["episode_start"],
        "episodeEnd": scope["episode_end"],
    }


@router.delete("/discs/{disc_id}/links/{media_type}/{media_id}", dependencies=[Depends(require_any_auth)])
async def remove_disc_link(disc_id: str, media_type: str, media_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(
        delete(DiscMediaLink).where(
            DiscMediaLink.disc_id == disc_id,
            DiscMediaLink.media_type == media_type,
            DiscMediaLink.media_id == media_id,
        )
    )
    await db.commit()
    return {"discId": disc_id, "mediaType": media_type, "mediaId": media_id, "deleted": True}


# ---------------------------------------------------------------------------
# Tapes
# ---------------------------------------------------------------------------

@router.get("/tapes")
async def list_tapes(db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(Tape).order_by(Tape.title))
    tapes = result.scalars().all()

    # Same "has this been digitized" signal as list_discs above —
    # media_files.tape_id is what the ingest/connect-file flow populates.
    counts_result = await db.execute(
        select(MediaFile.tape_id, func.count(MediaFile.id))
        .where(MediaFile.tape_id.isnot(None))
        .group_by(MediaFile.tape_id)
    )
    counts = dict(counts_result.all())

    return [{**_row_to_dict(row), "linkedFileCount": counts.get(row.id, 0)} for row in tapes]


@router.get("/tapes/search")
async def search_tapes(
    title: str | None = Query(default=None),
    tape_label: str | None = Query(default=None),
    barcode: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Look up existing tapes by title, physical label (e.g. 'VHSC_0001'), and/or barcode."""
    if not title and not tape_label and not barcode:
        return []

    conditions = []
    if title:
        conditions.append(Tape.title.ilike(f"%{title}%"))
    if tape_label:
        conditions.append(Tape.tape_label == tape_label)
    if barcode:
        conditions.append(Tape.barcode == barcode)

    result = await db.execute(
        select(Tape).where(or_(*conditions)).order_by(Tape.title).limit(25)
    )
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.post("/tapes")
async def create_tape(
    body: dict[str, Any],
    check_duplicates: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Create a new tape record with a server-generated id. Deliberately NOT
    behind require_any_auth — matches the discs endpoints' trust model
    (see create_disc's docstring).
    """
    if check_duplicates and not body.get("allowDuplicateBarcode"):
        await _reject_duplicate_barcode(Tape, body, db)
    body = await _normalize_physical_body(body, db)
    row = Tape(id=str(uuid.uuid4()))
    _apply_tape_fields(row, body)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/tapes/{tape_id}")
async def get_tape(tape_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Tape).where(Tape.id == tape_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Tape not found")
    return _row_to_dict(row)


@router.get("/tapes/{tape_id}/files")
async def list_tape_files(tape_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Media files digitized from this physical tape (media_files.tape_id)."""
    result = await db.execute(select(MediaFile).where(MediaFile.tape_id == tape_id))
    return [_media_file_to_dict(row) for row in result.scalars().all()]


@router.put("/tapes/{tape_id}", dependencies=[Depends(require_any_auth)])
async def upsert_tape(
    tape_id: str,
    body: dict[str, Any],
    merge: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create or replace; ?merge=true as for upsert_disc."""
    body = await _normalize_physical_body(body, db)
    result = await db.execute(select(Tape).where(Tape.id == tape_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Tape(id=tape_id)
        db.add(row)
    elif merge:
        body = _merged(row, body)

    _apply_tape_fields(row, body)

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/tapes/{tape_id}", dependencies=[Depends(require_any_auth)])
async def delete_tape(tape_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(Tape).where(Tape.id == tape_id))
    await db.commit()
    return {"deleted": tape_id}


@router.get("/disc-sets/{set_id}/tapes")
async def list_tapes_in_set(set_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Other tapes in this boxed set — tape counterpart of list_discs_in_set.
    disc_sets itself needs no tape-specific handling, it's already
    media-type-generic (see DiscSet's docstring in db/models.py)."""
    result = await db.execute(select(Tape).where(Tape.set_id == set_id).order_by(Tape.title))
    return [_row_to_dict(row) for row in result.scalars().all()]


# ---------------------------------------------------------------------------
# Tape <-> Media Links (a tape containing more than one movie/series —
# mirrors "Disc <-> Media Links" below, using tape_media_links)
# ---------------------------------------------------------------------------

@router.get("/tapes/{tape_id}/links")
async def list_tape_links(tape_id: str, db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(select(TapeMediaLink).where(TapeMediaLink.tape_id == tape_id))
    links = result.scalars().all()
    titles = await _titles_for_media(db, [(link.media_type, link.media_id) for link in links])
    return [
        {
            "mediaType": link.media_type,
            "mediaId": link.media_id,
            "title": titles.get((link.media_type, link.media_id)),
        }
        for link in links
    ]


@router.post("/tapes/{tape_id}/links", dependencies=[Depends(require_any_auth)])
async def add_tape_link(tape_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    media_type = body.get("mediaType")
    media_id = body.get("mediaId")
    if media_type not in ("movie", "series") or not media_id:
        raise HTTPException(status_code=400, detail="mediaType ('movie'|'series') and mediaId are required")

    tape_result = await db.execute(select(Tape.id).where(Tape.id == tape_id))
    if tape_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Tape not found")

    await db.execute(
        pg_insert(TapeMediaLink)
        .values(tape_id=tape_id, media_type=media_type, media_id=media_id)
        .on_conflict_do_nothing()
    )
    await db.commit()
    return {"tapeId": tape_id, "mediaType": media_type, "mediaId": media_id}


@router.delete("/tapes/{tape_id}/links/{media_type}/{media_id}", dependencies=[Depends(require_any_auth)])
async def remove_tape_link(tape_id: str, media_type: str, media_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(
        delete(TapeMediaLink).where(
            TapeMediaLink.tape_id == tape_id,
            TapeMediaLink.media_type == media_type,
            TapeMediaLink.media_id == media_id,
        )
    )
    await db.commit()
    return {"tapeId": tape_id, "mediaType": media_type, "mediaId": media_id, "deleted": True}


# ---------------------------------------------------------------------------
# Reverse lookup: Media -> Discs/Tapes
# ---------------------------------------------------------------------------

@router.get("/media/{media_type}/{media_id}/discs")
async def list_media_discs_and_tapes(
    media_type: str, media_id: str, db: AsyncSession = Depends(get_db)
) -> dict[str, list[dict]]:
    """
    Reverse lookup: every Disc/Tape linked to a Movie/Series, via the
    disc_media_links/tape_media_links many-to-many tables, the legacy
    scalar raw_data.mediaId field (set by reassign-discs), OR a release that
    holds the title (release_contents: the discs of a multi-disc release
    carry no title links of their own). Backs the
    my-library detail page's "Associated Discs and Files" section.
    """
    if media_type not in ("movie", "series"):
        raise HTTPException(status_code=400, detail="media_type must be 'movie' or 'series'")
    return await discs_and_tapes_for_media(db, media_type, media_id)


async def discs_and_tapes_for_media(db: AsyncSession, media_type: str, media_id: str) -> dict[str, list[dict]]:
    """Discs and tapes linked to a movies/series row (``media_type`` is the table:
    ``movie`` or ``series``), via the link tables or the legacy raw_data.mediaId."""
    linked_disc_ids = (await db.execute(
        select(DiscMediaLink.disc_id).where(
            DiscMediaLink.media_type == media_type, DiscMediaLink.media_id == media_id
        )
    )).scalars().all()
    release_ids = select(ReleaseContent.release_id).where(
        ReleaseContent.media_type == media_type, ReleaseContent.media_id == media_id
    )
    discs = (await db.execute(
        select(Disc).where(
            or_(
                Disc.id.in_(linked_disc_ids),
                Disc.raw_data["mediaId"].astext == media_id,
                Disc.set_id.in_(release_ids),
            )
        ).order_by(Disc.title, Disc.disc_number)
    )).scalars().all()

    linked_tape_ids = (await db.execute(
        select(TapeMediaLink.tape_id).where(
            TapeMediaLink.media_type == media_type, TapeMediaLink.media_id == media_id
        )
    )).scalars().all()
    tapes = (await db.execute(
        select(Tape).where(
            or_(Tape.id.in_(linked_tape_ids), Tape.raw_data["mediaId"].astext == media_id)
        ).order_by(Tape.title)
    )).scalars().all()

    disc_counts = dict((await db.execute(
        select(MediaFile.disc_id, func.count(MediaFile.id))
        .where(MediaFile.disc_id.in_([d.id for d in discs]))
        .group_by(MediaFile.disc_id)
    )).all()) if discs else {}
    tape_counts = dict((await db.execute(
        select(MediaFile.tape_id, func.count(MediaFile.id))
        .where(MediaFile.tape_id.in_([t.id for t in tapes]))
        .group_by(MediaFile.tape_id)
    )).all()) if tapes else {}

    # Prefer the dedicated storage_type/storage_id columns over whatever
    # raw_data happens to carry — raw_data is only as fresh as the last
    # write's body, so a row updated by a flow that didn't round-trip these
    # fields would otherwise silently under-report a real storage location.
    return {
        "discs": [
            {**_row_to_dict(d), "storageType": d.storage_type, "storageId": d.storage_id,
             "linkedFileCount": disc_counts.get(d.id, 0)}
            for d in discs
        ],
        "tapes": [
            {**_row_to_dict(t), "storageType": t.storage_type, "storageId": t.storage_id,
             "linkedFileCount": tape_counts.get(t.id, 0)}
            for t in tapes
        ],
    }


# ---------------------------------------------------------------------------
# Source Media Linking
# ---------------------------------------------------------------------------

@router.post("/link-source")
async def link_source_media(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """
    Link delivered file paths to the disc/tape they were ripped/digitized from.

    Called by disc-ripper-service right after delivery (see its
    services/catalog_client.py) since it's the only place that knows which
    physical disc a rip job was linked to — delivery itself is filesystem-only
    (no other push from disc-ripper to here), so this is the one point where
    that link gets recorded. Upserts a MediaFile row per path (by the unique
    file_path column) rather than requiring the ingest watcher to have
    processed the file first — assignment_orchestrator's own upsert-by-path
    later fills in the rest without disturbing disc_id/tape_id set here.

    Body: { filePaths: string[], discId?: string, tapeId?: string }
    """
    file_paths: list[str] = body.get("filePaths") or []
    disc_id: str | None = body.get("discId")
    tape_id: str | None = body.get("tapeId")

    if not file_paths:
        raise HTTPException(status_code=400, detail="filePaths must not be empty")
    if not disc_id and not tape_id:
        raise HTTPException(status_code=400, detail="discId or tapeId is required")

    release_id = None
    if disc_id:
        release_id = (await db.execute(select(Disc.set_id).where(Disc.id == disc_id))).scalar_one_or_none()

    linked: list[str] = []
    for file_path in file_paths:
        # A call that arrives after the file was organized finds the organized
        # row (through the recorded move) instead of leaving an orphan at the
        # ingest path.
        media_file = await media_file_index.resolve_current(db, file_path)
        if media_file is None:
            media_file = await media_file_index.upsert_by_path(db, file_path)
        if disc_id:
            media_file.disc_id = disc_id
            media_file.release_id = release_id
            media_file.source_kind = "disc"
        if tape_id:
            media_file.tape_id = tape_id
            if not disc_id:
                media_file.source_kind = "tape"
        linked.append(file_path)

    await db.commit()
    return {"linked": linked, "discId": disc_id, "tapeId": tape_id}


@router.get("/media-files/search")
async def search_media_files(
    q: str | None = Query(default=None),
    unlinked: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Search scanned/ingested files by filename — backs the "connect an
    existing file to this disc/tape" picker on the physical-media detail
    page. `unlinked=true` restricts to files with no disc_id and no tape_id
    set yet, the common case (avoids re-linking a file already attached
    elsewhere without realizing it).
    """
    conditions = []
    if q:
        conditions.append(MediaFile.file_name.ilike(f"%{q}%"))
    if unlinked:
        conditions.append(MediaFile.disc_id.is_(None))
        conditions.append(MediaFile.tape_id.is_(None))

    stmt = select(MediaFile)
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = stmt.order_by(MediaFile.file_name).limit(50)

    result = await db.execute(stmt)
    return [_media_file_to_dict(row) for row in result.scalars().all()]


@router.patch("/media-files/{file_id}/link", dependencies=[Depends(require_any_auth)])
async def link_media_file(file_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """
    Connect or disconnect a single existing MediaFile to/from a disc or tape.

    Body: { discId?: string | null, tapeId?: string | null }
    Passing null (or omitting a key entirely) clears that link — this is
    "disconnect". Passing a real id sets it — "connect". Setting discId
    also clears tapeId and vice versa (a file only comes from one physical
    source), unless both are explicitly passed as null (fully disconnect).
    """
    result = await db.execute(select(MediaFile).where(MediaFile.id == file_id))
    media_file = result.scalar_one_or_none()
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")

    if "sourceKind" in body:
        source_kind = body["sourceKind"] or None
        if source_kind is not None and source_kind not in SOURCE_KINDS:
            raise HTTPException(status_code=422, detail=f"sourceKind must be one of: {', '.join(SOURCE_KINDS)}.")
        media_file.source_kind = source_kind

    # releaseId alone: the file came from this release, exact disc unknown.
    if "releaseId" in body:
        release_id = body["releaseId"]
        if release_id:
            release_result = await db.execute(select(DiscSet.id).where(DiscSet.id == release_id))
            if release_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail=f"Release not found: {release_id}")
            if media_file.disc_id and "discId" not in body:
                # A disc of another release would contradict it; drop the disc.
                current = await db.execute(select(Disc.set_id).where(Disc.id == media_file.disc_id))
                if current.scalar_one_or_none() != release_id:
                    media_file.disc_id = None
            media_file.release_id = release_id
            media_file.tape_id = None
            media_file.source_kind = "disc"
        else:
            media_file.release_id = None
            media_file.disc_id = None

    if "discId" in body:
        disc_id = body["discId"]
        if disc_id:
            disc_result = await db.execute(select(Disc).where(Disc.id == disc_id))
            disc_row = disc_result.scalar_one_or_none()
            if disc_row is None:
                raise HTTPException(status_code=404, detail=f"Disc not found: {disc_id}")
            media_file.disc_id = disc_id
            # The disc decides the release, whatever releaseId said.
            media_file.release_id = disc_row.set_id
            media_file.tape_id = None
            media_file.source_kind = "disc"
        else:
            media_file.disc_id = None
            if "releaseId" not in body:
                media_file.release_id = None
            if media_file.source_kind == "disc" and not media_file.release_id and "sourceKind" not in body:
                media_file.source_kind = None

    if "tapeId" in body:
        tape_id = body["tapeId"]
        if tape_id:
            tape_result = await db.execute(select(Tape.id).where(Tape.id == tape_id))
            if tape_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail=f"Tape not found: {tape_id}")
            media_file.tape_id = tape_id
            media_file.disc_id = None
            media_file.release_id = None
            media_file.source_kind = "tape"
        else:
            media_file.tape_id = None
            if media_file.source_kind == "tape" and "sourceKind" not in body:
                media_file.source_kind = None

    await db.commit()
    await db.refresh(media_file)
    return _media_file_to_dict(media_file)


# ---------------------------------------------------------------------------
# Disc Reassignment
# ---------------------------------------------------------------------------

@router.post("/reassign-discs", dependencies=[Depends(require_any_auth)])
async def reassign_discs(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """
    Move a set of disc records from one catalog entry to another.

    Body:
      discIds     – list of disc IDs to reassign
      fromMediaId – current catalog entry that owns these discs
      toMediaId   – target catalog entry (must already exist)
      toMediaType – "movie" | "series"
    """
    disc_ids: list[str] = body.get("discIds") or []
    from_media_id: str  = body.get("fromMediaId") or ""
    to_media_id: str    = body.get("toMediaId") or ""
    to_media_type: str  = body.get("toMediaType") or "movie"
    classification: str = body.get("classification") or "main_feature"

    _valid_classifications = {"main_feature", "special_feature", "alternate_version"}
    if classification not in _valid_classifications:
        raise HTTPException(status_code=400, detail=f"classification must be one of: {', '.join(sorted(_valid_classifications))}")

    if not disc_ids or not from_media_id or not to_media_id:
        raise HTTPException(status_code=400, detail="discIds, fromMediaId and toMediaId are required")

    if from_media_id == to_media_id:
        raise HTTPException(status_code=400, detail="fromMediaId and toMediaId must be different")

    # ------------------------------------------------------------------ #
    # Fetch source and target catalog entries
    # ------------------------------------------------------------------ #
    Model = Movie if to_media_type == "movie" else Series
    FromModel = Movie if _detect_media_type(from_media_id, db) == "movie" else Series

    # We need both the from and to entity to exist
    from_res = await db.execute(
        select(Movie).where(Movie.id == from_media_id)
    )
    from_row = from_res.scalar_one_or_none()
    if from_row is None:
        from_res2 = await db.execute(select(Series).where(Series.id == from_media_id))
        from_row = from_res2.scalar_one_or_none()
    if from_row is None:
        raise HTTPException(status_code=404, detail=f"Source catalog entry not found: {from_media_id}")

    to_res = await db.execute(select(Model).where(Model.id == to_media_id))
    to_row = to_res.scalar_one_or_none()
    if to_row is None:
        raise HTTPException(status_code=404, detail=f"Target catalog entry not found: {to_media_id}")

    # ------------------------------------------------------------------ #
    # Update the source entry — remove disc IDs from raw_data releases
    # ------------------------------------------------------------------ #
    disc_id_set = set(disc_ids)
    from_raw: dict = dict(from_row.raw_data or {})
    from_releases: list = list(from_raw.get("releases") or [])
    for release in from_releases:
        if isinstance(release.get("discIds"), list):
            release["discIds"] = [d for d in release["discIds"] if d not in disc_id_set]
    from_raw["releases"] = from_releases
    from_row.raw_data = from_raw

    # ------------------------------------------------------------------ #
    # Update the target entry — add disc IDs to a "reassigned" release slot
    # ------------------------------------------------------------------ #
    to_raw: dict = dict(to_row.raw_data or {})
    to_releases: list = list(to_raw.get("releases") or [])

    # Find (or create) a reassigned-files release bucket per classification
    slot_edition = f"_reassigned_{classification}"
    reassign_slot: dict | None = next(
        (r for r in to_releases if r.get("edition") == slot_edition), None
    )
    if reassign_slot is None:
        slot_label = {
            "main_feature":     "Reassigned – Main Feature",
            "special_feature":  "Reassigned – Special Feature",
            "alternate_version": "Reassigned – Alternate Version",
        }.get(classification, "Reassigned Files")
        reassign_slot = {
            "id": f"reassigned-{classification}-{to_media_id}",
            "edition": slot_edition,
            "classification": classification,
            "title": slot_label,
            "discIds": [],
        }
        to_releases.append(reassign_slot)

    existing_disc_ids: list = list(reassign_slot.get("discIds") or [])
    for disc_id in disc_ids:
        if disc_id not in existing_disc_ids:
            existing_disc_ids.append(disc_id)
    reassign_slot["discIds"] = existing_disc_ids
    to_raw["releases"] = to_releases
    to_row.raw_data = to_raw

    # ------------------------------------------------------------------ #
    # Update each disc record — update raw_data.mediaId / mediaType
    # ------------------------------------------------------------------ #
    disc_res = await db.execute(select(Disc).where(Disc.id.in_(disc_ids)))
    updated_disc_ids: list[str] = []
    for disc in disc_res.scalars().all():
        disc_raw: dict = dict(disc.raw_data or {})
        disc_raw["mediaId"]        = to_media_id
        disc_raw["mediaType"]      = to_media_type
        disc_raw["classification"] = classification
        disc.raw_data = disc_raw
        updated_disc_ids.append(disc.id)

    await db.commit()

    return {
        "success": True,
        "reassigned": updated_disc_ids,
        "toMediaId": to_media_id,
        "toMediaType": to_media_type,
    }


def _detect_media_type(media_id: str, db: Any) -> str:
    """Placeholder — type is inferred from query in the endpoint above."""
    return "movie"


# ---------------------------------------------------------------------------
# Collection Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
async def catalog_stats(
    recent_days: int = Query(default=RECENT_DAYS_DEFAULT, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Whole-catalog summary: counts by type, disc format and release
    decade, what was added in the last `recent_days` (30 by default),
    storage-location coverage, and what's currently lent out.

    There is no existing stats endpoint to reuse — /metrics is Prometheus
    scraping, not catalog figures — so the counting happens once here (in
    services/catalog_stats.py) and the web page and mobile screen can share
    it instead of each deriving totals from the list endpoints. Read-only
    like every other GET in this router (no require_any_auth), at one query
    per catalog table.

    Loans have no column or table of their own, so "lent out" is read out of
    the `raw_data` the mobile app writes. Two shapes are understood, and a
    record counts while its newest loan is unreturned:

      `loans` (also `loanHistory`/`lendingHistory`, a bare object counts too)
        a list of loan objects naming who (`loanedTo`/`lentTo`/`borrower`/
        `who`/`name`, or a nested `{"loanedTo": {"name": …}}`), when it left
        (`loanedAt`/`date`/`dateOut`), when it is due (`due`), and what closed
        it — a return date (`returnedAt`/`dateBack`/`returnDate`), a return
        flag (`returned: true`, not `false`), or a loan `status`/`loanStatus`
        that reads as back. A loan `status` is read from loan keys only: a
        record-level `status` on a series is the series status ("Ended"), so
        it is never a return marker.
      bare fields on the record
        `loanedTo`/`lentTo`/`borrower`/`onLoanTo` for the person, `onLoan`/
        `loanOut`/`isLent` for the flag. `onLoan: false` or a record return
        marker (`returnedAt`, `dateBack`, `returned`, …) means it came home.

    Both shapes are consulted, so `loans: [{"loanedTo": "Bo"}]` counts even
    when a stale `returned: true` sits next to it, and `loanedTo: "Sam"` with
    `returnedAt: "2026-02-04"` does not. `services/catalog_stats.py` states
    the contract in full next to the code that implements it.

    `recentlyAdded.items` and `lentOut.items` are capped at 12 entries while
    their `count` stays the whole total — callers (the web stats page) show
    "Showing 12 of N" rather than pretending the list is the lot.

    Issue #16 AC1 is pinned by backend/tests/test_catalog_stats.py::
    test_ac1_endpoint_returns_every_breakdown_the_criterion_names (mocked DB),
    with the route/auth/real-ORM/window/loan-shape probes in
    tests/test_catalog_stats_qa_probes.py and
    tests/test_catalog_stats_qa_probes_round2.py, and the per-figure
    aggregator tests in tests/test_catalog_stats_builder.py.
    """
    movies = (await db.execute(select(Movie))).scalars().all()
    series = (await db.execute(select(Series))).scalars().all()
    discs = (await db.execute(select(Disc))).scalars().all()
    tapes = (await db.execute(select(Tape))).scalars().all()
    return build_catalog_stats(
        movies=movies, series=series, discs=discs, tapes=tapes, recent_days=recent_days
    )
