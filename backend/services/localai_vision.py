"""
Calls to the local vision model on LocalAI (OpenAI-compatible /v1 API).

Shared by the cover scan (api/cover_scan.py) and content verification
(services/content_evidence_service.py). The model only ever reads and
describes: callers compare what it read against known data, and drop any
title it reports that is not grounded in the text it says it saw.
"""

import base64
import io
import json
import re
from typing import Any, Dict, List, Optional

import httpx
from PIL import Image, ImageOps

from config.settings import settings

# Generous: LocalAI keeps one model resident, so a call may first have to swap
# the vision model in.
VISION_TIMEOUT = 180.0

_STOPWORDS = {"the", "a", "an", "of", "and", "&", "in", "on", "to"}


def prepare_image(data: bytes, max_dimension: int = 1280) -> str:
    """Normalize rotation, downscale, and re-encode as base64 JPEG. ValueError on unreadable input."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)  # phone photos carry rotation in EXIF
        image.thumbnail((max_dimension, max_dimension))
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=85)
    except Exception as exc:  # PIL raises a zoo of exception types for bad input
        raise ValueError("not a readable image") from exc
    return base64.b64encode(out.getvalue()).decode("ascii")


def parse_model_json(content: str) -> Dict[str, Any]:
    """The model's JSON answer, or {} when it is not a JSON object."""
    try:
        parsed = json.loads(content)
    except (TypeError, json.JSONDecodeError):
        # Models occasionally wrap the JSON in prose despite json_object mode.
        match = re.search(r"\{.*\}", content or "", re.DOTALL)
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}


def tokens(text: str) -> set:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS}


def is_grounded(title: str, visible_text: List[str]) -> bool:
    """True if most of the title's words appear in the text the model says it
    read. Guards against a vision model confidently inventing a title from a
    picture that doesn't show one (observed: an empty room read as "The Hulk")."""
    title_tokens = tokens(title)
    if not title_tokens:
        return False
    seen = tokens(" ".join(visible_text))
    return len(title_tokens & seen) / len(title_tokens) >= 0.6


async def ask(
    prompt: str,
    image_b64: str,
    system: Optional[str] = None,
    max_tokens: int = 1024,
    timeout: float = VISION_TIMEOUT,
) -> str:
    """One image and one prompt to the vision model; returns the raw answer text.

    Raises httpx.HTTPError (connect, timeout, status) for the caller to translate.
    """
    messages: List[Dict[str, Any]] = [{"role": "system", "content": system}] if system else []
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
        ],
    })
    payload = {
        "model": settings.localai_vision_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    headers = {"Authorization": f"Bearer {settings.localai_api_key}"} if settings.localai_api_key else {}

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{settings.localai_url.rstrip('/')}/v1/chat/completions", json=payload, headers=headers
        )
        response.raise_for_status()
    choices = response.json().get("choices") or [{}]
    return choices[0].get("message", {}).get("content") or ""
