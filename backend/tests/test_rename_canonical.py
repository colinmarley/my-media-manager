"""POST /api/catalog/media-files/{id}/rename-canonical on a tmp_path library."""

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import IngestOperation, MediaFile, Movie, Series
from services import attention_service, media_file_index, storage_paths
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
INCEPTION = "Inception (2010) [imdbid-tt1375666]"


@pytest.fixture()
def library(tmp_path):
    storage_paths.set_overrides({"jellyfinDestBase": str(tmp_path)})
    yield tmp_path
    storage_paths.clear_overrides()


@pytest.fixture()
def app():
    from main import app as fastapi_app
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


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


def _put(root, rel, content=b"x"):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _row(root, id_, rel, **fields):
    fields.setdefault("is_available", True)
    fields.setdefault("location", "library")
    path = media_file_index.normalize_path(os.path.join(str(root), rel))
    row = MediaFile(id=id_, file_path=path, file_name=rel.rsplit("/", 1)[-1], relative_path=rel, **fields)
    row.created_at = T0
    return row


def _movie():
    return Movie(id="m1", title="Inception", release_date="2010", imdb_id="tt1375666", raw_data={"title": "Inception"})


def _movie_setup(root):
    rel = "Movies/Inception (2010)/inception.mkv"
    _put(root, rel, b"video")
    _put(root, "Movies/Inception (2010)/inception.nfo", b"<nfo/>")
    _put(root, "Movies/Inception (2010)/inception.en.srt", b"1")
    _put(root, "Movies/Inception (2010)/inceptionx.srt", b"other")  # different stem: stays
    main = _row(root, "f1", rel, role="main", movie_id="m1")
    srt = _row(root, "s1", "Movies/Inception (2010)/inception.en.srt", role="other", movie_id="m1")
    return FakeSession([_movie(), main, srt]), main, srt


URL = "/api/catalog/media-files/{}/rename-canonical"


async def test_dry_run_reports_target_sidecars_and_folder(app, library):
    session, main, _ = _movie_setup(library)
    async with _client(app, session) as ac:
        resp = await ac.post(URL.format("f1"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    target_rel = f"Movies/Inception (2010)/{INCEPTION}.mkv"
    assert body["currentRelativePath"] == "Movies/Inception (2010)/inception.mkv"
    assert body["canonicalRelativePath"] == target_rel
    assert body["fullCanonicalRelativePath"] == f"Movies/{INCEPTION}/{INCEPTION}.mkv"
    assert body["canonicalPath"].endswith(target_rel) and body["currentPath"] == main.file_path
    assert body["changed"] is True and body["applied"] is False and body["conflict"] is None
    assert body["folderMismatch"] == {"current": "Inception (2010)", "expected": INCEPTION}
    assert "left as it is" in body["detail"]
    assert sorted(os.path.basename(s["to"]) for s in body["sidecars"]) == [f"{INCEPTION}.en.srt", f"{INCEPTION}.nfo"]
    assert body["file"]["id"] == "f1"
    assert (library / "Movies/Inception (2010)/inception.mkv").exists()  # nothing moved
    assert session.all_of(IngestOperation) == []


async def test_apply_moves_file_and_sidecars_records_operations_and_relocates_rows(app, library):
    session, main, srt = _movie_setup(library)
    attention_service.summary_cache._value, attention_service.summary_cache._sampled_at = {"x": 1}, 1e18
    async with _client(app, session) as ac:
        resp = await ac.post(URL.format("f1"), params={"dryRun": "false"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    folder = library / "Movies" / "Inception (2010)"
    assert body["applied"] is True and body["changed"] is True and body["sidecarErrors"] == []
    assert sorted(os.listdir(folder)) == sorted([
        f"{INCEPTION}.mkv", f"{INCEPTION}.nfo", f"{INCEPTION}.en.srt", "inceptionx.srt",
    ])
    assert (folder / f"{INCEPTION}.mkv").read_bytes() == b"video"
    assert not (library / "Movies" / INCEPTION).exists()  # no new title folder

    assert main.relative_path == f"Movies/Inception (2010)/{INCEPTION}.mkv"
    assert main.file_path.endswith(main.relative_path) and main.file_name == f"{INCEPTION}.mkv"
    assert main.role == "main" and main.movie_id == "m1" and main.id == "f1"
    assert srt.file_path.endswith(f"{INCEPTION}.en.srt")
    assert body["file"]["filePath"] == main.file_path

    ops = session.all_of(IngestOperation)
    assert len(ops) == 3 and {o.status for o in ops} == {"done"} and {o.op for o in ops} == {"move"}
    assert sorted(body["operations"]) == sorted(o.id for o in ops)
    assert all(o.dst == o.planned_dst for o in ops)
    assert attention_service.summary_cache.is_stale()

    # A late caller holding the old path follows the recorded move.
    found = await media_file_index.resolve_current(session, os.path.join(str(folder), "inception.mkv"))
    assert found is main


async def test_conflict_when_target_exists(app, library):
    session, _, _ = _movie_setup(library)
    _put(library, f"Movies/Inception (2010)/{INCEPTION}.mkv", b"already here")
    async with _client(app, session) as ac:
        dry = await ac.post(URL.format("f1"))
        applied = await ac.post(URL.format("f1"), params={"dryRun": "false"})
    assert dry.status_code == 200 and "already exists" in dry.json()["conflict"]
    assert applied.status_code == 409 and applied.json()["detail"]["code"] == "RENAME_CONFLICT"
    assert (library / "Movies/Inception (2010)/inception.mkv").exists()
    assert session.all_of(IngestOperation) == []


async def test_sidecar_conflict_blocks_the_rename(app, library):
    session, _, _ = _movie_setup(library)
    _put(library, f"Movies/Inception (2010)/{INCEPTION}.nfo", b"other nfo")
    async with _client(app, session) as ac:
        applied = await ac.post(URL.format("f1"), params={"dryRun": "false"})
    assert applied.status_code == 409 and "sidecar" in applied.json()["detail"]["message"]


async def test_already_canonical_is_unchanged(app, library):
    rel = f"Movies/{INCEPTION}/{INCEPTION}.mkv"
    _put(library, rel)
    session = FakeSession([_movie(), _row(library, "f1", rel, role="main", movie_id="m1")])
    async with _client(app, session) as ac:
        resp = await ac.post(URL.format("f1"), params={"dryRun": "false"})
    body = resp.json()
    assert resp.status_code == 200 and body["changed"] is False and body["applied"] is False
    assert body["folderMismatch"] is None and body["conflict"] is None


async def test_episode_moves_into_the_canonical_season_folder(app, library):
    show = "Show (2005) [imdbid-tt0000123]"
    rel = f"TV Shows/{show}/Season 1/show.s01e02.mkv"
    _put(library, rel)
    row = _row(library, "e1", rel, role="episode", series_id="s1", season_number=1, episode_number=2)
    session = FakeSession([
        Series(id="s1", title="Show", running_years=["2005"], imdb_id="tt0000123", raw_data={"title": "Show"}),
        row,
    ])
    async with _client(app, session) as ac:
        resp = await ac.post(URL.format("e1"), params={"dryRun": "false"})
    assert resp.status_code == 200, resp.text
    expected = f"TV Shows/{show}/Season 01/{show} S01E02.mkv"
    assert resp.json()["canonicalRelativePath"] == expected
    assert (library / expected).exists() and row.relative_path == expected
    assert row.season_number == 1 and row.episode_number == 2


@pytest.mark.parametrize("fields, status, code", [
    ({"location": "ingest", "role": "main", "movie_id": "m1"}, 422, "NOT_IN_LIBRARY"),
    ({"role": "main", "movie_id": "m1", "is_available": False}, 409, "FILE_MISSING"),
    ({"role": "main"}, 422, "NO_TITLE_LINK"),
    ({"role": "extra", "movie_id": "m1"}, 422, "ROLE_NOT_RENAMABLE"),
    ({"role": "main", "movie_id": "gone"}, 422, "TITLE_NOT_FOUND"),
])
async def test_refusals(app, library, fields, status, code):
    rel = "Movies/Inception (2010)/inception.mkv"
    _put(library, rel)
    session = FakeSession([_movie(), _row(library, "f1", rel, **fields)])
    async with _client(app, session) as ac:
        resp = await ac.post(URL.format("f1"))
    assert resp.status_code == status, resp.text
    assert resp.json()["detail"]["code"] == code


async def test_unknown_file_and_auth(app, library):
    async with _client(app, FakeSession()) as ac:
        assert (await ac.post(URL.format("nope"))).status_code == 404
    app.dependency_overrides.clear()
    async with _client(app, FakeSession(), authed=False) as ac:
        assert (await ac.post(URL.format("nope"))).status_code == 401
