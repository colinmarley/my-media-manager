"""
Tests for backend/services/assignment_orchestrator.py

Covers the MediaFile upsert added to fix a real gap: no code path
previously wrote MediaFile rows, so media_assignments.primary_file_id
and everything downstream that references a media_file_id (Disc/Tape
linking, AssignmentExtraFile) had nothing to point at.
"""

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from db.models import MediaAssignment, MediaFile
from services.assignment_orchestrator import AssignmentOrchestrator


class _FakeResult:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar


class _FakeSession:
    def __init__(self, *, existing_media_file=None):
        self.added = []
        self.commit_calls = 0
        self._existing_media_file = existing_media_file
        self._get_results = {}

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, *_args, **_kwargs):
        return _FakeResult(self._existing_media_file)

    async def flush(self):
        for obj in self.added:
            if isinstance(obj, MediaFile) and not getattr(obj, "id", None):
                obj.id = "generated-media-file-id"

    async def commit(self):
        self.commit_calls += 1

    async def get(self, model, id_):
        if model is MediaAssignment:
            for obj in self.added:
                if isinstance(obj, MediaAssignment) and obj.id == id_:
                    return obj
            return None
        if model is MediaFile:
            for obj in self.added:
                if isinstance(obj, MediaFile) and obj.id == id_:
                    return obj
            return self._existing_media_file
        return None


class _FakeSessionFactory:
    def __init__(self, *, existing_media_file=None):
        self.session = _FakeSession(existing_media_file=existing_media_file)

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _queue_item(**overrides):
    base = {
        "id": "queue-item-1",
        "file_path": "/ingest/Inception (2010)/Inception (2010).mkv",
        "file_name": "Inception (2010).mkv",
        "file_size": 123456789,
        "confidence_score": 92,
        "best_match": {"title": "Inception", "year": 2010, "media_id": "tt1375666", "media_type": "movie"},
        "parsed_info": {"title": "Inception", "year": 2010, "media_type": "movie"},
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_auto_assign_creates_media_file_row():
    factory = _FakeSessionFactory()
    orchestrator = AssignmentOrchestrator(
        file_organization_service=None,
        auto_organize_enabled=False,
        db_session_factory=factory,
    )

    result = await orchestrator.auto_assign(_queue_item())

    assert result is not None
    media_files = [obj for obj in factory.session.added if isinstance(obj, MediaFile)]
    assert len(media_files) == 1
    assert media_files[0].file_path == "/ingest/Inception (2010)/Inception (2010).mkv"
    assert media_files[0].detected_media_type == "movie"
    assert media_files[0].confidence == 92


@pytest.mark.asyncio
async def test_auto_assign_sets_primary_file_id_on_assignment():
    factory = _FakeSessionFactory()
    orchestrator = AssignmentOrchestrator(
        file_organization_service=None,
        auto_organize_enabled=False,
        db_session_factory=factory,
    )

    await orchestrator.auto_assign(_queue_item())

    assignments = [obj for obj in factory.session.added if isinstance(obj, MediaAssignment)]
    media_files = [obj for obj in factory.session.added if isinstance(obj, MediaFile)]
    assert len(assignments) == 1
    assert assignments[0].primary_file_id == media_files[0].id


@pytest.mark.asyncio
async def test_auto_assign_upserts_existing_media_file_by_path():
    existing = MediaFile(id="existing-id", file_path="/ingest/Inception (2010)/Inception (2010).mkv")
    factory = _FakeSessionFactory(existing_media_file=existing)
    orchestrator = AssignmentOrchestrator(
        file_organization_service=None,
        auto_organize_enabled=False,
        db_session_factory=factory,
    )

    await orchestrator.auto_assign(_queue_item())

    # No new MediaFile should have been added — the existing row was updated in place.
    media_files = [obj for obj in factory.session.added if isinstance(obj, MediaFile)]
    assert media_files == []
    assert existing.detected_media_type == "movie"

    assignments = [obj for obj in factory.session.added if isinstance(obj, MediaAssignment)]
    assert assignments[0].primary_file_id == "existing-id"


@pytest.mark.asyncio
async def test_auto_assign_without_file_path_still_creates_assignment():
    factory = _FakeSessionFactory()
    orchestrator = AssignmentOrchestrator(
        file_organization_service=None,
        auto_organize_enabled=False,
        db_session_factory=factory,
    )

    result = await orchestrator.auto_assign(_queue_item(file_path=None))

    assert result is not None
    media_files = [obj for obj in factory.session.added if isinstance(obj, MediaFile)]
    assignments = [obj for obj in factory.session.added if isinstance(obj, MediaAssignment)]
    assert media_files == []
    assert assignments[0].primary_file_id is None


@pytest.mark.asyncio
async def test_auto_assign_updates_media_file_organization_status():
    factory = _FakeSessionFactory()
    fake_organizer = SimpleNamespace(
        organize_assignment=AsyncMock(return_value={
            "success": True,
            "targetPath": "/ark/media/jellyfin/Movies/Inception (2010)",
        })
    )
    orchestrator = AssignmentOrchestrator(
        file_organization_service=fake_organizer,
        auto_organize_enabled=True,
        db_session_factory=factory,
    )

    await orchestrator.auto_assign(_queue_item())

    media_files = [obj for obj in factory.session.added if isinstance(obj, MediaFile)]
    assert media_files[0].organization_status == "completed"
    assert media_files[0].target_path == "/ark/media/jellyfin/Movies/Inception (2010)"
    assert media_files[0].needs_organization is False


# ---------------------------------------------------------------------------
# After organize: the rows follow the files (media_file_index)
# ---------------------------------------------------------------------------

LIB = "/ark/media/jellyfin"


@pytest.fixture()
def _library_root():
    from services import storage_paths

    storage_paths.set_overrides({"jellyfinDestBase": LIB, "defaultIngressPaths": ["/ingest"]})
    yield
    storage_paths.clear_overrides()


def _organizer(result):
    return SimpleNamespace(organize_assignment=AsyncMock(return_value=result))


@pytest.mark.asyncio
async def test_organize_relocates_the_primary_row_to_the_real_destination(_library_root):
    from tests.fake_db import FakeSession

    session = FakeSession()
    folder = f"{LIB}/Movies/Inception (2010) [imdbid-tt1375666]"
    destination = f"{folder}/Inception (2010) [imdbid-tt1375666].mkv"
    orchestrator = AssignmentOrchestrator(
        file_organization_service=_organizer({
            "success": True,
            "targetPath": folder,
            "catalogId": "movie-row-1",
            "operations": [{
                "success": True, "op": "move",
                "source": "/ingest/Inception (2010)/Inception (2010).mkv",
                "destination": destination,
            }],
        }),
        auto_organize_enabled=True,
        db_session_factory=session,
    )

    result = await orchestrator.auto_assign(_queue_item())

    assert result["organized"] is True
    (row,) = session.all_of(MediaFile)
    assert row.file_path == destination
    assert row.target_path == folder  # the folder, as before
    assert row.relative_path == "Movies/Inception (2010) [imdbid-tt1375666]/Inception (2010) [imdbid-tt1375666].mkv"
    assert row.location == "library" and row.role == "main"
    assert row.movie_id == "movie-row-1" and row.series_id is None
    (assignment,) = session.all_of(MediaAssignment)
    assert assignment.primary_file_id == row.id


@pytest.mark.asyncio
async def test_organize_sets_series_link_and_episode_numbers_and_moves_extras(_library_root):
    from tests.fake_db import FakeSession

    extra = MediaFile(id="extra-1", file_path="/ingest/Show/extras/Bloopers.mkv", file_name="Bloopers.mkv")
    session = FakeSession([extra])
    season = f"{LIB}/TV Shows/Some Show (2002)/Season 01"
    orchestrator = AssignmentOrchestrator(
        file_organization_service=_organizer({
            "success": True,
            "targetPath": season,
            "catalogId": "series-row-1",
            "operations": [
                {"success": True, "source": "/ingest/Show/Some.Show.S01E03.mkv",
                 "destination": f"{season}/Some Show (2002) S01E03.mkv"},
                {"success": True, "source": "/ingest/Show/extras/Bloopers.mkv",
                 "destination": f"{LIB}/TV Shows/Some Show (2002)/extras/Bloopers.mkv"},
            ],
        }),
        auto_organize_enabled=True,
        db_session_factory=session,
    )
    item = _queue_item(
        file_path="/ingest/Show/Some.Show.S01E03.mkv",
        file_name="Some.Show.S01E03.mkv",
        best_match={"title": "Some Show", "year": 2002, "media_type": "episode", "season": 1, "episode": 3},
        parsed_info={"title": "Some Show", "season": 1, "episode": 3, "media_type": "episode"},
    )

    await orchestrator.auto_assign(item)

    rows = {row.id: row for row in session.all_of(MediaFile)}
    primary = next(row for row in rows.values() if row.id != "extra-1")
    assert primary.file_path == f"{season}/Some Show (2002) S01E03.mkv"
    assert (primary.role, primary.season_number, primary.episode_number) == ("episode", 1, 3)
    assert primary.series_id == "series-row-1" and primary.movie_id is None
    assert rows["extra-1"].file_path == f"{LIB}/TV Shows/Some Show (2002)/extras/Bloopers.mkv"
    assert rows["extra-1"].role == "extra" and rows["extra-1"].series_id == "series-row-1"


@pytest.mark.asyncio
async def test_failed_organize_leaves_the_row_at_its_source(_library_root):
    from tests.fake_db import FakeSession

    session = FakeSession()
    orchestrator = AssignmentOrchestrator(
        file_organization_service=_organizer({"success": False, "error": "disk full", "operations": [
            {"success": False, "source": "/ingest/Inception (2010)/Inception (2010).mkv", "error": "disk full"},
        ]}),
        auto_organize_enabled=True,
        db_session_factory=session,
    )

    await orchestrator.auto_assign(_queue_item())

    (row,) = session.all_of(MediaFile)
    assert row.file_path == "/ingest/Inception (2010)/Inception (2010).mkv"
    assert row.organization_status == "failed" and row.movie_id is None


@pytest.mark.asyncio
async def test_upsert_media_file_finds_the_organized_row_for_a_late_ingest_path(_library_root):
    from datetime import datetime, timezone
    from db.models import IngestOperation
    from tests.fake_db import FakeSession

    organized = MediaFile(id="organized", file_path=f"{LIB}/Movies/A/A.mkv", file_name="A.mkv", disc_id="disc-1")
    session = FakeSession([
        organized,
        IngestOperation(id="o1", op="move", src="/ingest/gone/A.mkv", dst=organized.file_path,
                        status="done", undone_at=None, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
    ])
    orchestrator = AssignmentOrchestrator(db_session_factory=session)

    row = await orchestrator._upsert_media_file(session, {"file_path": "/ingest/gone/A.mkv"}, "movie")

    assert row is organized and len(session.all_of(MediaFile)) == 1
