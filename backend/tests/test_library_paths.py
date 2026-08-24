"""
Tests for backend/api/library_paths.py

Covers list, create, update, and delete endpoints for user-defined
library scan paths. Uses dependency injection mocking so no real
database is required.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_library_path(
    id: str = "path1",
    name: str = "Movies",
    root_path: str = "/media/movies",
    media_type: str = "movie",
    is_active: bool = True,
):
    row = MagicMock()
    row.id = id
    row.name = name
    row.root_path = root_path
    row.media_type = media_type
    row.is_active = is_active
    row.last_scanned = None
    row.created_at = None
    return row


def _make_db(*, single=None, rows=None):
    """Build a mock AsyncSession supporting both list and single-row queries."""
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = single
    result.scalars.return_value.all.return_value = rows if rows is not None else []
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


# ===========================================================================
# GET /api/library-paths
# ===========================================================================

class TestListLibraryPaths:
    @pytest.mark.asyncio
    async def test_list_paths_empty(self, app):
        from db.database import get_db

        db = _make_db(rows=[])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/library-paths")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_paths_returns_data(self, app):
        from db.database import get_db

        path = _make_library_path()
        db = _make_db(rows=[path])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/library-paths")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "path1"
            assert data[0]["name"] == "Movies"
            assert data[0]["rootPath"] == "/media/movies"
            assert data[0]["mediaType"] == "movie"
            assert data[0]["isActive"] is True
            assert data[0]["lastScanned"] is None
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# POST /api/library-paths
# ===========================================================================

class TestCreateLibraryPath:
    @pytest.mark.asyncio
    async def test_create_requires_auth(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/library-paths",
                    json={"name": "Movies", "rootPath": "/media/movies"},
                )
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_path_with_auth(self, app):
        from db.database import get_db
        from api.auth import require_session

        db = _make_db()

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/library-paths",
                    json={
                        "name": "TV Shows",
                        "rootPath": "/media/tv",
                        "mediaType": "series",
                        "isActive": True,
                    },
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["name"] == "TV Shows"
            assert body["rootPath"] == "/media/tv"
            assert body["mediaType"] == "series"
            assert body["isActive"] is True
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_path_uses_defaults_for_missing_fields(self, app):
        from db.database import get_db
        from api.auth import require_session

        db = _make_db()

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/library-paths", json={})
            assert resp.status_code == 200
            body = resp.json()
            # Handler defaults: name="Unnamed", media_type="mixed", is_active=True
            assert body["name"] == "Unnamed"
            assert body["mediaType"] == "mixed"
            assert body["isActive"] is True
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# PATCH /api/library-paths/{id}
# ===========================================================================

class TestUpdateLibraryPath:
    @pytest.mark.asyncio
    async def test_update_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=_make_library_path())

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.patch("/api/library-paths/path1", json={"name": "Updated"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_update_path_not_found(self, app):
        from db.database import get_db
        from api.auth import require_session

        db = _make_db(single=None)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.patch("/api/library-paths/missing", json={"name": "Updated"})
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_update_path_name(self, app):
        from db.database import get_db
        from api.auth import require_session

        path = _make_library_path(id="path1", name="Old Name")
        db = _make_db(single=path)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.patch("/api/library-paths/path1", json={"name": "New Name"})
            assert resp.status_code == 200
            # The handler mutates the mock row in-place; _row_to_dict reads row.name
            assert path.name == "New Name"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_update_path_active_status(self, app):
        from db.database import get_db
        from api.auth import require_session

        path = _make_library_path(id="path1", is_active=True)
        db = _make_db(single=path)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.patch("/api/library-paths/path1", json={"isActive": False})
            assert resp.status_code == 200
            assert path.is_active is False
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# DELETE /api/library-paths/{id}
# ===========================================================================

class TestDeleteLibraryPath:
    @pytest.mark.asyncio
    async def test_delete_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=_make_library_path())

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/library-paths/path1")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_path_not_found(self, app):
        from db.database import get_db
        from api.auth import require_session

        db = _make_db(single=None)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/library-paths/missing")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_path(self, app):
        from db.database import get_db
        from api.auth import require_session

        path = _make_library_path(id="path1")
        db = _make_db(single=path)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/library-paths/path1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] == "path1"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()
