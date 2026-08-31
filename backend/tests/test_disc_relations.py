"""
Tests for the disc-sets and disc-media-links endpoints added to
backend/api/catalog.py (backing mobile's boxed-set grouping and
multi-title-per-disc linking).
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


def _make_disc_set(id: str = "set1", title: str = "LOTR Extended Trilogy"):
    row = MagicMock()
    row.id = id
    row.title = title
    return row


def _make_disc(id: str = "disc1", title: str = "Test Disc"):
    row = MagicMock()
    row.id = id
    row.title = title
    row.raw_data = {"title": title}
    return row


def _make_link(disc_id: str = "disc1", media_type: str = "movie", media_id: str = "tt1"):
    row = MagicMock()
    row.disc_id = disc_id
    row.media_type = media_type
    row.media_id = media_id
    return row


def _make_db(*, single=None, rows=None):
    """Mock AsyncSession returning a single canned result for every
    execute() call. Tests that need distinct results per call (multi-query
    endpoints) set `db.execute.side_effect` directly instead."""
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = single
    result.scalars.return_value.all.return_value = rows if rows is not None else []
    result.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


# ===========================================================================
# GET/POST /api/catalog/disc-sets
# ===========================================================================


class TestDiscSets:
    @pytest.mark.asyncio
    async def test_search_disc_sets_returns_matches(self, app):
        from db.database import get_db

        db = _make_db(rows=[_make_disc_set()])

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/disc-sets", params={"title": "LOTR"})
            assert resp.status_code == 200
            assert resp.json() == [{"id": "set1", "title": "LOTR Extended Trilogy"}]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_disc_set_requires_auth(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/disc-sets", json={"title": "New Set"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_disc_set(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/disc-sets", json={"title": "New Set"})
            assert resp.status_code == 200
            assert resp.json()["title"] == "New Set"
            assert resp.json()["id"]
            db.add.assert_called_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_disc_set_rejects_blank_title(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/disc-sets", json={"title": "   "})
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_discs_in_set(self, app):
        from db.database import get_db

        db = _make_db(rows=[_make_disc(id="disc1"), _make_disc(id="disc2")])

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/disc-sets/set1/discs")
            assert resp.status_code == 200
            assert [d["id"] for d in resp.json()] == ["disc1", "disc2"]
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# GET/POST/DELETE /api/catalog/discs/{disc_id}/links
# ===========================================================================


class TestDiscLinks:
    @pytest.mark.asyncio
    async def test_list_disc_links_resolves_titles(self, app):
        from db.database import get_db

        links = [_make_link(media_type="movie", media_id="tt1"), _make_link(media_type="movie", media_id="tt2")]
        links_result = MagicMock()
        links_result.scalars.return_value.all.return_value = links
        titles_result = MagicMock()
        titles_result.all.return_value = [("tt1", "Dumb & Dumber"), ("tt2", "Dumb & Dumberer")]

        db = _make_db()
        db.execute.side_effect = [links_result, titles_result]

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs/disc1/links")
            assert resp.status_code == 200
            body = resp.json()
            assert body == [
                {"mediaType": "movie", "mediaId": "tt1", "title": "Dumb & Dumber"},
                {"mediaType": "movie", "mediaId": "tt2", "title": "Dumb & Dumberer"},
            ]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_disc_link_requires_auth(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs/disc1/links", json={"mediaType": "movie", "mediaId": "tt1"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_disc_link(self, app):
        from db.database import get_db

        db = _make_db()
        db.execute.side_effect = [
            MagicMock(scalar_one_or_none=lambda: "disc1"),  # disc existence check
            MagicMock(scalar_one_or_none=lambda: None),  # no existing link
        ]

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs/disc1/links", json={"mediaType": "movie", "mediaId": "tt1"})
            assert resp.status_code == 200
            assert resp.json() == {"discId": "disc1", "mediaType": "movie", "mediaId": "tt1"}
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_disc_link_is_idempotent(self, app):
        from db.database import get_db

        db = _make_db()
        db.execute.side_effect = [
            MagicMock(scalar_one_or_none=lambda: "disc1"),  # disc exists
            MagicMock(scalar_one_or_none=lambda: _make_link()),  # link already exists
        ]

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs/disc1/links", json={"mediaType": "movie", "mediaId": "tt1"})
            assert resp.status_code == 200
            db.add.assert_not_called()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_disc_link_rejects_invalid_media_type(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs/disc1/links", json={"mediaType": "episode", "mediaId": "x"})
            assert resp.status_code == 400
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_disc_link_404s_for_missing_disc(self, app):
        from db.database import get_db

        db = _make_db(single=None)

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs/missing/links", json={"mediaType": "movie", "mediaId": "tt1"})
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_remove_disc_link_requires_auth(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/catalog/discs/disc1/links/movie/tt1")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_remove_disc_link(self, app):
        from db.database import get_db

        db = _make_db()

        async def override_db():
            yield db

        _override_auth(app)
        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/catalog/discs/disc1/links/movie/tt1")
            assert resp.status_code == 200
            assert resp.json()["deleted"] is True
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()
