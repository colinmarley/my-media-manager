"""TMDB-first search, OMDb-by-id enrichment, episode validation and runtime checks
(quick win 11 in docs/architecture/INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md).

All HTTP is mocked: ``requests.get`` is replaced by a router that answers by URL.
"""

from typing import Any, Dict, List, Optional

from services import auto_matcher_service as ams
from services.auto_matcher_service import AutoMatcherService

TMDB = "https://api.themoviedb.org/3"
OMDB = "http://www.omdbapi.com"


class _FakeResponse:
    def __init__(self, payload: Optional[Dict[str, Any]], status_code: int = 200):
        self._payload = payload or {}
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise ams.requests.HTTPError(f"{self.status_code}")

    def json(self) -> Dict[str, Any]:
        return self._payload


def _install(monkeypatch, routes: Dict[str, Any]):
    """routes: exact URL -> payload, or callable(params) -> payload / (payload, status)."""
    calls: List[Dict[str, Any]] = []

    def fake_get(url, params=None, timeout=None):
        params = dict(params or {})
        calls.append({"url": url, "params": params})
        if url not in routes:
            raise AssertionError(f"unexpected request: {url} {params}")
        handler = routes[url]
        result = handler(params) if callable(handler) else handler
        if isinstance(result, tuple):
            return _FakeResponse(*result)
        return _FakeResponse(result)

    monkeypatch.setattr(ams.requests, "get", fake_get)
    return calls


def _rules(match: Dict[str, Any]) -> Dict[str, int]:
    return {entry["rule"]: entry["points"] for entry in match["score_breakdown"]}


def _minutes(value: float) -> float:
    return value * 60_000


def _omdb_searches(calls):
    return [c for c in calls if c["url"] == OMDB and "s" in c["params"]]


# ---------------------------------------------------------------------------
# Movies
# ---------------------------------------------------------------------------


def test_movie_search_queries_tmdb_first_and_takes_imdb_id_from_details(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 27205, "title": "Inception", "release_date": "2010-07-15"}]},
        f"{TMDB}/movie/27205": {"id": 27205, "title": "Inception", "runtime": 148,
                                "external_ids": {"imdb_id": "tt1375666"}},
    })
    service = AutoMatcherService(omdb_api_key="o", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Inception", "year": 2010, "media_type": "movie", "media_duration_ms": _minutes(147)}
    )

    best = result["best_match"]
    assert best["source"] == "tmdb"
    assert best["media_id"] == "27205"
    assert best["imdb_id"] == "tt1375666"
    assert best["runtime_minutes"] == 148
    assert _rules(best)["runtime_within_5pct"] == 15
    assert best["confidence_score"] == 95  # 55 title + 25 year + 15 runtime
    assert "runtime within 5pct +15" in best["match_reason"]
    assert _omdb_searches(calls) == [], "OMDb must not be searched when TMDB found candidates"
    assert not any(c["url"] == OMDB for c in calls), "TMDB supplied everything, no OMDb call needed"


def test_omdb_by_id_fills_runtime_tmdb_lacks(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 1, "title": "Premium Rush", "release_date": "2012-08-24"}]},
        f"{TMDB}/movie/1": {"id": 1, "title": "Premium Rush", "runtime": 0, "imdb_id": "tt1547234"},
        OMDB: lambda params: {"Response": "True", "Title": "Premium Rush", "Year": "2012",
                              "imdbID": params["i"], "Runtime": "91 min"},
    })
    service = AutoMatcherService(omdb_api_key="o", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Premium Rush", "year": 2012, "media_type": "movie", "media_duration_ms": _minutes(91)}
    )

    best = result["best_match"]
    omdb_calls = [c for c in calls if c["url"] == OMDB]
    assert [c["params"].get("i") for c in omdb_calls] == ["tt1547234"], "OMDb is asked by id, not searched"
    assert best["runtime_minutes"] == 91
    assert best["raw_data"]["omdbData"]["Runtime"] == "91 min"
    assert _rules(best)["runtime_within_5pct"] == 15


def test_runtime_breaks_a_title_tie_between_remake_and_original(monkeypatch):
    _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [
            {"id": 841, "title": "Dune", "release_date": "1984-12-14"},
            {"id": 438631, "title": "Dune", "release_date": "2021-09-15"},
        ]},
        f"{TMDB}/movie/841": {"id": 841, "runtime": 137, "external_ids": {"imdb_id": "tt0087182"}},
        f"{TMDB}/movie/438631": {"id": 438631, "runtime": 155, "external_ids": {"imdb_id": "tt1160419"}},
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match({"title": "Dune", "media_type": "movie", "media_duration_ms": _minutes(156)})

    best = result["best_match"]
    assert best["imdb_id"] == "tt1160419"
    assert _rules(best)["runtime_within_5pct"] == 15
    runner_up = result["candidates"][1]
    assert _rules(runner_up)["runtime_differs"] == 0  # 156 vs 137 is 14% off: shown, not scored
    assert result["margin"] == 15
    assert result["ambiguous"] is False


def test_runtime_off_by_more_than_a_quarter_is_penalised(monkeypatch):
    _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 27205, "title": "Inception", "release_date": "2010-07-15"}]},
        f"{TMDB}/movie/27205": {"id": 27205, "runtime": 148, "external_ids": {"imdb_id": "tt1375666"}},
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    # A 14-minute featurette named after the film.
    result = service.search_and_match(
        {"title": "Inception", "year": 2010, "media_type": "movie", "media_duration_ms": _minutes(14)}
    )

    best = result["best_match"]
    assert _rules(best)["runtime_off_over_25pct"] == -30
    assert best["confidence_score"] == 50
    entry = next(e for e in best["score_breakdown"] if e["rule"] == "runtime_off_over_25pct")
    assert "14 min vs 148 min" in entry["note"]


def test_unknown_duration_adds_no_runtime_entry(monkeypatch):
    _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 27205, "title": "Inception", "release_date": "2010-07-15"}]},
        f"{TMDB}/movie/27205": {"id": 27205, "runtime": 148, "external_ids": {"imdb_id": "tt1375666"}},
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match({"title": "Inception", "year": 2010, "media_type": "movie"})

    best = result["best_match"]
    assert not any(rule.startswith("runtime") for rule in _rules(best))
    assert best["confidence_score"] == 80
    assert best["imdb_id"] == "tt1375666"


def test_omdb_search_is_the_fallback_when_tmdb_finds_nothing(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": []},
        OMDB: lambda params: (
            {"Response": "True", "Search": [{"Title": "Obscure Film", "Year": "1999", "imdbID": "tt0000001",
                                             "Type": "movie"}]}
            if "s" in params
            else {"Response": "True", "imdbID": params["i"], "Runtime": "100 min"}
        ),
    })
    service = AutoMatcherService(omdb_api_key="o", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Obscure Film", "year": 1999, "media_type": "movie", "media_duration_ms": _minutes(101)}
    )

    best = result["best_match"]
    assert best["source"] == "omdb"
    assert calls[0]["url"] == f"{TMDB}/search/movie"
    assert len(_omdb_searches(calls)) == 1
    assert best["runtime_minutes"] == 100
    assert _rules(best)["runtime_within_5pct"] == 15


def test_tmdb_only_mode_never_calls_omdb(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": []},
    })
    service = AutoMatcherService(omdb_api_key="o", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match({"title": "Nothing Here", "media_type": "movie"})

    assert result["found"] is False
    assert all(c["url"] != OMDB for c in calls)


def test_id_tag_runtime_mismatch_is_shown_but_not_scored(monkeypatch):
    _install(monkeypatch, {
        OMDB: {"Response": "True", "Title": "Premium Rush", "Year": "2012", "imdbID": "tt1547234",
               "Type": "movie", "Runtime": "91 min"},
    })
    service = AutoMatcherService(omdb_api_key="o", tmdb_api_key="")

    result = service.search_and_match({
        "title": "Premium Rush", "media_type": "movie", "imdb_id": "tt1547234",
        "media_duration_ms": _minutes(12),
    })

    best = result["best_match"]
    assert result["lookup"] == "id"
    assert best["confidence_score"] == 100
    assert _rules(best)["runtime_off_over_25pct"] == 0
    assert "the file may be an extra" in best["match_reason"]


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


def _season(episode_count: int, runtime: int = 22) -> Dict[str, Any]:
    return {"season_number": 2, "episodes": [
        {"episode_number": n, "name": f"Episode {n}", "runtime": runtime} for n in range(1, episode_count + 1)
    ]}


def _tv_routes(season_payload, season_status: int = 200):
    return {
        f"{TMDB}/search/tv": {"results": [{"id": 1421, "name": "Modern Family", "first_air_date": "2009-09-23"}]},
        f"{TMDB}/tv/1421": {"id": 1421, "name": "Modern Family", "episode_run_time": [22],
                            "external_ids": {"imdb_id": "tt1442437"}},
        f"{TMDB}/tv/1421/season/2": (season_payload, season_status),
    }


def test_existing_episode_is_confirmed_against_tmdb_season(monkeypatch):
    calls = _install(monkeypatch, _tv_routes(_season(24)))
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match({
        "title": "Modern Family", "media_type": "episode", "season": 2, "episode": 5,
        "media_duration_ms": _minutes(21.5),
    })

    best = result["best_match"]
    rules = _rules(best)
    assert rules["season_exists"] == 8
    assert rules["episode_exists"] == 8
    assert rules["runtime_within_5pct"] == 15
    assert best["episode_title"] == "Episode 5"
    assert best["imdb_id"] == "tt1442437"
    assert best["season"] == 2 and best["episode"] == 5
    assert best["confidence_score"] == 100  # clamped
    assert sum(1 for c in calls if c["url"].endswith("/season/2")) == 1


def test_episode_not_in_the_season_is_penalised(monkeypatch):
    _install(monkeypatch, _tv_routes(_season(10)))
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Modern Family", "media_type": "episode", "season": 2, "episode": 14}
    )

    best = result["best_match"]
    rules = _rules(best)
    assert rules["season_exists"] == 8
    assert rules["episode_missing"] == -30
    assert best["confidence_score"] == 58  # 55 + 15 series + 10 episode no. + 8 - 30
    assert "S02E14 not on TMDB" in best["match_reason"]


def test_missing_season_is_penalised(monkeypatch):
    _install(monkeypatch, _tv_routes({"status_code": 34, "status_message": "not found"}, season_status=404))
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Modern Family", "media_type": "episode", "season": 2, "episode": 1}
    )

    rules = _rules(result["best_match"])
    assert rules["season_missing"] == -30
    assert "episode_exists" not in rules


def test_multi_episode_file_compares_against_summed_runtime(monkeypatch):
    _install(monkeypatch, _tv_routes(_season(24)))
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match({
        "title": "Modern Family", "media_type": "episode", "season": 2, "episode": 1, "episode_end": 2,
        "media_duration_ms": _minutes(44),
    })

    rules = _rules(result["best_match"])
    assert rules["episode_exists"] == 8
    assert rules["runtime_within_5pct"] == 15


def test_episode_runtime_within_ten_percent_gets_the_episode_tier(monkeypatch):
    _install(monkeypatch, _tv_routes(_season(24, runtime=30)))
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match({
        "title": "Modern Family", "media_type": "episode", "season": 2, "episode": 3,
        "media_duration_ms": _minutes(27.5),
    })

    assert _rules(result["best_match"])["episode_runtime_within_10pct"] == 10


def test_provider_check_failure_keeps_the_base_score(monkeypatch):
    def broken_details(params):
        return ({}, 500)

    _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 27205, "title": "Inception", "release_date": "2010-07-15"}]},
        f"{TMDB}/movie/27205": broken_details,
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Inception", "year": 2010, "media_type": "movie", "media_duration_ms": _minutes(148)}
    )

    assert result["best_match"]["confidence_score"] == 80
