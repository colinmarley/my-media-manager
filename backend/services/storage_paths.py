"""
The one place the library and ingest roots are resolved.

The library root (where Jellyfin reads organized media) and the ingest roots
(where new files arrive) used to be read from ``settings`` in some places,
hard-coded in others, and changed only in memory by ``PUT /api/ingress/config``.
Every caller now asks this module at call time.

Resolution order for each root:

1. an override stored in the ``app_config`` table (written by
   ``PUT /api/ingress/config`` and loaded at startup), then
2. ``config/settings.py`` (environment variables, then the code default).

The stored paths are container paths (POSIX). The helpers below compare paths
as strings, with either separator, so they behave the same when the tests run
on Windows against ``tmp_path`` roots. They never touch the filesystem.
"""

from __future__ import annotations

import json
import posixpath
import re
import threading
from typing import Any, Dict, Iterable, List, Optional

from config.settings import settings
from services.path_builder import PathBuilder

# app_config key holding the persisted subset of the ingress runtime config.
CONFIG_KEY = "ingress_runtime_config"

# Runtime-config keys that are paths and therefore resolved here.
LIBRARY_ROOT_KEY = "jellyfinDestBase"
INGEST_ROOTS_KEY = "defaultIngressPaths"

_WINDOWS_PATH_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")

_lock = threading.Lock()
_overrides: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Overrides (in memory, mirrored from app_config)
# ---------------------------------------------------------------------------

def set_overrides(overrides: Optional[Dict[str, Any]]) -> None:
    """Replace the in-memory overrides (the persisted runtime config)."""
    with _lock:
        _overrides.clear()
        _overrides.update(dict(overrides or {}))


def get_overrides() -> Dict[str, Any]:
    with _lock:
        return dict(_overrides)


def clear_overrides() -> None:
    set_overrides(None)


async def load_persisted_config(db: Any) -> Dict[str, Any]:
    """Read the persisted runtime-config overrides from ``app_config`` ({} when none)."""
    from sqlalchemy import select  # pylint: disable=import-outside-toplevel
    from db.models import AppConfig  # pylint: disable=import-outside-toplevel

    result = await db.execute(select(AppConfig).where(AppConfig.key == CONFIG_KEY))
    row = result.scalar_one_or_none()
    if row is None:
        return {}
    try:
        data = json.loads(row.value)
    except Exception:  # pylint: disable=broad-except
        from utils.logging import logger  # pylint: disable=import-outside-toplevel

        logger.warning("Failed to parse stored ingress runtime config", exc_info=True)
        return {}
    return data if isinstance(data, dict) else {}


async def save_persisted_config(db: Any, data: Dict[str, Any]) -> None:
    """Write the runtime-config overrides to ``app_config`` (insert or replace)."""
    from sqlalchemy import select  # pylint: disable=import-outside-toplevel
    from db.models import AppConfig  # pylint: disable=import-outside-toplevel

    result = await db.execute(select(AppConfig).where(AppConfig.key == CONFIG_KEY))
    row = result.scalar_one_or_none()
    serialized = json.dumps(data)
    if row is not None:
        row.value = serialized
    else:
        db.add(AppConfig(key=CONFIG_KEY, value=serialized))
    await db.commit()


# ---------------------------------------------------------------------------
# Pure path helpers
# ---------------------------------------------------------------------------

def _is_windows_style(path: str) -> bool:
    return bool(_WINDOWS_PATH_RE.match(path or ""))


def clean_root(path: Any) -> str:
    """Strip trailing separators from a root, keeping a bare ``/`` or ``C:/``."""
    text = str(path or "").strip()
    if not text:
        return ""
    stripped = text.rstrip("/\\")
    if not stripped:
        return text[0]
    if re.fullmatch(r"[A-Za-z]:", stripped):
        return stripped + text[len(stripped)]
    return stripped


def _normalize(path: Any) -> str:
    """Forward slashes, no dot segments; a UNC ``//host`` prefix is kept."""
    text = str(path or "").strip().replace("\\", "/")
    if not text:
        return ""
    normalized = posixpath.normpath(text)
    if text.startswith("//") and not normalized.startswith("//"):
        normalized = "/" + normalized
    return normalized


def _comparable(path: Any) -> str:
    """Normalized form used only for comparisons (Windows-style paths compare case-insensitively)."""
    text = str(path or "")
    normalized = _normalize(text)
    if _is_windows_style(text.strip()) or "\\" in text:
        normalized = normalized.lower()
    return normalized


def relative_to(path: Any, root: Any) -> Optional[str]:
    """``path`` relative to ``root`` with forward slashes, '' for the root itself, None if outside."""
    if not path or not root:
        return None
    target = _comparable(path)
    base = _comparable(root)
    if not base:
        return None
    if target == base:
        return ""
    prefix = base if base.endswith("/") else base + "/"
    if not target.startswith(prefix):
        return None
    # Same length as ``target``; slicing it keeps the original letter case.
    return _normalize(path)[len(prefix):]


def is_within(path: Any, root: Any) -> bool:
    return relative_to(path, root) is not None


def join_root(root: Any, relative_path: Any) -> str:
    """Join a library-relative path onto a root (absolute input is returned unchanged)."""
    return PathBuilder.absolute(clean_root(root), str(relative_path or ""))


# ---------------------------------------------------------------------------
# Resolved roots
# ---------------------------------------------------------------------------

def library_root() -> str:
    """The Jellyfin library root: stored override, else ``settings.jellyfin_dest_base``."""
    with _lock:
        override = _overrides.get(LIBRARY_ROOT_KEY)
    return clean_root(override or settings.jellyfin_dest_base)


def ingest_roots() -> List[str]:
    """Watched ingest roots: stored override, else ``settings.ingress_default_paths``."""
    with _lock:
        override = _overrides.get(INGEST_ROOTS_KEY)
    roots: Iterable[Any] = override if override else (settings.ingress_default_paths or [])
    if isinstance(roots, str):
        roots = [roots]
    cleaned = [clean_root(root) for root in roots]
    return [root for root in cleaned if root]


def primary_ingest_root() -> Optional[str]:
    roots = ingest_roots()
    return roots[0] if roots else None


def category_folders() -> List[str]:
    """The top-level library folders, one per media category."""
    return [
        settings.folder_movies,
        settings.folder_tv_shows,
        settings.folder_documentaries,
        settings.folder_live_performances,
    ]


def category_root(media_type: str) -> Optional[str]:
    """Absolute library folder for a media type (movie, episode/series, documentary, ...)."""
    folder = PathBuilder.subfolder(media_type)
    if folder is None:
        return None
    return join_root(library_root(), folder)


def home_videos_root() -> str:
    return clean_root(settings.home_videos_path)


def to_library_relative(path: Any, root: Optional[str] = None) -> Optional[str]:
    """Library-relative form of ``path`` (forward slashes), None when it is not in the library."""
    return relative_to(path, root if root is not None else library_root())


def from_library_relative(rel: Any, root: Optional[str] = None) -> str:
    return join_root(root if root is not None else library_root(), rel)


def is_in_library(path: Any, root: Optional[str] = None) -> bool:
    return is_within(path, root if root is not None else library_root())


def is_in_ingest(path: Any, roots: Optional[Iterable[str]] = None) -> bool:
    candidates = list(roots) if roots is not None else ingest_roots()
    return any(is_within(path, root) for root in candidates)
