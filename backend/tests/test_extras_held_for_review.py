"""Ripped extras are held for a person to confirm their type, and the type names the library file."""

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from config.settings import settings
from services import contact_sheet, extras_taxonomy, rip_records, storage_paths
from services.ingress_queue_service import (
    QUEUE_AUTO_ASSIGNED,
    QUEUE_COMPLETED,
    QUEUE_NEEDS_REVIEW,
    IngressQueueService,
)
from tests.fake_db import FakeSession

MOVIE = {"title": "Gone Girl", "year": 2014, "media_type": "movie", "confidence_score": 100,
         "media_id": "tt2267998", "imdb_id": "tt2267998"}
SHOW = {"title": "Burn Notice", "year": 2007, "media_type": "series", "confidence_score": 100,
        "media_id": "tt0810788", "imdb_id": "tt0810788"}


def _declaration(**overrides) -> dict:
    base = {
        "rip_id": "11111111-2222-3333-4444-555555555555", "disc_id": "disc-1",
        "media_type": "movie", "title": "Gone Girl", "year": 2014,
        "imdb_id": "tt2267998", "tmdb_id": 210577, "rip_season": None,
        "title_index": 4, "content_type": "trailer", "is_main_feature": None,
        "season": None, "episode": None, "episode_end": None, "tmdb_episode_id": None,
        "episode_name": None, "custom_name": None, "read_errors": 0, "duration_seconds": None,
    }
    base.update(overrides)
    return base


def _show_extra(**overrides) -> dict:
    return _declaration(**{
        "media_type": "show", "title": "Burn Notice", "year": 2007, "imdb_id": "tt0810788", "tmdb_id": 2919,
        "rip_season": 1, "content_type": "clip", **overrides,
    })


class _StubMatcher:
    def __init__(self, result):
        self.result = result

    def search_and_match(self, parsed_info):
        return json.loads(json.dumps(self.result))


def _ingest_file(tmp_path, name, folder_name):
    folder = tmp_path / "ingest" / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(b"x" * 16)
    return path


def _service(tmp_path, files, match, subfolder=""):
    """A queue holding ``files`` ({name: declaration}) of one folder, all matched to ``match``."""
    matcher = _StubMatcher({"status": "success", "found": True, "candidates": [match], "best_match": match})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)
    folder = os.path.join(f"{match['title']} ({match['year']}) [imdbid-{match['imdb_id']}]", subfolder)
    by_path = {}
    items = []
    for name, declaration in files.items():
        path = os.fspath(_ingest_file(tmp_path, name, folder))
        by_path[path] = declaration
        items.append(service.add_manual_file(path))

    async def declaration_for(candidate, _source_root):
        return by_path.get(candidate.file_path)

    service._rip_declaration_for = declaration_for
    return service, items


@pytest.fixture(autouse=True)
def library(tmp_path):
    storage_paths.set_overrides({storage_paths.LIBRARY_ROOT_KEY: os.fspath(tmp_path / "library")})
    yield tmp_path / "library"
    storage_paths.clear_overrides()


def _process_all(service, count):
    return [asyncio.run(service.process_next_item()) for _ in range(count)]


# ── naming ──────────────────────────────────────────────────────────────────

def test_extra_file_name_numbers_from_the_second_of_a_kind():
    name = extras_taxonomy.extra_file_name
    assert name("Burn Notice (2007)", "scene", ".mkv") == "Burn Notice (2007)-scene.mkv"
    taken = ["burn notice (2007)-scene.mkv", "Burn Notice (2007) 2-scene.MKV"]
    assert name("Burn Notice (2007)", "scene", "mkv", taken) == "Burn Notice (2007) 3-scene.mkv"
    assert name("Burn Notice (2007)", "behind_the_scenes", ".mkv", taken) == "Burn Notice (2007)-behindthescenes.mkv"
    with pytest.raises(ValueError):
        name("Burn Notice (2007)", "nonsense", ".mkv")


def test_every_category_has_a_suffix_the_taxonomy_reads_back():
    for category in extras_taxonomy.CATEGORIES:
        stem = os.path.splitext(extras_taxonomy.extra_file_name("X (2000)", category, ".mkv"))[0]
        assert extras_taxonomy.classify_extra_category_from_stem(stem) == category


# ── apply_declaration ───────────────────────────────────────────────────────

def test_a_declared_extra_carries_its_type_and_is_held_only_when_asked():
    parsed = {}
    assert rip_records.apply_declaration(parsed, _declaration()) is None
    assert parsed["extras_category"] == "trailer" and "extras_confirmed" not in parsed

    parsed = {}
    assert rip_records.apply_declaration(parsed, _declaration(), hold_extras=True) == rip_records.EXTRA_HOLD_REASON

    # The older generic tag is an extra with no type yet: held, nothing to pre-select.
    parsed = {}
    assert rip_records.apply_declaration(parsed, _declaration(content_type="special_feature"), hold_extras=True)
    assert "extras_category" not in parsed


def test_a_reviewers_type_and_confirmation_survive_reprocessing():
    parsed = {}
    previous = {"extras_category": "blooper", "extras_confirmed": True}
    assert rip_records.apply_declaration(parsed, _declaration(), previous=previous, hold_extras=True) is None
    assert parsed["extras_category"] == "blooper" and parsed["extras_confirmed"] is True


def test_a_main_feature_is_never_held_as_an_extra():
    parsed = {}
    main = _declaration(content_type="main_feature", is_main_feature=True)
    assert rip_records.apply_declaration(parsed, main, hold_extras=True) is None
    assert "extras_category" not in parsed


# ── the queue ───────────────────────────────────────────────────────────────

def test_a_ripped_extra_waits_in_review_with_a_typed_name(tmp_path):
    service, _ = _service(tmp_path, {"Gone Girl (2014)-trailer.mkv": _declaration()}, MOVIE)
    (item,) = _process_all(service, 1)

    assert item.status == QUEUE_NEEDS_REVIEW
    assert item.parsed_info["review_reason"] == rip_records.EXTRA_HOLD_REASON
    assert item.parsed_info["extras_category"] == "trailer"
    assert service.is_held_extra(item)
    assert [view["id"] for view in service.held_extras()] == [item.id]
    assert item.proposed_path == "Movies/Gone Girl (2014) [imdbid-tt2267998]/Gone Girl (2014)-trailer.mkv"


def test_changing_the_type_renames_the_proposal(tmp_path):
    service, _ = _service(tmp_path, {"Gone Girl (2014)-trailer.mkv": _declaration()}, MOVIE)
    (item,) = _process_all(service, 1)

    updated = asyncio.run(service.set_extras_category(item.id, "blooper"))
    assert updated.parsed_info["extras_category"] == "blooper"
    assert updated.proposed_path == "Movies/Gone Girl (2014) [imdbid-tt2267998]/Gone Girl (2014)-blooper.mkv"
    assert service.is_held_extra(updated)

    with pytest.raises(ValueError):
        asyncio.run(service.set_extras_category(item.id, "nonsense"))
    assert asyncio.run(service.set_extras_category("no-such-item", "clip")) is None


def test_extras_of_one_type_are_numbered_against_each_other_and_the_library(tmp_path, library):
    season = library / "TV Shows" / "Burn Notice (2007) [imdbid-tt0810788]" / "Season 01"
    season.mkdir(parents=True)
    (season / "Burn Notice (2007)-scene.mkv").write_bytes(b"x")
    files = {
        "Burn Notice (2007)-clip.mkv": _show_extra(title_index=1, content_type="scene"),
        "Burn Notice (2007) 2-clip.mkv": _show_extra(title_index=2, content_type="scene"),
        "Burn Notice (2007) 3-clip.mkv": _show_extra(title_index=3, content_type="blooper"),
    }
    # The ripper delivers a show's files into a season folder, which is where the season comes from.
    service, _ = _service(tmp_path, files, SHOW, subfolder="Season 01")
    items = _process_all(service, 3)

    assert all(item.status == QUEUE_NEEDS_REVIEW for item in items)
    names = sorted(os.path.basename(view["proposed_path"]) for view in service.held_extras())
    assert names == ["Burn Notice (2007) 2-scene.mkv", "Burn Notice (2007) 3-scene.mkv", "Burn Notice (2007)-blooper.mkv"]
    folders = {os.path.dirname(view["proposed_path"]) for view in service.held_extras()}
    assert folders == {"TV Shows/Burn Notice (2007) [imdbid-tt0810788]/Season 01"}


def test_confirming_releases_the_hold(tmp_path):
    service, _ = _service(tmp_path, {"Gone Girl (2014)-trailer.mkv": _declaration()}, MOVIE)
    (item,) = _process_all(service, 1)

    confirmed = asyncio.run(service.set_extras_category(item.id, "featurette", confirmed=True))
    assert confirmed.parsed_info["extras_confirmed"] is True
    assert not service.is_held_extra(confirmed)
    assert service.held_extras() == []


def test_with_the_hold_off_a_ripped_extra_is_auto_assigned_under_its_typed_name(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ingress_hold_rip_extras", False)
    service, _ = _service(tmp_path, {"Gone Girl (2014)-trailer.mkv": _declaration()}, MOVIE)
    (item,) = _process_all(service, 1)

    assert item.status == QUEUE_AUTO_ASSIGNED
    assert "review_reason" not in item.parsed_info
    assert item.proposed_path.endswith("/Gone Girl (2014)-trailer.mkv")


def test_an_episode_and_a_file_without_a_rip_record_are_left_alone(tmp_path):
    episode = _show_extra(content_type="episode", season=1, episode=5, episode_name="Family Business")
    service, _ = _service(tmp_path, {"Burn Notice S01E05 - Family Business.mkv": episode}, SHOW)
    (item,) = _process_all(service, 1)
    assert item.status == QUEUE_AUTO_ASSIGNED
    assert "extras_category" not in item.parsed_info
    assert not service.is_held_extra(item)
    assert "S01E05" in item.proposed_path


# ── the review API ──────────────────────────────────────────────────────────

@pytest.fixture()
def app():
    from main import app as fastapi_app
    previous = getattr(fastapi_app.state, "ingress_queue_service", None)
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()
    fastapi_app.state.ingress_queue_service = previous


def _client(app, service):
    from api.auth import require_session
    from db.database import get_db

    async def override_db():
        yield FakeSession([])

    async def override_auth():
        return MagicMock()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_session] = override_auth
    app.state.ingress_queue_service = service
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _held(tmp_path):
    service, _ = _service(tmp_path, {"Gone Girl (2014)-trailer.mkv": _declaration()}, MOVIE)
    item = await service.process_next_item()
    return service, item


async def test_pending_lists_a_held_extra(app, tmp_path):
    service, item = await _held(tmp_path)
    async with _client(app, service) as ac:
        pending = (await ac.get("/api/media/extras/pending")).json()
    assert len(pending) == 1
    row = pending[0]
    assert row["id"] == item.id and row["queueItemId"] == item.id
    assert (row["source"], row["category"], row["title"], row["discTitleIndex"]) == ("rip", "trailer", "Gone Girl", 4)
    assert row["fileName"] == "Gone Girl (2014)-trailer.mkv"
    assert row["proposedPath"].endswith("Gone Girl (2014)-trailer.mkv")
    assert row["hasContactSheet"] is True


async def test_patch_sets_the_type_then_confirm_files_it(app, tmp_path):
    service, item = await _held(tmp_path)
    accepted = []

    async def mark_complete(item_id, manual_action=False, **_kwargs):
        accepted.append((item_id, manual_action))
        queued = service.items_by_id[item_id]
        queued.status = QUEUE_COMPLETED
        return queued

    service.mark_complete = mark_complete
    async with _client(app, service) as ac:
        changed = await ac.patch(f"/api/media/extras/{item.id}", json={"category": "blooper"})
        assert changed.status_code == 200
        assert changed.json()["category"] == "blooper" and changed.json()["confirmed"] is False
        assert changed.json()["proposedPath"].endswith("Gone Girl (2014)-blooper.mkv")
        assert accepted == []

        bad = await ac.patch(f"/api/media/extras/{item.id}", json={"category": "nonsense"})
        assert bad.status_code == 400

        done = await ac.patch(f"/api/media/extras/{item.id}", json={"category": "blooper", "confirmed": True})
        assert done.status_code == 200
        assert done.json()["confirmed"] is True and done.json()["queueStatus"] == QUEUE_COMPLETED
        assert accepted == [(item.id, True)]
        assert (await ac.get("/api/media/extras/pending")).json() == []

        assert (await ac.patch("/api/media/extras/nope", json={"confirmed": True})).status_code == 404


async def test_contact_sheet_is_served_for_a_held_extra_only(app, tmp_path, monkeypatch):
    service, item = await _held(tmp_path)
    sheet = tmp_path / "sheet.jpg"
    sheet.write_bytes(b"\xff\xd8jpeg")
    asked = []

    def build(path, duration_seconds):
        asked.append(path)
        return os.fspath(sheet) if path.endswith("trailer.mkv") else None

    monkeypatch.setattr(contact_sheet, "build", build)
    async with _client(app, service) as ac:
        ok = await ac.get(f"/api/media/extras/{item.id}/contact-sheet")
        assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
        assert ok.content == b"\xff\xd8jpeg"
        assert asked == [item.file_path]
        assert (await ac.get("/api/media/extras/nope/contact-sheet")).status_code == 404

        monkeypatch.setattr(contact_sheet, "build", lambda *_: None)
        assert (await ac.get(f"/api/media/extras/{item.id}/contact-sheet")).status_code == 422


# ── contact sheets ──────────────────────────────────────────────────────────

def test_contact_sheet_command_spreads_twelve_frames_over_the_file():
    cmd = contact_sheet.command("/in/a.mkv", 240.0, "/out/a.jpg")
    assert cmd[0] == "ffmpeg" and cmd[-1] == "/out/a.jpg"
    assert "fps=1/20.000,scale=320:-2,tile=4x3" in cmd
    # A clip shorter than twelve seconds still asks for a frame a second, not a zero step.
    assert "fps=1/1.000,scale=320:-2,tile=4x3" in contact_sheet.command("/in/a.mkv", 5.0, "/out/a.jpg")


def test_contact_sheet_is_cached_per_file_version_and_missing_files_give_none(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "temp_directory", os.fspath(tmp_path / "tmp"))
    video = tmp_path / "a.mkv"
    video.write_bytes(b"x")
    assert contact_sheet.build(os.fspath(tmp_path / "gone.mkv"), 60) is None

    first = contact_sheet.cache_path(os.fspath(video))
    with open(first, "wb") as fh:
        fh.write(b"cached")
    runs = []
    monkeypatch.setattr(contact_sheet.subprocess, "run", lambda *a, **k: runs.append(a))
    assert contact_sheet.build(os.fspath(video), 60) == first
    assert runs == []

    video.write_bytes(b"longer now")
    assert contact_sheet.cache_path(os.fspath(video)) != first


# ── the real accept ─────────────────────────────────────────────────────────

class _CapturingOrchestrator:
    """Stands in for the organizer: records what it was asked to file, and says it did."""

    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append(dict(queue_item))
        proposed_path = queue_item.get("proposed_path") or ""
        return {
            "assignment_id": "assignment-1",
            "organized": True,
            "organization_result": {
                "success": True,
                "targetPath": os.path.dirname(proposed_path) if proposed_path else None,
                "operations": [{"destination": proposed_path}],
            },
        }


async def test_confirming_through_the_api_files_the_extra_under_the_chosen_type(app, tmp_path):
    service, item = await _held(tmp_path)
    orchestrator = _CapturingOrchestrator()
    service.assignment_orchestrator = orchestrator

    async with _client(app, service) as ac:
        done = await ac.patch(f"/api/media/extras/{item.id}", json={"category": "blooper", "confirmed": True})
        assert done.status_code == 200, done.text
        assert done.json()["queueStatus"] == QUEUE_COMPLETED
        assert (await ac.get("/api/media/extras/pending")).json() == []

    assert len(orchestrator.calls) == 1
    filed = orchestrator.calls[0]
    assert filed["proposed_path"].replace("\\", "/").endswith(
        "Movies/Gone Girl (2014) [imdbid-tt2267998]/Gone Girl (2014)-blooper.mkv"
    )
    assert filed["parsed_info"]["extras_category"] == "blooper"
    assert filed["parsed_info"]["extras_confirmed"] is True
