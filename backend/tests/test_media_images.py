"""
Tests for backend/api/media_images.py

Uses dependency injection mocking for the DB and a tmp_path-backed
media_archive_path so no real database or persistent disk state is needed.
"""

import os

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


def _make_row(id: str = "disc1", image_files=None):
    row = MagicMock()
    row.id = id
    row.raw_data = {"title": "Test Disc", "imageFiles": image_files or []}
    row.image_files = image_files or []
    return row


def _make_db_session(rows=None):
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    return session


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


@pytest.fixture()
def media_archive(tmp_path, monkeypatch):
    from config.settings import settings
    monkeypatch.setattr(settings, "media_archive_path", str(tmp_path))
    return tmp_path


# ===========================================================================
# GET /api/media-images/{media_type}/{media_id}
# ===========================================================================


class TestListMediaImages:
    @pytest.mark.asyncio
    async def test_unknown_media_type_returns_404(self, app, media_archive):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media-images/bogus/disc1")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_empty_dir_returns_empty_list(self, app, media_archive):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media-images/disc/disc1")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_lists_existing_images(self, app, media_archive):
        d = os.path.join(str(media_archive), "disc", "disc1")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "cover.jpg"), "wb") as f:
            f.write(b"fake-image-bytes")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media-images/disc/disc1")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["filename"] == "cover.jpg"
        assert body[0]["url"] == "/api/media-images/disc/disc1/cover.jpg/file"


# ===========================================================================
# POST /api/media-images/{media_type}/{media_id}
# ===========================================================================


class TestUploadMediaImage:
    @pytest.mark.asyncio
    async def test_upload_without_auth_returns_401(self, app, media_archive):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/api/media-images/disc/disc1",
                files={"file": ("cover.jpg", b"fake-bytes", "image/jpeg")},
            )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_upload_success_saves_file_and_updates_row(self, app, media_archive):
        from db.database import get_db
        from api.mobile_auth import require_any_auth

        row = _make_row()
        db = _make_db_session(rows=row)

        async def override_db():
            yield db

        async def override_auth():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_any_auth] = override_auth
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/media-images/disc/disc1",
                    files={"file": ("cover.jpg", b"fake-bytes", "image/jpeg")},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["filename"] == "cover.jpg"
            saved_path = os.path.join(str(media_archive), "disc", "disc1", "cover.jpg")
            assert os.path.isfile(saved_path)
            assert row.raw_data["imageFiles"][-1]["fileName"] == body["url"]
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upload_rejects_unsupported_extension(self, app, media_archive):
        from db.database import get_db
        from api.mobile_auth import require_any_auth

        row = _make_row()
        db = _make_db_session(rows=row)

        async def override_db():
            yield db

        async def override_auth():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_any_auth] = override_auth
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/media-images/disc/disc1",
                    files={"file": ("notes.txt", b"not an image", "text/plain")},
                )
            assert resp.status_code == 415
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_upload_avoids_filename_collision(self, app, media_archive):
        from db.database import get_db
        from api.mobile_auth import require_any_auth

        d = os.path.join(str(media_archive), "disc", "disc1")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "cover.jpg"), "wb") as f:
            f.write(b"existing-file")

        row = _make_row()
        db = _make_db_session(rows=row)

        async def override_db():
            yield db

        async def override_auth():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_any_auth] = override_auth
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/media-images/disc/disc1",
                    files={"file": ("cover.jpg", b"new-bytes", "image/jpeg")},
                )
            assert resp.status_code == 200
            assert resp.json()["filename"] != "cover.jpg"
            assert resp.json()["filename"].startswith("cover_")
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# GET /api/media-images/{media_type}/{media_id}/{filename}/file
# ===========================================================================


class TestGetMediaImage:
    @pytest.mark.asyncio
    async def test_get_missing_file_returns_404(self, app, media_archive):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media-images/disc/disc1/missing.jpg/file")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_existing_file_returns_bytes(self, app, media_archive):
        d = os.path.join(str(media_archive), "disc", "disc1")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "cover.jpg"), "wb") as f:
            f.write(b"fake-image-bytes")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/media-images/disc/disc1/cover.jpg/file")
        assert resp.status_code == 200
        assert resp.content == b"fake-image-bytes"


# ===========================================================================
# DELETE /api/media-images/{media_type}/{media_id}/{filename}
# ===========================================================================


class TestDeleteMediaImage:
    @pytest.mark.asyncio
    async def test_delete_without_auth_returns_401(self, app, media_archive):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.delete("/api/media-images/disc/disc1/cover.jpg")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_removes_file_and_updates_row(self, app, media_archive):
        from db.database import get_db
        from api.mobile_auth import require_any_auth

        d = os.path.join(str(media_archive), "disc", "disc1")
        os.makedirs(d, exist_ok=True)
        fpath = os.path.join(d, "cover.jpg")
        with open(fpath, "wb") as f:
            f.write(b"fake-image-bytes")

        url = "/api/media-images/disc/disc1/cover.jpg/file"
        row = _make_row(image_files=[{"fileName": url}])
        db = _make_db_session(rows=row)

        async def override_db():
            yield db

        async def override_auth():
            return MagicMock()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[require_any_auth] = override_auth
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/media-images/disc/disc1/cover.jpg")
            assert resp.status_code == 200
            assert resp.json() == {"deleted": "cover.jpg"}
            assert not os.path.isfile(fpath)
            assert row.raw_data["imageFiles"] == []
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_delete_missing_file_returns_404(self, app, media_archive):
        from api.mobile_auth import require_any_auth

        async def override_auth():
            return MagicMock()

        app.dependency_overrides[require_any_auth] = override_auth
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/media-images/disc/disc1/missing.jpg")
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()
