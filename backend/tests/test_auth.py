"""
Tests for backend/api/auth.py

Uses dependency injection mocking so no real database is required.
"""

import pytest
import bcrypt
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient, ASGITransport

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_session(rows=None):
    """Return a mock AsyncSession that yields the given rows from execute()."""
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


def _make_session_row(*, expired: bool = False) -> MagicMock:
    row = MagicMock()
    if expired:
        row.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    else:
        row.expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    return row


# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


# ===========================================================================
# POST /auth/login
# ===========================================================================


class TestLogin:
    @pytest.mark.asyncio
    async def test_login_success_sets_cookie(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_app_config(_hash("correct-passphrase")))

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/auth/login", json={"password": "correct-passphrase"})
            assert resp.status_code == 200
            assert resp.json()["authenticated"] is True
            assert "session_id" in resp.cookies
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
                resp = await ac.post("/api/auth/login", json={"password": "wrong"})
            assert resp.status_code == 401
            assert "session_id" not in resp.cookies
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_login_no_password_configured_returns_500(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)  # no row → no password configured

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/auth/login", json={"password": "anything"})
            assert resp.status_code == 500
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_login_calls_db_add_and_commit(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_app_config(_hash("secret")))

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                await ac.post("/api/auth/login", json={"password": "secret"})
            db.add.assert_called_once()
            db.commit.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# GET /auth/me
# ===========================================================================


class TestMe:
    @pytest.mark.asyncio
    async def test_me_with_valid_session(self, app):
        from db.database import get_db

        db = _make_db_session(rows=_make_session_row())

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/auth/me", cookies={"session_id": str(uuid.uuid4())})
            assert resp.status_code == 200
            assert resp.json()["authenticated"] is True
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_me_without_cookie_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/auth/me")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_me_with_unknown_session_returns_401(self, app):
        from db.database import get_db

        db = _make_db_session(rows=None)  # no session found

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/auth/me", cookies={"session_id": str(uuid.uuid4())})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# POST /auth/logout
# ===========================================================================


class TestLogout:
    @pytest.mark.asyncio
    async def test_logout_returns_unauthenticated(self, app):
        from db.database import get_db

        db = _make_db_session()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/auth/logout", cookies={"session_id": str(uuid.uuid4())})
            assert resp.status_code == 200
            assert resp.json() == {"authenticated": False}
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_logout_without_cookie_still_succeeds(self, app):
        from db.database import get_db

        db = _make_db_session()

        async def override():
            yield db

        app.dependency_overrides[get_db] = override
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/auth/logout")
            assert resp.status_code == 200
            assert resp.json() == {"authenticated": False}
        finally:
            app.dependency_overrides.clear()

