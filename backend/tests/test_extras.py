"""
Tests for backend/api/extras.py

Uses dependency injection mocking so no real database is required.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


def _make_extra(id: str = "extra1", category: str | None = None, confirmed: bool = False):
    extra = MagicMock()
    extra.id = id
    extra.assignment_id = "assignment1"
    extra.media_file_id = "file1"
    extra.category = category
    extra.source = "inferred" if category else None
    extra.confirmed = confirmed
    extra.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return extra


def _make_media_file(id: str = "file1", name: str = "trailer.mkv"):
    mf = MagicMock()
    mf.id = id
    mf.file_name = name
    mf.file_path = f"/ark/media/jellyfin/Movies/Inception (2010)/{name}"
    mf.file_size = 123456
    return mf


def _make_join_db(rows: list[tuple]):
    session = AsyncMock()
    result = MagicMock()
    result.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    return session


def _make_single_db(*, extra=None, media_file=None):
    """First execute() call returns the extra row, second returns the media file row."""
    session = AsyncMock()
    extra_result = MagicMock()
    extra_result.scalar_one_or_none.return_value = extra
    mf_result = MagicMock()
    mf_result.scalar_one_or_none.return_value = media_file
    session.execute = AsyncMock(side_effect=[extra_result, mf_result])
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


# ===========================================================================
# GET /api/media/extras/categories
# ===========================================================================

@pytest.mark.asyncio
async def test_list_categories_returns_taxonomy(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/media/extras/categories")
    assert resp.status_code == 200
    categories = resp.json()
    assert "trailer" in categories
    assert "deleted_scene" in categories
    assert "blooper" in categories


# ===========================================================================
# GET /api/media/extras/pending
# ===========================================================================

@pytest.mark.asyncio
async def test_list_pending_extras_empty(app):
    from db.database import get_db

    db = _make_join_db([])

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media/extras/pending")
        assert resp.status_code == 200
        assert resp.json() == []
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_pending_extras_returns_joined_rows(app):
    from db.database import get_db

    extra = _make_extra(category="trailer", confirmed=False)
    media_file = _make_media_file()
    db = _make_join_db([(extra, media_file)])

    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media/extras/pending")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "extra1"
        assert data[0]["category"] == "trailer"
        assert data[0]["confirmed"] is False
        assert data[0]["fileName"] == "trailer.mkv"
    finally:
        app.dependency_overrides.clear()


# ===========================================================================
# PATCH /api/media/extras/{id}
# ===========================================================================

@pytest.mark.asyncio
async def test_update_extra_requires_session(app):
    from db.database import get_db

    async def override():
        yield _make_single_db()

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.patch("/api/media/extras/extra1", json={"confirmed": True})
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_extra_not_found(app):
    from db.database import get_db
    from api.auth import require_session

    db = _make_single_db(extra=None)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_session] = lambda: MagicMock()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.patch("/api/media/extras/missing", json={"confirmed": True})
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_extra_rejects_unknown_category(app):
    from db.database import get_db
    from api.auth import require_session

    extra = _make_extra()
    db = _make_single_db(extra=extra)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_session] = lambda: MagicMock()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.patch("/api/media/extras/extra1", json={"category": "not_a_real_category"})
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_extra_rejects_confirm_without_category(app):
    from db.database import get_db
    from api.auth import require_session

    extra = _make_extra(category=None)
    db = _make_single_db(extra=extra)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_session] = lambda: MagicMock()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.patch("/api/media/extras/extra1", json={"confirmed": True})
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_update_extra_sets_category_and_confirms(app):
    from db.database import get_db
    from api.auth import require_session

    extra = _make_extra(category=None)
    media_file = _make_media_file()

    def refresh_side_effect(obj):
        return None

    db = _make_single_db(extra=extra, media_file=media_file)
    db.refresh = AsyncMock(side_effect=refresh_side_effect)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_session] = lambda: MagicMock()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.patch(
                "/api/media/extras/extra1",
                json={"category": "deleted_scene", "confirmed": True},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["category"] == "deleted_scene"
        assert data["confirmed"] is True
        assert extra.source == "manual"
    finally:
        app.dependency_overrides.clear()
