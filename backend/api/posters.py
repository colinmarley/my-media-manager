"""
Poster image endpoints.

GET  /api/posters/{media_type}/{media_id}           serve poster by index (?index=N)
GET  /api/posters/{media_type}/{media_id}/list       return all cached poster metadata
POST /api/posters/{media_type}/{media_id}/refresh    force re-check against source (auth)

On each primary-poster (index=0) request a background task checks whether the
source URL has changed since the last fetch (max once per 24 hours). If a new
version is detected it is stored as an additional poster so both versions are
available for browsing.
"""

import re

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from api.auth import require_session
from config.settings import settings
from db.database import get_db
from db.models import Movie, Series
from services.poster_cache_service import (
    download_poster,
    force_refresh,
    get_poster_list,
    get_poster_path,
    refresh_if_stale,
)

router = APIRouter(prefix="/api/posters", tags=["Posters"])

_MEDIA_MODELS: dict = {
    "movie": Movie,
    "series": Series,
}

_CACHE_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}  # 7 days


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _poster_format_from_url(url: str) -> str:
    match = re.search(r"\.([a-zA-Z0-9]+)(?:\?|$)", url)
    ext = match.group(1).lower() if match else "jpg"
    return ext if ext in {"jpg", "jpeg", "png", "webp", "gif"} else "jpg"


def _apply_manual_poster_source(row, source_url: str) -> dict:
    raw: dict = dict(row.raw_data or {})
    omdb = dict(raw.get("omdbData") or {})
    image_files = [
        img for img in list(raw.get("imageFiles") or [])
        if not (isinstance(img, dict) and img.get("fileName") == source_url)
    ]
    image_files.insert(0, {"fileName": source_url, "format": _poster_format_from_url(source_url)})

    omdb["Poster"] = source_url
    raw["Poster"] = source_url
    raw["posterUrl"] = source_url
    raw["omdbData"] = omdb
    raw["imageFiles"] = image_files

    row.raw_data = raw
    if hasattr(row, "image_files"):
        row.image_files = image_files
    if hasattr(row, "omdb_data"):
        row.omdb_data = omdb

    return raw

async def _resolve_poster_url(media_type: str, media_id: str, db: AsyncSession) -> str | None:
    """Extract the best available poster URL from the record's raw_data.

    If no URL is stored yet, try to recover one from TMDb fields or hydrate
    the record from OMDb using the saved title / IMDb id.
    """
    model = _MEDIA_MODELS.get(media_type)
    if not model:
        return None

    result = await db.execute(select(model).where(model.id == media_id))
    row = result.scalar_one_or_none()
    if not row or not row.raw_data:
        return None

    raw: dict = dict(row.raw_data or {})

    for img in raw.get("imageFiles") or []:
        url = img.get("fileName") if isinstance(img, dict) else None
        if url and url != "N/A" and url.startswith("http"):
            return url

    omdb = raw.get("omdbData") or {}
    poster = omdb.get("Poster") if isinstance(omdb, dict) else None
    if poster and poster != "N/A":
        return poster

    tmdb = raw.get("tmdbData") or {}
    tmdb_poster_path = tmdb.get("poster_path") if isinstance(tmdb, dict) else None
    if isinstance(tmdb_poster_path, str) and tmdb_poster_path:
        tmdb_url = f"https://image.tmdb.org/t/p/w500{tmdb_poster_path}"
        image_files = list(raw.get("imageFiles") or [])
        if not any(isinstance(img, dict) and img.get("fileName") == tmdb_url for img in image_files):
            image_files.insert(0, {"fileName": tmdb_url, "format": "jpg"})
            raw["imageFiles"] = image_files
            row.raw_data = raw
            try:
                flag_modified(row, "raw_data")
            except Exception:
                pass
            if hasattr(db, "commit"):
                await db.commit()
            if hasattr(db, "refresh"):
                await db.refresh(row)
        return tmdb_url

    api_key = settings.omdb_api_key
    if not api_key:
        return None

    external_ids = raw.get("externalIds") or {}
    imdb_candidates = [
        external_ids.get("imdbId") if isinstance(external_ids, dict) else None,
        raw.get("imdbId"),
        raw.get("imdbID"),
    ]
    imdb_id = next((value for value in imdb_candidates if isinstance(value, str) and re.fullmatch(r"tt\d+", value.strip())), None)

    title = raw.get("title") or raw.get("name")

    params = {"apikey": api_key, "plot": "full"}
    if imdb_id:
        params["i"] = imdb_id.strip()
    else:
        if not isinstance(title, str) or not title.strip():
            return None
        params["t"] = title.strip()
        raw_year = raw.get("releaseDate") or raw.get("runningDates") or raw.get("year") or omdb.get("Year")
        if isinstance(raw_year, str):
            year_match = re.search(r"(19|20)\d{2}", raw_year)
            if year_match:
                params["y"] = year_match.group(0)

    try:
        response = requests.get("https://www.omdbapi.com/", params=params, timeout=10)
        response.raise_for_status()
        payload = response.json()
        poster = payload.get("Poster") if isinstance(payload, dict) else None
        if payload.get("Response") == "True" and isinstance(poster, str) and poster and poster != "N/A":
            image_files = list(raw.get("imageFiles") or [])
            if not any(isinstance(img, dict) and img.get("fileName") == poster for img in image_files):
                image_files.insert(0, {"fileName": poster, "format": "jpg"})
            raw["imageFiles"] = image_files
            raw["omdbData"] = payload

            external_ids = dict(raw.get("externalIds") or {})
            if payload.get("imdbID"):
                external_ids["imdbId"] = payload["imdbID"]
                raw["externalIds"] = external_ids
                if hasattr(row, "imdb_id"):
                    row.imdb_id = payload["imdbID"]

            row.raw_data = raw
            if hasattr(row, "omdb_data"):
                row.omdb_data = payload
            try:
                flag_modified(row, "raw_data")
            except Exception:
                pass
            if hasattr(db, "commit"):
                await db.commit()
            if hasattr(db, "refresh"):
                await db.refresh(row)
            return poster
    except Exception:
        return None

    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{media_type}/{media_id}/list")
async def list_posters(media_type: str, media_id: str) -> dict:
    """Return count and metadata for every cached poster for this item."""
    if media_type not in _MEDIA_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown media type '{media_type}'.")
    posters = get_poster_list(media_type, media_id)
    return {"count": len(posters), "posters": posters}


@router.get("/{media_type}/{media_id}")
async def get_poster(
    background_tasks: BackgroundTasks,
    media_type: str,
    media_id: str,
    index: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve the cached poster at position *index* (0 = first/oldest, higher = newer).
    On index-0 requests a background task silently checks the source for updates
    at most once per 24 hours; if a newer image is found it is stored as a new entry.
    Returns 404 if no poster is stored and no source URL exists.
    Returns 502 if the initial download from the external source fails.
    """
    if media_type not in _MEDIA_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown media type '{media_type}'.")

    path = get_poster_path(media_type, media_id, index)
    if path:
        if index == 0:
            url = await _resolve_poster_url(media_type, media_id, db)
            if url:
                background_tasks.add_task(refresh_if_stale, url, media_type, media_id)
        return FileResponse(path, headers=_CACHE_HEADERS)

    # Nothing on disk yet — download now (only possible for index 0)
    if index != 0:
        raise HTTPException(status_code=404, detail=f"Poster at index {index} not found.")

    url = await _resolve_poster_url(media_type, media_id, db)
    if not url:
        raise HTTPException(status_code=404, detail="No poster available for this item.")

    path = await download_poster(url, media_type, media_id)
    if not path:
        raise HTTPException(status_code=502, detail="Failed to download poster from external source.")

    return FileResponse(path, headers=_CACHE_HEADERS)


@router.post("/{media_type}/{media_id}/source", dependencies=[Depends(require_session)])
async def update_poster_source(
    media_type: str,
    media_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Persist a manually supplied poster URL and fetch it into the cache."""
    model = _MEDIA_MODELS.get(media_type)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown media type '{media_type}'.")

    source_url = str(body.get("sourceUrl") or body.get("posterUrl") or "").strip()
    if not re.match(r"^https?://", source_url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="A valid http or https poster URL is required.")

    result = await db.execute(select(model).where(model.id == media_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Media item not found.")

    _apply_manual_poster_source(row, source_url)
    try:
        flag_modified(row, "raw_data")
    except Exception:
        pass

    await db.commit()
    await db.refresh(row)

    refresh_result = await force_refresh(source_url, media_type, media_id)
    return {
        "message": "Poster source updated and cache refreshed.",
        "sourceUrl": source_url,
        "activeIndex": max(0, refresh_result.get("total_posters", 1) - 1),
        **refresh_result,
    }


@router.post("/{media_type}/{media_id}/refresh", dependencies=[Depends(require_session)])
async def refresh_poster(
    media_type: str,
    media_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Force an immediate re-check against the source URL, bypassing the 24-hour cooldown.
    Returns whether a new poster was found and the total count.
    """
    if media_type not in _MEDIA_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown media type '{media_type}'.")
    url = await _resolve_poster_url(media_type, media_id, db)
    if not url:
        raise HTTPException(status_code=404, detail="No poster URL found for this item.")
    return await force_refresh(url, media_type, media_id)

