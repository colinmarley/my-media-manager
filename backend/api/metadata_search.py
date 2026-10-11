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
  GET /api/metadata-search/upc?code=                              barcode -> product title/format guess

Mirrors the OMDb request shapes already used by the web frontend's
OmdbService.ts (`s=` search, `i=` lookup) so the two stay easy to compare.
"""

import asyncio
import re

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from api.mobile_auth import require_any_auth
from config.settings import settings

router = APIRouter(prefix="/api/metadata-search", tags=["Metadata Search"])

_REQUEST_TIMEOUT = 10


async def _get(url: str, params: dict) -> requests.Response:
    """requests is blocking — run it on a worker thread so a slow upstream
    (up to the 10s timeout) doesn't stall every other request, saves included."""
    return await asyncio.to_thread(requests.get, url, params=params, timeout=_REQUEST_TIMEOUT)


def _json(response: requests.Response, service: str) -> dict:
    """Upstream sometimes answers with an HTML error page — a 502 with a
    message, not an unhandled JSONDecodeError (500)."""
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"{service} returned an unreadable response.") from exc
    return payload if isinstance(payload, dict) else {}


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
        response = await _get("https://www.omdbapi.com/", params)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OMDb request failed: {exc}") from exc

    payload = _json(response, "OMDb")
    if payload.get("Response") != "True":
        return {"results": []}
    return {"results": payload.get("Search") or []}


@router.get("/omdb/details", dependencies=[Depends(require_any_auth)])
async def get_omdb_details(imdb_id: str = Query(..., alias="imdbId", pattern=r"^tt\d+$")) -> dict:
    """Fetch full OMDb details for a specific title by IMDb id."""
    api_key = _require_omdb_key()
    params = {"apikey": api_key, "i": imdb_id, "plot": "full"}

    try:
        response = await _get("https://www.omdbapi.com/", params)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OMDb request failed: {exc}") from exc

    payload = _json(response, "OMDb")
    if payload.get("Response") != "True":
        raise HTTPException(status_code=404, detail=payload.get("Error") or "Title not found on OMDb.")
    return payload


# ---------------------------------------------------------------------------
# UPC / EAN barcode lookup
# ---------------------------------------------------------------------------
#
#   GET /api/metadata-search/upc?code=   product lookup for a disc/tape barcode
#
# Backed by UPCitemdb's free trial endpoint (no key, ~100 lookups/day per IP),
# so results are cached in-process: a re-scan of the same case, or two phones
# scanning the same retail release, doesn't spend quota twice. Retail product
# titles are noisy ("The Matrix (Blu-ray + DVD + Digital) [Widescreen]"), so
# the response also carries a cleaned title plus a best-guess format/edition
# the app can pre-fill — never auto-save; the user confirms.

_UPC_LOOKUP_URL = "https://api.upcitemdb.com/prod/trial/lookup"
_upc_cache: dict[str, dict] = {}

# Order matters: the first match wins, so more specific formats come first
# ("4K Ultra HD Blu-ray" is UHD, not plain Blu-ray).
_FORMAT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("UHD_BLURAY", re.compile(r"\b(4k|ultra\s*hd|uhd)\b", re.I)),
    ("HD_DVD", re.compile(r"\bhd[\s-]?dvd\b", re.I)),
    ("BLURAY", re.compile(r"\bblu[\s-]?ray\b", re.I)),
    ("LASERDISC", re.compile(r"\blaser\s*disc\b", re.I)),
    ("VHS", re.compile(r"\bvhs\b", re.I)),
    ("DVD", re.compile(r"\bdvd\b", re.I)),
]

_EDITION_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("Steelbook", re.compile(r"\bsteel\s*book\b", re.I)),
    ("Criterion", re.compile(r"\bcriterion\b", re.I)),
    ("Collector's Edition", re.compile(r"\bcollector'?s\b", re.I)),
    ("Director's Cut", re.compile(r"\bdirector'?s\s+cut\b", re.I)),
    ("Extended", re.compile(r"\bextended\b", re.I)),
    ("Unrated", re.compile(r"\bunrated\b", re.I)),
    ("Special Edition", re.compile(r"\bspecial\s+edition\b", re.I)),
    ("Limited Edition", re.compile(r"\blimited\s+edition\b", re.I)),
    ("Theatrical", re.compile(r"\btheatrical\b", re.I)),
]

# Bracketed/parenthesized chunks that are packaging, not title — only
# dropped when they mention one of these words, so "(500) Days of Summer"
# or "Alien (1979)" survive.
_PACKAGING_WORDS = re.compile(
    r"blu[\s-]?ray|dvd|4k|ultra\s*hd|uhd|digital|widescreen|full\s*screen|"
    r"edition|steelbook|region|disc|vhs|copy|combo|pack|bonus|slipcover|ntsc|pal",
    re.I,
)
_TRAILING_FORMAT = re.compile(
    r"\s*[-–:,]\s*(4k|ultra\s*hd|uhd|blu[\s-]?ray|dvd|hd[\s-]?dvd|vhs)\b.*$", re.I
)


_TRAILING_PACKAGING = re.compile(
    r"\s+(4k\s+ultra\s+hd|4k|ultra\s*hd|blu[\s-]?ray|dvd|vhs|steel\s*book|widescreen|"
    r"full\s*screen|slipcover|digital)\s*$",
    re.I,
)


_MEDIA_CATEGORY = re.compile(r"media|movie|film|video|dvd|television", re.I)


def _guess(patterns: list[tuple[str, re.Pattern]], *texts: str) -> str | None:
    for value, pattern in patterns:
        if any(pattern.search(t or "") for t in texts):
            return value
    return None


def clean_product_title(title: str) -> str:
    """Strip retail packaging noise from a product title, keeping the film title."""
    # Everything after the first packaging bracket is noise in practice —
    # real listings pad the end with genre keywords ("Goodfellas [DVD]
    # Feature Thriller Drama Action ...").
    first_packaging = next(
        (m for m in re.finditer(r"[\(\[]([^\)\]]*)[\)\]]", title) if _PACKAGING_WORDS.search(m.group(1))),
        None,
    )
    cleaned = title[: first_packaging.start()] if first_packaging else title
    cleaned = _TRAILING_FORMAT.sub("", cleaned)
    # Bare trailing packaging words with no separator ("The Matrix Blu-ray",
    # "Jaws Steelbook") — looped, since they often stack.
    previous = None
    while previous != cleaned:
        previous = cleaned
        cleaned = _TRAILING_PACKAGING.sub("", cleaned).strip(" -–:,")
    return re.sub(r"\s{2,}", " ", cleaned).strip(" -–:,")


def parse_upc_item(code: str, item: dict) -> dict:
    raw_title = (item.get("title") or "").strip()
    description = item.get("description") or ""
    category = item.get("category") or ""
    format_guess = _guess(_FORMAT_PATTERNS, raw_title, description)
    return {
        "found": True,
        "code": code,
        "rawTitle": raw_title,
        "title": clean_product_title(raw_title) or raw_title,
        "format": format_guess,
        "edition": _guess(_EDITION_PATTERNS, raw_title, description),
        "brand": item.get("brand") or None,
        "category": category or None,
        # The database covers every retail product — a mis-scan can come
        # back as tortilla chips. Lets the app warn instead of pre-filling.
        "looksLikeMedia": bool(format_guess or _MEDIA_CATEGORY.search(category)),
        "imageUrl": (item.get("images") or [None])[0],
    }


@router.get("/upc", dependencies=[Depends(require_any_auth)])
async def lookup_upc(code: str = Query(..., pattern=r"^\d{8,14}$")) -> dict:
    """Look up a UPC/EAN barcode. Returns {found: false} when the database has no match."""
    if code in _upc_cache:
        return _upc_cache[code]

    try:
        response = await _get(_UPC_LOOKUP_URL, {"upc": code})
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"UPC lookup failed: {exc}") from exc

    if response.status_code == 429:
        # Don't cache — the same code may well resolve tomorrow.
        raise HTTPException(status_code=503, detail="UPC lookup daily limit reached. Try again tomorrow.")
    if response.status_code == 400 and _json(response, "UPC lookup").get("code") == "INVALID_UPC":
        # Bad check digit / not a real UPC — usually a mis-scan.
        result = {"found": False, "code": code, "reason": "invalid"}
        _upc_cache[code] = result
        return result
    if response.status_code == 404:
        result = {"found": False, "code": code}
        _upc_cache[code] = result
        return result
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"UPC lookup failed: {exc}") from exc

    items = _json(response, "UPC lookup").get("items") or []
    result = parse_upc_item(code, items[0]) if items else {"found": False, "code": code}
    _upc_cache[code] = result
    return result
