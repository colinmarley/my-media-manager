"""
Tests for the ingress reset-to-encoded endpoints in backend/api/ingress_operations.py.

Regression coverage for a bug where both endpoints referenced an undefined
`assignment_ref` (leftover from a pre-Postgres Firestore implementation) and
would raise NameError if ever called, despite the web UI still exposing a
"Reset files back to encoded" button for them.
"""

import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport


def _make_queue_item(item_id="item-1", assignment_id="assign-1", status="completed"):
    item = SimpleNamespace(
        id=item_id,
        assignment_id=assignment_id,
        status=status,
        last_error=None,
        processed_at="2026-01-01T00:00:00",
    )
    item.to_dict = lambda: {"id": item.id, "assignment_id": item.assignment_id, "status": item.status}
    return item


def _make_assignment(operations=None, primary_file_id=None):
    assignment = MagicMock()
    assignment.operations = (
        operations
        if operations is not None
        else [{"source": "/ark/encoded/movie.mkv", "destination": "/ark/library/Movies/Movie (2020)/Movie.mkv"}]
    )
    assignment.primary_file_id = primary_file_id
    return assignment


def _make_db(*, assignment=None, media_file=None):
    """Mock AsyncSession whose .get() returns the right row for MediaAssignment/MediaFile."""
    session = AsyncMock()

    async def fake_get(model, _id):
        from db.models import MediaAssignment, MediaFile
        if model is MediaAssignment:
            return assignment
        if model is MediaFile:
            return media_file
        return None

    session.get = AsyncMock(side_effect=fake_get)
    session.commit = AsyncMock()
    return session


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _wire_app_state(app, *, queue_item=None, file_manager=None):
    queue_service = MagicMock()
    queue_service.lock = threading.RLock()
    queue_service.items_by_id = {queue_item.id: queue_item} if queue_item else {}
    queue_service._persist_queue_item = AsyncMock()
    app.state.ingress_queue_service = queue_service
    app.state.file_manager = file_manager or MagicMock()
    return queue_service


class TestResetSingleItemToEncoded:
    @pytest.mark.asyncio
    async def test_moves_files_back_and_updates_assignment_status(self, app, monkeypatch):
        from db.database import get_db

        queue_item = _make_queue_item()
        file_manager = MagicMock()
        _wire_app_state(app, queue_item=queue_item, file_manager=file_manager)

        assignment = _make_assignment()
        db = _make_db(assignment=assignment)

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            monkeypatch.setattr("os.path.exists", lambda path: True)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-to-encoded", json={"itemId": queue_item.id})
            assert resp.status_code == 200
            body = resp.json()
            assert body["success"] is True
            assert body["data"]["filesReset"] == 1
            file_manager.move_file.assert_called_once_with(
                "/ark/library/Movies/Movie (2020)/Movie.mkv",
                "/ark/encoded/movie.mkv",
                merge_contents=False,
            )
            assert assignment.organization_status == "pending"
            db.commit.assert_awaited()
            assert queue_item.status == "needs_review"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_also_resets_the_primary_media_file(self, app, monkeypatch):
        from db.database import get_db

        queue_item = _make_queue_item()
        file_manager = MagicMock()
        _wire_app_state(app, queue_item=queue_item, file_manager=file_manager)

        media_file = MagicMock()
        assignment = _make_assignment(primary_file_id="file-1")
        db = _make_db(assignment=assignment, media_file=media_file)

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            monkeypatch.setattr("os.path.exists", lambda path: True)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-to-encoded", json={"itemId": queue_item.id})
            assert resp.status_code == 200
            assert media_file.organization_status == "pending"
            assert media_file.target_path is None
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_404s_when_assignment_not_found(self, app):
        from db.database import get_db

        queue_item = _make_queue_item()
        _wire_app_state(app, queue_item=queue_item)

        db = _make_db(assignment=None)

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-to-encoded", json={"itemId": queue_item.id})
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_404s_when_queue_item_not_found(self, app):
        from db.database import get_db

        _wire_app_state(app)
        db = _make_db()

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-to-encoded", json={"itemId": "missing"})
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()


class TestResetCompletedItemsToEncoded:
    @pytest.mark.asyncio
    async def test_resets_all_completed_items(self, app, monkeypatch):
        from db.database import get_db

        queue_item = _make_queue_item(item_id="item-2", assignment_id="assign-2", status="completed")
        file_manager = MagicMock()
        _wire_app_state(app, queue_item=queue_item, file_manager=file_manager)

        assignment = _make_assignment()
        db = _make_db(assignment=assignment)

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            monkeypatch.setattr("os.path.exists", lambda path: True)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-completed-to-encoded")
            assert resp.status_code == 200
            body = resp.json()
            assert body["data"]["itemsReset"] == 1
            assert body["data"]["itemsAttempted"] == 1
            assert assignment.organization_status == "pending"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_no_completed_items_returns_zero_counts(self, app):
        from db.database import get_db

        _wire_app_state(app)
        db = _make_db()

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-completed-to-encoded")
            assert resp.status_code == 200
            assert resp.json()["data"]["itemsAttempted"] == 0
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_records_error_when_assignment_missing_but_keeps_going(self, app):
        from db.database import get_db

        queue_item = _make_queue_item(item_id="item-3", assignment_id="missing-assign", status="completed")
        _wire_app_state(app, queue_item=queue_item)

        db = _make_db(assignment=None)

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ingress/queue/reset-completed-to-encoded")
            assert resp.status_code == 200
            body = resp.json()
            assert body["success"] is False
            assert body["data"]["itemsReset"] == 0
            assert "missing-assign" in body["data"]["errors"][0]
        finally:
            app.dependency_overrides.clear()
