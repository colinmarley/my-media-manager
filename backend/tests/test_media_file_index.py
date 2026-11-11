"""media_file_index: the one writer of media_files.file_path."""

from datetime import datetime, timedelta, timezone

import pytest

from db.models import AssignmentExtraFile, IngestOperation, MediaAssignment, MediaFile
from services import media_file_index as index
from services import storage_paths
from tests.fake_db import FakeSession

LIB = "/ark/media/jellyfin"
INGEST = "/ark/media/ingest"
T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _roots(monkeypatch):
    storage_paths.set_overrides({"jellyfinDestBase": LIB, "defaultIngressPaths": [INGEST]})
    yield
    storage_paths.clear_overrides()


def _file(id_, path, **fields):
    row = MediaFile(id=id_, file_path=path, file_name=path.rsplit("/", 1)[-1], **fields)
    row.created_at = fields.get("created_at", T0)
    return row


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def test_path_fields_in_library():
    fields = index.path_fields(f"{LIB}/Movies/A (2000)/A (2000).mkv")
    assert fields == {
        "file_path": f"{LIB}/Movies/A (2000)/A (2000).mkv",
        "file_name": "A (2000).mkv",
        "file_extension": ".mkv",
        "folder_path": f"{LIB}/Movies/A (2000)",
        "relative_path": "Movies/A (2000)/A (2000).mkv",
        "location": "library",
    }


def test_path_fields_in_ingest_and_elsewhere():
    assert index.path_fields(f"{INGEST}/rip/x.mkv")["location"] == "ingest"
    assert index.path_fields(f"{INGEST}/rip/x.mkv")["relative_path"] is None
    assert index.path_fields("/tmp/x.mkv")["location"] == "other"


def test_backslashes_never_reach_stored_values():
    fields = index.path_fields("C:\\lib\\Movies\\A (2000)\\A.mkv", library_root="C:\\lib")
    assert "\\" not in fields["file_path"]
    assert fields["relative_path"] == "Movies/A (2000)/A.mkv"
    assert fields["location"] == "library"


def test_rebase_path():
    assert index.rebase_path("/a/b/c.mkv", "/a/b", "/x/y") == "/x/y/c.mkv"
    assert index.rebase_path("/a/b/s/c.mkv", "/a/b/", "/x") == "/x/s/c.mkv"
    assert index.rebase_path("/a/bc/c.mkv", "/a/b", "/x") is None


def test_choose_survivor_keeps_the_older_row():
    old, new = {"created_at": T0}, {"created_at": T0 + timedelta(days=1)}
    assert index.choose_survivor(moving=new, existing=old) == "existing"
    assert index.choose_survivor(moving=old, existing=new) == "moving"
    assert index.choose_survivor(moving={"created_at": None}, existing={"created_at": None}) == "moving"


def test_merged_values_keeps_survivor_links_and_fills_gaps():
    survivor = {"disc_id": "disc-1", "tape_id": None, "assignment_status": "unassigned", "probed_at": None}
    dropped = {"disc_id": "disc-2", "tape_id": "tape-9", "assignment_status": "assigned",
               "assigned_to_id": "tt1", "probed_at": T0, "video_codec": "HEVC"}
    updates = index.merged_values(survivor, dropped)
    assert "disc_id" not in updates
    assert updates["tape_id"] == "tape-9"
    assert updates["assignment_status"] == "assigned"
    assert updates["assigned_to_id"] == "tt1"
    assert updates["video_codec"] == "HEVC" and updates["probed_at"] == T0


def test_probe_values_maps_extractor_output():
    values = index.probe_values({
        "containerFormat": "Matroska",
        "overallBitrate": 12_000_000,
        "duration": 7_200_000.0,
        "videoMetadata": {"codec": "HEVC", "width": 3840, "height": 2160, "resolutionCategory": "4K",
                          "hdrFormat": "HDR10"},
        "audioTracks": [{"codec": "AC-3", "channels": 6}, {"codec": "TrueHD", "channels": "8", "isDefault": True}],
        "subtitleTracks": [{"format": "PGS"}],
    })
    assert values["container"] == "Matroska"
    assert values["video_codec"] == "HEVC"
    assert (values["width"], values["height"]) == (3840, 2160)
    assert values["resolution_category"] == "4K"
    assert values["hdr_format"] == "HDR10"
    assert (values["audio_codec"], values["audio_channels"]) == ("TrueHD", 8)  # the default track
    assert values["duration_ms"] == 7_200_000
    assert values["bitrate"] == 12_000_000
    assert len(values["audio_tracks"]) == 2 and values["subtitle_tracks"] == [{"format": "PGS"}]


def test_probe_values_rejects_empty_output():
    with pytest.raises(ValueError):
        index.probe_values({"videoMetadata": None, "audioTracks": [], "subtitleTracks": [], "containerFormat": None})


def test_apply_probe_records_error_on_empty_output():
    row = _file("f", f"{LIB}/Movies/A/A.mkv")
    assert index.apply_probe(row, {}, now=T0) is False
    assert row.probe_error and row.probed_at == T0


def test_mark_missing_and_available():
    row = _file("f", f"{LIB}/Movies/A/A.mkv", is_available=True)
    assert index.mark_missing(row, now=T0) is True
    assert row.is_available is False and row.missing_since == T0
    assert index.mark_missing(row, now=T0 + timedelta(days=1)) is False
    assert row.missing_since == T0  # first time it was seen missing
    assert index.mark_available(row) is True
    assert row.is_available is True and row.missing_since is None


def test_follow_chains_hops_and_stops_on_cycles():
    hops = index.next_hops([("/a", "/b"), ("/b", "/c"), ("/x", "/y"), ("/y", "/x")])
    assert index.follow("/a", hops) == "/c"
    assert index.follow("/x", hops) in ("/x", "/y")
    assert index.follow("/none", hops) == "/none"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

async def test_upsert_by_path_creates_with_path_fields():
    session = FakeSession()
    row = await index.upsert_by_path(session, f"{INGEST}/rip/movie.mkv", file_size=10)
    assert row.id and row.file_path == f"{INGEST}/rip/movie.mkv"
    assert row.location == "ingest" and row.file_size == 10 and row.is_available is True
    again = await index.upsert_by_path(session, f"{INGEST}/rip/movie.mkv")
    assert again is row and len(session.all_of(MediaFile)) == 1


async def test_relocate_moves_the_row_and_sets_placement():
    row = _file("f1", f"{INGEST}/rip/movie.mkv", disc_id="disc-1")
    session = FakeSession([row])
    dst = f"{LIB}/Movies/A (2000) [imdbid-tt0000001]/A (2000) [imdbid-tt0000001].mkv"

    moved = await index.relocate(session, row.file_path, dst)

    assert moved is row and row.id == "f1" and row.disc_id == "disc-1"
    assert row.file_path == dst
    assert row.relative_path == "Movies/A (2000) [imdbid-tt0000001]/A (2000) [imdbid-tt0000001].mkv"
    assert row.location == "library" and row.role == "main"
    assert row.folder_path == f"{LIB}/Movies/A (2000) [imdbid-tt0000001]"


async def test_relocate_without_a_row_is_a_no_op():
    session = FakeSession()
    assert await index.relocate(session, "/nowhere/a.mkv", f"{LIB}/Movies/A/A.mkv") is None
    assert session.all_of(MediaFile) == []


async def test_relocate_merges_into_the_older_row_and_keeps_its_id_and_disc():
    # The ripper's link-source created a row at the destination long ago...
    older = _file("old-id", f"{LIB}/Movies/A/A.mkv", disc_id="disc-1", created_at=T0)
    # ...and ingest made another for the same file at its source.
    newer = _file("new-id", f"{INGEST}/rip/A.mkv", assignment_status="assigned", assigned_to_id="tt1",
                  created_at=T0 + timedelta(days=3))
    assignment = MediaAssignment(id="a1", media_type="movie", media_id="m1", primary_file_id="new-id")
    extra = AssignmentExtraFile(id="x1", assignment_id="a1", media_file_id="new-id")
    session = FakeSession([older, newer, assignment, extra])

    survivor = await index.relocate(session, newer.file_path, older.file_path)

    assert survivor is older and survivor.id == "old-id"
    assert survivor.disc_id == "disc-1"
    assert survivor.assignment_status == "assigned" and survivor.assigned_to_id == "tt1"
    assert [r.id for r in session.all_of(MediaFile)] == ["old-id"]
    assert assignment.primary_file_id == "old-id"
    assert extra.media_file_id == "old-id"


async def test_relocate_merge_keeps_the_moving_row_when_it_is_older():
    moving = _file("old-id", f"{INGEST}/rip/A.mkv", tape_id="tape-1", created_at=T0)
    existing = _file("new-id", f"{LIB}/Movies/A/A.mkv", disc_id="disc-2", created_at=T0 + timedelta(days=1))
    assignment = MediaAssignment(id="a1", media_type="movie", media_id="m1", primary_file_id="new-id")
    session = FakeSession([moving, existing, assignment])

    survivor = await index.relocate(session, moving.file_path, existing.file_path)

    assert survivor is moving and survivor.file_path == f"{LIB}/Movies/A/A.mkv"
    assert survivor.tape_id == "tape-1" and survivor.disc_id == "disc-2"
    assert assignment.primary_file_id == "old-id"
    assert len(session.all_of(MediaFile)) == 1


async def test_relocate_tree_moves_every_row_under_the_folder():
    a = _file("a", f"{LIB}/Movies/Old (2000)/Old (2000).mkv")
    b = _file("b", f"{LIB}/Movies/Old (2000)/extras/b.mkv")
    sibling = _file("c", f"{LIB}/Movies/Old (2000) 2/x.mkv")
    session = FakeSession([a, b, sibling])

    moved = await index.relocate_tree(session, f"{LIB}/Movies/Old (2000)", f"{LIB}/Movies/New (2001)")

    assert moved == 2
    assert a.file_path == f"{LIB}/Movies/New (2001)/Old (2000).mkv"
    assert b.file_path == f"{LIB}/Movies/New (2001)/extras/b.mkv" and b.role == "extra"
    assert sibling.file_path == f"{LIB}/Movies/Old (2000) 2/x.mkv"


def _move(op_id, src, dst, *, status="done", undone_at=None, created_at=T0):
    return IngestOperation(id=op_id, op="move", src=src, dst=dst, status=status,
                           undone_at=undone_at, created_at=created_at)


async def test_resolve_current_returns_the_row_at_the_path():
    row = _file("f", f"{INGEST}/rip/a.mkv")
    session = FakeSession([row])
    assert await index.resolve_current(session, row.file_path, exists=lambda p: True) is row


async def test_resolve_current_follows_done_moves_to_the_organized_row():
    organized = _file("f", f"{LIB}/Movies/A/A.mkv")
    session = FakeSession([
        organized,
        _move("o1", f"{INGEST}/rip/a.mkv", f"{INGEST}/staging/a.mkv"),
        _move("o2", f"{INGEST}/staging/a.mkv", f"{LIB}/Movies/A/A.mkv", created_at=T0 + timedelta(seconds=1)),
    ])
    found = await index.resolve_current(session, f"{INGEST}/rip/a.mkv", exists=lambda p: False)
    assert found is organized


async def test_resolve_current_ignores_undone_and_failed_moves():
    organized = _file("f", f"{LIB}/Movies/A/A.mkv")
    session = FakeSession([
        organized,
        _move("o1", f"{INGEST}/rip/a.mkv", organized.file_path, undone_at=T0),
        _move("o2", f"{INGEST}/rip/b.mkv", organized.file_path, status="failed"),
    ])
    assert await index.resolve_current(session, f"{INGEST}/rip/a.mkv", exists=lambda p: False) is None
    assert await index.resolve_current(session, f"{INGEST}/rip/b.mkv", exists=lambda p: False) is None


async def test_resolve_current_does_not_follow_when_a_new_file_is_at_the_path():
    organized = _file("f", f"{LIB}/Movies/A/A.mkv")
    session = FakeSession([organized, _move("o1", f"{INGEST}/rip/a.mkv", organized.file_path)])
    assert await index.resolve_current(session, f"{INGEST}/rip/a.mkv", exists=lambda p: True) is None
