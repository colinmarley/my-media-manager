"""Add TMDB reference data (cast, directors, season episode list) to bench cases.

Standard library only, so it runs inside the backend container, which already has the key:

  docker exec -i media-manager-backend python - < enrich_tmdb.py < cases.jsonl   # not possible (stdin is the script)
  docker cp enrich_tmdb.py media-manager-backend:/tmp/ && \
    docker exec -i media-manager-backend python /tmp/enrich_tmdb.py < cases.jsonl > cases.enriched.jsonl

Reads MEDIA_LIBRARY_TMDB_API_KEY or TMDB_API_KEY from the environment.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.themoviedb.org/3"
KEY = os.environ.get("MEDIA_LIBRARY_TMDB_API_KEY") or os.environ.get("TMDB_API_KEY") or ""
_cache = {}
CREW_JOBS = {"Producer", "Executive Producer", "Screenplay", "Writer", "Story", "Original Music Composer",
             "Director of Photography", "Editor", "Casting", "Production Design", "Costume Design"}


def crew_names(crew):
    out = []
    for c in crew or []:
        jobs = {c.get("job")} | {j.get("job") for j in (c.get("jobs") or [])}
        if jobs & CREW_JOBS and c["name"] not in out:
            out.append(c["name"])
    return out[:30]


def get(path, **params):
    params["api_key"] = KEY
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    cache_key = (path, tuple(sorted(params.items())))
    if cache_key in _cache:
        return _cache[cache_key]
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                data = json.load(resp)
                _cache[cache_key] = data
                return data
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                _cache[cache_key] = None
                return None
            if exc.code == 429 or exc.code >= 500:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1.5 * (attempt + 1))
    return None


def find_id(imdb_id, want):
    found = get(f"/find/{imdb_id}", external_source="imdb_id") or {}
    results = found.get(f"{want}_results") or []
    return results[0]["id"] if results else None


def enrich_movie(case):
    tmdb_id = find_id(case["imdb_id"], "movie")
    if not tmdb_id:
        return
    d = get(f"/movie/{tmdb_id}", append_to_response="credits") or {}
    credits = d.get("credits") or {}
    case["ref"] = {
        "tmdb_id": tmdb_id,
        "title": d.get("title"),
        "original_title": d.get("original_title"),
        "runtime_min": d.get("runtime"),
        "overview": d.get("overview"),
        "cast": [c["name"] for c in (credits.get("cast") or [])[:20]],
        "directors": [c["name"] for c in (credits.get("crew") or []) if c.get("job") == "Director"],
        "crew": crew_names(credits.get("crew")),
    }


def enrich_episode(case):
    tmdb_id = case.get("series_tmdb_id")
    if not tmdb_id and case.get("imdb_id"):
        tmdb_id = find_id(case["imdb_id"], "tv")
    if not tmdb_id:
        return
    show = get(f"/tv/{tmdb_id}", append_to_response="aggregate_credits") or {}
    season = get(f"/tv/{tmdb_id}/season/{case['season']}") or {}
    cast = (show.get("aggregate_credits") or {}).get("cast") or []
    case["ref"] = {
        "tmdb_id": tmdb_id,
        "title": show.get("name"),
        "original_title": show.get("original_name"),
        "cast": [c["name"] for c in cast[:20]],
        "directors": [c["name"] for c in (show.get("created_by") or [])],
        "crew": crew_names((show.get("aggregate_credits") or {}).get("crew")),
        "episodes": [
            {
                "n": e.get("episode_number"),
                "name": e.get("name"),
                "overview": e.get("overview"),
                "runtime_min": e.get("runtime"),
                "guests": [g["name"] for g in (e.get("guest_stars") or [])[:8]],
                "directors": [c["name"] for c in (e.get("crew") or []) if c.get("job") == "Director"],
            }
            for e in (season.get("episodes") or [])
        ],
    }


def main():
    if not KEY:
        sys.exit("no TMDB key in the environment")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        case = json.loads(line)
        try:
            if case["kind"] == "episode":
                enrich_episode(case)
            else:
                enrich_movie(case)
        except Exception as exc:  # keep going; an unenriched case is skipped by the bench
            case["ref_error"] = str(exc)[:200]
        sys.stdout.write(json.dumps(case) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
