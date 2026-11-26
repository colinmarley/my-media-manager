"""Ripped extras are held for a person to confirm their type, and the type names the library file."""

import asyncio
import json
import os
import shutil
import subprocess
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from config.settings import settings
from services import contact_sheet, extra_preview, extras_taxonomy, rip_records, storage_paths
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
    # A blooper is filed under Jellyfin's "other" (Jellyfin has no blooper type), so it reads back as one.
    for category in extras_taxonomy.CATEGORIES:
        stem = os.path.splitext(extras_taxonomy.extra_file_name("X (2000)", category, ".mkv"))[0]
        expected = "other" if category == "blooper" else category
        assert extras_taxonomy.classify_extra_category_from_stem(stem) == expected


def test_every_category_is_filed_under_a_name_and_folder_jellyfin_reads_as_an_extra():
    """Any other file in a season folder is taken by Jellyfin for an episode."""
    jellyfin_folders = {"trailers", "behind the scenes", "deleted scenes", "interviews", "scenes",
                        "samples", "shorts", "featurettes", "extras", "other", "clips"}
    for category in extras_taxonomy.CATEGORIES:
        assert extras_taxonomy.CATEGORY_TO_SUFFIX[category] in extras_taxonomy.JELLYFIN_EXTRA_SUFFIXES
        assert extras_taxonomy.CATEGORY_TO_FOLDER[category] in jellyfin_folders
    assert extras_taxonomy.extra_file_name("Show (1996)", "blooper", ".mkv") == "Show (1996)-other.mkv"
    # The disc ripper still names a gag reel "-blooper" in ingest; that reads as a blooper.
    assert extras_taxonomy.classify_extra_category_from_stem("Show (1996)-blooper") == "blooper"


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
    assert updated.proposed_path == "Movies/Gone Girl (2014) [imdbid-tt2267998]/Gone Girl (2014)-other.mkv"
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
    assert names == ["Burn Notice (2007) 2-scene.mkv", "Burn Notice (2007) 3-scene.mkv", "Burn Notice (2007)-other.mkv"]
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
        assert changed.json()["proposedPath"].endswith("Gone Girl (2014)-other.mkv")
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
        # An item id is reused when a later disc delivers to the same path: the
        # browser must revalidate, not show the earlier file's frames.
        assert ok.headers["cache-control"] == "private, no-cache"
        assert ok.headers.get("etag")
        assert (await ac.get("/api/media/extras/nope/contact-sheet")).status_code == 404

        monkeypatch.setattr(contact_sheet, "build", lambda *_: None)
        assert (await ac.get(f"/api/media/extras/{item.id}/contact-sheet")).status_code == 422


async def test_preview_streams_a_held_extra_from_the_asked_time_and_track(app, tmp_path, monkeypatch):
    service, item = await _held(tmp_path)
    asked = []

    async def stream(path, start, audio):
        asked.append((path, start, audio))
        yield b"ftyp"
        yield b"moof"

    monkeypatch.setattr(extra_preview, "stream", stream)
    monkeypatch.setattr(
        extra_preview, "playback_info",
        lambda path: {"durationSeconds": 120.0, "audioTracks": [{"index": 0}, {"index": 1, "commentary": True}]},
    )
    async with _client(app, service) as ac:
        ok = await ac.get(f"/api/media/extras/{item.id}/preview", params={"start": 61.5, "audio": 1})
        assert ok.status_code == 200 and ok.headers["content-type"] == "video/mp4"
        assert ok.content == b"ftypmoof"
        assert "no-store" in ok.headers["cache-control"]
        assert asked == [(item.file_path, 61.5, 1)]

        info = await ac.get(f"/api/media/extras/{item.id}/playback-info")
        assert info.status_code == 200 and info.json()["audioTracks"][1]["commentary"] is True

        assert (await ac.get("/api/media/extras/nope/preview")).status_code == 404
        assert (await ac.get(f"/api/media/extras/{item.id}/preview", params={"start": -1})).status_code == 422

        os.remove(item.file_path)
        assert (await ac.get(f"/api/media/extras/{item.id}/preview")).status_code == 404
        assert (await ac.get(f"/api/media/extras/{item.id}/playback-info")).status_code == 404


@pytest.mark.parametrize("spec_version", ["2.3", "2.4"])
async def test_an_abandoned_preview_is_closed_so_ffmpeg_stops(spec_version):
    """The browser drops a stream on every jump; the generator's cleanup (which kills ffmpeg) must run
    as the response ends, not whenever the abandoned generator is garbage collected."""
    from api.extras import _ClosingStreamingResponse

    closed = []
    chunks_sent = []

    async def stream():
        try:
            while True:
                yield b"x" * 1024
        finally:
            closed.append(True)

    async def receive():
        await asyncio.sleep(0.05)
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] != "http.response.body":
            return
        chunks_sent.append(message)
        if len(chunks_sent) > 1:
            # The client has gone: a slow write that never drains (spec 2.3), or an error (2.4).
            if spec_version == "2.4":
                raise OSError("connection lost")
            await asyncio.Event().wait()

    response = _ClosingStreamingResponse(stream(), media_type="video/mp4")
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": spec_version}}
    from starlette.requests import ClientDisconnect

    try:
        await asyncio.wait_for(response(scope, receive, send), timeout=5)
    except (OSError, ClientDisconnect):
        pass  # how the lost connection surfaces depends on the Starlette version
    assert closed == [True]


# ── previews ────────────────────────────────────────────────────────────────

def test_preview_command_seeks_before_reading_and_maps_the_chosen_audio_track():
    cmd = extra_preview.command("/in/a.mkv", 75.25, 2)
    assert cmd[0] == "ffmpeg" and cmd[-1] == "pipe:1"
    assert cmd.index("-ss") < cmd.index("-i") and cmd[cmd.index("-ss") + 1] == "75.250"
    assert "0:a:2?" in cmd and "0:v:0?" in cmd
    assert "frag_keyframe+empty_moov+default_base_moof" in cmd
    # Out-of-range input is clamped, not passed to ffmpeg.
    assert "0.000" in extra_preview.command("/in/a.mkv", -5, -1) and "0:a:0?" in extra_preview.command("/in/a.mkv", 0, -1)


needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg/ffprobe not installed"
)


def _two_track_clip(tmp_path) -> str:
    """A four-second MKV with MPEG-2 video and two AC-3 tracks, the second marked as a commentary."""
    path = os.fspath(tmp_path / "clip.mkv")
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc=size=720x480:rate=30000/1001:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=4",
            "-map", "0:v", "-map", "1:a", "-map", "2:a",
            "-c:v", "mpeg2video", "-c:a", "ac3",
            "-metadata:s:a:1", "title=Commentary", "-disposition:a:1", "comment",
            path,
        ],
        check=True, capture_output=True, timeout=60,
    )
    return path


@needs_ffmpeg
def test_playback_info_gives_the_length_and_each_audio_track(tmp_path):
    info = extra_preview.playback_info(_two_track_clip(tmp_path))
    assert 3.5 < info["durationSeconds"] < 4.5
    tracks = info["audioTracks"]
    assert [t["index"] for t in tracks] == [0, 1]
    assert tracks[0]["codec"] == "ac3" and tracks[1]["title"] == "Commentary" and tracks[1]["commentary"] is True
    assert extra_preview.playback_info(os.fspath(tmp_path / "gone.mkv")) == {"durationSeconds": None, "audioTracks": []}


@needs_ffmpeg
async def test_preview_stream_is_a_playable_fragmented_mp4(tmp_path):
    clip = _two_track_clip(tmp_path)
    data = b"".join([chunk async for chunk in extra_preview.stream(clip, 1.0, 1)])
    assert data[4:8] == b"ftyp" and b"moof" in data
    out = tmp_path / "preview.mp4"
    out.write_bytes(data)
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "json", os.fspath(out)],
        check=True, capture_output=True, timeout=60,
    ).stdout)
    assert sorted(s["codec_name"] for s in probe["streams"]) == ["aac", "h264"]
    # Started a second in: about three seconds remain.
    assert 2.0 < float(probe["format"]["duration"]) < 3.6


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
        "Movies/Gone Girl (2014) [imdbid-tt2267998]/Gone Girl (2014)-other.mkv"
    )
    assert filed["parsed_info"]["extras_category"] == "blooper"
    assert filed["parsed_info"]["extras_confirmed"] is True
