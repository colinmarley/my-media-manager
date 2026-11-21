"""Benchmark System One decision servers on My Media Manager ingest classification.

Each eval group is one movie's library files (main / version / extra, from media_files.role),
with file names anonymized to MakeMKV-style title_tNN.mkv in shuffled order, so a model has to
decide from runtimes, sizes and the film's metadata - the hard real-world disc-rip case.

The request is built exactly like backend/services/ingest_ai_classifier.py on
feat/jev-ingest-decisions (one state per folder, one choice question per file).

  python bench.py --groups groups.jsonl --provider heuristic --out results/heuristic.jsonl
  python bench.py --groups groups.jsonl --provider systemone --url http://jevlab-onejev:8101/v1 \
      --model jev-latest --name onejev-9b --out results/onejev-9b.jsonl
  python bench.py --report results/*.jsonl
"""

import argparse
import asyncio
import glob
import json
import os
import random
import re
import statistics
import time
from typing import Any, Dict, List, Optional

import httpx

LABEL_MAIN, LABEL_VERSION, LABEL_SPECIAL = "main_feature", "alternate_version", "special_feature"
ROLE_TO_LABEL = {"main": LABEL_MAIN, "version": LABEL_VERSION, "extra": LABEL_SPECIAL}

# --- verbatim from ingest_ai_classifier.py ------------------------------------------------------
_LABEL_CRITERIA: Dict[str, str] = {
    LABEL_MAIN: (
        "The film itself in its primary/standard cut: the full-length feature "
        "presentation a viewer would pick from the disc's Play Movie option."
    ),
    LABEL_VERSION: (
        "Another full-length cut of the same film: extended, director's, "
        "unrated, theatrical-vs-special edition, alternate ending cut, or the "
        "same feature mastered differently. Runtime is close to the main feature."
    ),
    LABEL_SPECIAL: (
        "Bonus material that is not the film: making-of, featurettes, "
        "interviews, deleted or extended scenes, trailers, gag reels, short "
        "films, music videos, or disc filler such as intros and short loops."
    ),
}
_INSTRUCTIONS = (
    "This is one movie's ingest folder (usually a single disc rip). Using every "
    "file's runtime, size and name relative to the others, classify file {file_id} "
    "(\"{file_name}\")."
)
MAX_GROUP_FILES = 40


def _minutes(ms: Optional[float]) -> Optional[float]:
    return round(float(ms) / 60000.0, 1) if ms and ms > 0 else None


PROMPT = "v1"
NAMES = "anon"
_INSTRUCTIONS_V2 = (
    "This is one movie's ingest folder (usually a single disc rip). File {file_id} (\"{file_name}\") runs "
    "{runtime} min, {pct}% as long as the longest file in the folder ({longest} min){expected}. "
    "Is it the film, another full-length cut of the film, or bonus material?"
)


def build_request(group: Dict[str, Any]):
    files_in = group["files"][:MAX_GROUP_FILES]
    longest = max(float(f["ms"]) for f in files_in)
    files, qids = [], {}
    for n, f in enumerate(files_in, start=1):
        fid = f"f{n}"
        qids[fid] = f
        files.append({
            "id": fid,
            "file_name": f["anon_name"],
            "folder": group["folder"],
            "runtime_minutes": _minutes(f["ms"]),
            "size_gb": round(float(f["size"] or 0) / 1e9, 2),
            "percent_of_longest_runtime": round(100.0 * float(f["ms"]) / longest) if longest else None,
        })
    state = {
        "title": group["title"],
        "year": int(group["year"]) if str(group.get("year") or "").isdigit() else None,
        "media_type": "movie",
        "main_feature_already_in_library": False,
        "library_main_feature_runtime_minutes": None,
        "files": files,
    }
    if group.get("runtime"):
        state["expected_runtime"] = group["runtime"]
    def instructions(fi):
        if PROMPT == "v1":
            return _INSTRUCTIONS.format(file_id=fi["id"], file_name=fi["file_name"])
        exp = f"; the film's listed runtime is {group['runtime']}" if group.get("runtime") else ""
        return _INSTRUCTIONS_V2.format(file_id=fi["id"], file_name=fi["file_name"], runtime=fi["runtime_minutes"],
                                       pct=fi["percent_of_longest_runtime"], longest=_minutes(longest),
                                       expected=exp)
    questions = {
        fi["id"]: {"type": "choice", "instructions": instructions(fi), "criteria": dict(_LABEL_CRITERIA)}
        for fi in files
    }
    return state, questions, qids


def enforce_single_main(results: Dict[str, Dict[str, Any]]) -> None:
    mains = [k for k, r in results.items() if r["label"] == LABEL_MAIN]
    if len(mains) <= 1:
        return
    keep = max(mains, key=lambda k: results[k]["probabilities"].get(LABEL_MAIN, results[k]["confidence"]))
    for k in mains:
        if k == keep:
            continue
        e = results[k]
        others = {a: b for a, b in e["probabilities"].items() if a != LABEL_MAIN}
        e["label"] = max(others, key=others.get) if others else LABEL_VERSION
        e["confidence"] = 0.0
        e["demoted"] = True
# -------------------------------------------------------------------------------------------------


def prepare_groups(path: str, limit: Optional[int], seed: int = 7) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    out = []
    for line in open(path, encoding="utf-8"):
        g = json.loads(line)
        files = [f for f in g["files"] if f.get("ms")]
        main = [f for f in files if f["role"] == "main"]
        if len(main) != 1 or len(files) < 2:
            continue
        longest = max(f["ms"] for f in files)
        # Library label noise: a "main" far shorter than the longest file is a mislabel.
        if main[0]["ms"] < 0.5 * longest:
            continue
        files = sorted(files, key=lambda f: -f["ms"])[:MAX_GROUP_FILES]
        order = list(range(len(files)))
        rng.shuffle(order)
        stem = re.sub(r"[^A-Za-z0-9]+", "_", g["title"] or "Title").strip("_").upper()[:32]
        for idx, f in zip(order, files):
            f["anon_name"] = f"title_t{idx:02d}.mkv"
            if NAMES == "original":
                # The library keeps the ingest name after " - " (Title (Year) [imdbid-..] - <original>.mkv);
                # the main was renamed, so it gets the MakeMKV disc-title style name instead.
                m = re.search(r"\]\s+-\s+(.+)$", f["name"])
                original = m.group(1) if (m and f["role"] != "main") else None
                if original and re.match(r"(?i)^version\s+\d+\.", original):
                    original = None  # the library's own rename of an alternate cut, not an ingest name
                f["anon_name"] = original or f"{stem}_t{idx:02d}.mkv"
        files.sort(key=lambda f: f["anon_name"])  # disc order, not runtime order
        title = g["title"] or "Unknown"
        year = g.get("year")
        out.append({
            "movie_id": g["movie_id"], "title": title, "year": year, "runtime": g.get("runtime"),
            "folder": f"{title} ({year})" if year else title, "files": files,
        })
    # Stable order; versions first so short runs still cover the hard case.
    out.sort(key=lambda g: (not any(f["role"] == "version" for f in g["files"]), g["movie_id"]))
    return out[:limit] if limit else out


def heuristic(group: Dict[str, Any], version_rule: bool) -> Dict[str, Dict[str, Any]]:
    """Today's rule: longest = main; >=85% of main is a version only when the main is already in the
    library (never, for a fresh disc), else special. version_rule=True applies the 85% rule always."""
    _, _, qids = build_request(group)
    longest_id = max(qids, key=lambda k: qids[k]["ms"])
    main_ms = qids[longest_id]["ms"]
    res = {}
    for fid, f in qids.items():
        if fid == longest_id:
            label = LABEL_MAIN
        elif version_rule and f["ms"] >= 0.85 * main_ms:
            label = LABEL_VERSION
        else:
            label = LABEL_SPECIAL
        res[fid] = {"label": label, "confidence": 1.0, "probabilities": {label: 1.0}}
    return res


async def ask(client: httpx.AsyncClient, url: str, model: str, state, questions, key: str = ""):
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    for attempt in range(4):
        r = await client.post(url.rstrip("/") + "/systemone",
                              json={"state": state, "model": model, "questions": questions}, headers=headers)
        if r.status_code in (429, 503, 529) and attempt < 3:
            await asyncio.sleep(2 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()


async def run(args) -> None:
    groups = prepare_groups(args.groups, args.limit)
    done = set()
    if os.path.exists(args.out) and not args.fresh:
        done = {json.loads(l)["movie_id"] for l in open(args.out, encoding="utf-8")}
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    out = open(args.out, "a", encoding="utf-8")
    client = httpx.AsyncClient(timeout=args.timeout)
    started = time.time()
    for i, g in enumerate(groups):
        if g["movie_id"] in done:
            continue
        state, questions, qids = build_request(g)
        t0 = time.perf_counter()
        error = None
        if args.provider == "heuristic":
            results = heuristic(g, version_rule=False)
        elif args.provider == "heuristic85":
            results = heuristic(g, version_rule=True)
        else:
            try:
                resp = await ask(client, args.url, args.model, state, questions, os.environ.get("BENCH_API_KEY", ""))
            except Exception as exc:  # keep going; count as a failed group
                resp, error = {}, f"{type(exc).__name__}: {str(exc)[:200]}"
            results = {}
            for fid in qids:
                a = (resp.get("answers") or {}).get(fid) or {}
                probs = {str(k): float(v) for k, v in (a.get("probabilities") or {}).items()}
                label = a.get("choice")
                if label not in _LABEL_CRITERIA:
                    continue
                results[fid] = {"label": label, "confidence": float(a.get("confidence") or 0.0),
                                "probabilities": probs}
            enforce_single_main(results)
        latency_ms = (time.perf_counter() - t0) * 1000
        rec = {
            "movie_id": g["movie_id"], "title": g["title"], "n_files": len(qids), "latency_ms": latency_ms,
            "error": error, "provider": args.name or args.provider,
            "files": [{"fid": fid, "role": f["role"], "truth": ROLE_TO_LABEL[f["role"]], "ms": f["ms"],
                       **(results.get(fid) or {"label": None, "confidence": 0.0, "probabilities": {}})}
                      for fid, f in qids.items()],
        }
        out.write(json.dumps(rec) + "\n")
        out.flush()
        if (i + 1) % 50 == 0:
            print(f"[{args.name}] {i + 1}/{len(groups)} groups, {time.time() - started:.0f}s", flush=True)
    out.close()
    await client.aclose()


HYBRID_FLOOR = 0.4


def fix_truth_and_hybrid(recs: List[Dict[str, Any]], hybrid: bool) -> None:
    """Truth fix: the library marks bonus clips kept in a movie's folder root as role=version, so a
    "version" under 70% of the main's runtime is scored as an extra. Hybrid: files under 40% of the
    longest runtime are special features by rule (no model answer used), the model only decides the rest."""
    for r in recs:
        main_ms = max((f["ms"] for f in r["files"] if f["truth"] == LABEL_MAIN), default=0)
        longest = max(f["ms"] for f in r["files"])
        for f in r["files"]:
            if f["truth"] == LABEL_VERSION and main_ms and f["ms"] < 0.7 * main_ms:
                f["truth"] = LABEL_SPECIAL
        if not hybrid:
            continue
        cands = [f for f in r["files"] if f["ms"] >= HYBRID_FLOOR * longest]
        for f in r["files"]:
            if f["ms"] < HYBRID_FLOOR * longest:
                f.update(label=LABEL_SPECIAL, confidence=1.0, probabilities={LABEL_SPECIAL: 1.0})
        if len(cands) == 1:
            cands[0].update(label=LABEL_MAIN, confidence=1.0, probabilities={LABEL_MAIN: 1.0})
        else:
            res = {f["fid"]: f for f in cands if f["label"]}
            enforce_single_main(res)


def score(path: str, hybrid: bool = False) -> Dict[str, Any]:
    recs = [json.loads(l) for l in open(path, encoding="utf-8")]
    fix_truth_and_hybrid(recs, hybrid)
    if hybrid:
        recs[0]["provider"] = recs[0]["provider"] + "+rule"
    files = [f for r in recs for f in r["files"]]
    n = len(files)
    err_groups = sum(1 for r in recs if r["error"])

    def feat(label):  # main or alternate = "a full cut of the film"
        return label in (LABEL_MAIN, LABEL_VERSION)

    strict = sum(f["label"] == f["truth"] for f in files) / n
    feature_vs_extra = sum((f["label"] is not None) and feat(f["label"]) == feat(f["truth"]) for f in files) / n
    versions = [f for f in files if f["truth"] == LABEL_VERSION]
    version_recall = sum(feat(f["label"]) for f in versions) / max(1, len(versions))
    extras = [f for f in files if f["truth"] == LABEL_SPECIAL]
    extra_recall = sum(f["label"] == LABEL_SPECIAL for f in extras) / max(1, len(extras))

    def group_ok(r):
        # Right when every file is on the right side of feature/extra and the chosen main is a real cut.
        ok = all((f["label"] is not None) and feat(f["label"]) == feat(f["truth"]) for f in r["files"])
        mains = [f for f in r["files"] if f["label"] == LABEL_MAIN]
        return ok and len(mains) == 1 and feat(mains[0]["truth"])
    group_acc = sum(group_ok(r) for r in recs) / len(recs)
    vgroups = [r for r in recs if any(f["truth"] == LABEL_VERSION for f in r["files"])]
    vgroup_acc = sum(group_ok(r) for r in vgroups) / max(1, len(vgroups))

    # Calibration on the feature/extra decision as assist mode would use it.
    conf = [(f["confidence"], (f["label"] is not None) and feat(f["label"]) == feat(f["truth"])) for f in files]
    bins = [[] for _ in range(10)]
    for c, ok in conf:
        bins[min(9, int(c * 10))].append((c, ok))
    ece = sum(len(b) / n * abs(statistics.mean(c for c, _ in b) - statistics.mean(ok for _, ok in b))
              for b in bins if b)
    hi = [ok for c, ok in conf if c >= 0.7]
    lat = sorted(r["latency_ms"] for r in recs if not r["error"])
    return {
        "provider": recs[0]["provider"], "groups": len(recs), "files": n, "errors": err_groups,
        "strict_3way": strict, "feature_vs_extra": feature_vs_extra, "version_recall": version_recall,
        "extra_recall": extra_recall, "group_acc": group_acc, "version_group_acc": vgroup_acc,
        "n_version_groups": len(vgroups), "ece": ece,
        "coverage_at_0.7": len(hi) / n, "acc_at_0.7": (sum(hi) / len(hi)) if hi else float("nan"),
        "p50_ms": lat[len(lat) // 2] if lat else None, "p90_ms": lat[int(len(lat) * 0.9)] if lat else None,
    }


def report(paths: List[str]) -> None:
    rows = [score(p) for p in paths] + [score(p, hybrid=True) for p in paths if "heuristic" not in p]
    cols = ["provider", "groups", "errors", "strict_3way", "feature_vs_extra", "version_recall", "extra_recall",
            "group_acc", "version_group_acc", "ece", "coverage_at_0.7", "acc_at_0.7", "p50_ms", "p90_ms"]
    print(" | ".join(cols))
    for r in rows:
        print(" | ".join(f"{r[c]:.3f}" if isinstance(r[c], float) and c not in ("p50_ms", "p90_ms")
                         else (f"{r[c]:.0f}" if isinstance(r[c], float) else str(r[c])) for c in cols))
    json.dump(rows, open(os.path.join(os.path.dirname(paths[0]), "summary.json"), "w"), indent=1)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--groups")
    p.add_argument("--provider", choices=["heuristic", "heuristic85", "systemone"])
    p.add_argument("--url")
    p.add_argument("--model", default="jev-latest")
    p.add_argument("--name")
    p.add_argument("--out")
    p.add_argument("--limit", type=int)
    p.add_argument("--timeout", type=float, default=300)
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--report", nargs="+")
    p.add_argument("--prompt", default="v1", choices=["v1", "v2"])
    p.add_argument("--names", default="anon", choices=["anon", "original"])
    a = p.parse_args()
    PROMPT = a.prompt
    NAMES = a.names
    if a.report:
        report(sorted({x for pat in a.report for x in glob.glob(pat)}))
    else:
        asyncio.run(run(a))
