"""Library inventory reconcile scan, against real tmp_path trees and an in-memory session."""

import asyncio
import os
import time
from datetime import datetime, timezone

import pytest

from db.models import IngestOperation, MediaFile, Movie, Series
from services import media_file_index, storage_paths
from services.library_inventory_service import (
    InventoryScanRunning,
    LibraryInventoryService,
    build_title_index,
    detect_moves,
    diff_inventory,
    promote_sole_mains,
    should_abort_missing,
)
from services.library_path_parser import parse_library_relative
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
MOVIE = "A Movie (2000) [imdbid-tt0000001]"
SHOW = "A Show (2002)"
GOOD_PROBE = {
    "containerFormat": "Matroska",
    "overallBitrate": 9_000_000,
    "duration": 5_400_000,
    "videoMetadata": {"codec": "AVC", "width": 1920, "height": 1080, "resolutionCategory": "1080p"},
    "audioTracks": [{"codec": "DTS", "channels": 6}],
    "subtitleTracks": [],
}


class FakeExtractor:
    def __init__(self, result=None, error=None, delay=0.0):
        self.calls = []
        self.result = result if result is not None else GOOD_PROBE
        self.error = error
        self.delay = delay

    def extract_full_metadata(self, path):
        self.calls.append(path)
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture()
def library(tmp_path):
    root = tmp_path / "lib"
    for folder in ("Movies", "TV Shows", "Documentaries", "Live Performances"):
        (root / folder).mkdir(parents=True)
    (tmp_path / "ingest").mkdir()
    storage_paths.set_overrides({"jellyfinDestBase": str(root), "defaultIngressPaths": [str(tmp_path / "ingest")]})
    yield root
    storage_paths.clear_overrides()


def _write(root, rel, size=1000, mtime=1_700_000_000):
    path = root.joinpath(*rel.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    os.utime(path, (mtime, mtime))
    return media_file_index.normalize_path(str(path))


def _service(session, *, extractor=None, mounted=True, **kwargs):
    kwargs.setdefault("probe_batch", 50)
    kwargs.setdefault("probe_timeout_seconds", 5)
    kwargs.setdefault("missing_abort_ratio", 0.5)
    return LibraryInventoryService(
        session,
        extractor=extractor or FakeExtractor(),
        mount_check=lambda: mounted,
        clock=lambda: T0,
        **kwargs,
    )


def _rows(session):
    return {row.relative_path or row.file_path: row for row in session.all_of(MediaFile)}


def _scan(service):
    return asyncio.run(service.run_scan())


# ---------------------------------------------------------------------------
# Pure decisions
# ---------------------------------------------------------------------------

def test_diff_inventory_splits_paths():
    known = {"/a": (10, 100.0), "/b": (10, 100.0), "/c": (10, 100.0), "/d": (None, None)}
    seen = {"/a": (10, 101.0), "/b": (11, 100.0), "/d": (5, 50.0), "/e": (1, 1.0)}
    diff = diff_inventory(known, seen)
    assert diff == {"new": ["/e"], "changed": ["/b"], "unchanged": ["/a", "/d"], "vanished": ["/c"]}


def test_detect_moves_needs_size_and_name_or_mtime_and_uniqueness():
    vanished = {"/old/a.mkv": (10, 100.0), "/old/b.mkv": (20, 100.0), "/old/c.mkv": (30, 5.0), "/old/d.mkv": (30, 5.0)}
    new = {"/new/a.mkv": (10, 999.0), "/new/renamed.mkv": (20, 100.5), "/new/x.mkv": (30, 5.0)}
    # a: same name; b: same mtime; c/d: two candidates for one file -> ambiguous.
    assert detect_moves(vanished, new) == [("/old/a.mkv", "/new/a.mkv"), ("/old/b.mkv", "/new/renamed.mkv")]


def test_should_abort_missing():
    assert should_abort_missing(0, 0, 0.2) is False
    assert should_abort_missing(1, 10, 0.2) is False
    assert should_abort_missing(3, 10, 0.2) is True
    assert should_abort_missing(1, 0, 0.2) is True


def test_title_index_prefers_folder_then_imdb_and_refuses_ambiguity():
    index = build_title_index(
        [
            {"id": "m1", "imdb_id": "tt0000001", "folders": ["/old/root/Movies/A (2000)", None]},
            {"id": "m2", "imdb_id": "tt0000002", "folders": ["/x/Movies/Dup (1999)"]},
            {"id": "m3", "imdb_id": None, "folders": [None, "/y/Movies/Dup (1999)"]},
        ],
        [{"id": "s1", "imdb_id": "tt0000001", "folders": ["/x/TV Shows/Show"]}],
    )
    assert index.resolve("movies/a (2000)", None, "movie") == ("m1", "folder")
    assert index.resolve("movies/other", "tt0000001", "movie") == ("m1", "imdb")
    assert index.resolve("movies/other", "tt0000001", "series") == ("s1", "imdb")
    assert index.resolve("movies/dup (1999)", None, "movie") == (None, "ambiguous")
    assert index.resolve("movies/none", None, "movie") == (None, "none")


def test_promote_sole_mains():
    rels = ["Movies/A (2000)/rip.mkv", "Movies/B (2001)/x.mkv", "Movies/B (2001)/y.mkv"]
    placements = {rel: parse_library_relative(rel) for rel in rels}
    promote_sole_mains(placements)
    assert placements["Movies/A (2000)/rip.mkv"]["role"] == "main"
    assert placements["Movies/B (2001)/x.mkv"]["role"] == "other"


# ---------------------------------------------------------------------------
# Scans
# ---------------------------------------------------------------------------

def test_new_files_become_rows_with_placement_and_probe(library):
    main = _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv", size=1500)
    _write(library, f"Movies/{MOVIE}/featurettes/Making Of.mkv")
    _write(library, f"TV Shows/{SHOW}/Season 01/{SHOW} S01E02.mkv")
    _write(library, f"Movies/{MOVIE}/{MOVIE}.nfo")
    _write(library, f"Movies/{MOVIE}/disc.iso")
    session = FakeSession()
    extractor = FakeExtractor()

    status = _scan(_service(session, extractor=extractor))

    rows = _rows(session)
    assert set(rows) == {
        f"Movies/{MOVIE}/{MOVIE}.mkv",
        f"Movies/{MOVIE}/featurettes/Making Of.mkv",
        f"TV Shows/{SHOW}/Season 01/{SHOW} S01E02.mkv",
    }
    feature = rows[f"Movies/{MOVIE}/{MOVIE}.mkv"]
    assert feature.file_path == main and "\\" not in feature.file_path
    assert feature.role == "main" and feature.location == "library"
    assert feature.file_size == 1500 and feature.is_available is True
    assert feature.modified_date == datetime.fromtimestamp(1_700_000_000, tz=timezone.utc)
    assert feature.video_codec == "AVC" and feature.resolution_category == "1080p"
    assert feature.audio_codec == "DTS" and feature.audio_channels == 6 and feature.duration_ms == 5_400_000
    assert feature.probed_at == T0 and feature.probe_error is None
    assert rows[f"Movies/{MOVIE}/featurettes/Making Of.mkv"].role == "extra"
    episode = rows[f"TV Shows/{SHOW}/Season 01/{SHOW} S01E02.mkv"]
    assert (episode.role, episode.season_number, episode.episode_number) == ("episode", 1, 2)
    assert status["phase"] == "done" and status["counts"]["newFiles"] == 3
    assert status["counts"]["probed"] == 3 and len(extractor.calls) == 3


def test_title_mapping_by_folder_path_and_by_imdb_tag(library):
    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    _write(library, f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01.mkv")
    _write(library, "Movies/Tagged Only (2005) [imdbid-tt0000005]/Tagged Only (2005) [imdbid-tt0000005].mkv")
    session = FakeSession([
        # jellyfin_info points at an older library root; still the same title folder.
        Movie(id="m1", title="A Movie", jellyfin_info={"folderPath": f"/old/root/Movies/{MOVIE}"}, raw_data={}),
        # Only raw_data carries the folder; for a series it is the series root.
        Series(id="s1", title="A Show", jellyfin_info={}, raw_data={"folderPath": f"/ark/x/TV Shows/{SHOW}"}),
        Movie(id="m5", title="Tagged Only", imdb_id="tt0000005", jellyfin_info={}, raw_data={}),
    ])

    status = _scan(_service(session))

    rows = _rows(session)
    assert rows[f"Movies/{MOVIE}/{MOVIE}.mkv"].movie_id == "m1"
    assert rows[f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01.mkv"].series_id == "s1"
    tagged = rows["Movies/Tagged Only (2005) [imdbid-tt0000005]/Tagged Only (2005) [imdbid-tt0000005].mkv"]
    assert tagged.movie_id == "m5"
    assert status["counts"]["linked"] == 3
    assert len(session.all_of(Movie)) == 2 and len(session.all_of(Series)) == 1  # never creates catalog rows


def test_ambiguous_title_is_left_unlinked(library):
    _write(library, "Movies/Dup (1999)/Dup (1999).mkv")
    session = FakeSession([
        Movie(id="m1", title="Dup", jellyfin_info={"folderPath": "/a/Movies/Dup (1999)"}, raw_data={}),
        Movie(id="m2", title="Dup", jellyfin_info={}, raw_data={"folderPath": "/b/Movies/Dup (1999)"}),
    ])

    status = _scan(_service(session))

    assert _rows(session)["Movies/Dup (1999)/Dup (1999).mkv"].movie_id is None
    assert status["counts"]["ambiguous"] == 1


def test_changed_file_is_probed_again(library):
    path_rel = f"Movies/{MOVIE}/{MOVIE}.mkv"
    _write(library, path_rel, size=1000)
    session = FakeSession()
    extractor = FakeExtractor()
    _scan(_service(session, extractor=extractor))
    assert len(extractor.calls) == 1

    _scan(_service(session, extractor=extractor))
    assert len(extractor.calls) == 1  # unchanged: not probed again

    _write(library, path_rel, size=2000, mtime=1_700_000_500)
    status = _scan(_service(session, extractor=extractor))
    row = _rows(session)[path_rel]
    assert status["counts"]["changedFiles"] == 1
    assert row.file_size == 2000 and len(extractor.calls) == 2


def test_moved_file_keeps_its_row(library):
    old = _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv", size=4321)
    session = FakeSession()
    _scan(_service(session))
    row = session.all_of(MediaFile)[0]
    row.disc_id = "disc-1"
    original_id = row.id

    new_dir = library / "Movies" / "Renamed (2000)"
    os.rename(os.path.dirname(old), new_dir)
    status = _scan(_service(session))

    rows = session.all_of(MediaFile)
    assert len(rows) == 1 and rows[0].id == original_id and rows[0].disc_id == "disc-1"
    assert rows[0].relative_path == f"Movies/Renamed (2000)/{MOVIE}.mkv"
    assert rows[0].is_available is True
    assert status["counts"]["movedFiles"] == 1 and status["counts"]["markedMissing"] == 0


def test_vanished_file_is_marked_missing_and_reappears(library):
    keep = [_write(library, f"Movies/Keep {i} (2000)/Keep {i} (2000).mkv", size=100 + i) for i in range(4)]
    gone = _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv", size=999)
    session = FakeSession()
    _scan(_service(session))

    os.remove(gone)
    status = _scan(_service(session))
    row = _rows(session)[f"Movies/{MOVIE}/{MOVIE}.mkv"]
    assert row.is_available is False and row.missing_since == T0
    assert status["counts"]["markedMissing"] == 1
    assert all(_rows(session)[media_file_index.normalize_path(p).split("/lib/")[1]].is_available for p in keep)

    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv", size=999)
    status = _scan(_service(session))
    assert row.is_available is True and row.missing_since is None
    assert status["counts"]["reappeared"] == 1


def test_nothing_marked_missing_when_the_mount_is_down(library):
    gone = _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    session = FakeSession()
    _scan(_service(session))
    os.remove(gone)

    status = _scan(_service(session, mounted=False))

    assert session.all_of(MediaFile)[0].is_available is True
    assert status["counts"]["markedMissing"] == 0
    assert any("missing files not marked" in w for w in status["warnings"])


def test_nothing_marked_missing_when_too_many_vanish_at_once(library):
    paths = [_write(library, f"Movies/T{i} (2000)/T{i} (2000).mkv", size=10 + i) for i in range(5)]
    session = FakeSession()
    _scan(_service(session))
    for path in paths[:3]:
        os.remove(path)

    status = _scan(_service(session, missing_abort_ratio=0.5))

    assert all(row.is_available for row in session.all_of(MediaFile))
    assert status["counts"]["markedMissing"] == 0
    assert "vanished in one scan" in status["lastError"]


def test_probe_budget_spreads_probing_over_scans(library):
    for i in range(3):
        _write(library, f"Movies/T{i} (2000)/T{i} (2000).mkv", size=10 + i)
    session = FakeSession()
    extractor = FakeExtractor()

    status = _scan(_service(session, extractor=extractor, probe_batch=2))
    assert status["counts"]["probed"] == 2 and status["counts"]["probePending"] == 1

    status = _scan(_service(session, extractor=extractor, probe_batch=2))
    assert status["counts"]["probed"] == 1
    assert all(row.probed_at is not None for row in session.all_of(MediaFile))
    assert len(extractor.calls) == 3


def test_probe_error_is_recorded_and_not_retried(library):
    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    session = FakeSession()
    failing = FakeExtractor(error=RuntimeError("mediainfo exploded"))

    status = _scan(_service(session, extractor=failing))
    row = session.all_of(MediaFile)[0]
    assert "mediainfo exploded" in row.probe_error and row.probed_at == T0
    assert status["counts"]["probeErrors"] == 1

    _scan(_service(session, extractor=failing))
    assert len(failing.calls) == 1


def test_probe_timeout_is_recorded_and_not_retried(library):
    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    session = FakeSession()
    slow = FakeExtractor(delay=0.5)

    _scan(_service(session, extractor=slow, probe_timeout_seconds=0.05))
    row = session.all_of(MediaFile)[0]
    assert "timed out" in row.probe_error

    _scan(_service(session, extractor=slow, probe_timeout_seconds=0.05))
    assert len(slow.calls) == 1


def test_empty_probe_output_is_an_error(library):
    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    session = FakeSession()
    _scan(_service(session, extractor=FakeExtractor(result={"videoMetadata": None, "audioTracks": []})))
    assert session.all_of(MediaFile)[0].probe_error


def test_probing_is_skipped_while_the_queue_is_busy(library):
    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    session = FakeSession()
    extractor = FakeExtractor()

    status = _scan(_service(session, extractor=extractor, queue_busy=lambda: True))

    assert extractor.calls == [] and status["counts"]["probePending"] == 1
    assert session.all_of(MediaFile)[0].probed_at is None


def test_heal_relocates_rows_left_at_an_ingest_source(library, tmp_path):
    dst = _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv", size=77)
    src = media_file_index.normalize_path(str(tmp_path / "ingest" / "rip" / "movie.mkv"))
    stale = MediaFile(id="f1", file_path=src, file_name="movie.mkv", disc_id="disc-1", is_available=True)
    session = FakeSession([
        stale,
        IngestOperation(id="o1", op="move", src=src, dst=dst, status="done", undone_at=None, created_at=T0),
    ])

    status = _scan(_service(session))

    rows = session.all_of(MediaFile)
    assert len(rows) == 1 and rows[0].id == "f1" and rows[0].disc_id == "disc-1"
    assert rows[0].file_path == dst and rows[0].location == "library"
    assert status["counts"]["healed"] == 1 and status["counts"]["newFiles"] == 0


def test_heal_leaves_a_file_that_was_moved_back(library, tmp_path):
    dst = media_file_index.normalize_path(str(library / "Movies" / MOVIE / f"{MOVIE}.mkv"))
    src_path = tmp_path / "ingest" / "rip" / "movie.mkv"
    src_path.parent.mkdir(parents=True)
    src_path.write_bytes(b"x")
    src = media_file_index.normalize_path(str(src_path))
    session = FakeSession([
        MediaFile(id="f1", file_path=src, file_name="movie.mkv", is_available=True),
        IngestOperation(id="o1", op="move", src=src, dst=dst, status="done", undone_at=None, created_at=T0),
    ])

    status = _scan(_service(session))

    assert session.all_of(MediaFile)[0].file_path == src
    assert status["counts"]["healed"] == 0


def test_scan_is_single_flight(library):
    session = FakeSession()
    service = _service(session)
    service._running = True

    with pytest.raises(InventoryScanRunning):
        asyncio.run(service.run_scan())

    async def start_twice():
        service._running = False
        first = service.start_scan()
        second = service.start_scan()
        await service.wait()
        return first, second

    assert asyncio.run(start_twice()) == (True, False)
    assert service.status()["running"] is False and service.status()["phase"] == "done"


def test_scan_can_be_cancelled(library):
    for i in range(3):
        _write(library, f"Movies/T{i} (2000)/T{i} (2000).mkv", size=10 + i)
    session = FakeSession()

    class CancellingExtractor(FakeExtractor):
        def extract_full_metadata(self, path):
            service.cancel()
            return super().extract_full_metadata(path)

    extractor = CancellingExtractor()
    service = _service(session, extractor=extractor)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(service.run_scan())

    status = service.status()
    assert status["cancelled"] is True and status["phase"] == "cancelled" and status["running"] is False
    assert len(extractor.calls) == 1


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

async def test_inventory_api_starts_a_scan_reports_status_and_refuses_a_second(library):
    from unittest.mock import MagicMock

    from httpx import ASGITransport, AsyncClient

    from api.mobile_auth import require_any_auth
    from main import app

    _write(library, f"Movies/{MOVIE}/{MOVIE}.mkv")
    service = _service(FakeSession())
    previous = getattr(app.state, "library_inventory_service", None)
    app.state.library_inventory_service = service

    async def override_auth():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override_auth
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            started = await ac.post("/api/library/inventory/scan")
            again = await ac.post("/api/library/inventory/scan")
            await service.wait()
            status = await ac.get("/api/library/inventory/status")
    finally:
        app.dependency_overrides.clear()
        app.state.library_inventory_service = previous

    assert started.status_code == 200 and started.json()["data"]["running"] is True
    assert again.status_code == 409
    body = status.json()["data"]
    assert body["phase"] == "done" and body["running"] is False
    assert body["counts"]["newFiles"] == 1 and body["startedAt"] == T0.isoformat()


async def test_inventory_api_requires_auth():
    from httpx import ASGITransport, AsyncClient

    from db.database import get_db
    from main import app

    async def override_db():
        yield FakeSession()

    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/library/inventory/status")
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()
