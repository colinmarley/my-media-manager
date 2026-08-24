"""
Tape Ingest Service
===================
Handles scanning directories for video files, generating thumbnails,
building Jellyfin-compatible destination paths, and running the
FFmpeg VHS post-processing pipeline.
"""

import json
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from config.settings import settings
from utils.logging import logger


def _format_size(size_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _format_duration(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02}:{sec:02}" if h else f"{m}:{sec:02}"


def _slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"\s+", "_", text.strip())


def _make_item(file_path: str, file_name: str, size_bytes: int, meta: Dict[str, Any]) -> Dict[str, Any]:
    duration = meta.get("duration")
    return {
        "file_path": file_path,
        "file_name": file_name,
        "file_size_bytes": size_bytes,
        "file_size_formatted": _format_size(size_bytes),
        "duration_seconds": duration,
        "duration_formatted": _format_duration(duration) if duration else None,
        "video_codec": meta.get("codec"),
        "resolution": meta.get("resolution"),
        "content_type": "unclassified",
    }


class TapeIngestService:
    _jobs: Dict[str, Dict[str, Any]] = {}

    def list_scan_roots(self) -> List[str]:
        roots = []
        ingress = settings.tape_ingest_ingress_folder
        if ingress and os.path.isdir(ingress):
            roots.append(ingress)
        for p in settings.allowed_base_paths:
            if os.path.isdir(p) and p not in roots:
                roots.append(p)
        return roots

    def scan_path(self, source_path: str) -> List[Dict[str, Any]]:
        exts = set(settings.supported_video_extensions)
        items: List[Dict[str, Any]] = []
        try:
            for entry in Path(source_path).rglob("*"):
                if not entry.is_file():
                    continue
                if entry.suffix.lower() not in exts:
                    continue
                size = entry.stat().st_size
                meta = self._probe_file(str(entry))
                items.append(_make_item(str(entry), entry.name, size, meta))
        except Exception as exc:
            logger.error("Tape scan failed", path=source_path, error=str(exc))
        return items

    def _probe_file(self, file_path: str) -> Dict[str, Any]:
        try:
            result = subprocess.run(
                [
                    settings.ffprobe_path, "-v", "quiet",
                    "-print_format", "json",
                    "-show_streams", "-show_format",
                    file_path,
                ],
                capture_output=True, text=True,
                timeout=settings.metadata_extraction_timeout,
            )
            if result.returncode != 0:
                return {}
            data = json.loads(result.stdout)
            fmt = data.get("format", {})
            video = next(
                (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
                None,
            )
            out: Dict[str, Any] = {}
            if fmt.get("duration"):
                out["duration"] = float(fmt["duration"])
            if video:
                out["codec"] = video.get("codec_name")
                w, h = video.get("width"), video.get("height")
                if w and h:
                    out["resolution"] = f"{w}x{h}"
            return out
        except Exception as exc:
            logger.warning("ffprobe failed", path=file_path, error=str(exc))
            return {}

    def generate_thumbnail(self, file_path: str) -> Optional[str]:
        try:
            meta = self._probe_file(file_path)
            seek = max(1.0, (meta.get("duration") or 10) * 0.1)
            thumb = os.path.join(settings.temp_directory, f"tape_thumb_{uuid4().hex}.jpg")
            os.makedirs(settings.temp_directory, exist_ok=True)
            result = subprocess.run(
                [
                    settings.ffmpeg_path, "-ss", str(seek),
                    "-i", file_path, "-vframes", "1", "-q:v", "3", "-y", thumb,
                ],
                capture_output=True, timeout=30,
            )
            if result.returncode == 0 and os.path.exists(thumb):
                return thumb
        except Exception as exc:
            logger.warning("Thumbnail failed", path=file_path, error=str(exc))
        return None

    def build_home_video_path(self, meta: Dict, dest: str) -> Tuple[str, str]:
        date_part = meta.get("date", "")
        if meta.get("date_end"):
            date_part = f"{date_part}_to_{meta['date_end']}"
        title_slug = _slugify(meta.get("title", "untitled"))
        folder_name = f"{date_part}_{title_slug}" if date_part else title_slug
        return os.path.join(dest, "Home Videos", folder_name), f"{folder_name}.mp4"

    def build_movie_path(self, meta: Dict, dest: str) -> Tuple[str, str]:
        name = f"{meta['title']} ({meta['year']})"
        return os.path.join(dest, "Movies", name), f"{name}.mp4"

    def build_tv_show_path(self, meta: Dict, dest: str) -> Tuple[str, str]:
        series = meta["series_title"]
        if meta.get("series_year"):
            series = f"{series} ({meta['series_year']})"
        season_folder = f"Season {meta['season_number']:02d}"
        filename = (
            f"{meta['series_title']} - "
            f"S{meta['season_number']:02d}E{meta['episode_number']:02d} - "
            f"{meta['episode_title']}.mp4"
        )
        return os.path.join(dest, "TV Shows", series, season_folder), filename

    def build_promo_path(self, meta: Dict, dest: str, category: str) -> Tuple[str, str]:
        target_folder = _slugify(meta.get("target_name", "")) or "Unknown"
        target_type = (meta.get("target_type") or "Other").title()
        title = _slugify(meta.get("title", "")) or category.rstrip("s")
        return os.path.join(dest, "Extras", category, target_type, target_folder), f"{title}.mp4"

    def _resolve_destination(self, item: Dict, dest: str) -> Tuple[str, str]:
        ct = item.get("content_type", "unclassified")
        if ct == "home_video" and item.get("home_video_metadata"):
            return self.build_home_video_path(item["home_video_metadata"], dest)
        if ct == "movie" and item.get("movie_assignment"):
            return self.build_movie_path(item["movie_assignment"], dest)
        if ct == "tv_show" and item.get("tv_show_assignment"):
            return self.build_tv_show_path(item["tv_show_assignment"], dest)
        if ct == "trailer" and item.get("promo_metadata"):
            return self.build_promo_path(item["promo_metadata"], dest, "Trailers")
        if ct == "commercial" and item.get("promo_metadata"):
            return self.build_promo_path(item["promo_metadata"], dest, "Commercials")
        if ct == "skip":
            return "", ""
        return os.path.join(dest, "_NeedsReview"), item["file_name"]

    def start_process_job(self, request: Dict) -> str:
        task_id = str(uuid4())
        items = request.get("items", [])
        statuses = [
            {
                "file_path": i["file_path"],
                "file_name": i["file_name"],
                "status": "skipped" if i.get("content_type") == "skip" else "pending",
                "target_path": None,
                "error": None,
                "progress_pct": 0.0,
            }
            for i in items
        ]
        self._jobs[task_id] = {
            "task_id": task_id,
            "overall_status": "running",
            "total": len(items),
            "completed": 0,
            "failed": 0,
            "skipped": sum(1 for i in items if i.get("content_type") == "skip"),
            "items": statuses,
        }
        threading.Thread(target=self._process_items, args=(task_id, request), daemon=True).start()
        return task_id

    def get_job_status(self, task_id: str) -> Optional[Dict]:
        return self._jobs.get(task_id)

    def _process_items(self, task_id: str, request: Dict) -> None:
        job = self._jobs[task_id]
        dest = request.get("destination_base", settings.tape_ingest_default_destination)
        use_filter = (
            request.get("apply_ffmpeg", False)
            and request.get("tape_type", "vhs") in ("vhs", "vhs_c")
        )
        for i, item in enumerate(request.get("items", [])):
            status = job["items"][i]
            if item.get("content_type") == "skip":
                continue
            status["status"] = "processing"
            try:
                folder, filename = self._resolve_destination(item, dest)
                dest_path = os.path.join(folder, filename)
                status["target_path"] = dest_path
                os.makedirs(folder, exist_ok=True)
                if use_filter:
                    self._ffmpeg_process(item["file_path"], dest_path)
                else:
                    shutil.copy2(item["file_path"], dest_path)
                status["status"] = "completed"
                status["progress_pct"] = 100.0
                job["completed"] += 1
            except Exception as exc:
                logger.error("Tape item failed", file=item.get("file_name"), error=str(exc))
                status["status"] = "failed"
                status["error"] = str(exc)
                job["failed"] += 1
        job["overall_status"] = "completed" if job["failed"] == 0 else "failed"

    def _ffmpeg_process(self, source: str, dest: str) -> None:
        result = subprocess.run(
            [
                settings.ffmpeg_path, "-i", source,
                "-vf", "yadif=mode=0,hqdn3d=2:1.5:6:4.5",
                "-c:v", "libx264",
                "-crf", str(settings.tape_ingest_ffmpeg_crf),
                "-preset", settings.tape_ingest_ffmpeg_preset,
                "-c:a", "aac", "-b:a", "160k",
                "-y", dest,
            ],
            capture_output=True, timeout=7200,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"FFmpeg failed: {result.stderr.decode('utf-8', errors='replace')[:500]}"
            )
