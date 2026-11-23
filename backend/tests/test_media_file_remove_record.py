"""DELETE /api/catalog/media-files/{id}: forgetting the record of a file that is gone from disk."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import MediaFile
from services import attention_service, library_inventory_service
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
URL = "/api/catalog/media-files/{}"


@pytest.fixture()
def app():
    from main import app as fastapi_app
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()
    attention_service.invalidate_summary()


@pytest.fixture(autouse=True)
def mounted(monkeypatch):
    monkeypatch.setattr(library_inventory_service, "default_mount_check", lambda: True)


def _client(app, session, *, authed=True):
    from db.database import get_db
    from api.mobile_auth import require_any_auth

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    if authed:
        async def override_auth():
            return MagicMock()
        app.dependency_overrides[require_any_auth] = override_auth
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _file(path, **fields):
    fields.setdefault("is_available", False)
    fields.setdefault("missing_since", T0)
    row = MediaFile(id="f1", file_path=str(path), file_name="A.mkv", location="library", **fields)
    row.created_at = T0
    return row


async def test_removes_the_record_of_a_missing_file(app, tmp_path):
    row = _file(tmp_path / "gone" / "A.mkv", disc_id="d1")
    session = FakeSession([row])
    attention_service.summary_cache._value, attention_service.summary_cache._sampled_at = {"x": 1}, 1e18
    async with _client(app, session) as ac:
        resp = await ac.delete(URL.format("f1"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": "f1", "fileName": "A.mkv", "filePath": str(tmp_path / "gone" / "A.mkv")}
    assert session.deleted == [row] and row not in session.objects
    assert session.commits == 1
    assert attention_service.summary_cache._value is None


async def test_refuses_a_file_the_library_lists_as_present(app, tmp_path):
    for available in (True, None):
        row = _file(tmp_path / "A.mkv", is_available=available, missing_since=None)
        session = FakeSession([row])
        async with _client(app, session) as ac:
            resp = await ac.delete(URL.format("f1"))
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "FILE_NOT_MISSING"
        assert session.deleted == [] and session.commits == 0


async def test_refuses_when_the_file_is_back_on_disk(app, tmp_path):
    path = tmp_path / "A.mkv"
    path.write_bytes(b"x")
    session = FakeSession([_file(path)])
    async with _client(app, session) as ac:
        resp = await ac.delete(URL.format("f1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "FILE_PRESENT"
    assert session.deleted == [] and path.exists()


async def test_refuses_when_the_library_share_is_not_mounted(app, tmp_path, monkeypatch):
    monkeypatch.setattr(library_inventory_service, "default_mount_check", lambda: False)
    session = FakeSession([_file(tmp_path / "A.mkv")])
    async with _client(app, session) as ac:
        resp = await ac.delete(URL.format("f1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "LIBRARY_NOT_MOUNTED"
    assert session.deleted == []


async def test_unknown_file_is_404_and_auth_is_required(app, tmp_path):
    session = FakeSession([_file(tmp_path / "A.mkv")])
    async with _client(app, session) as ac:
        assert (await ac.delete(URL.format("nope"))).status_code == 404
    app.dependency_overrides.clear()
    async with _client(app, session, authed=False) as ac:
        assert (await ac.delete(URL.format("f1"))).status_code in (401, 403)
    assert session.deleted == []
