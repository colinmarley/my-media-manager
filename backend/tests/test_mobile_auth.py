"""
Tests for backend/api/mobile_auth.py

Uses dependency injection mocking so no real database is required.
"""

import pytest
import bcrypt
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_session(rows=None):
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


def _hash(plaintext: str) -> str:
    return bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()


def _make_app_config(value: str):
    cfg = MagicMock()
    cfg.value = value
    return cfg


def _make_token_row(*, expired: bool = False, revoked: bool = False, device_name: str | None = "Test Phone"):
    row = MagicMock()
    row.device_name = device_name
    row.expires_at = (
        datetime.now(timezone.utc) - timedelta(days=1)
        if expired
        else datetime.now(timezone.utc) + timedelta(days=180)
    )
    row.revoked_at = datetime.now(timezone.utc) if revoked else None
    return row


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


# ===========================================================================
# POST /api/mobile/login
# ===========================================================================


class TestMobileLogin:
    @pytest.mark.asyncio
    async def test_login_success_returns_token(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_app_config(_hash("correct-passphrase")))

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/mobile/login",
                    json={"password": "correct-passphrase", "deviceName": "OnePlus 13"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["token"]
            assert body["expiresAt"]
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_login_wrong_password_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_app_config(_hash("correct-passphrase")))

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/mobile/login", json={"password": "wrong"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_login_no_password_configured_returns_500(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/mobile/login", json={"password": "anything"})
            assert resp.status_code == 500
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# GET /api/mobile/me
# ===========================================================================


class TestMobileMe:
    @pytest.mark.asyncio
    async def test_me_with_valid_token(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_token_row())

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/mobile/me", headers={"Authorization": "Bearer sometoken"})
            assert resp.status_code == 200
            body = resp.json()
            assert body["authenticated"] is True
            assert body["deviceName"] == "Test Phone"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_me_without_header_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/mobile/me")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_me_with_expired_token_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)  # expired tokens are excluded by the query filter

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/mobile/me", headers={"Authorization": "Bearer expiredtoken"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_me_with_revoked_token_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)  # revoked tokens are excluded by the query filter

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/mobile/me", headers={"Authorization": "Bearer revokedtoken"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# POST /api/mobile/logout
# ===========================================================================


class TestMobileLogout:
    @pytest.mark.asyncio
    async def test_logout_revokes_token(self, app):
        from db.database import get_db

        token_row = _make_token_row()
        db = _make_db_session(rows=token_row)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/mobile/logout", headers={"Authorization": "Bearer sometoken"})
            assert resp.status_code == 200
            assert resp.json() == {"authenticated": False}
            assert token_row.revoked_at is not None
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_logout_without_header_still_succeeds(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/mobile/logout")
            assert resp.status_code == 200
            assert resp.json() == {"authenticated": False}
        finally:
            app.dependency_overrides.clear()
