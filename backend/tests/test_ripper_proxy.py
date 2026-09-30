"""Tests for backend/api/ripper_proxy.py — the ripper itself is stubbed."""

from unittest.mock import MagicMock

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from api import ripper_proxy


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


def _job(id, status, created, disc=None, outputs=0):
    return {
        "id": id,
        "title": f"Title {id}",
        "year": 2007,
        "season": None,
        "media_type": "movie",
        "disc_type": "dvd",
        "status": status,
        "progress": 0.5,
        "error": None,
        "catalog_disc_id": disc,
        "output_paths": [f"/x/{i}.mkv" for i in range(outputs)],
        "created_at": created,
        "updated_at": created,
        "rip_dir": "/data/media/rips/secret",
    }


class _Stub:
    jobs: list = []
    fail = False

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        if _Stub.fail:
            raise httpx.ConnectError("refused")
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = _Stub.jobs
        return resp


@pytest.fixture()
def stub(monkeypatch):
    _Stub.fail = False
    _Stub.jobs = [
        _job("a", "done", "2026-06-01T10:00:00", disc="d1", outputs=2),
        _job("b", "ripping", "2026-06-03T10:00:00", disc="d2"),
        _job("c", "failed", "2026-06-02T10:00:00", disc="d1"),
    ]
    monkeypatch.setattr(ripper_proxy.httpx, "AsyncClient", _Stub)
    return _Stub


class TestRipperJobs:
    @pytest.mark.asyncio
    async def test_requires_auth(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ripper/jobs")
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_newest_first_summarized_with_active_count(self, app, stub):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ripper/jobs")
            body = resp.json()
            assert [j["id"] for j in body["jobs"]] == ["b", "c", "a"]
            assert body["activeCount"] == 1
            assert body["jobs"][0]["active"] is True
            assert body["jobs"][2]["fileCount"] == 2
            assert "rip_dir" not in body["jobs"][0]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_filters_by_catalog_disc_and_limits(self, app, stub):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ripper/jobs", params={"catalogDiscId": "d1", "limit": 1})
            assert [j["id"] for j in resp.json()["jobs"]] == ["c"]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_unreachable_ripper_is_503(self, app, stub):
        _override_auth(app)
        stub.fail = True
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ripper/jobs")
            assert resp.status_code == 503
        finally:
            app.dependency_overrides.clear()
