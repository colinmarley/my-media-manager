"""Benchmark content-based verification of ingest identity: does looking at the file help?

Ground truth is library files a human accepted (export_cases.sql, enrich_tmdb.py). File and folder
names are never shown to a model. Standard library only; needs ffmpeg/ffprobe and the media mount.

Stages, each resumable (results are cached per file under --work):

  python bench.py extract    --cases cases.enriched.jsonl --work /data/mmm-content-bench
  python transcribe.py       --work /data/mmm-content-bench          # optional, files without text subtitles
  python bench.py vision     --cases ... --work ... --localai http://localhost:8080 --model qwen2.5vl-7b
  python bench.py judge      --cases ... --work ... --decider http://localhost:8130/v1
  python bench.py report     --work ...

LOCALAI_API_KEY is read from the environment.
"""

import argparse
import base64
import concurrent.futures
import json
import os
import re
import statistics
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

TEXT_SUB_CODECS = {"subrip", "ass", "ssa", "mov_text", "webvtt", "text", "srt"}
EXTRA_KINDS = {"interview", "behind_the_scenes", "trailer_or_promo", "menu_or_logo"}
STOPWORDS = {"the", "a", "an", "of", "and", "in", "to"}
HEAD_FRAMES, MID_FRAMES, TAIL_FRAMES = 16, 6, 10
CREDIT_WORDS = re.compile(r"(directed|produced|written|created|starring|screenplay|music|edited|photography|producer|casting) by|(guest star|co star|executive producer|costume designer|production designer)")
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


# --------------------------------------------------------------------------- helpers

def load_cases(path: str) -> List[Dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        return [c for c in (json.loads(line) for line in fh if line.strip()) if c.get("ref")]


def case_dir(work: str, case: Dict[str, Any]) -> str:
    d = os.path.join(work, case["id"])
    os.makedirs(d, exist_ok=True)
    return d


def read_json(path: str) -> Optional[Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_json(path: str, data: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, path)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: float) -> Dict[str, Any]:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **headers}
    )
    last: Exception = RuntimeError("no attempt")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            last = RuntimeError(f"HTTP {exc.code}: {exc.read()[:200]!r}")
            if exc.code not in (429, 500, 502, 503, 529):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
        time.sleep(2 * (attempt + 1))
    raise last


# --------------------------------------------------------------------------- extract

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


def grab_frame(path: str, t: float, out: str) -> bool:
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1",
           "-vf", "scale='min(768,iw)':-2", "-q:v", "4", out]
    try:
        subprocess.run(cmd, check=True, timeout=120, stdin=subprocess.DEVNULL, capture_output=True)
    except (subprocess.SubprocessError, OSError):
        return False
    return os.path.exists(out) and os.path.getsize(out) > 0


def text_sub_stream(path: str) -> Optional[int]:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "s", "-show_entries",
           "stream=index,codec_name:stream_tags=language", "-of", "json", path]
    try:
        streams = json.loads(subprocess.run(cmd, capture_output=True, timeout=120, check=True).stdout).get("streams", [])
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    text = [s for s in streams if s.get("codec_name") in TEXT_SUB_CODECS]
    english = [s for s in text if (s.get("tags") or {}).get("language", "").lower() in ("eng", "en")]
    pick = (english or text or [None])[0]
    return pick["index"] if pick else None


def dialogue_windows(duration_s: float, length: float) -> List[float]:
    if duration_s < 2 * length + 120:
        return [min(30.0, duration_s * 0.05)]
    return [max(60.0, duration_s * 0.12), duration_s * 0.55]


def sub_text(path: str, stream: int, start: float, length: float) -> str:
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length), "-i", path,
           "-map", f"0:{stream}", "-f", "srt", "-"]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=600, stdin=subprocess.DEVNULL).stdout.decode("utf-8", "replace")
    except (subprocess.SubprocessError, OSError):
        return ""
    lines = []
    for line in raw.splitlines():
        line = re.sub(r"<[^>]+>|\{[^}]*\}", "", line).strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        if not lines or lines[-1] != line:
            lines.append(line)
    return "\n".join(lines)


def audio_clip(path: str, start: float, length: float, out: str) -> bool:
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", path,
           "-map", "0:a:0", "-ac", "1", "-ar", "16000", out]
    try:
        subprocess.run(cmd, check=True, timeout=600, stdin=subprocess.DEVNULL, capture_output=True)
    except (subprocess.SubprocessError, OSError):
        return False
    return os.path.exists(out) and os.path.getsize(out) > 1000


def extract_one(work: str, case: Dict[str, Any], audio: bool) -> Dict[str, Any]:
    d = case_dir(work, case)
    meta_path = os.path.join(d, "extract.json")
    done = read_json(meta_path)
    if done:
        return done
    started = time.time()
    duration_s = case["duration_ms"] / 1000.0
    frames = []
    for i, ft in enumerate(frame_times(duration_s)):
        name = f"f{i:02d}.jpg"
        if grab_frame(case["path"], ft["t"], os.path.join(d, name)):
            frames.append({**ft, "file": name})
    frames_s = time.time() - started

    started = time.time()
    source, text, clips = None, "", []
    if case["kind"] == "episode":  # dialogue is only used to tell episodes apart
        stream = text_sub_stream(case["path"])
        window = 300.0
        starts = dialogue_windows(duration_s, window)
        if stream is not None:
            text = "\n".join(sub_text(case["path"], stream, s, window) for s in starts).strip()
            if len(text) > 200:
                source = "subtitles"
        if source is None and audio:
            for i, s in enumerate(starts):
                clip = f"a{i}.wav"
                if audio_clip(case["path"], s, 240.0, os.path.join(d, clip)):
                    clips.append(clip)
            source = "audio" if clips else None
    if source == "subtitles":
        with open(os.path.join(d, "dialogue.txt"), "w", encoding="utf-8") as fh:
            fh.write(text)
    meta = {"frames": frames, "dialogue_source": source, "audio_clips": clips,
            "frames_s": round(frames_s, 1), "dialogue_s": round(time.time() - started, 1)}
    write_json(meta_path, meta)
    return meta


def stage_extract(args) -> None:
    cases = load_cases(args.cases)
    with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        futures = {pool.submit(extract_one, args.work, c, not args.no_audio): c for c in cases}
        for n, fut in enumerate(concurrent.futures.as_completed(futures), start=1):
            meta, case = fut.result(), futures[fut]
            print(f"[{n}/{len(cases)}] {case['kind']:8} frames={len(meta['frames'])} "
                  f"dialogue={meta['dialogue_source']} {meta['frames_s']}s+{meta['dialogue_s']}s", flush=True)


# --------------------------------------------------------------------------- vision

def parse_model_json(content: str) -> Optional[Dict[str, Any]]:
    content = (content or "").strip()
    match = re.search(r"\{.*\}", content, re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def describe_frame(args, image_path: str) -> Dict[str, Any]:
    with open(image_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    payload = {
        "model": args.model, "temperature": 0, "max_tokens": 500,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": FRAME_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
    }
    key = os.environ.get("LOCALAI_API_KEY", "")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    started = time.time()
    resp = post_json(f"{args.localai.rstrip('/')}/v1/chat/completions", payload, headers, timeout=240)
    content = resp["choices"][0]["message"].get("content") or ""
    parsed = parse_model_json(content) or {"parse_error": content[:300]}
    parsed["latency_s"] = round(time.time() - started, 2)
    return parsed


def vision_one(args, case: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    d = case_dir(args.work, case)
    out_path = os.path.join(d, f"vision.{args.model}.json")
    done = read_json(out_path)
    if done:
        return done
    meta = read_json(os.path.join(d, "extract.json"))
    if not meta:
        return None
    frames = []
    for fr in meta["frames"]:
        try:
            answer = describe_frame(args, os.path.join(d, fr["file"]))
        except Exception as exc:  # one bad frame must not lose the file
            answer = {"error": str(exc)[:200]}
        frames.append({**fr, **answer})
    result = {"model": args.model, "frames": frames}
    write_json(out_path, result)
    return result


def stage_vision(args) -> None:
    cases = load_cases(args.cases)
    with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
        futures = {pool.submit(vision_one, args, c): c for c in cases}
        for n, fut in enumerate(concurrent.futures.as_completed(futures), start=1):
            res, case = fut.result(), futures[fut]
            if not res:
                continue
            lat = [f.get("latency_s", 0) for f in res["frames"]]
            bad = sum(1 for f in res["frames"] if "error" in f or "parse_error" in f)
            print(f"[{n}/{len(cases)}] {case['kind']:8} {len(lat)} frames {sum(lat):.0f}s bad={bad}", flush=True)


# --------------------------------------------------------------------------- judge

def frame_text(frame: Dict[str, Any]) -> str:
    return norm(str(frame.get("visibleText") or ""))


def title_tokens(title: str) -> List[str]:
    tokens = norm(title).split()
    kept = [t for t in tokens if t not in STOPWORDS]
    return kept or tokens


def title_seen(title: str, frames: List[Dict[str, Any]]) -> Optional[str]:
    """The visibleText of the first frame that shows the title, or None."""
    tokens = title_tokens(title)
    if not tokens:
        return None
    phrase = f" {norm(title)} "
    for frame in frames:
        text = frame_text(frame)
        words = text.split()
        if not words:
            continue
        hits = sum(1 for t in tokens if t in words)
        need = len(tokens) if len(tokens) < 4 else max(3, round(len(tokens) * 0.8))
        if hits < need:
            continue
        # A one-word title only counts on a sparse frame (a title card), not inside running text.
        if len(tokens) == 1 and (len(words) > 6 or len(tokens[0]) < 3):
            continue
        # In a long text scattered title words prove nothing; the title must be there as a phrase.
        if len(words) > 12 and phrase not in f" {text} ":
            continue
        return str(frame.get("visibleText"))[:160]
    return None


def names_seen(names: List[str], frames: List[Dict[str, Any]]) -> List[str]:
    blob = " " + "  ".join(frame_text(f) for f in frames) + " "
    found = []
    for name in names or []:
        n = norm(name)
        if len(n.split()) >= 2 and f" {n} " in blob and name not in found:
            found.append(name)
    return found


def credits_read(frames: List[Dict[str, Any]]) -> int:
    """Frames that show credits. The model's own textKind label is unreliable, so also look for credit wording."""
    count = 0
    for f in frames:
        text = frame_text(f)
        if len(text.split()) >= 3 and (f.get("textKind") == "credits" or CREDIT_WORDS.search(text)):
            count += 1
    return count


DIRECTOR_CARD = re.compile(r"directed by|director")


def director_card_read(frames: List[Dict[str, Any]]) -> bool:
    """A frame that names a director: a headline credit TMDB always has, unlike deep crew lists."""
    for f in frames:
        text = frame_text(f)
        if len(text.split()) > 12 or "director of" in text or "assistant director" in text:
            continue
        if DIRECTOR_CARD.search(text):
            return True
    return False


def identity_verdict(ref: Dict[str, Any], frames: List[Dict[str, Any]], allow_veto: bool = True) -> Dict[str, Any]:
    """Does the on-screen text support this title? confirm / veto / no_evidence.

    Confirm: the title is on screen, or two known cast/crew names are. Veto needs a positive
    contradiction: a director credit was read and it names none of the title's directors. Reading
    crew lists that merely fail to overlap is not a contradiction (TMDB lists are partial), and bonus
    material has its own credits, so short files are never vetoed.
    """
    titles = [t for t in {ref.get("title"), ref.get("original_title")} if t]
    shown = next((s for s in (title_seen(t, frames) for t in titles) if s), None)
    people = names_seen((ref.get("cast") or []) + (ref.get("directors") or []) + (ref.get("crew") or []), frames)
    if shown or len(people) >= 2:
        verdict = "confirm"
    elif allow_veto and not people and ref.get("directors") and director_card_read(frames):
        verdict = "veto"
    else:
        verdict = "no_evidence"
    return {"verdict": verdict, "title_shown": shown, "people": people[:8]}


def episode_from_title_card(ref: Dict[str, Any], frames: List[Dict[str, Any]]) -> Optional[int]:
    series = set(title_tokens(ref.get("title") or ""))
    hits = []
    for ep in ref.get("episodes") or []:
        name = ep.get("name") or ""
        tokens = title_tokens(name)
        # Skip placeholder names ("Episode 4") and names that are just the series title.
        if not tokens or re.fullmatch(r"episode \d+", norm(name)) or set(tokens) <= series:
            continue
        if title_seen(name, frames):
            hits.append((len(tokens), ep["n"]))
    if not hits:
        return None
    hits.sort(reverse=True)
    if len(hits) > 1 and hits[0][0] == hits[1][0]:
        return None
    return hits[0][1]


def episode_from_guests(ref: Dict[str, Any], frames: List[Dict[str, Any]]) -> Optional[int]:
    scored = []
    for ep in ref.get("episodes") or []:
        scored.append((len(names_seen(ep.get("guests") or [], frames)), ep["n"]))
    scored.sort(reverse=True)
    if not scored or scored[0][0] == 0:
        return None
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return scored[0][1]


def episode_from_dialogue(args, case: Dict[str, Any], dialogue: str) -> Optional[Dict[str, Any]]:
    ref = case["ref"]
    criteria = {}
    for ep in ref.get("episodes") or []:
        overview = (ep.get("overview") or "").strip()
        if overview:
            criteria[f"e{ep['n']}"] = f"Episode {ep['n']}, \"{ep.get('name')}\": {overview[:500]}"
    if len(criteria) < 2 or len(dialogue) < 400:
        return None
    state = {"series": ref.get("title"), "season": case["season"], "dialogue_excerpt": dialogue[:7000]}
    question = {
        "type": "choice",
        "instructions": (
            "dialogue_excerpt is about ten minutes of spoken dialogue from one episode of this season. "
            "Which episode's synopsis does the dialogue fit?"
        ),
        "criteria": criteria,
    }
    started = time.time()
    resp = post_json(f"{args.decider.rstrip('/')}/systemone",
                     {"state": state, "model": args.decider_model, "questions": {"ep": question}}, {}, timeout=900)
    answer = (resp.get("answers") or {}).get("ep") or {}
    choice = str(answer.get("choice") or "")
    probs = answer.get("probabilities") or {}
    if not choice.startswith("e"):
        return None
    return {"episode": int(choice[1:]), "confidence": float(probs.get(choice, 0.0)),
            "latency_s": round(time.time() - started, 1)}


def role_from_frames(frames: List[Dict[str, Any]]) -> Dict[str, Any]:
    body = [f for f in frames if f.get("contentKind") and f.get("contentKind") != "credits"]
    extra = [f for f in body if f.get("contentKind") in EXTRA_KINDS]
    ratio = len(extra) / len(body) if body else 0.0
    return {"extra_ratio": round(ratio, 2), "label": "extra" if ratio >= 0.34 else "feature"}


def judge_one(args, case: Dict[str, Any], decoy_ref: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    d = case_dir(args.work, case)
    out_path = os.path.join(d, f"judge.{args.model}.json")
    done = read_json(out_path)
    if done and not args.rejudge:
        return done
    meta = read_json(os.path.join(d, "extract.json"))
    vision = read_json(os.path.join(d, f"vision.{args.model}.json"))
    if not meta or not vision:
        return None
    frames = vision["frames"]
    ref = case["ref"]
    # Bonus material carries its own credits; only feature-length or episode-length files can be vetoed.
    allow_veto = case["kind"] == "episode" or case["duration_ms"] / 60000.0 >= 0.5 * (ref.get("runtime_min") or 80)
    previous_dialogue = ((done or {}).get("episode") or {}).get("dialogue")
    out: Dict[str, Any] = {
        "id": case["id"], "kind": case["kind"], "title": ref.get("title"),
        "frames": len(frames),
        "frames_bad": sum(1 for f in frames if "error" in f or "parse_error" in f),
        "vision_s": round(sum(f.get("latency_s", 0) for f in frames), 1),
        "extract_s": meta["frames_s"] + meta["dialogue_s"],
        "true_claim": identity_verdict(ref, frames, allow_veto),
        "decoy_claim": identity_verdict(decoy_ref, frames, allow_veto) if decoy_ref else None,
        "role": role_from_frames(frames),
    }
    runtime = ref.get("runtime_min")
    if case["kind"] != "episode" and runtime:
        out["role"]["runtime_label"] = "extra" if case["duration_ms"] / 60000.0 < 0.5 * runtime else "feature"

    if case["kind"] == "episode":
        dialogue = ""
        for name in ("dialogue.txt", "whisper.txt"):
            try:
                with open(os.path.join(d, name), encoding="utf-8") as fh:
                    dialogue = fh.read()
                out["dialogue_source"] = "subtitles" if name == "dialogue.txt" else "whisper"
                break
            except OSError:
                continue
        ep: Dict[str, Any] = {
            "truth": case["episode"], "season_size": len(ref.get("episodes") or []),
            "title_card": episode_from_title_card(ref, frames),
            "guests": episode_from_guests(ref, frames),
            "dialogue": None,
        }
        if previous_dialogue and not args.redo_dialogue:
            ep["dialogue"] = previous_dialogue  # the CPU decider is slow; keep its earlier answer
        elif dialogue and not args.no_decider:
            try:
                ep["dialogue"] = episode_from_dialogue(args, case, dialogue)
            except Exception as exc:
                ep["dialogue_error"] = str(exc)[:200]
        dlg = ep["dialogue"]
        if ep["title_card"] is not None:
            ep["pick"], ep["pick_by"] = ep["title_card"], "title_card"
        elif dlg and dlg["confidence"] >= args.min_confidence:
            ep["pick"], ep["pick_by"] = dlg["episode"], "dialogue"
        elif ep["guests"] is not None:
            ep["pick"], ep["pick_by"] = ep["guests"], "guests"
        else:
            ep["pick"], ep["pick_by"] = None, None
        out["episode"] = ep
    write_json(out_path, out)
    return out


def stage_judge(args) -> None:
    cases = load_cases(args.cases)
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for c in cases:
        by_kind.setdefault("episode" if c["kind"] == "episode" else "movie", []).append(c)
    for n, case in enumerate(cases, start=1):
        pool = by_kind["episode" if case["kind"] == "episode" else "movie"]
        idx = pool.index(case)
        decoy = None
        for step in range(7, 7 + len(pool)):  # a different title of the same kind
            other = pool[(idx + step) % len(pool)]
            if norm(other["ref"].get("title") or "") != norm(case["ref"].get("title") or ""):
                decoy = other["ref"]
                break
        res = judge_one(args, case, decoy)
        if res:
            ep = res.get("episode") or {}
            print(f"[{n}/{len(cases)}] {case['kind']:8} true={res['true_claim']['verdict']:11} "
                  f"decoy={(res['decoy_claim'] or {}).get('verdict')} role={res['role']['label']} "
                  f"ep={ep.get('pick')}/{ep.get('truth')} by={ep.get('pick_by')}", flush=True)


# --------------------------------------------------------------------------- report

def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100.0 * n / d:.0f}%)" if d else "0/0"


def stage_report(args) -> None:
    rows = []
    for entry in sorted(os.listdir(args.work)):
        res = read_json(os.path.join(args.work, entry, f"judge.{args.model}.json"))
        if res:
            rows.append(res)
    if not rows:
        print("no results")
        return
    print(f"# Content verification bench: {args.model}, {len(rows)} files\n")

    print("## Is it the claimed title? (on-screen title and credit names only)\n")
    print("| files | n | true claim confirmed | true claim vetoed (false veto) | no evidence | wrong claim confirmed (false confirm) | wrong claim vetoed |")
    print("|---|---|---|---|---|---|---|")
    for kind in ("movie", "episode", "extra"):
        sub = [r for r in rows if r["kind"] == kind]
        if not sub:
            continue
        t = [r["true_claim"]["verdict"] for r in sub]
        dc = [r["decoy_claim"]["verdict"] for r in sub if r.get("decoy_claim")]
        print(f"| {kind} | {len(sub)} | {pct(t.count('confirm'), len(t))} | {pct(t.count('veto'), len(t))} | "
              f"{pct(t.count('no_evidence'), len(t))} | {pct(dc.count('confirm'), len(dc))} | {pct(dc.count('veto'), len(dc))} |")
    shown = [r for r in rows if r["kind"] != "extra"]
    print(f"\nTitle legible on screen (open identification is possible): "
          f"{pct(sum(1 for r in shown if r['true_claim']['title_shown']), len(shown))} of movies and episodes; "
          f"two or more cast/crew names read: {pct(sum(1 for r in shown if len(r['true_claim']['people']) >= 2), len(shown))}.\n")

    eps = [r["episode"] | {"src": r.get("dialogue_source")} for r in rows if r["kind"] == "episode"]
    if eps:
        print("## Which episode is it? (chance is about 1 in "
              f"{statistics.mean(e['season_size'] for e in eps):.0f})\n")
        print("| signal | answered | correct when answered |")
        print("|---|---|---|")

        def line(label, picks):
            answered = [(p, e) for p, e in picks if p is not None]
            print(f"| {label} | {pct(len(answered), len(picks))} | {pct(sum(1 for p, e in answered if p == e['truth']), len(answered))} |")

        line("episode title card", [(e["title_card"], e) for e in eps])
        line("guest names in credits", [(e["guests"], e) for e in eps])
        for src in ("subtitles", "whisper"):
            with_dlg = [e for e in eps if e["src"] == src and e.get("dialogue")]
            if with_dlg:
                line(f"dialogue ({src}) vs synopses, any confidence", [(e["dialogue"]["episode"], e) for e in with_dlg])
                conf = [(e["dialogue"]["episode"] if e["dialogue"]["confidence"] >= args.min_confidence else None, e) for e in with_dlg]
                line(f"dialogue ({src}), confidence >= {args.min_confidence}", conf)
        line("combined pick", [(e["pick"], e) for e in eps])
        no_dialogue = sum(1 for e in eps if not e.get("dialogue"))
        print(f"\nEpisodes with no dialogue answer: {no_dialogue} of {len(eps)}.\n")

    feats = [r for r in rows if r["kind"] == "movie"]
    extras = [r for r in rows if r["kind"] == "extra"]
    if feats or extras:
        print("## Feature or bonus material?\n")
        print("| rule | features called feature | extras called extra |")
        print("|---|---|---|")
        print(f"| frames only | {pct(sum(1 for r in feats if r['role']['label'] == 'feature'), len(feats))} | "
              f"{pct(sum(1 for r in extras if r['role']['label'] == 'extra'), len(extras))} |")
        fr = [r for r in feats if r["role"].get("runtime_label")]
        er = [r for r in extras if r["role"].get("runtime_label")]
        print(f"| runtime under half of TMDB runtime | {pct(sum(1 for r in fr if r['role']['runtime_label'] == 'feature'), len(fr))} | "
              f"{pct(sum(1 for r in er if r['role']['runtime_label'] == 'extra'), len(er))} |")
        long_extras = [r for r in er if r["role"]["runtime_label"] == "feature"]
        print(f"\nLong extras the runtime rule misses: {len(long_extras)}; frames call "
              f"{sum(1 for r in long_extras if r['role']['label'] == 'extra')} of them extra.\n")

    vis = [r["vision_s"] for r in rows]
    ext = [r["extract_s"] for r in rows]
    dlg = [e["dialogue"]["latency_s"] for e in eps if e.get("dialogue")] if eps else []
    print("## Cost per file\n")
    print(f"- frame and subtitle extraction: median {statistics.median(ext):.0f}s, max {max(ext):.0f}s")
    print(f"- vision model: median {statistics.median(vis):.0f}s for {statistics.median(r['frames'] for r in rows):.0f} frames; "
          f"unusable frame answers: {sum(r['frames_bad'] for r in rows)} of {sum(r['frames'] for r in rows)}")
    if dlg:
        print(f"- dialogue judgement on the CPU decider: median {statistics.median(dlg):.0f}s")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["extract", "vision", "judge", "report"])
    ap.add_argument("--cases")
    ap.add_argument("--work", required=True)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--no-audio", action="store_true", help="extract: skip audio clips for files without text subtitles")
    ap.add_argument("--localai", default="http://localhost:8080")
    ap.add_argument("--model", default="qwen2.5vl-7b")
    ap.add_argument("--decider", default="http://localhost:8130/v1")
    ap.add_argument("--decider-model", default="jev-latest")
    ap.add_argument("--no-decider", action="store_true")
    ap.add_argument("--min-confidence", type=float, default=0.7)
    ap.add_argument("--rejudge", action="store_true", help="recompute verdicts; keeps earlier dialogue answers")
    ap.add_argument("--redo-dialogue", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.work, exist_ok=True)
    {"extract": stage_extract, "vision": stage_vision, "judge": stage_judge, "report": stage_report}[args.stage](args)


if __name__ == "__main__":
    main()
