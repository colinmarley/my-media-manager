"""Tests for backend/api/wishlist.py — DB session mocked, as in test_media_images."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _session(rows=None, rowcount=1):
    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows or []
    result.rowcount = rowcount
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    session.add = MagicMock()
    return session


def _wire(app, session, auth=True):
    from db.database import get_db
    from api.mobile_auth import require_any_auth

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    if auth:
        async def override_auth():
            return MagicMock()

        app.dependency_overrides[require_any_auth] = override_auth


class TestWishlist:
    @pytest.mark.asyncio
    async def test_add_requires_auth(self, app):
        _wire(app, _session(), auth=False)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/wishlist", json={"title": "Heat"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_stores_document_in_wishlist_collection(self, app):
        session = _session()
        _wire(app, session)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/wishlist", json={"title": "  Heat  ", "format": "BLURAY", "barcode": "085391163121"}
                )
            assert resp.status_code == 201
            body = resp.json()
            assert body["title"] == "Heat"
            assert body["format"] == "BLURAY"
            assert body["id"] and body["createdAt"]
            row = session.add.call_args[0][0]
            assert row.collection == "wishlist"
            assert row.data["barcode"] == "085391163121"
            assert "notes" not in row.data
            session.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_add_validates_title_and_barcode(self, app):
        _wire(app, _session())
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                blank = await ac.post("/api/wishlist", json={"title": "   "})
                bad_code = await ac.post("/api/wishlist", json={"title": "Heat", "barcode": "abc"})
            assert blank.status_code == 422
            assert bad_code.status_code == 422
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_returns_documents(self, app):
        row = MagicMock()
        row.id = "w1"
        row.data = {"title": "Heat"}
        _wire(app, _session(rows=[row]))
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/wishlist")
            assert resp.json() == [{"title": "Heat", "id": "w1"}]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_missing_is_404(self, app):
        _wire(app, _session(rowcount=0))
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/wishlist/nope")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()
