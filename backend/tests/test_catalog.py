"""
Tests for backend/api/catalog.py

Covers movies, series, and discs CRUD endpoints.
Uses dependency injection mocking so no real database is required.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_movie(id: str = "movie1", title: str = "Test Movie", imdb_id: str = "tt1234567"):
    row = MagicMock()
    row.id = id
    row.imdb_id = imdb_id
    row.raw_data = {"title": title, "imdbId": imdb_id}
    return row


def _make_series(id: str = "series1", title: str = "Test Series", imdb_id: str = "tt7777777"):
    row = MagicMock()
    row.id = id
    row.imdb_id = imdb_id
    row.raw_data = {"title": title, "imdbId": imdb_id}
    return row


def _make_disc(id: str = "disc1", title: str = "Test Disc", format: str = "Blu-ray"):
    row = MagicMock()
    row.id = id
    row.format = format
    row.raw_data = {"title": title, "format": format}
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
# Movies
# ===========================================================================

class TestMovies:
    @pytest.mark.asyncio
    async def test_list_movies_empty(self, app):
        from db.database import get_db

        db = _make_db(rows=[])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_movies_returns_data(self, app):
        from db.database import get_db

        movie = _make_movie()
        db = _make_db(rows=[movie])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "movie1"
            assert data[0]["title"] == "Test Movie"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_movie_found(self, app):
        from db.database import get_db

        movie = _make_movie()
        db = _make_db(single=movie)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies/movie1")
            assert resp.status_code == 200
            assert resp.json()["id"] == "movie1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_movie_not_found(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies/missing")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_lookup_movie_no_params_returns_400(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies/lookup")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_lookup_movie_by_imdb_id_found(self, app):
        from db.database import get_db

        movie = _make_movie()
        db = _make_db(single=movie)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies/lookup?imdbId=tt1234567")
            assert resp.status_code == 200
            assert resp.json()["id"] == "movie1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_lookup_movie_not_found_returns_null(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/movies/lookup?titleLower=nonexistent")
            assert resp.status_code == 200
            assert resp.json() is None
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_movie_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/catalog/movies/movie1", json={"title": "Movie"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_movie_creates_new(self, app):
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
                resp = await ac.put(
                    "/api/catalog/movies/new-movie-id",
                    json={"title": "New Movie"},
                )
            assert resp.status_code == 200
            assert resp.json()["id"] == "new-movie-id"
            assert resp.json()["title"] == "New Movie"
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_movie_updates_existing(self, app):
        from db.database import get_db
        from api.auth import require_session

        existing = _make_movie(id="movie1")
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
                    "/api/catalog/movies/movie1",
                    json={"title": "Updated Movie"},
                )
            assert resp.status_code == 200
            db.add.assert_not_called()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_movie(self, app):
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
                resp = await ac.delete("/api/catalog/movies/movie1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] == "movie1"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Series
# ===========================================================================

class TestSeries:
    @pytest.mark.asyncio
    async def test_list_series_empty(self, app):
        from db.database import get_db

        db = _make_db(rows=[])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_series_returns_data(self, app):
        from db.database import get_db

        series = _make_series()
        db = _make_db(rows=[series])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "series1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_series_found(self, app):
        from db.database import get_db

        series = _make_series()
        db = _make_db(single=series)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series/series1")
            assert resp.status_code == 200
            assert resp.json()["id"] == "series1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_series_not_found(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series/missing")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_lookup_series_no_params_returns_400(self, app):
        from db.database import get_db

        db = _make_db()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series/lookup")
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_lookup_series_by_imdb_id_found(self, app):
        from db.database import get_db

        series = _make_series()
        db = _make_db(single=series)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/series/lookup?imdbId=tt7777777")
            assert resp.status_code == 200
            assert resp.json()["id"] == "series1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_series_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/catalog/series/s1", json={"title": "Series"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_series_creates_new(self, app):
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
                resp = await ac.put(
                    "/api/catalog/series/new-series-id",
                    json={"title": "New Series"},
                )
            assert resp.status_code == 200
            assert resp.json()["id"] == "new-series-id"
            assert resp.json()["title"] == "New Series"
            db.add.assert_called_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_series(self, app):
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
                resp = await ac.delete("/api/catalog/series/series1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] == "series1"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# Discs
# ===========================================================================

class TestDiscs:
    @pytest.mark.asyncio
    async def test_list_discs_empty(self, app):
        from db.database import get_db

        db = _make_db(rows=[])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_discs_returns_data(self, app):
        from db.database import get_db

        disc = _make_disc()
        db = _make_db(rows=[disc])

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "disc1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_disc_found(self, app):
        from db.database import get_db

        disc = _make_disc()
        db = _make_db(single=disc)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs/disc1")
            assert resp.status_code == 200
            assert resp.json()["id"] == "disc1"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_disc_not_found(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs/missing")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_disc_requires_auth(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/catalog/discs/disc1", json={"title": "Disc"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upsert_disc_creates_new(self, app):
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
                resp = await ac.put(
                    "/api/catalog/discs/new-disc-id",
                    json={"title": "New Disc", "format": "4K UHD"},
                )
            assert resp.status_code == 200
            assert resp.json()["id"] == "new-disc-id"
            assert resp.json()["title"] == "New Disc"
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_disc(self, app):
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
                resp = await ac.delete("/api/catalog/discs/disc1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] == "disc1"
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()
