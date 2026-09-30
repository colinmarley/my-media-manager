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


# ===========================================================================
# GET /api/metadata-search/upc
# ===========================================================================


class TestCleanProductTitle:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("The Matrix (Blu-ray + DVD + Digital) [Widescreen]", "The Matrix"),
            ("Inception [4K Ultra HD + Blu-ray]", "Inception"),
            ("Alien (1979) - DVD", "Alien (1979)"),
            ("(500) Days of Summer DVD", "(500) Days of Summer"),
            ("Jaws: 45th Anniversary Edition (Steelbook) (4K UHD)", "Jaws: 45th Anniversary Edition"),
            ("Heat", "Heat"),
            ("Goodfellas [DVD]  Feature Thriller Drama  Action  Crime", "Goodfellas"),
            ("Jaws (4K Ultra HD + Blu-ray) Steelbook", "Jaws"),
            ("The Matrix Blu-ray Steelbook", "The Matrix"),
        ],
    )
    def test_strips_packaging_noise(self, raw, expected):
        assert metadata_search.clean_product_title(raw) == expected


class TestParseUpcItem:
    def test_guesses_most_specific_format_and_edition(self):
        result = metadata_search.parse_upc_item(
            "012345678905",
            {
                "title": "Jaws (4K Ultra HD + Blu-ray) Steelbook",
                "brand": "Universal",
                "category": "Media > DVDs & Videos",
                "images": ["http://img"],
            },
        )
        assert result == {
            "found": True,
            "code": "012345678905",
            "rawTitle": "Jaws (4K Ultra HD + Blu-ray) Steelbook",
            "title": "Jaws",
            "format": "UHD_BLURAY",
            "edition": "Steelbook",
            "brand": "Universal",
            "category": "Media > DVDs & Videos",
            "looksLikeMedia": True,
            "imageUrl": "http://img",
        }

    def test_falls_back_to_description_for_format(self):
        result = metadata_search.parse_upc_item("1234567890", {"title": "Heat", "description": "Widescreen DVD"})
        assert result["format"] == "DVD"
        assert result["edition"] is None

    def test_flags_non_media_products(self):
        result = metadata_search.parse_upc_item(
            "000000000000", {"title": "ORGANIC BLUE CORN TORTILLA CHIPS", "category": "Food > Snack Foods"}
        )
        assert result["looksLikeMedia"] is False
        assert result["format"] is None


class TestLookupUpc:
    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        metadata_search._upc_cache.clear()
        yield
        metadata_search._upc_cache.clear()

    def _resp(self, status, body=None):
        resp = MagicMock()
        resp.status_code = status
        resp.json.return_value = body or {}
        resp.raise_for_status = MagicMock()
        return resp

    @pytest.mark.asyncio
    async def test_requires_auth(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/upc", params={"code": "012345678905"})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_rejects_non_numeric_code(self, app):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/upc", params={"code": "abc"})
            assert resp.status_code == 422
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_found_result_is_parsed_and_cached(self, app, monkeypatch):
        _override_auth(app)
        calls = []

        def fake_get(*a, **k):
            calls.append(k["params"]["upc"])
            return self._resp(200, {"items": [{"title": "Heat (Blu-ray)"}]})

        monkeypatch.setattr(metadata_search.requests, "get", fake_get)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                first = await ac.get("/api/metadata-search/upc", params={"code": "012345678905"})
                second = await ac.get("/api/metadata-search/upc", params={"code": "012345678905"})
            assert first.status_code == 200
            assert first.json()["title"] == "Heat"
            assert first.json()["format"] == "BLURAY"
            assert second.json() == first.json()
            assert calls == ["012345678905"]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_no_match_returns_found_false(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.requests, "get", lambda *a, **k: self._resp(200, {"items": []}))
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/upc", params={"code": "012345678905"})
            assert resp.json() == {"found": False, "code": "012345678905"}
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_invalid_upc_returns_found_false(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(
            metadata_search.requests,
            "get",
            lambda *a, **k: self._resp(400, {"code": "INVALID_UPC", "message": "Not a valid UPC code."}),
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/upc", params={"code": "025192042620"})
            assert resp.status_code == 200
            assert resp.json() == {"found": False, "code": "025192042620", "reason": "invalid"}
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_rate_limited_returns_503_and_is_not_cached(self, app, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(metadata_search.requests, "get", lambda *a, **k: self._resp(429))
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/metadata-search/upc", params={"code": "012345678905"})
            assert resp.status_code == 503
            assert "012345678905" not in metadata_search._upc_cache
        finally:
            app.dependency_overrides.clear()
