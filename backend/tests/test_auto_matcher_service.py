"""Tests for AutoMatcherService scoring, id-first lookup and ambiguity detection."""

from typing import Any, Dict, List

import pytest

from services import auto_matcher_service as ams
from services.auto_matcher_service import AutoMatcherService, MatchCandidate


class _FakeResponse:
    def __init__(self, payload: Dict[str, Any]):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Dict[str, Any]:
        return self._payload


def _install_fake_requests(monkeypatch, router):
    """router(url, params) -> payload dict."""
    calls: List[Dict[str, Any]] = []

    def fake_get(url, params=None, timeout=None):
        calls.append({"url": url, "params": dict(params or {})})
        return _FakeResponse(router(url, params or {}))

    monkeypatch.setattr(ams.requests, "get", fake_get)
    return calls


def test_exact_title_and_year_reaches_threshold_with_breakdown():
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")
    candidate = MatchCandidate(source="omdb", media_id="tt1", title="The World's End", media_type="movie", year=2013)

    score, breakdown = service._score_candidate(
        candidate, {"title": "The Worlds End", "year": 2013, "media_type": "movie"}
    )

    assert score == 80
    rules = {entry["rule"]: entry["points"] for entry in breakdown}
    assert rules["title_similarity"] == 55
    assert rules["year_exact"] == 25


def test_exact_title_without_year_stays_below_threshold():
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")
    candidate = MatchCandidate(source="omdb", media_id="tt1", title="Arrival", media_type="movie", year=2016)

    score, _ = service._score_candidate(candidate, {"title": "Arrival", "media_type": "unknown"})

    assert score == 55


def test_episode_with_series_and_episode_number_reaches_threshold():
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")
    candidate = MatchCandidate(source="omdb", media_id="tt2", title="Modern Family", media_type="series", year=2009)

    score, breakdown = service._score_candidate(
        candidate, {"title": "Modern Family", "media_type": "episode", "season": 3, "episode": 15}
    )

    assert score == 80
    assert {e["rule"] for e in breakdown} >= {"title_similarity", "series_kind", "episode_number"}


def test_search_marks_ambiguous_when_runner_up_is_close(monkeypatch):
    def router(url, params):
        return {
            "Response": "True",
            "Search": [
                {"Title": "The Office", "Year": "2005–2013", "imdbID": "tt0386676", "Type": "series"},
                {"Title": "The Office", "Year": "2001–2003", "imdbID": "tt0290978", "Type": "series"},
            ],
        }

    _install_fake_requests(monkeypatch, router)
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")

    result = service.search_and_match({"title": "The Office", "media_type": "episode", "season": 1, "episode": 1})

    assert result["ambiguous"] is True
    assert result["margin"] == 0
    assert "ambiguous" in result["best_match"]["match_reason"]
    assert len(result["candidates"]) == 2


def test_search_is_not_ambiguous_when_year_separates_candidates(monkeypatch):
    def router(url, params):
        return {
            "Response": "True",
            "Search": [
                {"Title": "Planet of the Apes", "Year": "1968", "imdbID": "tt0063442", "Type": "movie"},
                {"Title": "Planet of the Apes", "Year": "2001", "imdbID": "tt0133152", "Type": "movie"},
            ],
        }

    _install_fake_requests(monkeypatch, router)
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")

    result = service.search_and_match({"title": "Planet of the Apes", "year": 2001, "media_type": "movie"})

    assert result["ambiguous"] is False
    assert result["best_match"]["imdb_id"] == "tt0133152"
    assert result["best_match"]["confidence_score"] == 80
    assert result["margin"] == 25


def test_imdb_tag_short_circuits_search_and_scores_100(monkeypatch):
    def router(url, params):
        assert params.get("i") == "tt1547234", "expected an id lookup, not a search"
        return {
            "Response": "True",
            "Title": "Premium Rush",
            "Year": "2012",
            "imdbID": "tt1547234",
            "Type": "movie",
        }

    calls = _install_fake_requests(monkeypatch, router)
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")

    result = service.search_and_match(
        {"title": "Premium Rush", "year": 2012, "media_type": "movie", "imdb_id": "tt1547234"}
    )

    assert len(calls) == 1
    assert result["lookup"] == "id"
    assert result["ambiguous"] is False
    best = result["best_match"]
    assert best["confidence_score"] == 100
    assert best["imdb_id"] == "tt1547234"
    assert best["score_breakdown"][0]["rule"] == "id_tag"


def test_imdb_tag_falls_back_to_tmdb_find_when_omdb_missing(monkeypatch):
    def router(url, params):
        assert url.endswith("/find/tt0071007")
        return {"movie_results": [], "tv_results": [{"id": 1234, "name": "Little House on the Prairie",
                                                       "first_air_date": "1974-09-11"}]}

    _install_fake_requests(monkeypatch, router)
    service = AutoMatcherService(omdb_api_key="", tmdb_api_key="t")

    result = service.search_and_match(
        {"title": "Little House on the Prairie", "media_type": "episode", "season": 1, "episode": 23,
         "imdb_id": "tt0071007"}
    )

    best = result["best_match"]
    assert best["source"] == "tmdb"
    assert best["media_type"] == "series"
    assert best["season"] == 1 and best["episode"] == 23
    assert best["confidence_score"] == 100


def test_imdb_lookup_failure_falls_back_to_title_search(monkeypatch):
    def router(url, params):
        if "i" in params:
            return {"Response": "False", "Error": "Incorrect IMDb ID."}
        return {"Response": "True", "Search": [{"Title": "Premium Rush", "Year": "2012", "imdbID": "tt1547234",
                                                 "Type": "movie"}]}

    _install_fake_requests(monkeypatch, router)
    service = AutoMatcherService(omdb_api_key="k", tmdb_api_key="")

    result = service.search_and_match(
        {"title": "Premium Rush", "year": 2012, "media_type": "movie", "imdb_id": "tt9999999"}
    )

    assert result["lookup"] == "search"
    assert result["best_match"]["confidence_score"] == 80
