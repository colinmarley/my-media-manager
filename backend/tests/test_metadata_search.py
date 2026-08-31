"""
Tests for backend/api/metadata_search.py

Uses dependency injection mocking and monkeypatched requests.get so no
real network calls or database are required.
"""

import pytest
from unittest.mock import MagicMock

from httpx import AsyncClient, ASGITransport

from api import metadata_search


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


def _fake_response(json_body, ok=True):
    resp = MagicMock()
    resp.json.return_value = json_body
    resp.raise_for_status = MagicMock() if ok else MagicMock(side_effect=Exception("boom"))
    return resp


# ===========================================================================
# GET /api/metadata-search/omdb/search
# ===========================================================================


class TestSearchOmdb:
    @pytest.mark.asyncio
    async def test_search_without_auth_returns_401(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/omdb/search", params={"query": "Matrix"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_search_success_returns_results(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.settings, "omdb_api_key", "test-key")
        monkeypatch.setattr(
            metadata_search.requests,
            "get",
            lambda *a, **k: _fake_response(
                {
                    "Response": "True",
                    "Search": [
                        {"Title": "The Matrix", "Year": "1999", "imdbID": "tt0133093", "Type": "movie", "Poster": "N/A"}
                    ],
                }
            ),
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/search",
                    params={"query": "Matrix"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert len(body["results"]) == 1
            assert body["results"][0]["imdbID"] == "tt0133093"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_search_no_matches_returns_empty_list(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.settings, "omdb_api_key", "test-key")
        monkeypatch.setattr(
            metadata_search.requests,
            "get",
            lambda *a, **k: _fake_response({"Response": "False", "Error": "Movie not found!"}),
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/search",
                    params={"query": "zzzznonexistent"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 200
            assert resp.json() == {"results": []}
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_search_without_configured_key_returns_503(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.settings, "omdb_api_key", "")
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/search",
                    params={"query": "Matrix"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 503
        finally:
            app.dependency_overrides.clear()


# ===========================================================================
# GET /api/metadata-search/omdb/details
# ===========================================================================


class TestOmdbDetails:
    @pytest.mark.asyncio
    async def test_details_without_auth_returns_401(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/omdb/details", params={"imdbId": "tt0133093"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_details_success_returns_full_payload(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.settings, "omdb_api_key", "test-key")
        monkeypatch.setattr(
            metadata_search.requests,
            "get",
            lambda *a, **k: _fake_response(
                {"Response": "True", "Title": "The Matrix", "imdbID": "tt0133093", "Runtime": "136 min"}
            ),
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/details",
                    params={"imdbId": "tt0133093"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 200
            assert resp.json()["Runtime"] == "136 min"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_details_not_found_returns_404(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.settings, "omdb_api_key", "test-key")
        monkeypatch.setattr(
            metadata_search.requests,
            "get",
            lambda *a, **k: _fake_response({"Response": "False", "Error": "Incorrect IMDb ID."}),
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/details",
                    params={"imdbId": "tt9999999"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_details_rejects_malformed_imdb_id(self, app):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/metadata-search/omdb/details",
                    params={"imdbId": "not-an-imdb-id"},
                    headers={"Authorization": "Bearer sometoken"},
                )
            assert resp.status_code == 422
        finally:
            app.dependency_overrides.clear()
