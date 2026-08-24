"""
Poster cache service — download poster images, detect source changes, and
keep every unique version so users can cycle through historical posters.

Directory layout:
    {poster_cache_dir}/
        {media_type}/
            {media_id}/
                meta.json      ← list of poster entries (hash, timestamps, filename)
                poster_0.jpg   ← first downloaded (original)
                poster_1.jpg   ← detected update, etc.

Staleness:
    Each source URL is re-fetched at most once every 24 hours.  If the
    downloaded bytes are different from every stored poster (compared by
    SHA-256), the new image is appended as a new entry rather than
    replacing the existing one, so all historical versions are preserved.

Migration:
    Old flat-file layout ({cache_dir}/{media_type}/{media_id}.jpg) is
    automatically migrated to the directory layout on first access.
"""

import hashlib
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx

from config.settings import settings
from utils.logging import logger

_SUPPORTED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}
_CHECK_INTERVAL = timedelta(hours=24)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _item_dir(media_type: str, media_id: str) -> Path:
    p = Path(settings.poster_cache_dir) / media_type / media_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _meta_path(media_type: str, media_id: str) -> Path:
    return _item_dir(media_type, media_id) / "meta.json"


def _load_meta(media_type: str, media_id: str) -> dict:
    p = _meta_path(media_type, media_id)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"posters": []}


def _save_meta(media_type: str, media_id: str, meta: dict) -> None:
    _meta_path(media_type, media_id).write_text(json.dumps(meta, indent=2))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _ext_from_url(url: str) -> str:
    part = url.rsplit(".", 1)[-1].split("?")[0].lower()
    return part if part in _SUPPORTED_EXTENSIONS else "jpg"


def _migrate_flat_file(old_path: Path, media_type: str, media_id: str) -> None:
    """Move a legacy flat cache file into the new per-item directory layout."""
    data = old_path.read_bytes()
    ext = old_path.suffix.lstrip(".")
    dest = _item_dir(media_type, media_id) / f"poster_0.{ext}"
    dest.write_bytes(data)
    now = datetime.now(timezone.utc).isoformat()
    _save_meta(media_type, media_id, {
        "posters": [{
            "filename": f"poster_0.{ext}",
            "source_url": "",  # unknown — filled on next check
            "hash": _sha256(data),
            "downloaded_at": now,
            "last_checked_at": now,
        }]
    })
    try:
        old_path.unlink()
    except Exception:
        pass
    logger.info("Migrated poster to directory layout", media_type=media_type, media_id=media_id)


def _store_poster(data: bytes, url: str, media_type: str, media_id: str, meta: dict) -> Path | None:
    """
    Compare *data* against all stored posters by SHA-256.

    - Match found  → update last_checked_at (and backfill source_url if missing),
                     return the existing Path.
    - No match     → save as a new poster_{n}.ext entry, return its Path.
    """
    img_hash = _sha256(data)
    now = datetime.now(timezone.utc).isoformat()

    for entry in meta["posters"]:
        if entry["hash"] == img_hash:
            entry["last_checked_at"] = now
            if not entry.get("source_url") and url:
                entry["source_url"] = url
            _save_meta(media_type, media_id, meta)
            p = _item_dir(media_type, media_id) / entry["filename"]
            return p if p.exists() else None

    # New unique image — append it
    idx = len(meta["posters"])
    ext = _ext_from_url(url)
    filename = f"poster_{idx}.{ext}"
    dest = _item_dir(media_type, media_id) / filename
    dest.write_bytes(data)
    meta["posters"].append({
        "filename": filename,
        "source_url": url,
        "hash": img_hash,
        "downloaded_at": now,
        "last_checked_at": now,
    })
    _save_meta(media_type, media_id, meta)
    logger.info("New poster version cached", media_type=media_type, media_id=media_id, index=idx)
    return dest


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_poster_count(media_type: str, media_id: str) -> int:
    return len(_load_meta(media_type, media_id)["posters"])


def get_poster_path(media_type: str, media_id: str, index: int = 0) -> Path | None:
    """Return the Path to poster *index* if it exists on disk, else None.
    Transparently migrates the old flat-file layout on first access."""
    meta = _load_meta(media_type, media_id)

    if not meta["posters"] and index == 0:
        # Check for legacy flat file and migrate
        old_base = Path(settings.poster_cache_dir) / media_type
        for ext in _SUPPORTED_EXTENSIONS:
            old_path = old_base / f"{media_id}.{ext}"
            if old_path.exists():
                _migrate_flat_file(old_path, media_type, media_id)
                meta = _load_meta(media_type, media_id)
                break

    if not meta["posters"] or index >= len(meta["posters"]):
        return None
    p = _item_dir(media_type, media_id) / meta["posters"][index]["filename"]
    return p if p.exists() else None


def get_poster_list(media_type: str, media_id: str) -> list[dict]:
    """Return public metadata for all cached posters (omits source URLs and hashes)."""
    meta = _load_meta(media_type, media_id)
    return [
        {
            "index": i,
            "downloaded_at": entry.get("downloaded_at"),
            "last_checked_at": entry.get("last_checked_at"),
        }
        for i, entry in enumerate(meta["posters"])
    ]


async def _fetch_bytes(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.content
    except Exception as exc:
        logger.warning("Poster fetch failed", url=url, error=str(exc))
        return None


async def download_poster(url: str, media_type: str, media_id: str) -> Path | None:
    """Download *url* if no poster is cached yet.
    Returns the primary poster Path on success, None on failure."""
    if not url or url == "N/A":
        return None
    meta = _load_meta(media_type, media_id)
    if meta["posters"]:
        path = get_poster_path(media_type, media_id, 0)
        if path:
            return path
    data = await _fetch_bytes(url)
    if data is None:
        return None
    return _store_poster(data, url, media_type, media_id, meta)


async def refresh_if_stale(url: str, media_type: str, media_id: str) -> bool:
    """Re-fetch *url* if 24 h have elapsed since the last check.
    Appends a new poster entry if the source image has changed.
    Returns True if a new poster was added."""
    if not url or url == "N/A":
        return False
    meta = _load_meta(media_type, media_id)
    now = datetime.now(timezone.utc)

    # Find the most-recently-checked entry for this source URL
    last_checked: datetime | None = None
    for entry in meta["posters"]:
        if entry.get("source_url") == url:
            try:
                t = datetime.fromisoformat(entry["last_checked_at"])
                if last_checked is None or t > last_checked:
                    last_checked = t
            except Exception:
                pass

    if last_checked and (now - last_checked) < _CHECK_INTERVAL:
        return False  # Checked recently — skip

    before = len(meta["posters"])
    data = await _fetch_bytes(url)
    if data is None:
        return False
    _store_poster(data, url, media_type, media_id, meta)
    meta = _load_meta(media_type, media_id)
    added = len(meta["posters"]) > before
    if added:
        logger.info("Poster updated from source", media_type=media_type, media_id=media_id)
    return added


async def force_refresh(url: str, media_type: str, media_id: str) -> dict:
    """Immediately re-fetch *url*, bypassing the 24-hour cooldown.
    Returns {'new_poster_added': bool, 'total_posters': int}."""
    meta = _load_meta(media_type, media_id)
    before = len(meta["posters"])
    data = await _fetch_bytes(url)
    if data is None:
        return {"new_poster_added": False, "total_posters": before}
    _store_poster(data, url, media_type, media_id, meta)
    meta = _load_meta(media_type, media_id)
    return {
        "new_poster_added": len(meta["posters"]) > before,
        "total_posters": len(meta["posters"]),
    }
