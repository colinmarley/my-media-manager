"""
Metadata search proxy
======================
Server-side proxy for OMDb title search/lookup, so the mobile app's
"look up metadata by title" add-flow step never needs the OMDb API key
embedded in the distributed app binary (unlike the web frontend, which
calls OMDb directly from the browser using a NEXT_PUBLIC_* key — a
worse exposure for a mobile binary than a web bundle).

  GET /api/metadata-search/omdb/search?query=&type=movie|series   search by title
  GET /api/metadata-search/omdb/details?imdbId=                   full record by IMDb id

Mirrors the OMDb request shapes already used by the web frontend's
OmdbService.ts (`s=` search, `i=` lookup) so the two stay easy to compare.
"""

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from api.mobile_auth import require_any_auth
from config.settings import settings

router = APIRouter(prefix="/api/metadata-search", tags=["Metadata Search"])

_REQUEST_TIMEOUT = 10


def _require_omdb_key() -> str:
    if not settings.omdb_api_key:
        raise HTTPException(status_code=503, detail="OMDb API key is not configured on the server.")
    return settings.omdb_api_key


@router.get("/omdb/search", dependencies=[Depends(require_any_auth)])
async def search_omdb(
    query: str = Query(..., min_length=1),
    type: str | None = Query(default=None, pattern="^(movie|series|episode)$"),
) -> dict:
    """Search OMDb by title, returning lightweight candidates (Title, Year, imdbID, Poster)."""
    api_key = _require_omdb_key()
    params = {"apikey": api_key, "s": query}
    if type:
        params["type"] = type

    try:
        response = requests.get("https://www.omdbapi.com/", params=params, timeout=_REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OMDb request failed: {exc}") from exc

    payload = response.json()
    if payload.get("Response") != "True":
        return {"results": []}
    return {"results": payload.get("Search") or []}


@router.get("/omdb/details", dependencies=[Depends(require_any_auth)])
async def get_omdb_details(imdb_id: str = Query(..., alias="imdbId", pattern=r"^tt\d+$")) -> dict:
    """Fetch full OMDb details for a specific title by IMDb id."""
    api_key = _require_omdb_key()
    params = {"apikey": api_key, "i": imdb_id, "plot": "full"}

    try:
        response = requests.get("https://www.omdbapi.com/", params=params, timeout=_REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OMDb request failed: {exc}") from exc

    payload = response.json()
    if payload.get("Response") != "True":
        raise HTTPException(status_code=404, detail=payload.get("Error") or "Title not found on OMDb.")
    return payload
