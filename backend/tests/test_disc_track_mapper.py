"""MakeMKV track files of a TV disc ("The Show (1991)/B1_t00.mkv") are matched as a set:
the series from the folder title, the episodes from track order and durations against
TMDB per-episode runtimes. A mapping is only proposed when exactly one run of
consecutive episodes fits, and it is never auto-assigned.

All HTTP is mocked: ``requests.get`` is replaced by a router that answers by URL.
"""

import asyncio
import os
from typing import Any, Dict, List, Optional

import pytest

from services import auto_matcher_service as ams
from services import ingress_queue_service as iqs
from services.auto_matcher_service import AutoMatcherService
from services.disc_track_mapper import DiscTrackMapper, TrackFile, track_stem_key
from services.ingress_queue_service import QUEUE_NEEDS_REVIEW, IngressQueueService

TMDB = "https://api.themoviedb.org/3"
SHOW_ID = 4242


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
    """routes: URL -> payload or callable(params) -> payload. Other URLs answer 404."""
    calls: List[Dict[str, Any]] = []

    def fake_get(url, params=None, timeout=None):
        params = dict(params or {})
        calls.append({"url": url, "params": params})
        if url not in routes:
            return _FakeResponse({}, status_code=404)
        handler = routes[url]
        return _FakeResponse(handler(params) if callable(handler) else handler)

    monkeypatch.setattr(ams.requests, "get", fake_get)
    return calls


def _season(runtimes: List[Optional[int]]) -> Dict[str, Any]:
    return {"episodes": [
        {"episode_number": n, "name": f"Episode {n}", "runtime": r} for n, r in enumerate(runtimes, start=1)
    ]}


def _show_routes(seasons: List[List[Optional[int]]], name="The Red Green Show", first_air="1991-01-01",
                 movies: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    routes: Dict[str, Any] = {
        f"{TMDB}/search/tv": {"results": [{"id": SHOW_ID, "name": name, "first_air_date": first_air}]},
        f"{TMDB}/search/movie": {"results": movies or []},
        f"{TMDB}/tv/{SHOW_ID}": {
            "id": SHOW_ID, "name": name, "first_air_date": first_air,
            "number_of_seasons": len(seasons), "external_ids": {"imdb_id": "tt0098912"},
        },
    }
    for number, runtimes in enumerate(seasons, start=1):
        routes[f"{TMDB}/tv/{SHOW_ID}/season/{number}"] = _season(runtimes)
    return routes


def _matcher() -> AutoMatcherService:
    return AutoMatcherService(omdb_api_key="", tmdb_api_key="test-key", metadata_source="tmdb_only")


def _tracks(minutes: Dict[str, Optional[float]]) -> List[TrackFile]:
    return [
        TrackFile(file_path=f"/ingest/set/{stem}.mkv", stem=stem,
                  duration_ms=None if m is None else m * 60000.0)
        for stem, m in minutes.items()
    ]


QUERIES = [("The Red Green Show", 1991)]


# ── Mapper ──────────────────────────────────────────────────────────────────


def test_track_stem_key_orders_by_letter_disc_then_track():
    stems = ["B1_t10", "B1_t02", "A1_t00", "B4_t01"]
    assert sorted(stems, key=track_stem_key) == ["A1_t00", "B1_t02", "B1_t10", "B4_t01"]
    assert track_stem_key("Premium Rush_t00") is None
    assert track_stem_key("title_t00") is None


def test_unique_window_maps_tracks_and_sets_aside_play_all_and_extras(monkeypatch):
    # Season 1 opens with a 30-minute pilot, so only S01E01-E03 fits 30/24/24.
    _install(monkeypatch, _show_routes([[30, 24, 24, 24, 24, 24], [24, 24, 24, 24]]))
    tracks = _tracks({"B1_t00": 30.2, "B1_t01": 23.8, "B1_t02": 24.5, "B1_t03": 78.5, "B1_t04": 3.0})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert mapping is not None and mapping.mapped
    by_stem = {os.path.basename(path)[:-4]: info for path, info in mapping.files.items()}
    assert [(by_stem[s]["season"], by_stem[s]["episode"]) for s in ("B1_t00", "B1_t01", "B1_t02")] == [
        (1, 1), (1, 2), (1, 3)
    ]
    assert by_stem["B1_t00"]["episode_title"] == "Episode 1"
    assert by_stem["B1_t03"]["role"] == "play_all"
    assert by_stem["B1_t04"]["role"] == "extra"
    assert "S01E01-E03" in mapping.review_reason and "confirm" in mapping.review_reason
    assert mapping.series["imdb_id"] == "tt0098912"
    rules = [e["rule"] for e in mapping.set_entries]
    assert rules == ["disc_track_set", "track_window"]
    assert "1 play-all" in mapping.set_entries[0]["note"] and "1 extra" in mapping.set_entries[0]["note"]


def test_window_may_cross_a_season_boundary(monkeypatch):
    _install(monkeypatch, _show_routes([[22, 22, 22, 40], [35, 22, 22]]))
    tracks = _tracks({"A1_t00": 40, "A1_t01": 35})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert mapping.mapped
    assert sorted((i["season"], i["episode"]) for i in mapping.files.values()) == [(1, 4), (2, 1)]
    assert "S01E04-S02E01" in mapping.review_reason


def test_equal_runtimes_leave_the_set_unmapped_with_the_alternatives(monkeypatch):
    _install(monkeypatch, _show_routes([[22] * 6, [22] * 6]))
    tracks = _tracks({"B1_t00": 22, "B1_t01": 22.4, "B1_t02": 21.7})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert mapping is not None and not mapping.mapped
    assert "10 runs of 3 episodes" in mapping.review_reason
    assert "S01E01-E03" in mapping.review_reason and "and 7 more" in mapping.review_reason
    assert not any("episode" in info for info in mapping.files.values())


def test_no_fitting_window_is_explained(monkeypatch):
    _install(monkeypatch, _show_routes([[22, 22, 22]]))
    tracks = _tracks({"B1_t00": 26, "B1_t01": 26})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert not mapping.mapped
    assert "no run of 2 consecutive episodes" in mapping.review_reason


def test_missing_durations_leave_the_set_unmapped(monkeypatch):
    calls = _install(monkeypatch, _show_routes([[30, 24, 24]]))
    tracks = _tracks({"B1_t00": None, "B1_t01": 24})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert not mapping.mapped
    assert "no duration for 1 of 2 tracks (B1_t00)" in mapping.review_reason
    # Without durations there is nothing to compare, so no season is fetched.
    assert not [c for c in calls if "/season/" in c["url"]]


def test_unknown_tmdb_runtimes_leave_the_set_unmapped(monkeypatch):
    _install(monkeypatch, _show_routes([[None, None, None]]))
    tracks = _tracks({"B1_t00": 24, "B1_t01": 24})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert not mapping.mapped
    assert "no episode runtimes" in mapping.review_reason


def test_double_length_track_is_not_mapped(monkeypatch):
    _install(monkeypatch, _show_routes([[24, 24, 24, 24]]))
    tracks = _tracks({"B1_t00": 24, "B1_t01": 48, "B1_t02": 30})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert not mapping.mapped
    assert "double-length" in mapping.review_reason


def test_a_movie_disc_is_left_to_the_normal_matcher(monkeypatch):
    routes = _show_routes(
        [[24, 24]], name="Premium Rush", first_air="2015-01-01",
        movies=[{"id": 9, "title": "Premium Rush", "release_date": "2012-08-24"}],
    )
    _install(monkeypatch, routes)
    tracks = _tracks({"B1_t00": 91, "B1_t01": 4})

    assert DiscTrackMapper(_matcher()).map_set("Premium Rush (2012)", [("Premium Rush", 2012)], tracks) is None


def test_no_series_hit_is_left_to_the_normal_matcher(monkeypatch):
    _install(monkeypatch, {f"{TMDB}/search/tv": {"results": []}, f"{TMDB}/search/movie": {"results": []}})
    tracks = _tracks({"B1_t00": 24, "B1_t01": 24})

    assert DiscTrackMapper(_matcher()).map_set("Home Movies 2003", [("Home Movies", 2003)], tracks) is None


def test_ambiguous_series_is_not_mapped(monkeypatch):
    routes = _show_routes([[30, 24]])
    routes[f"{TMDB}/search/tv"] = {"results": [
        {"id": SHOW_ID, "name": "The Red Green Show", "first_air_date": "1991-01-01"},
        {"id": 77, "name": "The Red Green Show", "first_air_date": "1991-06-01"},
    ]}
    _install(monkeypatch, routes)
    tracks = _tracks({"B1_t00": 30, "B1_t01": 24})

    mapping = DiscTrackMapper(_matcher()).map_set("The Red Green Show (1991)", QUERIES, tracks)

    assert not mapping.mapped
    assert mapping.review_reason.startswith("disc track set: series ambiguous")


def test_later_query_without_the_volume_name_finds_the_series(monkeypatch):
    def search_tv(params):
        if params["query"] == "SpongeBob SquarePants":
            return {"results": [{"id": SHOW_ID, "name": "SpongeBob SquarePants", "first_air_date": "1999-05-01"}]}
        return {"results": []}

    routes = _show_routes([[30, 24, 24]], name="SpongeBob SquarePants", first_air="1999-05-01")
    routes[f"{TMDB}/search/tv"] = search_tv
    _install(monkeypatch, routes)
    tracks = _tracks({"B4_t10": 30, "B4_t11": 24})
    queries = [("SpongeBob SquarePants lost at sea", 1999), ("SpongeBob SquarePants", 1999)]

    mapping = DiscTrackMapper(_matcher()).map_set("SpongeBob SquarePants (lost at sea) (1999–)", queries, tracks)

    assert mapping.mapped
    assert sorted((i["season"], i["episode"]) for i in mapping.files.values()) == [(1, 1), (1, 2)]


# ── Queue integration ───────────────────────────────────────────────────────


def _make_set(tmp_path, folder: str, minutes: Dict[str, float], monkeypatch):
    ingress_root = tmp_path / "ingest"
    set_dir = ingress_root / folder
    set_dir.mkdir(parents=True)
    durations = {}
    for stem, m in minutes.items():
        path = set_dir / f"{stem}.mkv"
        path.write_bytes(b"x")
        durations[os.path.abspath(path)] = m * 60000.0
    monkeypatch.setattr(iqs, "_get_file_duration", lambda p: durations.get(os.path.abspath(p)))
    monkeypatch.setattr(iqs.settings, "jellyfin_dest_base", os.fspath(tmp_path / "jellyfin"))
    return ingress_root, set_dir


class _NeverCalledOrchestrator:
    def __init__(self):
        self.calls = 0

    async def assign_from_queue_item(self, *args, **kwargs):  # pragma: no cover - must not run
        self.calls += 1
        return {}


def _process_all(service: IngressQueueService, count: int) -> None:
    async def run():
        for _ in range(count):
            await service.process_next_item()
    asyncio.run(run())


def test_queue_holds_a_mapped_track_set_for_review_with_episode_proposals(tmp_path, monkeypatch):
    _install(monkeypatch, _show_routes([[30, 24, 24, 24], [24, 24]]))
    ingress_root, set_dir = _make_set(
        tmp_path, "The Red Green Show (1991)", {"B1_t00": 30, "B1_t01": 24, "B1_t02": 24.3, "B1_t03": 2.5},
        monkeypatch,
    )
    orchestrator = _NeverCalledOrchestrator()
    service = IngressQueueService(auto_matcher_service=_matcher(), assignment_orchestrator=orchestrator,
                                  auto_assign_threshold=50)
    items = {
        stem: service.add_manual_file(os.fspath(set_dir / f"{stem}.mkv"), ingress_path=os.fspath(ingress_root))
        for stem in ("B1_t00", "B1_t01", "B1_t02", "B1_t03")
    }

    _process_all(service, 4)

    assert orchestrator.calls == 0
    for stem, episode in (("B1_t00", 1), ("B1_t01", 2), ("B1_t02", 3)):
        item = items[stem]
        assert item.status == QUEUE_NEEDS_REVIEW
        assert (item.best_match["season"], item.best_match["episode"]) == (1, episode)
        assert item.parsed_info["track_mapping"]["mapped"] is True
        assert "confirm before organizing" in item.parsed_info["review_reason"]
        rules = [e["rule"] for e in item.best_match["score_breakdown"]]
        assert {"title_similarity", "disc_track_set", "track_window", "track_episode",
                "needs_confirmation"} <= set(rules)
        assert item.proposed_path.replace("\\", "/").endswith(
            f"The Red Green Show (1991) [imdbid-tt0098912]/Season 01/"
            f"The Red Green Show (1991) [imdbid-tt0098912] S01E0{episode} Episode {episode}.mkv"
        )

    extra = items["B1_t03"]
    assert extra.status == QUEUE_NEEDS_REVIEW
    assert extra.best_match is None and extra.proposed_path is None
    assert "likely an extra" in extra.parsed_info["review_reason"]
    assert extra.match_candidates[0]["title"] == "The Red Green Show"


def test_queue_unmapped_track_set_keeps_files_in_place_with_a_reason(tmp_path, monkeypatch):
    calls = _install(monkeypatch, _show_routes([[22] * 8]))
    ingress_root, set_dir = _make_set(
        tmp_path, "The Red Green Show (1991)", {"B1_t00": 22, "B1_t01": 22, "B1_t02": 22}, monkeypatch,
    )
    service = IngressQueueService(auto_matcher_service=_matcher())
    items = [
        service.add_manual_file(os.fspath(set_dir / f"B1_t0{n}.mkv"), ingress_path=os.fspath(ingress_root))
        for n in range(3)
    ]

    _process_all(service, 3)

    for item in items:
        assert item.status == QUEUE_NEEDS_REVIEW
        assert item.best_match is None and item.proposed_path is None
        assert item.parsed_info["track_mapping"]["mapped"] is False
        assert "6 runs of 3 episodes" in item.parsed_info["review_reason"]
        breakdown_rules = [e["rule"] for e in item.match_candidates[0]["score_breakdown"]]
        assert "track_mapping_unresolved" in breakdown_rules
    # The set is mapped once and reused by its other files.
    assert len([c for c in calls if c["url"] == f"{TMDB}/search/tv"]) == 1


def test_queue_falls_back_to_the_matcher_for_a_movie_disc(tmp_path, monkeypatch):
    routes = _show_routes(
        [[24]], name="Premium Rush", first_air="2015-01-01",
        movies=[{"id": 9, "title": "Premium Rush", "release_date": "2012-08-24"}],
    )
    routes[f"{TMDB}/movie/9"] = {"id": 9, "title": "Premium Rush", "release_date": "2012-08-24", "runtime": 91}
    _install(monkeypatch, routes)
    ingress_root, set_dir = _make_set(tmp_path, "Premium Rush (2012)", {"B1_t00": 91, "B1_t01": 4}, monkeypatch)
    service = IngressQueueService(auto_matcher_service=_matcher())
    item = service.add_manual_file(os.fspath(set_dir / "B1_t00.mkv"), ingress_path=os.fspath(ingress_root))

    _process_all(service, 1)

    assert "track_mapping" not in item.parsed_info
    assert item.best_match["title"] == "Premium Rush" and item.best_match["media_type"] == "movie"


@pytest.mark.parametrize("folder, expected", [
    ("The Red Skelton Hour (Best of early years) (1951–1971)",
     [("The Red Skelton Hour Best of early years", 1951), ("The Red Skelton Hour", 1951)]),
    ("Groucho Marx You Bet Your Life (1947)", [("Groucho Marx You Bet Your Life", 1947)]),
])
def test_track_set_queries_drop_the_parenthetical_volume_name(tmp_path, folder, expected):
    service = IngressQueueService()
    file_path = os.fspath(tmp_path / "ingest" / folder / "B1_t00.mkv")
    queries = service._track_set_queries(file_path, os.fspath(tmp_path / "ingest"), {})
    assert queries == expected


def test_track_set_queries_add_the_parent_folder(tmp_path):
    service = IngressQueueService()
    root = tmp_path / "ingest"
    file_path = os.fspath(root / "Spongebob Squarepants" / "SpongeBob SquarePants (lost at sea) (1999–)" / "B4_t10.mkv")
    queries = service._track_set_queries(file_path, os.fspath(root), {})
    assert queries == [("SpongeBob SquarePants lost at sea", 1999), ("SpongeBob SquarePants", 1999)]
