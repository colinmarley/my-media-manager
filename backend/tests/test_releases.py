"""
Releases (api/releases.py) and the release-aware parts of api/catalog.py:
loose releases for discs saved without a set, release barcodes in disc
search, disc link scope and release ids on linked files.

The validation and auth tests need no database. The rest run against a real
Postgres given by CATALOG_TEST_DATABASE_URL and are skipped without it. They
create and drop the full schema, so point it only at a throwaway database:

  docker run -d --rm -p 127.0.0.1:5439:5432 -e POSTGRES_PASSWORD=t postgres:16
  CATALOG_TEST_DATABASE_URL=postgresql+asyncpg://postgres:t@127.0.0.1:5439/postgres pytest tests/test_releases.py
"""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get("CATALOG_TEST_DATABASE_URL")


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


def _client(app):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------------
# Validation (no database)
# ---------------------------------------------------------------------------

class TestContentScope:
    def test_no_scope_is_all_null(self):
        from api.catalog import content_scope

        assert content_scope({"mediaType": "movie", "mediaId": "tt1"}) == {
            "season_number": None, "episode_start": None, "episode_end": None,
        }

    def test_season_and_range_are_coerced(self):
        from api.catalog import content_scope

        scope = content_scope({"mediaType": "series", "seasonNumber": "3", "episodeStart": 7, "episodeEnd": "12"})
        assert scope == {"season_number": 3, "episode_start": 7, "episode_end": 12}

    @pytest.mark.parametrize("body", [
        {"mediaType": "series", "episodeStart": 1},                                   # range without a season
        {"mediaType": "movie", "seasonNumber": 1},                                    # a movie has no season
        {"mediaType": "series", "seasonNumber": 1, "episodeStart": 9, "episodeEnd": 3},  # backwards
        {"mediaType": "series", "seasonNumber": -1},
        {"mediaType": "series", "seasonNumber": "three"},
    ])
    def test_bad_scope_is_a_422(self, body):
        from api.catalog import content_scope

        with pytest.raises(HTTPException) as exc:
            content_scope(body)
        assert exc.value.status_code == 422


class TestReleaseBodyValidation:
    def test_text_is_trimmed_and_blank_becomes_null(self):
        from api.releases import _normalize_release_body

        body = _normalize_release_body({"title": "  Alien  ", "barcode": " 0245 ", "edition": "  "})
        assert body["title"] == "Alien"
        assert body["barcode"] == "0245"
        assert body["edition"] is None

    @pytest.mark.parametrize("body", [
        {"title": "   "},
        {"packaging": "shoebox"},
        {"expectedDiscCount": 0},
        {"expectedDiscCount": 101},
        {"releaseYear": "nineteen"},
        {"storageId": "bad/id"},
        {"imageFiles": "cover.jpg"},
    ])
    def test_bad_fields_are_a_422(self, body):
        from api.releases import _normalize_release_body

        with pytest.raises(HTTPException) as exc:
            _normalize_release_body(body)
        assert exc.value.status_code == 422

    def test_duplicate_contents_collapse(self):
        from api.releases import _content_rows

        rows = _content_rows("r1", [
            {"mediaType": "series", "mediaId": "tt9", "seasonNumber": 1},
            {"mediaType": "series", "mediaId": "tt9", "seasonNumber": "1"},
            {"mediaType": "series", "mediaId": "tt9", "seasonNumber": 2},
        ])
        assert [(r.media_id, r.season_number) for r in rows] == [("tt9", 1), ("tt9", 2)]
        assert all(r.release_id == "r1" for r in rows)

    @pytest.mark.parametrize("items", [
        "tt1",
        ["tt1"],
        [{"mediaType": "episode", "mediaId": "x"}],
        [{"mediaType": "movie"}],
    ])
    def test_bad_contents_are_a_422(self, items):
        from api.releases import _content_rows

        with pytest.raises(HTTPException) as exc:
            _content_rows("r1", items)
        assert exc.value.status_code == 422


class TestDiscBodyValidation:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [{"contentRole": "main"}, {"ripIntent": "maybe"}])
    async def test_unknown_role_or_intent_is_a_422(self, body):
        from api.catalog import _normalize_physical_body

        with pytest.raises(HTTPException) as exc:
            await _normalize_physical_body(body, AsyncMock())
        assert exc.value.status_code == 422

    def test_rip_intent_defaults_to_rip(self):
        from api.catalog import _apply_disc_fields
        from db.models import Disc

        row = Disc(id="d1")
        _apply_disc_fields(row, {"title": "Alien"})
        assert row.rip_intent == "rip"
        assert row.content_role is None
        _apply_disc_fields(row, {"title": "Alien", "ripIntent": "skip", "ripSkipReason": "DVD copy",
                                 "contentRole": "duplicate_format"})
        assert (row.rip_intent, row.rip_skip_reason, row.content_role) == ("skip", "DVD copy", "duplicate_format")


class TestAuth:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("method,path", [
        ("post", "/api/catalog/releases"),
        ("put", "/api/catalog/releases/r1"),
        ("delete", "/api/catalog/releases/r1"),
    ])
    async def test_writes_need_a_session_or_token(self, app, method, path):
        from db.database import get_db

        async def override_db():
            yield AsyncMock()

        app.dependency_overrides[get_db] = override_db
        try:
            async with _client(app) as ac:
                kwargs = {} if method == "delete" else {"json": {"title": "Alien"}}
                resp = await getattr(ac, method)(path, **kwargs)
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Integration (real Postgres)
# ---------------------------------------------------------------------------

integration = pytest.mark.skipif(not TEST_DB_URL, reason="CATALOG_TEST_DATABASE_URL not set")


@pytest_asyncio.fixture()
async def db_app(app):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.database import get_db
    from db.models import Base, MediaFile, Movie, Series

    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    _override_auth(app)

    async with sessions() as s:
        s.add_all([
            Movie(id="tt0078748", title="Alien", raw_data={"title": "Alien"}),
            Movie(id="tt0090605", title="Aliens", raw_data={"title": "Aliens"}),
            Series(id="tt0098904", title="Seinfeld", raw_data={"title": "Seinfeld"}),
        ])
        await s.flush()
        s.add_all([
            MediaFile(id="f1", file_path="/lib/Alien (1979)/Alien (1979).mkv", file_name="Alien (1979).mkv",
                      movie_id="tt0078748", role="main"),
            MediaFile(id="f2", file_path="/lib/Aliens (1986)/Aliens (1986).mkv", file_name="Aliens (1986).mkv",
                      movie_id="tt0090605", role="main"),
        ])
        await s.commit()

    try:
        yield app, sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


COMBO = {
    "title": "Alien",
    "barcode": "024543617907",
    "edition": "Blu-ray + DVD",
    "packaging": "combo_pack",
    "contents": [{"mediaType": "movie", "mediaId": "tt0078748"}],
    "discs": [
        {"format": "Blu-ray", "contentRole": "feature", "storageType": "Binder", "storageId": "BD_0001"},
        {"format": "DVD", "contentRole": "duplicate_format", "ripIntent": "skip", "ripSkipReason": "DVD copy"},
    ],
}


@integration
class TestCreateRelease:
    @pytest.mark.asyncio
    async def test_combo_pack_is_saved_in_one_request(self, db_app):
        app, sessions = db_app
        from sqlalchemy import select
        from db.models import Disc

        async with _client(app) as ac:
            resp = await ac.post("/api/catalog/releases", json=COMBO)
        assert resp.status_code == 200, resp.text
        release = resp.json()
        assert release["title"] == "Alien"
        assert release["barcode"] == "024543617907"
        assert release["packaging"] == "combo_pack"
        assert release["expectedDiscCount"] == 2
        assert release["linkedFileCount"] == 0
        assert release["contents"] == [{
            "id": release["contents"][0]["id"], "mediaType": "movie", "mediaId": "tt0078748", "title": "Alien",
            "seasonNumber": None, "episodeStart": None, "episodeEnd": None,
        }]
        discs = release["discs"]
        assert [d["title"] for d in discs] == ["Alien - Disc 1", "Alien - Disc 2"]
        assert [d["discNumber"] for d in discs] == [1, 2]
        assert [d["format"] for d in discs] == ["Blu-ray", "DVD"]
        assert all(d["setId"] == release["id"] and d["isPartOfSet"] for d in discs)
        assert all(d["linkedFileCount"] == 0 for d in discs)

        async with sessions() as s:
            rows = (await s.execute(select(Disc).order_by(Disc.disc_number))).scalars().all()
        assert [r.set_id for r in rows] == [release["id"]] * 2
        assert [r.rip_intent for r in rows] == ["rip", "skip"]
        assert [r.content_role for r in rows] == ["feature", "duplicate_format"]
        assert rows[0].storage_id == "BD_0001"
        # The barcode lives on the release, not on each disc.
        assert [r.barcode for r in rows] == [None, None]

    @pytest.mark.asyncio
    async def test_single_disc_takes_the_release_title(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            resp = await ac.post("/api/catalog/releases", json={"title": "Aliens", "discs": [{"format": "DVD"}]})
        assert resp.status_code == 200
        disc = resp.json()["discs"][0]
        assert disc["title"] == "Aliens"
        assert disc["discNumber"] == 1
        assert "isPartOfSet" not in disc

    @pytest.mark.asyncio
    async def test_season_set_scope(self, db_app):
        app, _ = db_app
        body = {
            "title": "Seinfeld: Seasons 1 & 2",
            "packaging": "box_set",
            "contents": [
                {"mediaType": "series", "mediaId": "tt0098904", "seasonNumber": 1},
                {"mediaType": "series", "mediaId": "tt0098904", "seasonNumber": 2},
            ],
            "discs": [{"format": "DVD"} for _ in range(4)],
        }
        async with _client(app) as ac:
            resp = await ac.post("/api/catalog/releases", json=body)
        assert resp.status_code == 200
        release = resp.json()
        assert [(c["title"], c["seasonNumber"]) for c in release["contents"]] == [("Seinfeld", 1), ("Seinfeld", 2)]
        assert [d["discNumber"] for d in release["discs"]] == [1, 2, 3, 4]

    @pytest.mark.asyncio
    async def test_nothing_is_saved_when_a_disc_is_invalid(self, db_app):
        app, sessions = db_app
        from sqlalchemy import func, select
        from db.models import Disc, DiscSet, ReleaseContent

        body = {**COMBO, "discs": [{"format": "Blu-ray"}, {"format": "DVD", "ripIntent": "maybe"}]}
        async with _client(app) as ac:
            resp = await ac.post("/api/catalog/releases", json=body)
        assert resp.status_code == 422
        async with sessions() as s:
            for model in (DiscSet, Disc, ReleaseContent):
                assert (await s.execute(select(func.count()).select_from(model))).scalar_one() == 0

    @pytest.mark.asyncio
    async def test_title_is_required(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            resp = await ac.post("/api/catalog/releases", json={"barcode": "1"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_duplicate_barcode_asks_first(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            first = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            dup = await ac.post("/api/catalog/releases?check_duplicates=true", json=COMBO)
            assert dup.status_code == 409
            assert dup.json()["detail"]["code"] == "duplicate_barcode"
            assert dup.json()["detail"]["existingId"] == first["id"]
            # A real second copy.
            again = await ac.post(
                "/api/catalog/releases?check_duplicates=true", json={**COMBO, "allowDuplicateBarcode": True},
            )
            assert again.status_code == 200
            assert "allowDuplicateBarcode" not in again.json()
            listed = (await ac.get("/api/catalog/releases", params={"barcode": "024543617907"})).json()
        assert len(listed) == 2
        assert all(r["discCount"] == 2 for r in listed)


@integration
class TestEditAndDeleteRelease:
    @pytest.mark.asyncio
    async def test_put_changes_only_what_is_sent(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json={**COMBO, "notes": "From the sale"})).json()
            resp = await ac.put(f"/api/catalog/releases/{release['id']}", json={"edition": "Steelbook", "notes": None})
        assert resp.status_code == 200
        body = resp.json()
        assert body["edition"] == "Steelbook"
        assert body["notes"] is None
        assert body["barcode"] == "024543617907"
        assert body["packaging"] == "combo_pack"
        assert len(body["contents"]) == 1
        assert len(body["discs"]) == 2

    @pytest.mark.asyncio
    async def test_put_contents_replaces_the_list(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            resp = await ac.put(f"/api/catalog/releases/{release['id']}", json={"contents": [
                {"mediaType": "movie", "mediaId": "tt0078748"},
                {"mediaType": "movie", "mediaId": "tt0090605"},
            ]})
        assert resp.status_code == 200
        assert sorted(c["title"] for c in resp.json()["contents"]) == ["Alien", "Aliens"]

    @pytest.mark.asyncio
    async def test_unknown_release_is_a_404(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            assert (await ac.get("/api/catalog/releases/nope")).status_code == 404
            assert (await ac.put("/api/catalog/releases/nope", json={"title": "x"})).status_code == 404
            assert (await ac.delete("/api/catalog/releases/nope")).status_code == 404

    @pytest.mark.asyncio
    async def test_delete_is_refused_while_discs_remain(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            refused = await ac.delete(f"/api/catalog/releases/{release['id']}")
            assert refused.status_code == 409
            assert refused.json()["detail"]["code"] == "release_not_empty"
            assert refused.json()["detail"]["discCount"] == 2
            for disc in release["discs"]:
                assert (await ac.delete(f"/api/catalog/discs/{disc['id']}")).status_code == 200
            # A catalogued release is kept when its last disc goes; only loose ones are dropped.
            assert (await ac.get(f"/api/catalog/releases/{release['id']}")).status_code == 200
            assert (await ac.delete(f"/api/catalog/releases/{release['id']}")).status_code == 200
            assert (await ac.get(f"/api/catalog/releases/{release['id']}")).status_code == 404


@integration
class TestLooseReleases:
    @pytest.mark.asyncio
    async def test_a_disc_saved_without_a_set_gets_a_loose_release(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={
                "title": "Aliens", "format": "DVD", "barcode": "0111", "edition": "Special Edition", "setId": None,
            })).json()
            # To clients the disc is still "not in a set".
            assert disc["setId"] is None
            assert disc["releaseId"]
            release = (await ac.get(f"/api/catalog/releases/{disc['releaseId']}")).json()
            assert release["packaging"] == "loose"
            assert (release["title"], release["barcode"], release["edition"]) == ("Aliens", "0111", "Special Edition")
            assert [d["id"] for d in release["discs"]] == [disc["id"]]
            # Loose releases are not sets to join.
            assert (await ac.get("/api/catalog/disc-sets")).json() == []
            assert len((await ac.get("/api/catalog/releases")).json()) == 1
            assert (await ac.get("/api/catalog/releases", params={"include_loose": "false"})).json() == []
            # Every way of reading the disc agrees.
            for fetched in (
                (await ac.get(f"/api/catalog/discs/{disc['id']}")).json(),
                (await ac.get("/api/catalog/discs")).json()[0],
                (await ac.get("/api/catalog/discs/search", params={"title": "Aliens"})).json()[0],
            ):
                assert fetched["releaseId"] == disc["releaseId"]
                assert not fetched.get("setId")

    @pytest.mark.asyncio
    async def test_put_with_a_client_made_id_also_gets_one(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            resp = await ac.put("/api/catalog/discs/client-made-id", json={"title": "Aliens", "format": "DVD"})
            assert resp.status_code == 200, resp.text
            assert "setId" not in resp.json()
            release = (await ac.get(f"/api/catalog/releases/{resp.json()['releaseId']}")).json()
            assert release["packaging"] == "loose"
            assert [d["id"] for d in release["discs"]] == ["client-made-id"]

    @pytest.mark.asyncio
    async def test_editing_a_loose_disc_updates_its_release(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={"title": "Alienz", "barcode": "0111"})).json()
            edited = {**disc, "title": "Aliens", "barcode": "0222", "edition": "Special Edition"}
            saved = await ac.put(f"/api/catalog/discs/{disc['id']}", json=edited)
            assert saved.status_code == 200
            assert saved.json()["releaseId"] == disc["releaseId"]
            release = (await ac.get(f"/api/catalog/releases/{disc['releaseId']}")).json()
            assert (release["title"], release["barcode"], release["edition"]) == ("Aliens", "0222", "Special Edition")
            # The old barcode no longer finds the disc through its release.
            assert (await ac.get("/api/catalog/discs/search", params={"barcode": "0111"})).json() == []
            found = (await ac.get("/api/catalog/discs/search", params={"barcode": "0222"})).json()
            assert [d["id"] for d in found] == [disc["id"]]

    @pytest.mark.asyncio
    async def test_editing_a_disc_in_a_real_release_leaves_the_release_alone(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            disc = release["discs"][0]
            await ac.put(f"/api/catalog/discs/{disc['id']}", json={**disc, "title": "Alien (Blu-ray)", "barcode": "0999"})
            after = (await ac.get(f"/api/catalog/releases/{release['id']}")).json()
            assert (after["title"], after["barcode"]) == ("Alien", "024543617907")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("set_value", ["omitted", None, ""])
    async def test_saving_a_loose_disc_again_keeps_its_release(self, db_app, set_value):
        """Whatever an older client sends for "no set" (nothing, null, or an
        empty string), a loose disc stays in the one release it has."""
        app, _ = db_app
        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={"title": "Aliens", "format": "DVD"})).json()
            record = {k: v for k, v in disc.items() if k != "setId"}
            if set_value != "omitted":
                record["setId"] = set_value
            for params in ({}, {"merge": "true"}):
                saved = await ac.put(
                    f"/api/catalog/discs/{disc['id']}", json={**record, "condition": "Good"}, params=params,
                )
                assert saved.status_code == 200
                assert saved.json()["releaseId"] == disc["releaseId"]
                assert not saved.json().get("setId")
            assert len((await ac.get("/api/catalog/releases")).json()) == 1

    @pytest.mark.asyncio
    async def test_computed_keys_echoed_back_are_not_stored(self, db_app):
        app, sessions = db_app
        from db.models import Disc

        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={"title": "Aliens"})).json()
            listed = (await ac.get("/api/catalog/discs")).json()[0]
            assert listed["linkedFileCount"] == 0
            await ac.put(f"/api/catalog/discs/{disc['id']}", json={**listed, "releaseId": "made-up"})
        async with sessions() as s:
            row = await s.get(Disc, disc["id"])
            assert "releaseId" not in row.raw_data and "linkedFileCount" not in row.raw_data
            assert row.set_id == disc["releaseId"]

    @pytest.mark.asyncio
    async def test_joining_a_release_drops_the_loose_one_and_moves_its_files(self, db_app):
        app, sessions = db_app
        from db.models import MediaFile

        async with _client(app) as ac:
            box = (await ac.post("/api/catalog/releases", json={"title": "Alien Anthology", "packaging": "box_set"})).json()
            disc = (await ac.post("/api/catalog/discs", json={"title": "Aliens", "format": "Blu-ray"})).json()
            loose_id = disc["releaseId"]
            linked = await ac.patch("/api/catalog/media-files/f2/link", json={"discId": disc["id"]})
            assert linked.json()["releaseId"] == loose_id

            moved = await ac.put(f"/api/catalog/discs/{disc['id']}", json={"setId": box["id"]}, params={"merge": "true"})
            assert moved.status_code == 200
            assert (moved.json()["setId"], moved.json()["releaseId"]) == (box["id"], box["id"])
            assert (await ac.get(f"/api/catalog/releases/{loose_id}")).status_code == 404
            detail = (await ac.get(f"/api/catalog/releases/{box['id']}")).json()
            assert [d["id"] for d in detail["discs"]] == [disc["id"]]
            assert detail["linkedFileCount"] == 1
        async with sessions() as s:
            assert (await s.get(MediaFile, "f2")).release_id == box["id"]

    @pytest.mark.asyncio
    async def test_deleting_a_loose_disc_removes_its_release(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={"title": "Aliens"})).json()
            assert (await ac.delete(f"/api/catalog/discs/{disc['id']}")).status_code == 200
            assert (await ac.get("/api/catalog/releases")).json() == []

    @pytest.mark.asyncio
    async def test_a_replace_that_omits_the_set_keeps_a_real_release(self, db_app):
        """The web edit dialog PUTs a partial record without setId."""
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            disc = release["discs"][0]
            saved = (await ac.put(f"/api/catalog/discs/{disc['id']}", json={"title": "Alien", "format": "Blu-ray"})).json()
            assert (saved["setId"], saved["releaseId"]) == (release["id"], release["id"])
            assert len((await ac.get(f"/api/catalog/releases/{release['id']}")).json()["discs"]) == 2

    @pytest.mark.asyncio
    async def test_leaving_a_set_makes_a_new_loose_release(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            disc = release["discs"][1]
            saved = (await ac.put(
                f"/api/catalog/discs/{disc['id']}", json={"setId": None, "isPartOfSet": False}, params={"merge": "true"},
            )).json()
            assert saved["setId"] is None
            assert saved["releaseId"] and saved["releaseId"] != release["id"]
            loose = (await ac.get(f"/api/catalog/releases/{saved['releaseId']}")).json()
            assert loose["packaging"] == "loose"
            assert len((await ac.get(f"/api/catalog/releases/{release['id']}")).json()["discs"]) == 1

    @pytest.mark.asyncio
    async def test_loose_cannot_be_chosen_and_a_loose_release_is_not_edited_directly(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            assert (await ac.post("/api/catalog/releases", json={"title": "x", "packaging": "loose"})).status_code == 422
            disc = (await ac.post("/api/catalog/discs", json={"title": "Aliens"})).json()
            url = f"/api/catalog/releases/{disc['releaseId']}"
            refused = await ac.put(url, json={"notes": "n"})
            assert refused.status_code == 409
            assert refused.json()["detail"]["code"] == "loose_release"
            # Giving it a packaging turns it into a catalogued release.
            promoted = await ac.put(url, json={"packaging": "case", "barcode": "0333"})
            assert promoted.status_code == 200
            assert promoted.json()["packaging"] == "case"


@integration
class TestBarcodeSearch:
    @pytest.mark.asyncio
    async def test_disc_search_finds_discs_by_their_release_barcode(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            found = (await ac.get("/api/catalog/discs/search", params={"barcode": "024543617907"})).json()
            assert sorted(d["id"] for d in found) == sorted(d["id"] for d in release["discs"])
            assert (await ac.get("/api/catalog/discs/search", params={"barcode": "000"})).json() == []


@integration
class TestFileLinks:
    @pytest.mark.asyncio
    async def test_file_linked_to_a_release_without_a_disc(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            linked = await ac.patch("/api/catalog/media-files/f1/link", json={"releaseId": release["id"]})
            assert linked.status_code == 200
            body = linked.json()
            assert (body["releaseId"], body["discId"], body["sourceKind"]) == (release["id"], None, "disc")
            detail = (await ac.get(f"/api/catalog/releases/{release['id']}")).json()
            assert detail["linkedFileCount"] == 1
            assert [d["linkedFileCount"] for d in detail["discs"]] == [0, 0]
            listed = (await ac.get("/api/catalog/releases")).json()
            assert listed[0]["linkedFileCount"] == 1

    @pytest.mark.asyncio
    async def test_disc_link_sets_the_release_and_unlink_clears_both(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            disc_id = release["discs"][0]["id"]
            linked = (await ac.patch("/api/catalog/media-files/f1/link", json={"discId": disc_id})).json()
            assert (linked["discId"], linked["releaseId"], linked["sourceKind"]) == (disc_id, release["id"], "disc")
            detail = (await ac.get(f"/api/catalog/releases/{release['id']}")).json()
            assert [d["linkedFileCount"] for d in detail["discs"]] == [1, 0]

            cleared = (await ac.patch("/api/catalog/media-files/f1/link", json={"discId": None})).json()
            assert (cleared["discId"], cleared["releaseId"], cleared["sourceKind"]) == (None, None, None)

    @pytest.mark.asyncio
    async def test_release_link_drops_a_disc_of_another_release(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            first = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            second = (await ac.post("/api/catalog/releases", json={"title": "Alien (4K)", "discs": [{}]})).json()
            await ac.patch("/api/catalog/media-files/f1/link", json={"discId": first["discs"][0]["id"]})
            moved = (await ac.patch("/api/catalog/media-files/f1/link", json={"releaseId": second["id"]})).json()
            assert (moved["releaseId"], moved["discId"]) == (second["id"], None)

    @pytest.mark.asyncio
    async def test_unknown_release_or_source_kind(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            assert (await ac.patch("/api/catalog/media-files/f1/link", json={"releaseId": "nope"})).status_code == 404
            assert (await ac.patch("/api/catalog/media-files/f1/link", json={"sourceKind": "vinyl"})).status_code == 422

    @pytest.mark.asyncio
    async def test_a_file_can_be_marked_digital(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            marked = (await ac.patch("/api/catalog/media-files/f2/link", json={"sourceKind": "digital"})).json()
            assert (marked["sourceKind"], marked["discId"], marked["releaseId"]) == ("digital", None, None)

    @pytest.mark.asyncio
    async def test_ripper_link_source_sets_the_release(self, db_app):
        app, sessions = db_app
        from db.models import MediaFile

        async with _client(app) as ac:
            release = (await ac.post("/api/catalog/releases", json=COMBO)).json()
            disc_id = release["discs"][0]["id"]
            resp = await ac.post("/api/catalog/link-source", json={
                "filePaths": ["/lib/Alien (1979)/Alien (1979).mkv"], "discId": disc_id,
            })
            assert resp.status_code == 200
        async with sessions() as s:
            row = await s.get(MediaFile, "f1")
            assert (row.disc_id, row.release_id, row.source_kind) == (disc_id, release["id"], "disc")


@integration
class TestDiscLinkScope:
    @pytest.mark.asyncio
    async def test_scope_is_stored_updated_and_listed(self, db_app):
        app, _ = db_app
        async with _client(app) as ac:
            disc = (await ac.post("/api/catalog/discs", json={"title": "Seinfeld S3 D2", "format": "DVD"})).json()
            url = f"/api/catalog/discs/{disc['id']}/links"
            first = await ac.post(url, json={"mediaType": "series", "mediaId": "tt0098904", "seasonNumber": 3})
            assert first.status_code == 200
            # Resent with a range: the existing link's scope is updated.
            await ac.post(url, json={
                "mediaType": "series", "mediaId": "tt0098904", "seasonNumber": 3, "episodeStart": 7, "episodeEnd": 12,
            })
            # Resent without a scope (an older client): the scope is left alone.
            await ac.post(url, json={"mediaType": "series", "mediaId": "tt0098904"})
            assert (await ac.get(url)).json() == [{
                "mediaType": "series", "mediaId": "tt0098904", "title": "Seinfeld",
                "seasonNumber": 3, "episodeStart": 7, "episodeEnd": 12,
            }]
