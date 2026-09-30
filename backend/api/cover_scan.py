"""
Cover scan (vision OCR)
=======================
Reads the title/format/edition off a photo of a disc case, sleeve, or bare
disc label using a local vision model on Ollama — for the mobile add flow's
"Scan cover" button, mainly for loose discs with no barcode to look up.

  POST /api/metadata-search/cover-scan   multipart `file` -> extracted fields

Runs on ai-workstation's Ollama (same host the disc ripper's failure
analysis uses), so no cloud OCR account and no image leaves the homelab.
The result is a suggestion the app shows for confirmation, never saved as-is.
"""

import base64
import io
import json
import re

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps

from api.mobile_auth import require_any_auth
from config.settings import settings

router = APIRouter(prefix="/api/metadata-search", tags=["Metadata Search"])

_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
# Phone photos are 3-4k px wide; the model reads a cover fine at 1280 and
# answers several times faster (and fits alongside other GPU work).
_MAX_DIMENSION = 1280
_OLLAMA_TIMEOUT = 180.0

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
    """Normalize rotation, downscale, and re-encode as base64 JPEG."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)  # phone photos carry rotation in EXIF
        image.thumbnail((_MAX_DIMENSION, _MAX_DIMENSION))
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=85)
    except Exception as exc:  # PIL raises a zoo of exception types for bad input
        raise HTTPException(status_code=400, detail="That file couldn't be read as an image.") from exc
    return base64.b64encode(out.getvalue()).decode("ascii")


def _parse_model_json(content: str) -> dict:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Models occasionally wrap the JSON in prose despite format=json.
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {}


def _clean_str(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and value.lower() not in ("null", "none", "n/a", "unknown") else None


_STOPWORDS = {"the", "a", "an", "of", "and", "&", "in", "on", "to"}


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS}


def is_grounded(title: str, visible_text: list[str]) -> bool:
    """True if most of the title's words appear in the text the model says it
    read. Guards against a vision model confidently inventing a title from a
    photo that doesn't show one (observed: an empty room read as "The Hulk")."""
    title_tokens = _tokens(title)
    if not title_tokens:
        return False
    seen = _tokens(" ".join(visible_text))
    return len(title_tokens & seen) / len(title_tokens) >= 0.6


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

    payload = {
        "model": settings.ollama_vision_model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _USER_PROMPT, "images": [_prepare_image(data)]},
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
    }

    try:
        async with httpx.AsyncClient(timeout=_OLLAMA_TIMEOUT) as client:
            response = await client.post(f"{settings.ollama_host.rstrip('/')}/api/chat", json=payload)
            response.raise_for_status()
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail="Cover scanning is unavailable (vision model host unreachable).") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Cover scan timed out. Try again.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cover scan failed: {exc}") from exc

    content = response.json().get("message", {}).get("content", "")
    return normalize_scan(_parse_model_json(content))
