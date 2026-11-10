"""TMDB treats the year as a hard filter. A folder year that is one off from TMDB's
date ("Unsolved Mysteries (1987)" first aired in 1988 there) used to return no
candidates at all; the search is now repeated without the year.

All HTTP is mocked: ``requests.get`` is replaced by a router that answers by URL.
"""

from typing import Any, Dict, List, Optional

from services import auto_matcher_service as ams
from services.auto_matcher_service import AutoMatcherService

TMDB = "https://api.themoviedb.org/3"


class _FakeResponse:
    def __init__(self, payload: Optional[Dict[str, Any]], status_code: int = 200):
        self._payload = payload or {}
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise ams.requests.HTTPError(f"{self.status_code}")

    def json(self) -> Dict[str, Any]:
        return self._payload


def _install(monkeypatch, routes: Dict[str, Any]) -> List[Dict[str, Any]]:
    """routes: URL -> payload or callable(params) -> payload. Other URLs answer {}."""
    calls: List[Dict[str, Any]] = []

    def fake_get(url, params=None, timeout=None):
        params = dict(params or {})
        calls.append({"url": url, "params": params})
        handler = routes.get(url, {})
        return _FakeResponse(handler(params) if callable(handler) else handler)

    monkeypatch.setattr(ams.requests, "get", fake_get)
    return calls


def _searches(calls, kind):
    return [c["params"] for c in calls if c["url"] == f"{TMDB}/search/{kind}"]


def _rules(match: Dict[str, Any]) -> Dict[str, int]:
    return {entry["rule"]: entry["points"] for entry in match["score_breakdown"]}


def _only_without(year_param, results):
    return lambda params: {"results": [] if year_param in params else results}


def test_series_search_retries_without_the_year_when_the_filtered_search_is_empty(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/tv": _only_without(
            "first_air_date_year",
            [{"id": 1527, "name": "Unsolved Mysteries", "first_air_date": "1988-10-05"}],
        ),
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match(
        {"title": "Unsolved Mysteries", "year": 1987, "media_type": "episode", "season": 1, "episode": 1}
    )

    assert _searches(calls, "tv") == [
        {"api_key": "t", "query": "Unsolved Mysteries", "first_air_date_year": 1987},
        {"api_key": "t", "query": "Unsolved Mysteries"},
    ]
    best = result["best_match"]
    assert best["title"] == "Unsolved Mysteries"
    assert best["media_id"] == "1527"
    # The off-by-one year is still visible in the score, not silently treated as exact.
    assert "year_off_by_one" in _rules(best)
    assert "year_exact" not in _rules(best)


def test_movie_search_retries_without_the_year_when_the_filtered_search_is_empty(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": _only_without(
            "year", [{"id": 23527, "title": "Carlin at Carnegie", "release_date": "1983-01-01"}]
        ),
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match({"title": "Carlin at Carnegie", "year": 1982, "media_type": "movie"})

    assert [("year" in params) for params in _searches(calls, "movie")] == [True, False]
    assert result["best_match"]["title"] == "Carlin at Carnegie"


def test_a_filtered_search_with_results_is_not_repeated(monkeypatch):
    calls = _install(monkeypatch, {
        f"{TMDB}/search/movie": {"results": [{"id": 9, "title": "Heat", "release_date": "1995-12-15"}]},
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match({"title": "Heat", "year": 1995, "media_type": "movie"})

    assert len(_searches(calls, "movie")) == 1
    assert "year_exact" in _rules(result["best_match"])


def test_a_search_without_a_year_runs_once(monkeypatch):
    calls = _install(monkeypatch, {f"{TMDB}/search/tv": {"results": []}})
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match({"title": "Nothing Like This", "media_type": "episode", "season": 1, "episode": 2})

    assert _searches(calls, "tv") == [{"api_key": "t", "query": "Nothing Like This"}]
    assert result["best_match"] is None


def test_a_same_named_series_decades_later_does_not_make_the_match_ambiguous(monkeypatch):
    # Both candidates have season 1 episode 1, so before the cap the 1988 series
    # scored 111 and the 2020 one 96: four points apart once capped at 100.
    season_one = {"episodes": [{"episode_number": 1, "name": "Episode 1"}]}
    _install(monkeypatch, {
        f"{TMDB}/search/tv": _only_without("first_air_date_year", [
            {"id": 1527, "name": "Unsolved Mysteries", "first_air_date": "1988-10-05"},
            {"id": 97549, "name": "Unsolved Mysteries", "first_air_date": "2020-07-01"},
        ]),
        f"{TMDB}/tv/1527/season/1": season_one,
        f"{TMDB}/tv/97549/season/1": season_one,
    })
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t", metadata_source="tmdb_only")

    result = service.search_and_match(
        {"title": "Unsolved Mysteries", "year": 1987, "media_type": "episode", "season": 1, "episode": 1}
    )

    assert result["best_match"]["media_id"] == "1527"
    assert result["ambiguous"] is False
    later = next(c for c in result["candidates"] if c["media_id"] == "97549")
    assert _rules(later)["year_mismatch"] == -20
