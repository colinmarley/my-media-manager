"""/api/attention/* (api/attention.py) over the in-memory session."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import AttentionDismissal, Disc, IngressQueueItem, MediaFile, Movie, Series
from services import attention_service
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
ROOT = "/ark/media/jellyfin"
INCEPTION = "Inception (2010) [imdbid-tt1375666]"


@pytest.fixture()
def app():
    from main import app as fastapi_app
    attention_service.invalidate_summary()
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


def lib_file(id_, rel, **fields):
    fields.setdefault("is_available", True)
    fields.setdefault("location", "library")
    fields.setdefault("probed_at", T0)
    row = MediaFile(id=id_, file_path=f"{ROOT}/{rel}", file_name=rel.rsplit("/", 1)[-1], relative_path=rel, **fields)
    row.created_at = T0
    return row


def _library():
    return FakeSession([
        Movie(id="m1", title="Inception", release_date="2010", imdb_id="tt1375666", raw_data={"title": "Inception"}),
        Movie(id="m2", title="Other", release_date="2001", imdb_id="tt0000002",
              raw_data={"title": "Other", "imdbId": "tt0000002"}),
        Series(id="s1", title="Show", raw_data={"title": "Show", "seasons": []}),
        lib_file("f1", f"Movies/{INCEPTION}/bad.mkv", role="main", movie_id="m1"),
        lib_file("f2", "Movies/Other (2001) [imdbid-tt0000002]/x.mkv", role="main", movie_id="m2", probed_at=None),
        lib_file("f3", "Movies/Loose/loose.mkv", role="main"),
        lib_file("f4", "Movies/Other (2001) [imdbid-tt0000002]/gone.mkv", role="extra", movie_id="m2",
                 is_available=False, missing_since=T0),
        IngressQueueItem(id="q1", file_path="/in/a.mkv", file_name="a.mkv", status="needs_review",
                         parsed_info={"review_reason": "ambiguous match"}, best_match={"title": "Alpha"},
                         queued_at=T0),
        Disc(id="d1", title="Unripped", raw_data={}, created_at=T0),
    ])


async def test_requires_auth(app):
    async with _client(app, FakeSession(), authed=False) as ac:
        for method, url in (("get", "/api/attention/summary"), ("get", "/api/attention/items"),
                            ("post", "/api/attention/dismiss"), ("delete", "/api/attention/dismiss/x")):
            resp = await getattr(ac, method)(url)
            assert resp.status_code == 401, url


async def test_summary_counts_and_total(app):
    async with _client(app, _library()) as ac:
        resp = await ac.get("/api/attention/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["counts"] == {
        "needs_assignment": 2,  # q1 + unlinked f3
        "needs_rename": 2,      # f1, f2
        "needs_review": 0,
        "missing_file": 1,
        "no_disc_link": 0,
        "unprobed": 1,
        "unripped_disc": 1,
    }
    assert body["total"] == 5
    assert body["generatedAt"]


async def test_items_filters_and_paging(app):
    session = _library()
    async with _client(app, session) as ac:
        everything = (await ac.get("/api/attention/items")).json()
        renames = (await ac.get("/api/attention/items", params={"kind": "needs_rename"})).json()
        two = (await ac.get("/api/attention/items", params={"kind": "needs_rename,missing_file"})).json()
        page = (await ac.get("/api/attention/items", params={"limit": 2, "offset": 1})).json()
        by_title = (await ac.get("/api/attention/items", params={"mediaType": "movie", "mediaId": "tt0000002"})).json()
        bad_kind = await ac.get("/api/attention/items", params={"kind": "nope"})
        half_filter = await ac.get("/api/attention/items", params={"mediaType": "movie"})
        missing_title = await ac.get("/api/attention/items", params={"mediaType": "movie", "mediaId": "zz"})

    assert everything["total"] == 7 and len(everything["items"]) == 7
    assert {i["kind"] for i in renames["items"]} == {"needs_rename"} and renames["total"] == 2
    assert two["total"] == 3
    assert page["total"] == 7 and [i["id"] for i in page["items"]] == [i["id"] for i in everything["items"][1:3]]
    assert {i["id"] for i in by_title["items"]} == {
        "needs_rename:media_file:f2", "missing_file:media_file:f4", "unprobed:media_file:f2",
    }
    assert bad_kind.status_code == 400 and half_filter.status_code == 400 and missing_title.status_code == 404

    item = next(i for i in everything["items"] if i["id"] == "needs_rename:media_file:f1")
    assert set(item) == set(attention_service.ITEM_KEYS)
    assert item["file"]["id"] == "f1" and item["file"]["filePath"] == f"{ROOT}/Movies/{INCEPTION}/bad.mkv"
    assert item["expected"] == f"Movies/{INCEPTION}/{INCEPTION}.mkv"
    queue = next(i for i in everything["items"] if i["subjectType"] == "queue_item")
    assert queue["file"] is None and queue["queueItemId"] == "q1"


async def test_dismiss_round_trip_invalidates_the_summary(app):
    session = _library()
    async with _client(app, session) as ac:
        before = (await ac.get("/api/attention/summary")).json()
        dismissed = await ac.post("/api/attention/dismiss", json={
            "kind": "needs_rename", "subjectType": "media_file", "subjectId": "f1", "days": None, "note": "later",
        })
        assert dismissed.status_code == 200, dismissed.text
        body = dismissed.json()
        after = (await ac.get("/api/attention/summary")).json()
        items = (await ac.get("/api/attention/items", params={"kind": "needs_rename"})).json()
        listed = (await ac.get("/api/attention/dismissals")).json()
        again = await ac.post("/api/attention/dismiss", json={
            "kind": "needs_rename", "subjectType": "media_file", "subjectId": "f1", "days": 3,
        })
        undone = await ac.delete(f"/api/attention/dismiss/{body['id']}")
        restored = (await ac.get("/api/attention/summary")).json()
        gone = await ac.delete(f"/api/attention/dismiss/{body['id']}")

    assert body["kind"] == "needs_rename" and body["subjectId"] == "f1" and body["note"] == "later"
    assert body["fingerprint"] == f"Movies/{INCEPTION}/bad.mkv" and body["dismissedUntil"] is None
    assert body["itemId"] == "needs_rename:media_file:f1"
    assert before["counts"]["needs_rename"] == 2 and after["counts"]["needs_rename"] == 1
    assert after["total"] == before["total"] - 1
    assert [i["subjectId"] for i in items["items"]] == ["f2"]
    assert [d["id"] for d in listed["dismissals"]] == [body["id"]]
    # Re-dismissing the same subject updates the one row.
    assert again.status_code == 200 and again.json()["id"] == body["id"] and again.json()["dismissedUntil"]
    assert len(session.all_of(AttentionDismissal)) == 0
    assert undone.status_code == 200 and restored["counts"]["needs_rename"] == 2
    assert gone.status_code == 404


async def test_dismiss_refusals(app):
    session = _library()
    session.objects[3].needs_review = True  # f1 flagged by a person
    async with _client(app, session) as ac:
        unknown = await ac.post("/api/attention/dismiss", json={"kind": "x", "subjectType": "media_file", "subjectId": "f1"})
        bad_subject = await ac.post("/api/attention/dismiss", json={"kind": "needs_rename", "subjectType": "x", "subjectId": "f1"})
        no_item = await ac.post("/api/attention/dismiss", json={"kind": "needs_rename", "subjectType": "media_file", "subjectId": "f3"})
        flagged = await ac.post("/api/attention/dismiss", json={"kind": "needs_review", "subjectType": "media_file", "subjectId": "f1"})
        bad_days = await ac.post("/api/attention/dismiss", json={"kind": "needs_rename", "subjectType": "media_file", "subjectId": "f1", "days": 0})
    assert unknown.status_code == 400 and bad_subject.status_code == 400
    assert no_item.status_code == 404 and flagged.status_code == 422 and bad_days.status_code == 422


async def test_summary_is_cached_until_invalidated(app):
    session = _library()
    async with _client(app, session) as ac:
        first = (await ac.get("/api/attention/summary")).json()
        session.add(lib_file("f9", "Movies/Loose/another.mkv", role="main"))
        cached = (await ac.get("/api/attention/summary")).json()
        attention_service.invalidate_summary()
        fresh = (await ac.get("/api/attention/summary")).json()
    assert cached == first
    assert fresh["counts"]["needs_assignment"] == first["counts"]["needs_assignment"] + 1
