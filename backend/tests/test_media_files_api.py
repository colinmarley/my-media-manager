"""GET /api/catalog/media/{type}/{id}/detail and /files (api/media_files.py)."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from api import media_files as media_files_api
from db.models import Disc, MediaFile, Movie, Series, Tape
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
ORIGINAL_KEYS = [
    "id", "fileName", "filePath", "fileSize", "detectedMediaType",
    "assignmentStatus", "targetPath", "organizationStatus", "createdAt",
]
INVENTORY_KEYS = [
    "relativePath", "role", "seasonNumber", "episodeNumber", "episodeEndNumber", "location",
    "container", "videoCodec", "resolutionCategory", "width", "height", "hdrFormat",
    "audioCodec", "audioChannels", "durationMs", "bitrate", "probedAt", "probeError",
    "isAvailable", "missingSince", "discId", "tapeId", "movieId", "seriesId", "disc", "tape",
    "needsReview", "reviewNote", "reviewedAt",
]


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


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


@pytest.fixture(autouse=True)
def _links(monkeypatch):
    calls = []

    async def fake_links(db, media_type, media_id):
        calls.append((media_type, media_id))
        return {"discs": [{"id": "disc-1", "title": "Disc One", "linkedFileCount": 1}], "tapes": []}

    monkeypatch.setattr(media_files_api.catalog_api, "discs_and_tapes_for_media", fake_links)
    return calls


def _movie(id_, title, *, imdb_id=None, raw=None):
    return Movie(id=id_, title=title, imdb_id=imdb_id, raw_data=raw or {"title": title}, jellyfin_info={})


def _file(id_, rel, **fields):
    fields.setdefault("is_available", True)
    row = MediaFile(
        id=id_,
        file_path=f"/ark/media/jellyfin/{rel}",
        file_name=rel.rsplit("/", 1)[-1],
        relative_path=rel,
        **fields,
    )
    row.created_at = T0
    return row


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("record, expected", [
    ({"mediaType": "series"}, "series"),
    ({"mediaType": "episode"}, "series"),
    ({"mediaSubType": "documentary"}, "documentary"),
    ({"subType": "home_video"}, "home_video"),
    ({"folderPath": "/ark/media/jellyfin/Documentaries/X (2000)"}, "documentary"),
    ({"folderPath": "/ark/_NeedsReview/X"}, "needs_review"),
    ({"jellyfinInfo": {"folderPath": "/ark/media/jellyfin/Live Performances/X"}}, "live_performance"),
    ({"jellyfinInfo": {"folderPath": "/ark/media/jellyfin/TV Shows/X"}}, "series"),
    ({"seasons": []}, "series"),
    ({}, "movie"),
])
def test_derive_media_type_matches_the_web_ui(record, expected):
    assert media_files_api.derive_media_type(record) == expected


def test_group_files():
    files = [
        {"fileName": "b.mkv", "role": "main"},
        {"fileName": "v.mkv", "role": "version"},
        {"fileName": "x.mkv", "role": "extra"},
        {"fileName": "o.mkv", "role": None},
        {"fileName": "e2.mkv", "role": "episode", "seasonNumber": 1, "episodeNumber": 2},
        {"fileName": "e1.mkv", "role": "episode", "seasonNumber": 1, "episodeNumber": 1},
        {"fileName": "s0.mkv", "role": "episode", "seasonNumber": 0, "episodeNumber": 1},
        {"fileName": "se.mkv", "role": "extra", "seasonNumber": 1},
        {"fileName": "abs.mkv", "role": "episode", "seasonNumber": None, "episodeNumber": 3},
    ]
    groups = media_files_api.group_files(files)
    assert [f["fileName"] for f in groups["main"]] == ["b.mkv"]
    assert [f["fileName"] for f in groups["versions"]] == ["v.mkv"]
    assert [f["fileName"] for f in groups["extras"]] == ["x.mkv"]
    assert [f["fileName"] for f in groups["other"]] == ["o.mkv"]
    assert [s["seasonNumber"] for s in groups["seasons"]] == [0, 1, None]
    season1 = groups["seasons"][1]
    assert [f["fileName"] for f in season1["episodes"]] == ["e1.mkv", "e2.mkv"]
    assert [f["fileName"] for f in season1["extras"]] == ["se.mkv"]


def test_summarize_files():
    summary = media_files_api.summarize_files([
        {"fileSize": 10, "isAvailable": True, "probedAt": "x"},
        {"fileSize": None, "isAvailable": False, "probedAt": None},
    ])
    assert summary == {"fileCount": 2, "totalSize": 10, "missingCount": 1, "unprobedCount": 1}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def test_detail_requires_auth(app):
    try:
        async with _client(app, FakeSession(), authed=False) as ac:
            resp = await ac.get("/api/catalog/media/movie/m1/detail")
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()


async def test_detail_by_primary_key_returns_record_links_files_and_summary(app, _links):
    movie = _movie("m1", "A Movie", imdb_id="tt0000001",
                   raw={"title": "A Movie", "imdbId": "tt0000001", "folderPath": "/ark/media/jellyfin/Movies/A"})
    disc = Disc(id="disc-1", title="Disc One", format="Blu-ray")
    main = _file("f1", "Movies/A/A.mkv", role="main", movie_id="m1", file_size=100, disc_id="disc-1",
                 video_codec="HEVC", width=3840, height=2160, resolution_category="4K", probed_at=T0)
    extra = _file("f2", "Movies/A/extras/b.mkv", role="extra", movie_id="m1", file_size=5, is_available=False,
                  missing_since=T0)
    # Not linked yet, but the legacy assignment names this title.
    legacy = MediaFile(id="f3", file_path="/ark/media/ingest/x.mkv", file_name="x.mkv",
                       assigned_to_type="movie", assigned_to_id="tt0000001")
    other_title = _file("f4", "Movies/B/B.mkv", role="main", movie_id="m2")
    session = FakeSession([movie, disc, main, extra, legacy, other_title, _movie("m2", "B")])
    try:
        async with _client(app, session) as ac:
            resp = await ac.get("/api/catalog/media/movie/m1/detail")
        assert resp.status_code == 200, resp.text
        body = resp.json()
    finally:
        app.dependency_overrides.clear()

    assert set(body) == {"record", "mediaType", "catalogType", "discs", "tapes", "files", "summary"}
    assert body["record"] == {"title": "A Movie", "imdbId": "tt0000001",
                              "folderPath": "/ark/media/jellyfin/Movies/A", "id": "m1"}
    assert body["mediaType"] == "movie" and body["catalogType"] == "movie"
    assert body["discs"][0]["id"] == "disc-1" and _links == [("movie", "m1")]
    files = body["files"]
    assert [f["id"] for f in files["main"]] == ["f1"]
    assert [f["id"] for f in files["extras"]] == ["f2"]
    assert [f["id"] for f in files["other"]] == ["f3"]
    first = files["main"][0]
    assert first["disc"] == {"id": "disc-1", "title": "Disc One", "format": "Blu-ray"}
    assert first["tape"] is None
    assert first["videoCodec"] == "HEVC" and first["resolutionCategory"] == "4K"
    assert first["probedAt"] == T0.isoformat()
    assert body["summary"] == {"fileCount": 3, "totalSize": 105, "missingCount": 1, "unprobedCount": 2}


async def test_detail_by_imdb_id(app):
    session = FakeSession([
        _movie("m1", "A Movie", raw={"title": "A Movie", "externalIds": {"imdbId": "tt0000009"}}),
    ])
    try:
        async with _client(app, session) as ac:
            resp = await ac.get("/api/catalog/media/movie/tt0000009/detail")
        assert resp.status_code == 200, resp.text
        assert resp.json()["record"]["id"] == "m1"
    finally:
        app.dependency_overrides.clear()


async def test_detail_resolves_derived_types(app, _links):
    doc = _movie("d1", "Planet", raw={"title": "Planet", "folderPath": "/ark/media/jellyfin/Documentaries/Planet"})
    # Same IMDb id on a plain movie: the route type decides which one is shown.
    plain = _movie("p1", "Alpha", imdb_id="tt5", raw={"title": "Alpha", "imdbId": "tt5"})
    doc.raw_data = {**doc.raw_data, "imdbId": "tt5"}
    show = Series(id="s1", title="Show", raw_data={"title": "Show", "seasons": []}, jellyfin_info={})
    ep = _file("e1", "TV Shows/Show/Season 01/Show S01E01.mkv", role="episode", season_number=1,
               episode_number=1, series_id="s1")
    session = FakeSession([doc, plain, show, ep])
    try:
        async with _client(app, session) as ac:
            documentary = await ac.get("/api/catalog/media/documentary/tt5/detail")
            movie = await ac.get("/api/catalog/media/movie/tt5/detail")
            series = await ac.get("/api/catalog/media/series/s1/files")
            bad = await ac.get("/api/catalog/media/podcast/x/detail")
            missing = await ac.get("/api/catalog/media/movie/nope/detail")
    finally:
        app.dependency_overrides.clear()

    assert documentary.json()["record"]["id"] == "d1" and documentary.json()["mediaType"] == "documentary"
    assert movie.json()["record"]["id"] == "p1"
    body = series.json()
    assert body["catalogType"] == "series" and body["mediaId"] == "s1"
    assert body["seasons"][0]["seasonNumber"] == 1 and body["seasons"][0]["episodes"][0]["id"] == "e1"
    assert body["summary"]["fileCount"] == 1
    assert bad.status_code == 400
    assert missing.status_code == 404


async def test_files_dto_is_a_superset_of_the_original_shape(app):
    tape = Tape(id="tape-1", title="Tape One", tape_type="vhs")
    row = _file("f1", "Movies/A/A.mkv", role="main", movie_id="m1", tape_id="tape-1", file_size=1)
    session = FakeSession([_movie("m1", "A"), tape, row])
    try:
        async with _client(app, session) as ac:
            resp = await ac.get("/api/catalog/media/movie/m1/files")
    finally:
        app.dependency_overrides.clear()

    dto = resp.json()["main"][0]
    assert list(dto)[:9] == ORIGINAL_KEYS
    assert set(dto) == set(ORIGINAL_KEYS) | set(INVENTORY_KEYS)
    assert dto["tape"] == {"id": "tape-1", "title": "Tape One", "format": "vhs"}
    assert isinstance(dto["fileSize"], int) and dto["createdAt"] == T0.isoformat()
