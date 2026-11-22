"""Rip records: storing what disc-ripper-service reports, linking delivered
files to their disc, and letting a re-rip back into the ingest queue."""

import json
import os
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import Disc, DiscMediaLink, DiscRip, DiscRipTitle, MediaFile, Movie, Series
from services import rip_records, storage_paths
from services.ingress_queue_service import QUEUE_IGNORED, QUEUE_NEEDS_REVIEW, QUEUE_PENDING, IngressQueueService
from services.rip_records import RipRecord
from tests.fake_db import FakeSession

INGEST = "/ark/media/ingest"
# The queue keys files by the path the OS reports (backslashes on Windows).
os_path = os.path.normpath
FOLDER = f"{INGEST}/Firefly (2002) [imdbid-tt0303461]"
EP1 = f"{FOLDER}/Season 01/Firefly S01E01-E02 - Serenity.mkv"
EP3 = f"{FOLDER}/Season 01/Firefly S01E03 - The Train Job.mkv"
TRAILER = f"{FOLDER}/Season 01/Firefly (2002)-trailer.mkv"
JOB = "11111111-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def ingest_root(monkeypatch):
    storage_paths.set_overrides({storage_paths.INGEST_ROOTS_KEY: [INGEST]})
    # Delivered files "exist" unless a test says otherwise.
    monkeypatch.setattr("services.media_file_index._default_exists", lambda path: True)
    yield
    storage_paths.clear_overrides()


def _payload(status: str = "delivered", **overrides) -> dict:
    title_status = "delivered" if status in ("delivered", "partial") else "ripped"
    payload = {
        "schema_version": 1,
        "job_id": JOB,
        "status": status,
        "ripper_host": "ai-workstation",
        "rip_started_at": "2026-11-22T20:00:00Z",
        "rip_finished_at": "2026-11-22T21:10:00Z",
        "delivered_at": "2026-11-22T21:12:00Z" if title_status == "delivered" else None,
        "catalog": {"disc_id": "disc-1", "title": "Firefly Disc 1", "barcode": "024543012345",
                    "disc_number": 1, "edition": None, "format": "dvd", "release_id": "release-9"},
        "identity": {"media_type": "show", "title": "Firefly", "year": 2002,
                     "imdb_id": "tt0303461", "tmdb_id": 1437, "season": 1},
        "disc": {"disc_type": "dvd", "reported_disc_type": "DVD disc", "disc_name": "Firefly, Disc 1",
                 "volume_label": "FIREFLY_D1", "fingerprint": "f" * 64, "fingerprint_algo": "scan-v1",
                 "drive_model": "BD-RE HL-DT-ST", "makemkv_version": "MakeMKV v2.0.0",
                 "scan_id": "scan-1", "scan_link": "declared"},
        "scan_titles": [{"index": 0, "duration_seconds": 5171}, {"index": 1, "duration_seconds": 2649},
                        {"index": 2, "duration_seconds": 90}, {"index": 3, "duration_seconds": 2600}],
        "titles": [
            {"title_index": 0, "file_seq": 0, "status": title_status, "content_type": "episode",
             "season": 1, "episode": 1, "episode_end": 2, "tmdb_episode_id": 85395,
             "episode_name": "Serenity", "makemkv_filename": "B1_t00.mkv", "dest_path": EP1,
             "ingest_relative_path": EP1[len(INGEST) + 1:], "size_bytes": 4959793152,
             "sha256": "a" * 64, "read_errors": 0, "probe": {"duration_seconds": 5170.4}},
            {"title_index": 1, "file_seq": 0, "status": title_status, "content_type": "episode",
             "season": 1, "episode": 3, "episode_name": "The Train Job", "makemkv_filename": "B2_t01.mkv",
             "dest_path": EP3, "ingest_relative_path": EP3[len(INGEST) + 1:],
             "size_bytes": 2412345344, "sha256": "b" * 64, "read_errors": 2},
            {"title_index": 2, "file_seq": 0, "status": title_status, "content_type": "trailer",
             "makemkv_filename": "B9_t02.mkv", "dest_path": TRAILER,
             "ingest_relative_path": TRAILER[len(INGEST) + 1:], "size_bytes": 52428800},
        ],
    }
    payload.update(overrides)
    return payload


def _session(*extra) -> FakeSession:
    return FakeSession([Disc(id="disc-1", title="Firefly Disc 1", set_id="release-9"), *extra])


async def _store(session, payload=None):
    return await rip_records.upsert_rip(session, RipRecord.model_validate(payload or _payload()))


# ── Storing ─────────────────────────────────────────────────────────────────

async def test_delivered_rip_is_stored_with_disc_identity_and_declarations():
    session = _session()
    result = await _store(session)

    assert result.created and result.disc_found and result.linked_files == 3
    (rip,) = session.all_of(DiscRip)
    assert rip.id == JOB and rip.status == "delivered"
    assert (rip.disc_id, rip.release_id) == ("disc-1", "release-9")
    assert (rip.media_type, rip.title, rip.year, rip.tmdb_id, rip.imdb_id, rip.season) == (
        "show", "Firefly", 2002, 1437, "tt0303461", 1)
    assert rip.volume_label == "FIREFLY_D1" and rip.fingerprint == "f" * 64
    assert rip.reported_disc_type == "DVD disc" and rip.makemkv_version == "MakeMKV v2.0.0"
    assert len(rip.scan_titles) == 4            # every title on the disc, ripped or not
    assert rip.manifest["disc"]["scan_id"] == "scan-1"   # unknown keys survive in the stored payload

    titles = {t.title_index: t for t in session.all_of(DiscRipTitle)}
    assert (titles[0].season, titles[0].episode, titles[0].episode_end) == (1, 1, 2)
    assert titles[0].tmdb_episode_id == 85395 and titles[0].makemkv_filename == "B1_t00.mkv"
    assert titles[0].delivered_path == EP1 and titles[0].duration_seconds == 5170.4
    assert titles[1].read_errors == 2
    assert titles[2].content_type == "trailer" and titles[2].episode is None


async def test_delivered_files_are_linked_to_the_disc_and_release():
    session = _session()
    await _store(session)

    files = {f.file_path: f for f in session.all_of(MediaFile)}
    assert set(files) == {EP1, EP3, TRAILER}
    for media_file in files.values():
        assert (media_file.disc_id, media_file.release_id, media_file.source_kind) == ("disc-1", "release-9", "disc")
    assert files[EP1].checksum == "a" * 64
    # Declarations stay on the rip title; the file row's placement is its own.
    assert files[EP1].season_number is None and files[EP1].episode_number is None
    by_index = {t.title_index: t for t in session.all_of(DiscRipTitle)}
    assert by_index[0].media_file_id == files[EP1].id


async def test_reporting_twice_changes_nothing():
    session = _session()
    first = await _store(session)
    second = await _store(session)

    assert first.created and not second.created
    assert len(session.all_of(DiscRip)) == 1
    assert len(session.all_of(DiscRipTitle)) == 3
    assert len(session.all_of(MediaFile)) == 3
    assert first.newly_delivered == [EP1, EP3, TRAILER]
    assert second.newly_delivered == []          # nothing is re-queued by a repeat


async def test_preregistration_announces_paths_without_creating_file_rows():
    session = _session()
    result = await _store(session, _payload("delivering"))

    assert result.expected == [EP1, EP3, TRAILER]
    assert result.linked_files == 0 and session.all_of(MediaFile) == []
    assert await rip_records.pending_paths(session) == [EP1, EP3, TRAILER]

    confirmed = await _store(session)
    assert confirmed.newly_delivered == [EP1, EP3, TRAILER]
    assert len(session.all_of(MediaFile)) == 3
    assert await rip_records.pending_paths(session) == []


async def test_stale_preregistration_does_not_undo_a_delivery():
    session = _session()
    await _store(session)
    late = await _store(session, _payload("delivering"))

    assert late.expected == []
    (rip,) = session.all_of(DiscRip)
    assert rip.status == "delivered"
    assert {t.status for t in session.all_of(DiscRipTitle)} == {"delivered"}


async def test_failed_title_is_recorded_but_not_linked():
    payload = _payload("partial")
    payload["titles"][1].update(status="failed", error="makemkvcon produced no file", dest_path=None,
                                ingest_relative_path=None)
    session = _session()
    result = await _store(session, payload)

    assert result.linked_files == 2 and EP3 not in result.newly_delivered
    failed = next(t for t in session.all_of(DiscRipTitle) if t.title_index == 1)
    assert failed.status == "failed" and failed.media_file_id is None and failed.delivered_path is None


async def test_unknown_catalog_disc_still_stores_the_rip():
    session = FakeSession()
    result = await _store(session)

    assert not result.disc_found
    (rip,) = session.all_of(DiscRip)
    assert rip.disc_id is None and rip.manifest["catalog"]["disc_id"] == "disc-1"
    (first, *_rest) = session.all_of(MediaFile)
    assert first.disc_id is None and first.source_kind == "disc"


async def test_late_report_attaches_to_the_organized_file(monkeypatch):
    """The push arrives after the file was organized: the existing library
    row is linked, and no orphan is left at the ingest path."""
    organized = MediaFile(id="mf-organized", file_path=EP1, file_name="x.mkv")
    session = _session(organized)
    await _store(session)

    assert organized.disc_id == "disc-1" and organized.checksum == "a" * 64
    assert sum(1 for f in session.all_of(MediaFile) if f.file_path == EP1) == 1


async def test_path_is_resolved_from_the_relative_path_when_mounts_differ():
    payload = _payload()
    for title in payload["titles"]:
        title["dest_path"] = title["dest_path"].replace(INGEST, "/data/ingest")
    session = _session()
    await _store(session, payload)

    assert {t.delivered_path for t in session.all_of(DiscRipTitle)} == {EP1, EP3, TRAILER}


# ── Disc ↔ title link ───────────────────────────────────────────────────────

async def test_series_disc_gets_its_episode_range():
    session = _session(Series(id="series-firefly", title="Firefly", tmdb_id="1437"))
    await _store(session)

    (link,) = session.all_of(DiscMediaLink)
    assert (link.disc_id, link.media_type, link.media_id) == ("disc-1", "series", "series-firefly")
    assert (link.season_number, link.episode_start, link.episode_end) == (1, 1, 3)


async def test_second_rip_of_the_disc_widens_the_range():
    session = _session(
        Series(id="series-firefly", title="Firefly", imdb_id="tt0303461"),
        DiscMediaLink(disc_id="disc-1", media_type="series", media_id="series-firefly",
                      season_number=1, episode_start=4, episode_end=6),
    )
    await _store(session)

    (link,) = session.all_of(DiscMediaLink)
    assert (link.episode_start, link.episode_end) == (1, 6)


async def test_movie_disc_is_linked_without_a_scope():
    payload = _payload()
    payload["identity"] = {"media_type": "movie", "title": "Gone Girl", "year": 2014,
                           "imdb_id": "tt2267998", "tmdb_id": 210577, "season": None}
    payload["titles"] = [{"title_index": 0, "status": "delivered", "content_type": "main_feature",
                          "is_main_feature": True, "dest_path": f"{INGEST}/Gone Girl (2014)/Gone Girl (2014).mkv"}]
    session = _session(Movie(id="movie-gg", title="Gone Girl", tmdb_id="210577"))
    await _store(session, payload)

    (link,) = session.all_of(DiscMediaLink)
    assert (link.media_type, link.media_id, link.season_number) == ("movie", "movie-gg", None)


async def test_no_link_until_the_title_is_in_the_catalog():
    session = _session()
    await _store(session)
    assert session.all_of(DiscMediaLink) == []


# ── Manifest files ──────────────────────────────────────────────────────────

async def test_manifests_in_the_ingest_root_are_imported(tmp_path):
    root = tmp_path / "ingest"
    folder = root / "Firefly (2002) [imdbid-tt0303461]"
    folder.mkdir(parents=True)
    (folder / "_rip_manifest.11111111.json").write_text(json.dumps(_payload()), encoding="utf-8")
    (folder / "_rip_manifest.deadbeef.json").write_text("{not json", encoding="utf-8")
    (folder / "notes.json").write_text("{}", encoding="utf-8")

    session = _session()
    summary = await rip_records.import_manifests(session, roots=[str(root)])

    assert summary["found"] == 2 and summary["imported"] == [JOB]
    assert len(summary["unreadable"]) == 1
    assert len(session.all_of(DiscRip)) == 1


# ── Queue: a re-rip to a path that was closed as ignored ────────────────────

def _watched(path: str) -> SimpleNamespace:
    now = time.time()
    path = os_path(path)
    return SimpleNamespace(file_path=path, file_name=os.path.basename(path), ingress_path=INGEST,
                           file_size=1024, detected_at=now, queued_at=now)


def test_ignored_path_stays_ignored_without_a_rip():
    service = IngressQueueService()
    item = service.add_from_watcher(_watched(EP1))
    item.status = QUEUE_IGNORED
    assert service.add_from_watcher(_watched(EP1)).status == QUEUE_IGNORED


def test_announced_rip_path_is_queued_even_if_the_old_row_was_ignored():
    service = IngressQueueService()
    item = service.add_from_watcher(_watched(EP1))
    item.status = QUEUE_IGNORED

    service.expect_rip_paths([EP1])
    again = service.add_from_watcher(_watched(EP1))

    assert again is item and again.status == QUEUE_PENDING
    assert service.rip_expected_paths == set()
    # The announcement is used once: ignoring it again sticks.
    again.status = QUEUE_IGNORED
    assert service.add_from_watcher(_watched(EP1)).status == QUEUE_IGNORED


def test_announced_rip_path_is_queued_after_a_restart():
    """Only the persisted index knows the path was ignored."""
    service = IngressQueueService()
    service.persisted_paths[os_path(EP1)] = ("row-1", QUEUE_IGNORED)
    assert service.add_from_watcher(_watched(EP1)) is None

    service.expect_rip_paths([EP1])
    item = service.add_from_watcher(_watched(EP1))
    assert item is not None and item.id == "row-1" and item.status == QUEUE_PENDING


def test_requeue_only_touches_ignored_or_untracked_files():
    service = IngressQueueService()
    reviewed = service.add_from_watcher(_watched(EP1))
    reviewed.status = QUEUE_NEEDS_REVIEW
    assert service.requeue_ripped_file(EP1) is None
    assert reviewed.status == QUEUE_NEEDS_REVIEW          # a file under review is left alone

    ignored = service.add_from_watcher(_watched(EP3))
    ignored.status = QUEUE_IGNORED
    assert service.requeue_ripped_file(EP3) is ignored and ignored.status == QUEUE_PENDING

    assert service.requeue_ripped_file(TRAILER).status == QUEUE_PENDING   # never seen before
    # A path in the rip record's forward-slash form finds the item the watcher made for it.
    assert len(service.items_by_id) == 3


def test_rip_paths_match_the_watchers_form_of_the_path():
    service = IngressQueueService()
    watched = service.add_from_watcher(_watched(EP1))            # OS form
    assert service.requeue_ripped_file(EP1) is None              # record form: same file, already pending
    assert list(service.items_by_id.values()) == [watched]


# ── API ─────────────────────────────────────────────────────────────────────

@pytest.fixture()
def app():
    from main import app as fastapi_app
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


def _client(app, session, *, authed=True, queue=None):
    from api.mobile_auth import require_any_auth
    from db.database import get_db

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    if authed:
        async def override_auth():
            return MagicMock()
        app.dependency_overrides[require_any_auth] = override_auth
    app.state.ingress_queue_service = queue
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_put_stores_the_rip_without_auth(app):
    session = _session()
    async with _client(app, session, authed=False) as ac:
        resp = await ac.put(f"/api/rips/{JOB}", json=_payload())
    assert resp.status_code == 200
    assert resp.json() == {"id": JOB, "status": "delivered", "created": True, "discFound": True,
                           "linkedFiles": 3, "expectedPaths": 0, "requeued": 0}
    assert session.commits == 1


async def test_put_rejects_a_mismatched_job_id(app):
    async with _client(app, _session()) as ac:
        resp = await ac.put("/api/rips/another-job", json=_payload())
    assert resp.status_code == 400


async def test_put_rejects_a_payload_without_status(app):
    payload = _payload()
    del payload["status"]
    async with _client(app, _session()) as ac:
        resp = await ac.put(f"/api/rips/{JOB}", json=payload)
    assert resp.status_code == 422


async def test_preregister_then_confirm_drives_the_queue(app, monkeypatch):
    session = _session()
    queue = IngressQueueService()
    old = queue.add_from_watcher(_watched(EP1))
    old.status = QUEUE_IGNORED                      # an earlier rip's file, long since organized

    async with _client(app, session, queue=queue) as ac:
        pre = await ac.put(f"/api/rips/{JOB}", json=_payload("delivering"))
        assert pre.json()["expectedPaths"] == 3
        assert queue.rip_expected_paths == {os_path(EP1), os_path(EP3), os_path(TRAILER)}

        # The watcher sees the re-ripped file: it is queued again.
        assert queue.add_from_watcher(_watched(EP1)).status == QUEUE_PENDING

        # The files are "on disk" now (os.path is shared, so this covers the queue's own checks too).
        monkeypatch.setattr("os.path.isfile", lambda path: True)
        monkeypatch.setattr("os.path.getsize", lambda path: 1024)
        confirm = await ac.put(f"/api/rips/{JOB}", json=_payload())
    # EP1 is already pending; the two files the watcher has not reported yet are queued.
    assert confirm.json()["requeued"] == 2
    assert queue.rip_expected_paths == set()


async def test_get_and_list_rips(app):
    session = _session()
    async with _client(app, session) as ac:
        await ac.put(f"/api/rips/{JOB}", json=_payload())
        one = (await ac.get(f"/api/rips/{JOB}")).json()
        by_print = (await ac.get("/api/rips", params={"fingerprint": "f" * 64})).json()
        by_disc = (await ac.get("/api/rips", params={"discId": "disc-1"})).json()
        other = (await ac.get("/api/rips", params={"fingerprint": "0" * 64})).json()
        missing = await ac.get("/api/rips/nope")

    assert one["volumeLabel"] == "FIREFLY_D1" and one["tmdbId"] == 1437
    assert [t["titleIndex"] for t in one["titles"]] == [0, 1, 2]
    assert one["titles"][0]["episodeEnd"] == 2 and len(one["scanTitles"]) == 4
    assert [r["id"] for r in by_print] == [JOB] == [r["id"] for r in by_disc]
    assert other == [] and missing.status_code == 404


async def test_reading_rips_needs_auth(app):
    async with _client(app, _session(), authed=False) as ac:
        assert (await ac.get("/api/rips")).status_code in (401, 403)
        assert (await ac.post("/api/rips/import-manifests")).status_code in (401, 403)
