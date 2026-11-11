"""The library reassign endpoints keep media_files rows on the moved files (best effort)."""

import os

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import MediaFile, Movie
from services import media_file_index, storage_paths
from tests.fake_db import FakeSession


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


@pytest.fixture()
def library(tmp_path):
    root = tmp_path / "lib"
    (root / "Movies").mkdir(parents=True)
    storage_paths.set_overrides({"jellyfinDestBase": os.path.realpath(root)})
    yield root
    storage_paths.clear_overrides()


def _client(app, session):
    from db.database import get_db

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _row_for(path):
    row = MediaFile(id="f1", file_name=os.path.basename(path), disc_id="disc-1")
    media_file_index.apply_path(row, os.path.realpath(path))
    return row


async def test_reassign_file_relocates_the_row_and_links_by_imdb(app, library):
    source = library / "Movies" / "Wrong (1999)" / "rip.mkv"
    source.parent.mkdir()
    source.write_bytes(b"x")
    row = _row_for(source)
    session = FakeSession([row, Movie(id="m1", title="Right", imdb_id="tt0000001", raw_data={}, jellyfin_info={})])
    try:
        async with _client(app, session) as ac:
            resp = await ac.post("/api/files/dest-folder/reassign-file", json={
                "filePath": str(source), "newTitle": "Right", "newYear": "2001", "newImdbId": "tt0000001",
                "mediaType": "movie", "fileCategory": "main_feature",
            })
        assert resp.status_code == 200, resp.text
    finally:
        app.dependency_overrides.clear()

    target = resp.json()["data"]["targetFile"]
    assert os.path.isfile(target)
    assert row.file_path == media_file_index.normalize_path(target)
    assert row.id == "f1" and row.disc_id == "disc-1"
    assert row.relative_path == "Movies/Right (2001) [imdbid-tt0000001]/Right (2001) [imdbid-tt0000001].mkv"
    assert row.role == "main" and row.movie_id == "m1"
    assert session.commits == 1


async def test_reassign_folder_relocates_every_row_in_the_tree(app, library):
    folder = library / "Movies" / "Old (1999)"
    (folder / "extras").mkdir(parents=True)
    (folder / "Old (1999).mkv").write_bytes(b"x")
    (folder / "extras" / "bonus.mkv").write_bytes(b"y")
    main = _row_for(folder / "Old (1999).mkv")
    extra = MediaFile(id="f2", file_name="bonus.mkv")
    media_file_index.apply_path(extra, os.path.realpath(folder / "extras" / "bonus.mkv"))
    session = FakeSession([main, extra])
    try:
        async with _client(app, session) as ac:
            resp = await ac.post("/api/files/dest-folder/reassign-folder", json={
                "currentFolderPath": str(folder), "newTitle": "New", "newYear": "2000",
                "newImdbId": "tt0000002", "mediaType": "movie",
            })
        assert resp.status_code == 200, resp.text
    finally:
        app.dependency_overrides.clear()

    new_folder = "Movies/New (2000) [imdbid-tt0000002]"
    assert main.relative_path == f"{new_folder}/New (2000) [imdbid-tt0000002].mkv"
    assert extra.relative_path == f"{new_folder}/extras/bonus.mkv" and extra.role == "extra"


async def test_a_database_failure_does_not_fail_the_move(app, library, monkeypatch):
    source = library / "Movies" / "Wrong (1999)" / "rip.mkv"
    source.parent.mkdir()
    source.write_bytes(b"x")

    async def broken(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(media_file_index, "relocate", broken)
    try:
        async with _client(app, FakeSession()) as ac:
            resp = await ac.post("/api/files/dest-folder/reassign-file", json={
                "filePath": str(source), "newTitle": "Right", "newYear": "2001", "newImdbId": "tt0000001",
                "mediaType": "movie", "fileCategory": "unknown",
            })
        assert resp.status_code == 200, resp.text
        assert resp.json()["success"] is True
        assert os.path.isfile(resp.json()["data"]["targetFile"])
    finally:
        app.dependency_overrides.clear()
