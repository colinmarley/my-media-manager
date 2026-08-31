"""
Catalog API — CRUD endpoints for the media catalog (movies, series, discs).

All endpoints return data in the same shape the frontend catalog hooks
previously expected, so no frontend type changes are required.  The full
catalog document is stored in the `raw_data` JSONB column and returned
as the payload, with the PostgreSQL primary-key `id` guaranteed to be set.
"""

import os
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_
from typing import Any

from db.database import get_db
from db.models import Movie, Series, Disc, DiscSet, DiscMediaLink, Tape, MediaFile
from api.mobile_auth import require_any_auth
from config.settings import settings

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _row_to_dict(row, id_field: str = "id") -> dict:
    """Return the raw_data blob with id guaranteed."""
    data: dict = dict(row.raw_data or {})
    data["id"] = getattr(row, id_field)
    return data


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
    row.language = body.get("language")
    row.purchase_date = body.get("purchaseDate") or body.get("purchase_date")
    row.release_date = body.get("releaseDate") or body.get("release_date")
    row.is_part_of_set = bool(body.get("isPartOfSet") or body.get("is_part_of_set") or False)
    row.is_rental_disc = bool(body.get("isRentalDisc") or body.get("is_rental_disc") or False)
    row.contains_special_features = bool(
        body.get("containsSpecialFeatures") or body.get("contains_special_features") or False
    )
    row.raw_data = body


def _apply_tape_fields(row: Tape, body: dict[str, Any]) -> None:
    """Sync the flattened Tape columns from body — same rationale as
    _apply_disc_fields (search_tapes() filters on tape_label directly)."""
    row.title = body.get("title") or "Untitled"
    row.tape_type = body.get("tapeType") or body.get("tape_type")
    row.tape_label = body.get("tapeLabel") or body.get("tape_label")
    row.brand = body.get("brand")
    row.condition = body.get("condition")
    row.recording_speed = body.get("recordingSpeed") or body.get("recording_speed")
    row.label_notes = body.get("labelNotes") or body.get("label_notes")
    row.purchase_date = body.get("purchaseDate") or body.get("purchase_date")
    row.raw_data = body


def _media_file_to_dict(row: MediaFile) -> dict:
    return {
        "id": row.id,
        "fileName": row.file_name,
        "filePath": row.file_path,
        "fileSize": row.file_size,
        "detectedMediaType": row.detected_media_type,
        "assignmentStatus": row.assignment_status,
        "targetPath": row.target_path,
        "organizationStatus": row.organization_status,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
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
async def upsert_movie(movie_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Movie(id=movie_id)
        db.add(row)

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
    row.collection_order = body.get("collectionOrder") or body.get("collection_order")
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
async def remove_movie_to_review(movie_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Move the movie's folder to _NeedsReview, then delete the catalog record."""
    result = await db.execute(select(Movie).where(Movie.id == movie_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Movie not found")

    raw = dict(row.raw_data or {})
    folder_path = raw.get("folderPath") or (raw.get("jellyfinInfo") or {}).get("folderPath")

    move_result = None
    if folder_path and os.path.isdir(folder_path):
        dest_base = os.path.realpath(settings.jellyfin_dest_base)
        real_src = os.path.realpath(folder_path)
        if not real_src.startswith(dest_base + os.sep):
            raise HTTPException(status_code=403, detail="Folder is outside the media destination.")
        review_dir = os.path.join(dest_base, settings.folder_needs_review)
        os.makedirs(review_dir, exist_ok=True)
        dest = os.path.join(review_dir, os.path.basename(real_src))
        if os.path.exists(dest):
            dest = dest + f"__{movie_id[:8]}"
        shutil.move(real_src, dest)
        move_result = dest

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
async def upsert_series(series_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Series(id=series_id)
        db.add(row)

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
async def remove_series_to_review(series_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Move the series' folder to _NeedsReview, then delete the catalog record."""
    result = await db.execute(select(Series).where(Series.id == series_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")

    raw = dict(row.raw_data or {})
    folder_path = raw.get("folderPath") or (raw.get("jellyfinInfo") or {}).get("folderPath")

    move_result = None
    if folder_path and os.path.isdir(folder_path):
        dest_base = os.path.realpath(settings.jellyfin_dest_base)
        real_src = os.path.realpath(folder_path)
        if not real_src.startswith(dest_base + os.sep):
            raise HTTPException(status_code=403, detail="Folder is outside the media destination.")
        review_dir = os.path.join(dest_base, settings.folder_needs_review)
        os.makedirs(review_dir, exist_ok=True)
        dest = os.path.join(review_dir, os.path.basename(real_src))
        if os.path.exists(dest):
            dest = dest + f"__{series_id[:8]}"
        shutil.move(real_src, dest)
        move_result = dest

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
    return [_row_to_dict(row) for row in result.scalars().all()]


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

    result = await db.execute(
        select(Disc).where(or_(*conditions)).order_by(Disc.title).limit(25)
    )
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.post("/discs")
async def create_disc(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
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
    row = Disc(id=str(uuid.uuid4()))
    _apply_disc_fields(row, body)
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
async def upsert_disc(disc_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Disc).where(Disc.id == disc_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Disc(id=disc_id)
        db.add(row)

    _apply_disc_fields(row, body)

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/discs/{disc_id}", dependencies=[Depends(require_any_auth)])
async def delete_disc(disc_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(Disc).where(Disc.id == disc_id))
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
    stmt = select(DiscSet).order_by(DiscSet.title)
    if title:
        stmt = select(DiscSet).where(DiscSet.title.ilike(f"%{title}%")).order_by(DiscSet.title)
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
        }
        for link in links
    ]


@router.post("/discs/{disc_id}/links", dependencies=[Depends(require_any_auth)])
async def add_disc_link(disc_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    media_type = body.get("mediaType")
    media_id = body.get("mediaId")
    if media_type not in ("movie", "series") or not media_id:
        raise HTTPException(status_code=400, detail="mediaType ('movie'|'series') and mediaId are required")

    disc_result = await db.execute(select(Disc.id).where(Disc.id == disc_id))
    if disc_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Disc not found")

    existing = await db.execute(
        select(DiscMediaLink).where(
            DiscMediaLink.disc_id == disc_id,
            DiscMediaLink.media_type == media_type,
            DiscMediaLink.media_id == media_id,
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(DiscMediaLink(disc_id=disc_id, media_type=media_type, media_id=media_id))
        await db.commit()
    return {"discId": disc_id, "mediaType": media_type, "mediaId": media_id}


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
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.get("/tapes/search")
async def search_tapes(
    title: str | None = Query(default=None),
    tape_label: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Look up existing tapes by title and/or physical label (e.g. 'VHSC_0001')."""
    if not title and not tape_label:
        return []

    conditions = []
    if title:
        conditions.append(Tape.title.ilike(f"%{title}%"))
    if tape_label:
        conditions.append(Tape.tape_label == tape_label)

    result = await db.execute(
        select(Tape).where(or_(*conditions)).order_by(Tape.title).limit(25)
    )
    return [_row_to_dict(row) for row in result.scalars().all()]


@router.post("/tapes")
async def create_tape(body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    """
    Create a new tape record with a server-generated id. Deliberately NOT
    behind require_any_auth — matches the discs endpoints' trust model
    (see create_disc's docstring).
    """
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
async def upsert_tape(tape_id: str, body: dict[str, Any], db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Tape).where(Tape.id == tape_id))
    row = result.scalar_one_or_none()

    if row is None:
        row = Tape(id=tape_id)
        db.add(row)

    _apply_tape_fields(row, body)

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/tapes/{tape_id}", dependencies=[Depends(require_any_auth)])
async def delete_tape(tape_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(Tape).where(Tape.id == tape_id))
    await db.commit()
    return {"deleted": tape_id}


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

    linked: list[str] = []
    for file_path in file_paths:
        result = await db.execute(select(MediaFile).where(MediaFile.file_path == file_path))
        media_file = result.scalar_one_or_none()
        if media_file is None:
            media_file = MediaFile(
                id=str(uuid.uuid4()),
                file_path=file_path,
                file_name=os.path.basename(file_path),
            )
            db.add(media_file)
        if disc_id:
            media_file.disc_id = disc_id
        if tape_id:
            media_file.tape_id = tape_id
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

    if "discId" in body:
        disc_id = body["discId"]
        if disc_id:
            disc_result = await db.execute(select(Disc.id).where(Disc.id == disc_id))
            if disc_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail=f"Disc not found: {disc_id}")
            media_file.disc_id = disc_id
            media_file.tape_id = None
        else:
            media_file.disc_id = None

    if "tapeId" in body:
        tape_id = body["tapeId"]
        if tape_id:
            tape_result = await db.execute(select(Tape.id).where(Tape.id == tape_id))
            if tape_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=404, detail=f"Tape not found: {tape_id}")
            media_file.tape_id = tape_id
            media_file.disc_id = None
        else:
            media_file.tape_id = None

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
