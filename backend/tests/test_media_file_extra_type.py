"""POST /api/catalog/media-files/{id}/extra-type: changing the type of an extra on a tmp_path library."""

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from db.models import AssignmentExtraFile, IngestOperation, MediaFile
from services import attention_service, extras_taxonomy, media_file_index, storage_paths
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
URL = "/api/catalog/media-files/{}/extra-type"
SEASON = "TV Shows/Burn Notice (2007)/Season 01"
SCENE = f"{SEASON}/Burn Notice (2007) 8-scene.mkv"


@pytest.fixture()
def library(tmp_path):
    storage_paths.set_overrides({"jellyfinDestBase": str(tmp_path)})
    yield tmp_path
    storage_paths.clear_overrides()


@pytest.fixture()
def app(monkeypatch):
    from main import app as fastapi_app
    from services.filesystem_manager import FileSystemManager

    # Another test may have left a stand-in file manager on app.state.
    monkeypatch.setattr(fastapi_app.state, "file_manager", FileSystemManager(), raising=False)
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


def _put(root, rel, content=b"x"):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _row(root, rel, id_="f1", **fields):
    fields.setdefault("is_available", True)
    fields.setdefault("location", "library")
    fields.setdefault("role", "extra")
    path = media_file_index.normalize_path(os.path.join(str(root), rel))
    row = MediaFile(id=id_, file_path=path, file_name=rel.rsplit("/", 1)[-1], relative_path=rel, **fields)
    row.created_at = T0
    return row


def _scene(root, **fields):
    """The 8th scene of Burn Notice season 1, with its nfo and a subtitle, linked to a disc."""
    _put(root, SCENE, b"video")
    _put(root, SCENE.replace(".mkv", ".nfo"), b"<movie>\n  <title>Burn Notice 8-scene</title>\n</movie>\n")
    _put(root, SCENE.replace(".mkv", ".en.srt"), b"1")
    _put(root, f"{SEASON}/Burn Notice (2007) 80-scene.nfo", b"other file")  # different stem: stays
    fields.setdefault("disc_id", "d1")
    fields.setdefault("series_id", "s1")
    fields.setdefault("season_number", 1)
    fields.setdefault("assignment_status", "assigned")
    return _row(root, SCENE, **fields)


async def _post(app, session, category, *, dry_run=None, file_id="f1"):
    params = {} if dry_run is None else {"dryRun": "true" if dry_run else "false"}
    async with _client(app, session) as ac:
        return await ac.post(URL.format(file_id), params=params, json={"category": category})


def _listing(root, rel=SEASON):
    return sorted(os.listdir(root / rel))


# -- the name rule ---------------------------------------------------------

def test_stems_split_into_base_counter_and_suffix():
    split = extras_taxonomy.split_suffixed_stem
    assert split("Burn Notice (2007)-blooper") == {
        "base": "Burn Notice (2007)", "number": None, "suffix": "blooper", "category": "blooper"}
    assert split("The Whitest Kids U' Know (2007) 3-short") == {
        "base": "The Whitest Kids U' Know (2007)", "number": "3", "suffix": "short", "category": "short"}
    assert split("Show (2001) 2-behindthescenes")["category"] == "behind_the_scenes"
    assert split("Show (2001)-deletedscene")["category"] == "deleted_scene"
    # A number that is part of a title without a year is not a counter.
    assert split("Apollo 13-trailer")["base"] == "Apollo 13"
    assert split("Burn Notice (2007)") is None and split("Making Of") is None


def test_every_category_has_a_suffix_the_library_parser_reads_back():
    assert set(extras_taxonomy.CATEGORY_TO_SUFFIX) == set(extras_taxonomy.CATEGORIES)
    for category in extras_taxonomy.CATEGORIES:
        # A blooper is filed under Jellyfin's "other" suffix, which reads back as other.
        expected = "other" if category == "blooper" else category
        assert extras_taxonomy.classify_extra_category_from_stem(
            extras_taxonomy.suffixed_stem("Show (2001)", category)) == expected
        assert extras_taxonomy.split_suffixed_stem(
            extras_taxonomy.suffixed_stem("Show (2001)", category, 4)) == {
                "base": "Show (2001)", "number": "4",
                "suffix": extras_taxonomy.CATEGORY_TO_SUFFIX[category], "category": expected}


# -- the endpoint ----------------------------------------------------------

async def test_renames_the_file_moves_its_sidecars_and_keeps_the_record(app, library):
    row = _scene(library)
    extra = AssignmentExtraFile(id="x1", assignment_id="a1", media_file_id="f1", category="scene", source="inferred")
    session = FakeSession([row, extra])
    attention_service.summary_cache._value, attention_service.summary_cache._sampled_at = {"x": 1}, 1e18

    resp = await _post(app, session, "featurette", dry_run=False)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    new_name = "Burn Notice (2007)-featurette.mkv"
    assert _listing(library) == sorted([
        new_name, "Burn Notice (2007)-featurette.nfo", "Burn Notice (2007)-featurette.en.srt",
        "Burn Notice (2007) 80-scene.nfo",
    ])
    assert (library / SEASON / new_name).read_bytes() == b"video"
    assert (library / SEASON / "Burn Notice (2007)-featurette.nfo").read_bytes() == (
        b"<movie>\n  <title>Burn Notice-featurette</title>\n</movie>\n")

    assert body["applied"] is True and body["sidecarErrors"] == [] and body["nfoTitleUpdated"] is True
    assert body["currentName"] == "Burn Notice (2007) 8-scene.mkv" and body["newName"] == new_name
    assert body["currentCategory"] == "scene" and body["category"] == "featurette"
    assert body["currentRelativePath"] == SCENE and body["newRelativePath"] == f"{SEASON}/{new_name}"
    assert len(body["sidecars"]) == 2

    # Same record: id, disc link, title link and assignment survive; the path fields follow the file.
    assert row.id == "f1" and body["fileId"] == "f1" and body["file"]["id"] == "f1"
    assert row.disc_id == "d1" and row.series_id == "s1" and row.assignment_status == "assigned"
    assert row.file_name == new_name and row.relative_path == f"{SEASON}/{new_name}"
    assert row.file_path == body["newPath"] and row.file_path.endswith(row.relative_path)
    assert row.role == "extra" and row.season_number == 1
    assert body["file"]["fileName"] == new_name and body["file"]["discId"] == "d1"
    assert extra.category == "featurette" and extra.source == "manual"

    ops = session.all_of(IngestOperation)
    assert len(ops) == 3 and {o.status for o in ops} == {"done"} and {o.op for o in ops} == {"move"}
    assert sorted(body["operations"]) == sorted(o.id for o in ops)
    assert attention_service.summary_cache.is_stale()


async def test_takes_the_next_number_when_the_plain_name_is_taken(app, library):
    row = _scene(library)
    _put(library, f"{SEASON}/Burn Notice (2007)-other.mkv")
    # "2-other" is free on disk but another record holds it, and "3-other" has a stray nfo.
    held = _row(library, f"{SEASON}/Burn Notice (2007) 2-other.mkv", id_="f2")
    _put(library, f"{SEASON}/Burn Notice (2007) 3-other.nfo")
    session = FakeSession([row, held])

    preview = await _post(app, session, "other")
    assert preview.status_code == 200, preview.text
    assert preview.json()["newName"] == "Burn Notice (2007) 4-other.mkv"

    resp = await _post(app, session, "other", dry_run=False)
    assert resp.status_code == 200, resp.text
    assert row.file_name == "Burn Notice (2007) 4-other.mkv"
    assert (library / SEASON / "Burn Notice (2007) 4-other.mkv").read_bytes() == b"video"
    assert (library / SEASON / "Burn Notice (2007) 4-other.nfo").read_text() == (
        "<movie>\n  <title>Burn Notice 4-other</title>\n</movie>\n")
    assert (library / SEASON / "Burn Notice (2007)-other.mkv").read_bytes() == b"x"  # untouched
    assert held.file_name == "Burn Notice (2007) 2-other.mkv"


async def test_a_first_of_its_type_file_becomes_the_first_of_the_new_type(app, library):
    rel = f"{SEASON}/Burn Notice (2007)-blooper.mkv"
    _put(library, rel)
    _put(library, rel.replace(".mkv", ".nfo"), b"<movie><title>My own title</title></movie>")
    session = FakeSession([_row(library, rel)])
    resp = await _post(app, session, "behind_the_scenes", dry_run=False)
    assert resp.status_code == 200, resp.text
    assert resp.json()["newName"] == "Burn Notice (2007)-behindthescenes.mkv"
    # A title somebody wrote is not replaced.
    assert resp.json()["nfoTitleUpdated"] is False
    assert (library / SEASON / "Burn Notice (2007)-behindthescenes.nfo").read_bytes() == (
        b"<movie><title>My own title</title></movie>")


async def test_dry_run_is_the_default_and_changes_nothing(app, library):
    row = _scene(library)
    session = FakeSession([row])
    before = _listing(library)
    for dry_run in (None, True):
        resp = await _post(app, session, "clip", dry_run=dry_run)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["applied"] is False and body["operations"] == [] and body["nfoTitleUpdated"] is False
        assert body["currentName"] == "Burn Notice (2007) 8-scene.mkv"
        assert body["newName"] == "Burn Notice (2007)-clip.mkv"
        assert sorted(os.path.basename(s["to"]) for s in body["sidecars"]) == [
            "Burn Notice (2007)-clip.en.srt", "Burn Notice (2007)-clip.nfo"]
        assert body["file"]["fileName"] == "Burn Notice (2007) 8-scene.mkv"
    assert _listing(library) == before
    assert row.relative_path == SCENE and session.commits == 0
    assert session.all_of(IngestOperation) == []


async def _refused(app, session, category, status, code, root=None):
    before = _listing(root) if root is not None else None
    for dry_run in (True, False):
        resp = await _post(app, session, category, dry_run=dry_run)
        assert resp.status_code == status, resp.text
        assert resp.json()["detail"]["code"] == code
        assert resp.json()["detail"]["message"]
    assert session.commits == 0 and session.all_of(IngestOperation) == []
    if root is not None:
        assert _listing(root) == before


async def test_refuses_an_unknown_category(app, library):
    session = FakeSession([_scene(library)])
    await _refused(app, session, "gag_reel", 422, "UNKNOWN_CATEGORY", library)
    await _refused(app, session, "", 422, "UNKNOWN_CATEGORY", library)


async def test_refuses_the_type_the_file_already_has(app, library):
    await _refused(app, FakeSession([_scene(library)]), "scene", 409, "SAME_TYPE", library)


async def test_refuses_a_file_that_is_not_an_extra(app, library):
    for role in ("episode", "main", "other", None):
        await _refused(app, FakeSession([_scene(library, role=role)]), "blooper", 422, "NOT_AN_EXTRA", library)


async def test_refuses_a_file_that_is_missing(app, library):
    # Flagged missing by the last scan, though the file is there...
    flagged = _scene(library, is_available=False, missing_since=T0)
    await _refused(app, FakeSession([flagged]), "blooper", 409, "FILE_MISSING", library)
    # ...and listed as present, though it is gone.
    gone = _row(library, f"{SEASON}/Burn Notice (2007) 9-scene.mkv")
    await _refused(app, FakeSession([gone]), "blooper", 409, "FILE_MISSING", library)


async def test_refuses_a_file_outside_the_library(app, library, tmp_path_factory):
    elsewhere = tmp_path_factory.mktemp("ingest")
    _put(elsewhere, "Burn Notice (2007) 8-scene.mkv")
    row = _row(elsewhere, "Burn Notice (2007) 8-scene.mkv", location="ingest")
    await _refused(app, FakeSession([row]), "blooper", 422, "NOT_IN_LIBRARY")
    assert os.listdir(elsewhere) == ["Burn Notice (2007) 8-scene.mkv"]


async def test_refuses_an_extra_typed_by_its_folder(app, library):
    # No type suffix in the name: the "featurettes" folder is what makes it a featurette.
    plain = "Movies/Inception (2010)/featurettes/Making Of.mkv"
    _put(library, plain)
    await _refused(app, FakeSession([_row(library, plain)]), "blooper", 422, "TYPE_NOT_IN_NAME")
    # A suffix inside an extras folder would not change what Jellyfin shows either.
    suffixed = "Movies/Inception (2010)/featurettes/Inception (2010)-scene.mkv"
    _put(library, suffixed)
    await _refused(app, FakeSession([_row(library, suffixed)]), "blooper", 422, "TYPE_NOT_IN_NAME")
    assert sorted(os.listdir(library / "Movies/Inception (2010)/featurettes")) == [
        "Inception (2010)-scene.mkv", "Making Of.mkv"]


async def test_unknown_file_is_404_and_auth_is_required(app, library):
    session = FakeSession([_scene(library)])
    assert (await _post(app, session, "blooper", file_id="nope")).status_code == 404
    app.dependency_overrides.clear()
    async with _client(app, session, authed=False) as ac:
        resp = await ac.post(URL.format("f1"), params={"dryRun": "false"}, json={"category": "blooper"})
    assert resp.status_code in (401, 403)
    assert (library / SCENE).exists()
