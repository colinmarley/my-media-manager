"""Matching from what the ripper declared: a file with a rip record is matched
by the declared ids, episode and content type instead of by its name."""

import asyncio
import json
import os
from unittest.mock import AsyncMock

import pytest

from db.models import DiscRip, DiscRipTitle
from services import rip_records, storage_paths
from services.ingress_queue_service import (
    QUEUE_AUTO_ASSIGNED,
    QUEUE_NEEDS_REVIEW,
    IngressQueueService,
)
from tests.fake_db import FakeSession

MATCH = {"title": "Gone Girl", "year": 2014, "media_type": "movie", "confidence_score": 100,
         "media_id": "tt2267998", "imdb_id": "tt2267998"}


def _declaration(**overrides) -> dict:
    base = {
        "rip_id": "11111111-2222-3333-4444-555555555555", "disc_id": "disc-1",
        "media_type": "movie", "title": "Gone Girl", "year": 2014,
        "imdb_id": "tt2267998", "tmdb_id": 210577, "rip_season": None,
        "title_index": 0, "content_type": "main_feature", "is_main_feature": True,
        "season": None, "episode": None, "episode_end": None, "tmdb_episode_id": None,
        "episode_name": None, "custom_name": None, "read_errors": 0, "duration_seconds": None,
    }
    base.update(overrides)
    return base


def _episode(**overrides) -> dict:
    return _declaration(**{
        "media_type": "show", "title": "Firefly", "year": 2002, "imdb_id": "tt0303461", "tmdb_id": 1437,
        "rip_season": 1, "content_type": "episode", "is_main_feature": None, "season": 1, "episode": 5,
        "episode_name": "Safe", **overrides,
    })


# ── apply_declaration ───────────────────────────────────────────────────────

def test_movie_main_feature_takes_ids_and_classification():
    parsed = {"title": "gone girl t00", "media_type": "unknown", "year": None}
    reason = rip_records.apply_declaration(parsed, _declaration())

    assert reason is None
    assert (parsed["imdb_id"], parsed["tmdb_id"]) == ("tt2267998", "210577")
    assert (parsed["title"], parsed["year"], parsed["media_type"]) == ("Gone Girl", 2014, "movie")
    assert parsed["classification_override"] == "main_feature"
    assert parsed["rip"] == {"rip_id": "11111111-2222-3333-4444-555555555555", "disc_id": "disc-1",
                             "title_index": 0, "content_type": "main_feature", "read_errors": 0}


def test_movie_extra_is_a_special_feature():
    parsed = {"title": "Gone Girl", "media_type": "movie"}
    assert rip_records.apply_declaration(
        parsed, _declaration(content_type="trailer", is_main_feature=None, title_index=4)) is None
    assert parsed["classification_override"] == "special_feature"


def test_one_of_several_features_is_left_for_the_version_rules():
    parsed = {"title": "Gone Girl", "media_type": "movie"}
    rip_records.apply_declaration(parsed, _declaration(is_main_feature=False))
    assert "classification_override" not in parsed


def test_declared_episode_replaces_the_parsed_one():
    parsed = {"title": "Firefly", "media_type": "episode", "season": 1, "episode": 3, "episode_end": None}
    assert rip_records.apply_declaration(parsed, _episode(episode_end=6)) is None
    assert (parsed["season"], parsed["episode"], parsed["episode_end"]) == (1, 5, 6)
    assert parsed["episode_title"] == "Safe" and parsed["media_type"] == "episode"
    assert "classification_override" not in parsed


def test_episode_season_falls_back_to_the_rips_season():
    parsed = {}
    rip_records.apply_declaration(parsed, _episode(season=None))
    assert parsed["season"] == 1


def test_unassigned_show_title_is_held_and_keeps_no_declared_episode():
    """The ripper names an unassigned title by its position on the disc; that
    number is not an episode number."""
    parsed = {"title": "Firefly", "media_type": "episode", "season": 1, "episode": 3}
    reason = rip_records.apply_declaration(parsed, _episode(episode=None, episode_name=None))
    assert reason and "without an episode assignment" in reason
    assert parsed["tmdb_id"] == "1437"          # the series is still known


def test_show_extra_is_a_special_feature_and_not_an_episode_claim():
    parsed = {"title": "Firefly", "media_type": "episode", "season": 1, "episode": None}
    assert rip_records.apply_declaration(
        parsed, _episode(content_type="deleted_scene", episode=None)) is None
    assert parsed["classification_override"] == "special_feature"


def test_read_errors_hold_the_file():
    reason = rip_records.apply_declaration({}, _declaration(read_errors=3))
    assert reason == "the disc had 3 read error(s) while this title was ripped"


def test_duration_that_differs_from_the_rip_holds_the_file():
    assert rip_records.apply_declaration({}, _declaration(duration_seconds=8936.0), media_duration_ms=8_940_000) is None
    reason = rip_records.apply_declaration({}, _declaration(duration_seconds=8936.0), media_duration_ms=4_468_000)
    assert reason == "file runs 4468s but the rip recorded 8936s"


def test_a_reviewers_classification_is_kept():
    parsed = {"classification_override": "alternate_version"}
    rip_records.apply_declaration(parsed, _declaration(), keep_classification=True)
    assert parsed["classification_override"] == "alternate_version"


# ── declaration_for_path ────────────────────────────────────────────────────

PATH = "/ark/media/ingest/Gone Girl (2014)/Gone Girl (2014).mkv"


def _rows(status="delivered", size=1000, rip_id="rip-1", **title_fields):
    rip = DiscRip(id=rip_id, status="delivered", disc_id="disc-1", media_type="movie", title="Gone Girl",
                  year=2014, imdb_id="tt2267998", tmdb_id=210577)
    title = DiscRipTitle(id=f"t-{rip_id}", rip_id=rip_id, title_index=0, file_seq=0, status=status,
                         content_type="main_feature", is_main_feature=True, delivered_path=PATH,
                         size_bytes=size, read_errors=0, **title_fields)
    return [rip, title]


async def test_declaration_is_found_by_delivered_path():
    session = FakeSession(_rows())
    found = await rip_records.declaration_for_path(session, PATH.replace("/", "\\"), file_size=1000)
    assert found["rip_id"] == "rip-1" and found["tmdb_id"] == 210577
    assert found["content_type"] == "main_feature" and found["disc_id"] == "disc-1"


async def test_a_different_file_at_the_same_path_has_no_declaration():
    session = FakeSession(_rows(size=1000))
    assert await rip_records.declaration_for_path(session, PATH, file_size=2222) is None
    # An unknown size on either side does not rule the record out.
    assert await rip_records.declaration_for_path(session, PATH, file_size=0) is not None


async def test_only_a_delivered_title_counts():
    assert await rip_records.declaration_for_path(FakeSession(_rows(status="ripped")), PATH, 1000) is None
    assert await rip_records.declaration_for_path(FakeSession(), PATH, 1000) is None


# ── The queue's lookup, including the manifest left in the folder ───────────

async def test_lookup_without_a_database_is_no_record(tmp_path):
    service = IngressQueueService()
    item = service.add_manual_file(os.fspath(_ingest_file(tmp_path)))
    assert await service._rip_declaration_for(item, os.fspath(tmp_path)) is None


def _ingest_file(tmp_path, name="Gone Girl (2014).mkv", data=b"x" * 64,
                 folder_name="Gone Girl (2014) [imdbid-tt2267998]"):
    folder = tmp_path / "ingest" / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(data)
    return path


def _manifest_for(path, **title) -> dict:
    return {
        "schema_version": 1, "job_id": "11111111-2222-3333-4444-555555555555", "status": "delivered",
        "catalog": {"disc_id": "disc-1"},
        "identity": {"media_type": "movie", "title": "Gone Girl", "year": 2014,
                     "imdb_id": "tt2267998", "tmdb_id": 210577},
        "disc": {"volume_label": "GONE_GIRL", "fingerprint": "f" * 64},
        "titles": [{"title_index": 0, "status": "delivered", "content_type": "main_feature",
                    "is_main_feature": True, "dest_path": os.fspath(path), "size_bytes": 64, **title}],
    }


async def test_manifest_in_the_folder_is_read_when_no_record_arrived(tmp_path, monkeypatch):
    storage_paths.set_overrides({storage_paths.INGEST_ROOTS_KEY: [os.fspath(tmp_path / "ingest")]})
    monkeypatch.setattr("services.media_file_index._default_exists", lambda path: True)
    try:
        path = _ingest_file(tmp_path)
        manifest = path.parent / "_rip_manifest.11111111.json"
        manifest.write_text(json.dumps(_manifest_for(path)), encoding="utf-8")

        session = FakeSession()
        service = IngressQueueService(db_session_factory=session)
        item = service.add_manual_file(os.fspath(path))

        found = await service._rip_declaration_for(item, os.fspath(path.parent))
        assert found["rip_id"] == "11111111-2222-3333-4444-555555555555" and found["tmdb_id"] == 210577
        assert len(session.all_of(DiscRip)) == 1 and session.commits == 1

        # The manifest is read once, not for every file in the folder.
        other = service.add_manual_file(os.fspath(_ingest_file(tmp_path, "Gone Girl (2014)-trailer.mkv")))
        assert await service._rip_declaration_for(other, os.fspath(path.parent)) is None
        assert session.commits == 1
    finally:
        storage_paths.clear_overrides()


async def test_a_failing_lookup_falls_back_to_the_name(tmp_path):
    class _Broken:
        def __call__(self):
            raise RuntimeError("database is down")

    service = IngressQueueService(db_session_factory=_Broken())
    item = service.add_manual_file(os.fspath(_ingest_file(tmp_path)))
    assert await service._rip_declaration_for(item, os.fspath(tmp_path)) is None


# ── process_next_item ───────────────────────────────────────────────────────

class _StubMatcher:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def search_and_match(self, parsed_info):
        self.calls.append(dict(parsed_info))
        return json.loads(json.dumps(self.result))


def _service(tmp_path, name, declaration, match=MATCH, **file_kwargs):
    matcher = _StubMatcher({"status": "success", "found": True, "candidates": [match], "best_match": match})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)
    service._rip_declaration_for = AsyncMock(return_value=declaration)
    item = service.add_manual_file(os.fspath(_ingest_file(tmp_path, name, **file_kwargs)))
    return service, matcher, item


def test_declared_extra_is_auto_assigned_where_a_named_one_is_held(tmp_path, monkeypatch):
    """A file on a later disc of a set takes its title from the folder, so
    without a record it is held for review. Declared at rip time, it is known
    to be an extra of that film. (With ``ingress_hold_rip_extras`` on, the
    default, it still waits for its type to be confirmed: see
    test_extras_held_for_review.py.)"""
    from config.settings import settings
    monkeypatch.setattr(settings, "ingress_hold_rip_extras", False)
    name = "Gone Girl (2014)-trailer.mkv"
    disc_two = {"folder_name": "Gone Girl D2 (2014) [imdbid-tt2267998]"}

    service, _matcher, _item = _service(tmp_path, name, None, **disc_two)
    undeclared = asyncio.run(service.process_next_item())
    assert undeclared.status == QUEUE_NEEDS_REVIEW
    assert "matched on the folder title" in undeclared.parsed_info["review_reason"]

    declaration = _declaration(content_type="trailer", is_main_feature=None, title_index=4)
    service, matcher, _item = _service(tmp_path, name, declaration, **disc_two)
    declared = asyncio.run(service.process_next_item())

    assert declared.status == QUEUE_AUTO_ASSIGNED
    assert "review_reason" not in declared.parsed_info
    assert declared.classification_override == "special_feature"
    assert declared.parsed_info["rip"]["title_index"] == 4
    assert (matcher.calls[0]["imdb_id"], matcher.calls[0]["tmdb_id"]) == ("tt2267998", "210577")
    rules = [entry["rule"] for entry in declared.best_match["score_breakdown"]]
    assert rules[-1] == "ripper_manifest"
    assert "disc title 4" in declared.best_match["score_breakdown"][-1]["note"]


def test_declared_episode_is_what_the_matcher_is_asked_for(tmp_path):
    episode_match = {"title": "Firefly", "year": 2002, "media_type": "series", "confidence_score": 100,
                     "media_id": "tt0303461"}
    # The name says episode 3 (its position on the disc); the rip says episode 5.
    service, matcher, _item = _service(tmp_path, "Firefly S01E03.mkv", _episode(), match=episode_match)
    processed = asyncio.run(service.process_next_item())

    asked = matcher.calls[0]
    assert (asked["media_type"], asked["season"], asked["episode"]) == ("episode", 1, 5)
    assert asked["tmdb_id"] == "1437"
    assert processed.status == QUEUE_AUTO_ASSIGNED
    assert (processed.parsed_info["season"], processed.parsed_info["episode"]) == (1, 5)


def test_read_errors_keep_a_declared_file_in_review(tmp_path):
    service, _matcher, _item = _service(tmp_path, "Gone Girl (2014).mkv", _declaration(read_errors=2))
    processed = asyncio.run(service.process_next_item())
    assert processed.status == QUEUE_NEEDS_REVIEW
    assert processed.parsed_info["review_reason"] == "the disc had 2 read error(s) while this title was ripped"


def test_unassigned_show_title_stays_in_review(tmp_path):
    service, _matcher, _item = _service(
        tmp_path, "Firefly S01E03.mkv", _episode(episode=None, episode_name=None))
    processed = asyncio.run(service.process_next_item())
    assert processed.status == QUEUE_NEEDS_REVIEW
    assert "without an episode assignment" in processed.parsed_info["review_reason"]


def test_a_reviewers_classification_beats_the_declaration(tmp_path):
    declaration = _declaration(content_type="trailer", is_main_feature=None)
    service, _matcher, item = _service(tmp_path, "Gone Girl (2014)-trailer.mkv", declaration)
    item.classification_override = "main_feature"
    processed = asyncio.run(service.process_next_item())
    assert processed.classification_override == "main_feature"
    assert processed.parsed_info["classification_override"] == "main_feature"


def test_no_record_leaves_processing_as_it_was(tmp_path):
    service, matcher, _item = _service(tmp_path, "Gone Girl (2014).mkv", None)
    processed = asyncio.run(service.process_next_item())

    assert processed.status == QUEUE_AUTO_ASSIGNED
    assert "rip" not in processed.parsed_info
    assert processed.classification_override is None
    assert matcher.calls[0]["imdb_id"] == "tt2267998"      # from the folder tag, as before
    assert all(e.get("rule") != "ripper_manifest" for e in processed.best_match.get("score_breakdown", []))
