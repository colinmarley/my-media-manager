"""
Tests for backend/api/generic_data.py

Covers CRUD operations on arbitrary collections stored in the generic_data
table, and ensures blocked catalog collections are rejected.
Uses dependency injection mocking so no real database is required.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_generic_row(id: str = "doc1", collection: str = "actors", data: dict | None = None):
    row = MagicMock()
    row.id = id
    row.collection = collection
    row.data = data if data is not None else {"name": "Test Actor"}
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
# Blocked collections
# ===========================================================================

class TestBlockedCollections:
    @pytest.mark.asyncio
    async def test_list_movies_is_blocked(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/movies")
            assert resp.status_code == 400
            assert "catalog" in resp.json()["detail"].lower()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_series_is_blocked(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/series")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_discs_is_blocked(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/discs")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_document_from_blocked_collection(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/movies/some-id")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# List collection
# ===========================================================================

class TestListCollection:
    @pytest.mark.asyncio
    async def test_list_empty_collection(self, app):
        from db.database import get_db

        db = _make_db(rows=[])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/actors")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_collection_returns_documents(self, app):
        from db.database import get_db

        row = _make_generic_row(id="actor1", collection="actors", data={"name": "Jane Doe"})
        db = _make_db(rows=[row])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/actors")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "actor1"
            assert data[0]["name"] == "Jane Doe"
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Get single document
# ===========================================================================

class TestGetDocument:
    @pytest.mark.asyncio
    async def test_get_document_found(self, app):
        from db.database import get_db

        row = _make_generic_row(id="actor1", data={"name": "Jane Doe"})
        db = _make_db(single=row)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/actors/actor1")
            assert resp.status_code == 200
            assert resp.json()["id"] == "actor1"
            assert resp.json()["name"] == "Jane Doe"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_document_not_found(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/data/actors/missing")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Upsert document
# ===========================================================================

class TestUpsertDocument:
    @pytest.mark.asyncio
    async def test_upsert_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/data/actors/actor1", json={"name": "Jane"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_blocked_collection_returns_400(self, app):
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
                resp = await ac.put("/api/data/movies/movie1", json={"title": "Movie"})
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_creates_new_document(self, app):
        from db.database import get_db
        from api.auth import require_session

        db = _make_db(single=None)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        # Make refresh update the row's data
        created_row = _make_generic_row(id="new-actor", collection="actors", data={"name": "New Actor", "id": "new-actor"})
        db.refresh = AsyncMock(side_effect=lambda row: setattr(row, "data", {"name": "New Actor", "id": "new-actor"}) or None)

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/data/actors/new-actor",
                    json={"name": "New Actor"},
                )
            assert resp.status_code == 200
            assert resp.json()["id"] == "new-actor"
            assert resp.json()["name"] == "New Actor"
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_updates_existing_document(self, app):
        from db.database import get_db
        from api.auth import require_session

        existing = _make_generic_row(id="actor1", data={"name": "Old Name"})
        db = _make_db(single=existing)

        async def override_db():
            yield db

        async def override_session():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_session] = override_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/data/actors/actor1",
                    json={"name": "Updated Name"},
                )
            assert resp.status_code == 200
            db.add.assert_not_called()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Delete document
# ===========================================================================

class TestDeleteDocument:
    @pytest.mark.asyncio
    async def test_delete_requires_auth(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/data/actors/actor1")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_blocked_collection_returns_400(self, app):
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
                resp = await ac.delete("/api/data/movies/movie1")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_document(self, app):
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
                resp = await ac.delete("/api/data/actors/actor1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] == "actor1"
            assert resp.json()["collection"] == "actors"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()
