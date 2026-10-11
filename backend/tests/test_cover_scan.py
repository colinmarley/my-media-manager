"""
Tests for backend/api/cover_scan.py

LocalAI is never called for real: httpx.AsyncClient is replaced with a stub.
"""

import io
import json
from unittest.mock import MagicMock

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from api import cover_scan


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


def _jpeg_bytes(size=(3000, 2000)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, format="JPEG")
    return out.getvalue()


class _StubClient:
    """Stands in for httpx.AsyncClient; records the posted payload."""

    posted: dict | None = None
    posted_url: str | None = None
    posted_headers: dict | None = None
    content = "{}"
    raise_exc: Exception | None = None

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None):
        if _StubClient.raise_exc:
            raise _StubClient.raise_exc
        _StubClient.posted = json
        _StubClient.posted_url = url
        _StubClient.posted_headers = headers
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"choices": [{"message": {"role": "assistant", "content": _StubClient.content}}]}
        return resp


@pytest.fixture()
def stub_localai(monkeypatch):
    _StubClient.posted = None
    _StubClient.raise_exc = None
    _StubClient.content = "{}"
    monkeypatch.setattr(cover_scan.httpx, "AsyncClient", _StubClient)
    return _StubClient


class TestNormalizeScan:
    def test_coerces_format_aliases_year_and_strings(self):
        result = cover_scan.normalize_scan(
            {
                "isMediaPackaging": True,
                "visibleText": ["JURASSIC PARK", "Steven Spielberg", "© 1993 Universal"],
                "title": " Jurassic Park ",
                "year": "© 1993 Universal",
                "format": "Blu-ray",
                "edition": "null",
                "isSeries": False,
                "season": None,
                "otherTitles": ["Jurassic Park", "The Lost World", ""],
                "confidence": "HIGH",
            }
        )
        assert result == {
            "found": True,
            "verified": True,
            "title": "Jurassic Park",
            "year": "1993",
            "format": "BLURAY",
            "edition": None,
            "isSeries": False,
            "season": None,
            "otherTitles": ["The Lost World"],
            "confidence": "high",
        }

    def test_unknown_format_and_bad_values_become_none(self):
        result = cover_scan.normalize_scan({"title": None, "format": "Betamax", "season": "two", "confidence": "?"})
        assert result["found"] is False
        assert result["format"] is None
        assert result["season"] is None
        assert result["confidence"] == "low"

    def test_not_packaging_discards_title(self):
        result = cover_scan.normalize_scan({"isMediaPackaging": False, "title": "The Hulk", "confidence": "high"})
        assert result["found"] is False
        assert result["title"] is None

    def test_title_not_in_visible_text_is_unverified_and_low_confidence(self):
        result = cover_scan.normalize_scan(
            {"isMediaPackaging": True, "visibleText": ["Widescreen", "DVD"], "title": "The Hulk", "confidence": "high"}
        )
        assert result["found"] is True
        assert result["verified"] is False
        assert result["confidence"] == "low"

    def test_4k_maps_to_uhd(self):
        assert cover_scan.normalize_scan({"title": "Dune", "format": "4K UHD"})["format"] == "UHD_BLURAY"


class TestIsGrounded:
    @pytest.mark.parametrize(
        "title,visible,expected",
        [
            ("Awakenings", ["AWAKENINGS", "Robin Williams"], True),
            ("The Lord of the Rings: The Two Towers", ["THE LORD OF THE RINGS", "THE TWO TOWERS"], True),
            ("The Hulk", ["Widescreen", "DVD"], False),
            ("Heat", [], False),
        ],
    )
    def test_title_words_must_appear_in_read_text(self, title, visible, expected):
        assert cover_scan.is_grounded(title, visible) is expected


class TestParseModelJson:
    def test_extracts_json_wrapped_in_prose(self):
        assert cover_scan._parse_model_json('Sure! {"title": "Heat"} Hope that helps') == {"title": "Heat"}

    def test_garbage_returns_empty(self):
        assert cover_scan._parse_model_json("no json here") == {}


class TestScanCoverEndpoint:
    @pytest.mark.asyncio
    async def test_requires_auth(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/metadata-search/cover-scan", files={"file": ("c.jpg", _jpeg_bytes(), "image/jpeg")})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_sends_downscaled_image_and_returns_normalized_fields(self, app, stub_localai):
        _override_auth(app)
        stub_localai.content = json.dumps(
            {"isMediaPackaging": True, "visibleText": ["HEAT", "Pacino De Niro"], "title": "Heat", "year": "1995", "format": "DVD", "confidence": "medium"}
        )
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/metadata-search/cover-scan", files={"file": ("c.jpg", _jpeg_bytes(), "image/jpeg")})
            assert resp.status_code == 200
            assert resp.json()["title"] == "Heat"
            assert resp.json()["format"] == "DVD"

            sent = stub_localai.posted
            assert stub_localai.posted_url.endswith("/v1/chat/completions")
            assert sent["model"] == cover_scan.settings.localai_vision_model
            assert sent["response_format"] == {"type": "json_object"}
            import base64

            image_part = sent["messages"][1]["content"][1]
            assert image_part["type"] == "image_url"
            prefix = "data:image/jpeg;base64,"
            assert image_part["image_url"]["url"].startswith(prefix)
            image = Image.open(io.BytesIO(base64.b64decode(image_part["image_url"]["url"][len(prefix):])))
            assert max(image.size) == cover_scan._MAX_DIMENSION
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_sends_localai_api_key(self, app, stub_localai, monkeypatch):
        _override_auth(app)
        monkeypatch.setattr(cover_scan.settings, "localai_api_key", "k123")
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/metadata-search/cover-scan", files={"file": ("c.jpg", _jpeg_bytes(), "image/jpeg")})
            assert resp.status_code == 200
            assert stub_localai.posted_headers == {"Authorization": "Bearer k123"}
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_non_image_upload_is_400(self, app, stub_localai):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/metadata-search/cover-scan", files={"file": ("c.jpg", b"not an image", "image/jpeg")})
            assert resp.status_code == 400
            assert stub_localai.posted is None
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_unreachable_model_host_is_503(self, app, stub_localai):
        _override_auth(app)
        stub_localai.raise_exc = httpx.ConnectError("refused")
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/metadata-search/cover-scan", files={"file": ("c.jpg", _jpeg_bytes(), "image/jpeg")})
            assert resp.status_code == 503
        finally:
            app.dependency_overrides.clear()
