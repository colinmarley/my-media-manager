"""
Cover scan (vision OCR)
=======================
Reads the title/format/edition off a photo of a disc case, sleeve, or bare
disc label using a local vision model on LocalAI — for the mobile add flow's
"Scan cover" button, mainly for loose discs with no barcode to look up.

  POST /api/metadata-search/cover-scan   multipart `file` -> extracted fields

Runs on a self-hosted LocalAI instance (OpenAI-compatible /v1 API, set by
MEDIA_LIBRARY_LOCALAI_URL; the same engine the disc ripper's failure analysis
uses), so no cloud OCR account is needed and no image leaves your network.
The result is a suggestion the app shows for confirmation, never saved as-is.
"""

import re

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.mobile_auth import require_any_auth
from config.settings import settings  # noqa: F401  (tests patch cover_scan.settings)
from services import localai_vision
from services.localai_vision import is_grounded

router = APIRouter(prefix="/api/metadata-search", tags=["Metadata Search"])

_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
# Phone photos are 3-4k px wide; the model reads a cover fine at 1280 and
# answers several times faster (and fits alongside other GPU work).
_MAX_DIMENSION = 1280
# Generous: LocalAI keeps one model resident, so a scan may first have to swap
# the vision model in.
_VISION_TIMEOUT = 180.0

_VALID_FORMATS = {"DVD", "BLURAY", "UHD_BLURAY", "HD_DVD", "LASERDISC", "VHS"}
_VALID_CONFIDENCE = {"high", "medium", "low"}

_SYSTEM_PROMPT = (
    "You read the packaging of physical movie and TV media (DVD, Blu-ray, 4K UHD, VHS). "
    "Respond ONLY with valid JSON matching the requested structure. No prose outside the JSON."
)

_USER_PROMPT = """\
This photo shows the front cover, spine, or label of a DVD, Blu-ray, 4K UHD Blu-ray, HD DVD, \
LaserDisc, or VHS tape. Identify the movie or TV show on it.

First decide whether the photo really shows media packaging or a disc/tape label. If it does not (a room, a screen, a person, a random object), set isMediaPackaging to false and every other field to null. Never guess a title from general appearance — only report text you can actually read in the photo.

Respond with this exact JSON structure:
{
  "isMediaPackaging": <true only if a disc case, sleeve, disc label, or tape is clearly visible>,
  "visibleText": [<every distinct line of text you can actually read in the photo, verbatim>],
  "title": "<the movie or show title as printed, without taglines, actor names, or format words; null if unreadable>",
  "year": "<4-digit release year if printed anywhere, else null>",
  "format": "<one of DVD | BLURAY | UHD_BLURAY | HD_DVD | LASERDISC | VHS, from logos/banners on the packaging; null if unclear>",
  "edition": "<edition text if printed, e.g. Special Edition, Director's Cut, Collector's Edition, Steelbook, Criterion; else null>",
  "isSeries": <true if this is a TV series/season, else false>,
  "season": <season number if printed, else null>,
  "otherTitles": [<other distinct feature titles if this is a double feature or collection; else empty>],
  "confidence": "<high | medium | low — how sure you are of the title>"
}"""


def _prepare_image(data: bytes) -> str:
    try:
        return localai_vision.prepare_image(data, _MAX_DIMENSION)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="That file couldn't be read as an image.") from exc


_parse_model_json = localai_vision.parse_model_json


def _clean_str(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and value.lower() not in ("null", "none", "n/a", "unknown") else None


def normalize_scan(parsed: dict) -> dict:
    """Coerce model output into a strict shape — the model's JSON is advisory."""
    fmt = _clean_str(parsed.get("format"))
    fmt = fmt.upper().replace("-", "_").replace(" ", "_") if fmt else None
    fmt = {"BLU_RAY": "BLURAY", "4K": "UHD_BLURAY", "UHD": "UHD_BLURAY", "4K_UHD": "UHD_BLURAY"}.get(fmt, fmt)

    year = _clean_str(str(parsed.get("year")) if parsed.get("year") is not None else None)
    year_match = re.search(r"(19|20)\d{2}", year or "")

    season = parsed.get("season")
    try:
        season = int(season) if season is not None else None
    except (TypeError, ValueError):
        season = None

    other = parsed.get("otherTitles")
    other_titles = [t for t in (_clean_str(o) for o in other) if t] if isinstance(other, list) else []

    confidence = _clean_str(parsed.get("confidence"))
    confidence = confidence.lower() if confidence else None

    title = _clean_str(parsed.get("title"))
    visible = parsed.get("visibleText")
    visible_text = [t for t in (_clean_str(v) for v in visible) if t] if isinstance(visible, list) else []

    # An explicit "this isn't packaging" wins over anything else the model
    # put in the other fields.
    if parsed.get("isMediaPackaging") is False:
        title = None
    grounded = bool(title) and is_grounded(title, visible_text)
    if title and not grounded:
        confidence = "low"

    return {
        "found": title is not None,
        "verified": grounded,
        "title": title,
        "year": year_match.group(0) if year_match else None,
        "format": fmt if fmt in _VALID_FORMATS else None,
        "edition": _clean_str(parsed.get("edition")),
        "isSeries": bool(parsed.get("isSeries")),
        "season": season,
        "otherTitles": [t for t in other_titles if t != title],
        "confidence": confidence if confidence in _VALID_CONFIDENCE else "low",
    }


@router.post("/cover-scan", dependencies=[Depends(require_any_auth)])
async def scan_cover(file: UploadFile = File(...)) -> dict:
    data = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large (15 MB max).")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")

    image_b64 = _prepare_image(data)
    try:
        content = await localai_vision.ask(_USER_PROMPT, image_b64, system=_SYSTEM_PROMPT, timeout=_VISION_TIMEOUT)
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail="Cover scanning is unavailable (vision model host unreachable).") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Cover scan timed out. Try again.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cover scan failed: {exc}") from exc

    return normalize_scan(localai_vision.parse_model_json(content))
