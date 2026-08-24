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
