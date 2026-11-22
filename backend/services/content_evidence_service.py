"""
Evidence taken from the content of a video file, for content verification.

"Watching" a file here means: a few dozen frames, dense in the opening and
closing minutes where titles and credits are, each read by the local vision
model; plus about ten minutes of dialogue, from an embedded text subtitle
track when there is one and from speech-to-text otherwise.

Nothing in this module decides anything. services/content_verifier.py compares
what was read against TMDB data. File and folder names are never shown to a
model. Sampling and prompt are the ones measured in scripts/content-verify-bench.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from config.settings import settings
from services import localai_vision
from utils.logging import logger

TEXT_SUB_CODECS = {"subrip", "ass", "ssa", "mov_text", "webvtt", "text", "srt"}
HEAD_FRAMES, MID_FRAMES, TAIL_FRAMES = 16, 6, 10
SUBTITLE_WINDOW_S = 300.0
AUDIO_WINDOW_S = 240.0
MIN_DIALOGUE_CHARS = 200
FRAME_PROMPT = (
    "This is one frame from a video file. Reply with JSON only, using exactly these keys:\n"
    '{"visibleText": "<every legible word of on-screen text, verbatim, in reading order; empty string if none>",\n'
    ' "textKind": "<title_card | credits | subtitle | caption | logo | none>",\n'
    ' "contentKind": "<feature_scene | interview | behind_the_scenes | trailer_or_promo | menu_or_logo | credits | other>",\n'
    ' "animated": <true|false>, "blackAndWhite": <true|false>,\n'
    ' "description": "<one short sentence about what is shown>"}\n'
    "Copy text exactly as shown. Never guess a film or show title that is not written on screen. "
    "interview = a person talking to an off-screen interviewer; behind_the_scenes = film crew, cameras, "
    "sets or rehearsal visible; trailer_or_promo = rating cards, 'coming soon', release-date or studio promo text."
)


@dataclass
class ContentEvidence:
    # One entry per sampled frame: zone (head|mid|tail), t (seconds), and either the
    # model's answer (visibleText, textKind, contentKind, description) or "error".
    frames: List[Dict[str, Any]] = field(default_factory=list)
    dialogue: str = ""
    dialogue_source: Optional[str] = None  # "subtitles" | "whisper"
    timings: Dict[str, float] = field(default_factory=dict)

    @property
    def unusable_frames(self) -> int:
        return sum(1 for f in self.frames if "error" in f)


def frame_times(duration_s: float) -> List[Dict[str, Any]]:
    """Dense in the opening and the end, where titles and credits are; sparse in the body."""
    if duration_s < 180:
        n = 8
        return [{"zone": "mid", "t": round(duration_s * (i + 0.5) / n, 1)} for i in range(n)]
    head_end = min(300.0, duration_s * 0.15)
    tail_len = min(360.0, duration_s * 0.12)
    tail_start = duration_s - tail_len
    out = []
    for i in range(HEAD_FRAMES):
        out.append({"zone": "head", "t": round(5 + (head_end - 5) * i / (HEAD_FRAMES - 1), 1)})
    for i in range(MID_FRAMES):
        out.append({"zone": "mid", "t": round(head_end + (tail_start - head_end) * (i + 0.5) / MID_FRAMES, 1)})
    for i in range(TAIL_FRAMES):
        out.append({"zone": "tail", "t": round(tail_start + (tail_len - 4) * i / (TAIL_FRAMES - 1), 1)})
    return out


def dialogue_windows(duration_s: float, length: float) -> List[float]:
    """Start times of the dialogue samples: one for a short file, otherwise early and past the middle."""
    if duration_s < 2 * length + 120:
        return [min(30.0, duration_s * 0.05)]
    return [max(60.0, duration_s * 0.12), duration_s * 0.55]


def _run(cmd: List[str], timeout: float) -> Optional[bytes]:
    try:
        done = subprocess.run(cmd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL, check=False)
    except (subprocess.SubprocessError, OSError):
        return None
    return done.stdout if done.returncode == 0 else None


def grab_frame(path: str, t: float, out: str) -> bool:
    # -ss before -i: seek by keyframe, so a frame deep in a two-hour file costs about a second.
    _run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1",
          "-vf", "scale='min(768,iw)':-2", "-q:v", "4", out], timeout=120)
    return os.path.exists(out) and os.path.getsize(out) > 0


def text_sub_stream(path: str) -> Optional[int]:
    """Stream index of an embedded text subtitle track, English first. Image subtitles (PGS, VobSub) are skipped."""
    raw = _run(["ffprobe", "-v", "error", "-select_streams", "s", "-show_entries",
                "stream=index,codec_name:stream_tags=language", "-of", "json", path], timeout=120)
    try:
        streams = json.loads(raw or b"{}").get("streams", [])
    except ValueError:
        return None
    text = [s for s in streams if s.get("codec_name") in TEXT_SUB_CODECS]
    english = [s for s in text if (s.get("tags") or {}).get("language", "").lower() in ("eng", "en")]
    pick = (english or text or [None])[0]
    return pick["index"] if pick else None


def sub_text(path: str, stream: int, start: float, length: float) -> str:
    raw = _run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", path,
                "-map", f"0:{stream}", "-f", "srt", "-"], timeout=600)
    lines: List[str] = []
    for line in (raw or b"").decode("utf-8", "replace").splitlines():
        line = re.sub(r"<[^>]+>|\{[^}]*\}", "", line).strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        if not lines or lines[-1] != line:
            lines.append(line)
    return "\n".join(lines)


def audio_clip(path: str, start: float, length: float, out: str) -> bool:
    _run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", path,
          "-map", "0:a:0", "-ac", "1", "-ar", "16000", out], timeout=600)
    return os.path.exists(out) and os.path.getsize(out) > 1000


def _grab_frames(path: str, duration_s: float, workdir: str) -> List[Dict[str, Any]]:
    frames = []
    for i, spot in enumerate(frame_times(duration_s)):
        out = os.path.join(workdir, f"f{i:02d}.jpg")
        if grab_frame(path, spot["t"], out):
            frames.append({**spot, "file": out})
    return frames


def _subtitle_dialogue(path: str, duration_s: float) -> str:
    stream = text_sub_stream(path)
    if stream is None:
        return ""
    starts = dialogue_windows(duration_s, SUBTITLE_WINDOW_S)
    return "\n".join(sub_text(path, stream, s, SUBTITLE_WINDOW_S) for s in starts).strip()


def _audio_clips(path: str, duration_s: float, workdir: str) -> List[str]:
    clips = []
    for i, start in enumerate(dialogue_windows(duration_s, SUBTITLE_WINDOW_S)):
        out = os.path.join(workdir, f"a{i}.wav")
        if audio_clip(path, start, AUDIO_WINDOW_S, out):
            clips.append(out)
    return clips


async def describe_frame(image_path: str) -> Dict[str, Any]:
    """The vision model's reading of one frame, or {"error": ...}; one bad frame must not lose the file."""
    try:
        with open(image_path, "rb") as fh:
            image_b64 = localai_vision.prepare_image(fh.read(), max_dimension=768)
        content = await localai_vision.ask(FRAME_PROMPT, image_b64, max_tokens=500, timeout=240.0)
    except (OSError, ValueError, httpx.HTTPError) as exc:
        return {"error": str(exc)[:200] or type(exc).__name__}
    parsed = localai_vision.parse_model_json(content)
    if not parsed:
        return {"error": "unparseable answer"}
    return {key: parsed.get(key) for key in ("visibleText", "textKind", "contentKind", "description")}


async def transcribe(clip_path: str) -> str:
    """Speech-to-text for one audio clip through an OpenAI-compatible /v1/audio/transcriptions."""
    url = (settings.content_verify_whisper_url or "").rstrip("/")
    if not url:
        return ""
    headers = {"Authorization": f"Bearer {settings.localai_api_key}"} if settings.localai_api_key else {}
    with open(clip_path, "rb") as fh:
        audio = fh.read()
    async with httpx.AsyncClient(timeout=600.0) as client:
        response = await client.post(
            f"{url}/v1/audio/transcriptions",
            data={"model": settings.content_verify_whisper_model, "language": "en"},
            files={"file": (os.path.basename(clip_path), audio, "audio/wav")},
            headers=headers,
        )
        response.raise_for_status()
    return str(response.json().get("text") or "").strip()


async def gather_evidence(path: str, duration_ms: float, want_dialogue: bool) -> ContentEvidence:
    """Sample and read one file. Dialogue is only fetched when asked for (it tells episodes apart)."""
    evidence = ContentEvidence()
    duration_s = float(duration_ms or 0) / 1000.0
    if duration_s <= 0:
        return evidence
    workdir = tempfile.mkdtemp(prefix="content-verify-")
    try:
        started = time.time()
        grabbed = await asyncio.to_thread(_grab_frames, path, duration_s, workdir)
        evidence.timings["frames_s"] = round(time.time() - started, 1)

        started = time.time()
        # One at a time: LocalAI serves a single slot, and a queue of requests would only time out.
        for frame in grabbed:
            answer = await describe_frame(frame["file"])
            evidence.frames.append({"zone": frame["zone"], "t": frame["t"], **answer})
        evidence.timings["vision_s"] = round(time.time() - started, 1)

        if want_dialogue:
            started = time.time()
            text = await asyncio.to_thread(_subtitle_dialogue, path, duration_s)
            if len(text) > MIN_DIALOGUE_CHARS:
                evidence.dialogue, evidence.dialogue_source = text, "subtitles"
            elif settings.content_verify_whisper_url:
                clips = await asyncio.to_thread(_audio_clips, path, duration_s, workdir)
                try:
                    text = "\n".join([await transcribe(clip) for clip in clips]).strip()
                except httpx.HTTPError as exc:
                    logger.warning("Content verification: speech-to-text failed", error=str(exc))
                    text = ""
                if len(text) > MIN_DIALOGUE_CHARS:
                    evidence.dialogue, evidence.dialogue_source = text, "whisper"
            evidence.timings["dialogue_s"] = round(time.time() - started, 1)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return evidence
