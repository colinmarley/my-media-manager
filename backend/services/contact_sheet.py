"""
Contact sheets: one JPEG of evenly spaced frames from a video file.

Extras Review shows one per held extra, so a person can tell a gag reel from
an audition tape before choosing its type. Sheets are cached on disk, keyed by
the file's path, size and modification time.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
from typing import List, Optional

from config.settings import settings

COLUMNS = 4
ROWS = 3
FRAME_WIDTH = 320
# A full decode of a long extra over the network share; well above what the discs seen so far need.
TIMEOUT_SECONDS = 300


def cache_dir() -> str:
    path = os.path.join(settings.temp_directory, "contact-sheets")
    os.makedirs(path, exist_ok=True)
    return path


def cache_path(video_path: str) -> str:
    """Where the sheet of ``video_path`` is cached. Changes when the file does."""
    try:
        stat = os.stat(video_path)
        stamp = f"{stat.st_size}:{int(stat.st_mtime)}"
    except OSError:
        stamp = "missing"
    digest = hashlib.sha256(f"{video_path}|{stamp}".encode("utf-8")).hexdigest()[:32]
    return os.path.join(cache_dir(), f"{digest}.jpg")


def command(video_path: str, duration_seconds: float, out_path: str) -> List[str]:
    """The ffmpeg call: one frame every duration/12 seconds, tiled 4x3."""
    frames = COLUMNS * ROWS
    step = max(duration_seconds / frames, 1.0)
    video_filter = f"fps=1/{step:.3f},scale={FRAME_WIDTH}:-2,tile={COLUMNS}x{ROWS}"
    return [
        "ffmpeg", "-v", "error", "-y", "-i", video_path,
        "-vf", video_filter, "-frames:v", "1", "-q:v", "5", out_path,
    ]


def build(video_path: str, duration_seconds: Optional[float]) -> Optional[str]:
    """Path of the sheet for ``video_path``, made now if it is not cached. None when it cannot be made."""
    if not video_path or not os.path.isfile(video_path):
        return None
    out_path = cache_path(video_path)
    if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    duration = float(duration_seconds or 0)
    if duration <= 0:
        duration = _probe_duration(video_path) or 0
    if duration <= 0:
        return None
    partial = f"{out_path}.{os.getpid()}.part.jpg"
    try:
        done = subprocess.run(
            command(video_path, duration, partial),
            capture_output=True, timeout=TIMEOUT_SECONDS, stdin=subprocess.DEVNULL, check=False,
        )
    except (subprocess.SubprocessError, OSError):
        done = None
    if done is None or done.returncode != 0 or not os.path.isfile(partial) or os.path.getsize(partial) == 0:
        if os.path.exists(partial):
            os.remove(partial)
        return None
    os.replace(partial, out_path)
    return out_path


def _probe_duration(video_path: str) -> Optional[float]:
    try:
        done = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video_path],
            capture_output=True, timeout=60, stdin=subprocess.DEVNULL, check=False,
        )
        return float(done.stdout.decode("utf-8", "replace").strip())
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
