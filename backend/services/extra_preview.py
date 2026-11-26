"""
Browser playback of held extras: the file transcoded on the fly to a small
fragmented MP4 (H.264 + stereo AAC) that any browser can play.

Extras Review plays one when its frames are not enough to tell the type: a
deleted scene or a commentary track shows the same frames as the episode.
Rips are MKV, and DVD rips carry MPEG-2 video with AC-3 audio, which no
browser decodes, so nothing is served as-is. A piped stream cannot be seeked
past what has arrived, so the player jumps by asking for a new stream with a
start time; ``audio`` picks the audio track (a commentary is often the second).
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from io import BufferedReader
from typing import AsyncGenerator, List, cast

MAX_HEIGHT = 480
# About two seconds of video per fragment, so playback starts (and restarts after a jump) quickly.
KEYFRAME_INTERVAL = 48
CHUNK_BYTES = 64 * 1024


def command(video_path: str, start_seconds: float = 0.0, audio_index: int = 0) -> List[str]:
    """The ffmpeg call that writes the preview of ``video_path`` from ``start_seconds`` to stdout."""
    start = max(0.0, float(start_seconds or 0))
    audio = max(0, int(audio_index or 0))
    return [
        "ffmpeg", "-v", "error", "-nostdin",
        # Before -i: a fast seek to the keyframe before ``start``; output time starts at 0.
        "-ss", f"{start:.3f}", "-i", video_path,
        # "?" keeps a file without video (or without that audio track) playable.
        "-map", "0:v:0?", "-map", f"0:a:{audio}?",
        "-vf", f"yadif=deint=interlaced,scale=-2:min(ih\\,{MAX_HEIGHT})",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-g", str(KEYFRAME_INTERVAL), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
        "-sn", "-dn", "-map_chapters", "-1",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", "pipe:1",
    ]


async def stream(video_path: str, start_seconds: float = 0.0, audio_index: int = 0) -> AsyncGenerator[bytes, None]:
    """The preview's bytes as ffmpeg writes them. ffmpeg is stopped when this generator is closed.

    Reads happen in a worker thread, not through asyncio's subprocess support,
    which the Windows selector event loop lacks.
    """
    proc = subprocess.Popen(
        command(video_path, start_seconds, audio_index),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    stdout = cast(BufferedReader, proc.stdout)
    try:
        while True:
            chunk = await asyncio.to_thread(stdout.read1, CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        # The browser closed the stream (a jump, a new track, the player closed): stop transcoding.
        # No await here: this also runs inside a cancelled task, where an await would be cut short.
        if proc.poll() is None:
            proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        stdout.close()


def playback_info(video_path: str) -> dict:
    """The file's length and audio tracks, for the player's timeline and track picker.

    ``durationSeconds`` is None and ``audioTracks`` empty when ffprobe cannot read the file.
    """
    try:
        done = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "a",
                "-show_entries",
                "format=duration:stream=codec_name,channels:stream_tags=language,title:stream_disposition=default,comment",
                "-of", "json", video_path,
            ],
            capture_output=True, timeout=60, stdin=subprocess.DEVNULL, check=False,
        )
        probed = json.loads(done.stdout.decode("utf-8", "replace") or "{}")
    except (subprocess.SubprocessError, OSError, ValueError):
        probed = {}
    try:
        duration = float((probed.get("format") or {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    tracks = []
    for index, s in enumerate(probed.get("streams") or []):
        tags = s.get("tags") or {}
        disposition = s.get("disposition") or {}
        tracks.append({
            "index": index,
            "codec": s.get("codec_name"),
            "channels": s.get("channels"),
            "language": tags.get("language") or tags.get("LANGUAGE"),
            "title": tags.get("title") or tags.get("TITLE"),
            "default": bool(disposition.get("default")),
            "commentary": bool(disposition.get("comment")),
        })
    return {"durationSeconds": duration if duration and duration > 0 else None, "audioTracks": tracks}
