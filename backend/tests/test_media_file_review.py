"""PATCH /api/catalog/media-files/{id}/review and the review keys of the file DTO."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from api.catalog import _media_file_to_dict
from db.models import Disc, MediaFile
from services import attention_service
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
URL = "/api/catalog/media-files/{}/review"


@pytest.fixture()
def app():
    from main import app as fastapi_app
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()
    attention_service.invalidate_summary()


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


def _file(**fields):
    row = MediaFile(id="f1", file_path="/ark/media/jellyfin/Movies/A/A.mkv", file_name="A.mkv",
                    location="library", is_available=True, **fields)
    row.created_at = T0
    return row


def test_dto_review_keys_default_off():
    dto = _media_file_to_dict(_file())
    assert dto["needsReview"] is False and dto["reviewNote"] is None and dto["reviewedAt"] is None
    flagged = _media_file_to_dict(_file(needs_review=True, review_note="n", reviewed_at=T0))
    assert flagged["needsReview"] is True and flagged["reviewNote"] == "n" and flagged["reviewedAt"] == T0.isoformat()


async def test_flag_and_clear(app):
    row = _file(disc_id="d1")
    session = FakeSession([row, Disc(id="d1", title="Disc", format="DVD")])
    attention_service.summary_cache._value, attention_service.summary_cache._sampled_at = {"x": 1}, 1e18
    async with _client(app, session) as ac:
        flagged = await ac.patch(URL.format("f1"), json={"needsReview": True, "note": "  wrong cut?  "})
        assert attention_service.summary_cache.is_stale()
        items = (await ac.get("/api/attention/items", params={"kind": "needs_review"})).json()
        kept_note = await ac.patch(URL.format("f1"), json={"needsReview": False})
    assert flagged.status_code == 200, flagged.text
    body = flagged.json()
    assert body["needsReview"] is True and body["reviewNote"] == "wrong cut?" and body["reviewedAt"] is None
    assert body["disc"] == {"id": "d1", "title": "Disc", "format": "DVD"}
    assert [i["id"] for i in items["items"]] == ["needs_review:media_file:f1"]
    assert items["items"][0]["dismissible"] is False
    cleared = kept_note.json()
    assert cleared["needsReview"] is False and cleared["reviewNote"] == "wrong cut?" and cleared["reviewedAt"]
    assert row.needs_review is False and session.commits >= 2


async def test_validation_not_found_and_auth(app):
    async with _client(app, FakeSession([_file()])) as ac:
        missing_body = await ac.patch(URL.format("f1"), json={})
        unknown = await ac.patch(URL.format("nope"), json={"needsReview": True})
    assert missing_body.status_code == 422 and unknown.status_code == 404
    app.dependency_overrides.clear()
    async with _client(app, FakeSession([_file()]), authed=False) as ac:
        assert (await ac.patch(URL.format("f1"), json={"needsReview": True})).status_code == 401
