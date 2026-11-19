"""
Coverage, file suggestions and bulk linking (api/releases.py, phase 2), and
the release-aware To-Do builders (services/attention_service.py).

The builder and auth tests need no database. The endpoint tests run against
a real Postgres given by CATALOG_TEST_DATABASE_URL and are skipped without
it (scripts/test-releases.sh starts a throwaway one).
"""

import os
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get("CATALOG_TEST_DATABASE_URL")
integration = pytest.mark.skipif(not TEST_DB_URL, reason="CATALOG_TEST_DATABASE_URL not set")

ALIEN, ALIENS, SEINFELD = "tt0078748", "tt0090605", "tt0098904"


def _client(app):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------------
# To-Do builders (no database)
# ---------------------------------------------------------------------------

def _inputs(discs, files, disc_links=()):
    from services.attention_service import AttentionInputs, TitleInfo
    from services.canonical_path import TitleIdentity

    inputs = AttentionInputs(files=list(files), discs=list(discs), disc_links=list(disc_links))
    inputs.titles[("movie", ALIEN)] = TitleInfo(TitleIdentity(kind="movie", id=ALIEN, title="Alien", year=1979), "movie")
    return inputs


def _disc(id, set_id, rip_intent="rip"):
    return NS(id=id, title=id, set_id=set_id, format="Blu-ray", rip_intent=rip_intent, raw_data={}, created_at=None)


def _file(id, **fields):
    base = dict(id=id, file_name=f"{id}.mkv", file_path=f"/lib/{id}.mkv", movie_id=ALIEN, series_id=None, role="main",
                season_number=None, episode_number=None, disc_id=None, release_id=None, tape_id=None,
                source_kind=None, is_available=True, created_at=None)
    base.update(fields)
    return NS(**base)


class TestUnrippedDiscBuilder:
    def _titles(self, inputs):
        from services.attention_service import build_unripped_disc
        return sorted(item["discId"] for item in build_unripped_disc(inputs))

    def test_lists_a_disc_with_no_files(self):
        assert self._titles(_inputs([_disc("d1", "r1")], [])) == ["d1"]

    def test_skips_a_ripped_disc(self):
        assert self._titles(_inputs([_disc("d1", "r1")], [_file("f", disc_id="d1", release_id="r1")])) == []

    def test_skips_a_disc_marked_wont_rip(self):
        assert self._titles(_inputs([_disc("bd", "r1"), _disc("dvd", "r1", rip_intent="skip")], [])) == ["bd"]

    def test_skips_a_disc_covered_by_files_of_its_release(self):
        """Existing files confirmed against the release, exact disc unknown."""
        inputs = _inputs([_disc("d1", "r1"), _disc("d2", "r1"), _disc("other", "r2")], [_file("f", release_id="r1")])
        assert self._titles(inputs) == ["other"]


class TestNoDiscLinkBuilder:
    def _items(self, files):
        from services.attention_service import build_no_disc_link
        link = NS(disc_id="d1", media_type="movie", media_id=ALIEN)
        return build_no_disc_link(_inputs([_disc("d1", "r1")], files, [link]))

    def test_asks_when_the_title_has_a_disc_and_its_file_names_none(self):
        items = self._items([_file("f")])
        assert [item["mediaId"] for item in items] == [ALIEN]

    def test_a_file_linked_to_the_disc_is_enough(self):
        assert self._items([_file("f", disc_id="d1", release_id="r1")]) == []

    def test_a_file_linked_to_the_release_is_enough(self):
        assert self._items([_file("f", release_id="r1")]) == []

    def test_a_download_does_not_ask_for_a_disc(self):
        assert self._items([_file("f", source_kind="digital")]) == []

    def test_a_download_beside_an_unlinked_rip_still_asks(self):
        assert len(self._items([_file("web", source_kind="digital"), _file("rip")])) == 1


class TestAuth:
    @pytest.mark.asyncio
    async def test_link_files_needs_a_session_or_token(self):
        from db.database import get_db
        from main import app

        async def override_db():
            yield AsyncMock()

        app.dependency_overrides[get_db] = override_db
        try:
            async with _client(app) as ac:
                resp = await ac.post("/api/catalog/releases/r1/link-files", json={"fileIds": ["f1"]})
            assert resp.status_code == 401
        finally:
            app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Endpoints (real Postgres)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture()
async def stack():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.mobile_auth import require_any_auth
    from db.database import get_db
    from db.models import Base, MediaFile, Movie, Series
    from main import app

    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with sessions() as session:
            yield session

    async def override_auth():
        return MagicMock()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_any_auth] = override_auth

    def movie(id, movie_id, role="main", width=1920, height=1080, **extra):
        return MediaFile(id=id, file_path=f"/lib/{id}.mkv", file_name=f"{id}.mkv", movie_id=movie_id, role=role,
                         width=width, height=height, location="library", **extra)

    def episode(n, season=3):
        return MediaFile(id=f"s{season}e{n}", file_path=f"/lib/s{season}e{n}.mkv", file_name=f"s{season}e{n}.mkv",
                         series_id=SEINFELD, role="episode", season_number=season, episode_number=n,
                         width=720, height=480, location="library")

    async with sessions() as s:
        s.add_all([
            Movie(id=ALIEN, title="Alien", raw_data={"title": "Alien"}),
            Movie(id=ALIENS, title="Aliens", raw_data={"title": "Aliens"}),
            Series(id=SEINFELD, title="Seinfeld", raw_data={"title": "Seinfeld"},
                   tmdb_data={"seasons": [{"season_number": 3, "episode_count": 3}]}),
        ])
        await s.flush()
        s.add_all([
            movie("alien-hd", ALIEN),
            movie("alien-sd", ALIEN, role="version", width=720, height=480),
            movie("alien-extra", ALIEN, role="extra"),
            movie("aliens-web", ALIENS, source_kind="digital"),
            episode(1), episode(2), episode(3), episode(1, season=4),
            MediaFile(id="unassigned", file_path="/ingest/x.mkv", file_name="x.mkv"),
        ])
        await s.commit()

    try:
        async with _client(app) as ac:
            yield ac, sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


COMBO = {
    "title": "Alien", "barcode": "024543617907", "packaging": "combo_pack",
    "contents": [{"mediaType": "movie", "mediaId": ALIEN}],
    "discs": [{"format": "Blu-ray", "contentRole": "feature"},
              {"format": "DVD", "contentRole": "duplicate_format", "ripIntent": "skip"}],
}
SEASON = {
    "title": "Seinfeld: Season 3", "packaging": "box_set",
    "contents": [{"mediaType": "series", "mediaId": SEINFELD, "seasonNumber": 3}],
    "discs": [{"format": "DVD"}, {"format": "DVD"}],
}


@integration
class TestCoverageEndpoint:
    @pytest.mark.asyncio
    async def test_before_anything_is_catalogued(self, stack):
        ac, _ = stack
        coverage = (await ac.get("/api/catalog/coverage")).json()
        assert coverage["discs"]["total"] == 0 and coverage["releases"]["total"] == 0
        # Main files and episodes: alien-hd, aliens-web, four episodes.
        assert coverage["files"] == {
            "total": 6, "linkedDisc": 0, "linkedRelease": 0, "suggested": 0, "noSource": 5, "notPhysical": 1,
            "linked": 0, "unlinked": 5,
        }
        assert coverage["otherFiles"] == {"version": 1, "extra": 1, "other": 0, "unassigned": 1}
        assert coverage["titles"] == {"withBoth": 0, "filesOnly": 3, "discsOnly": 0}

    @pytest.mark.asyncio
    async def test_counts_follow_cataloguing_and_linking(self, stack):
        ac, _ = stack
        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        season = (await ac.post("/api/catalog/releases", json=SEASON)).json()
        loose = (await ac.post("/api/catalog/discs", json={"title": "Predator", "format": "DVD"})).json()

        before = (await ac.get("/api/catalog/coverage")).json()
        assert before["discs"] == {"total": 5, "ripped": 0, "covered": 0, "unripped": 4, "skipped": 1, "done": 1}
        assert before["releases"] == {
            "total": 3, "complete": 0, "partial": 0, "none": 3, "skipped": 0, "loose": 1, "incompleteSets": 0,
        }
        assert (before["files"]["suggested"], before["files"]["noSource"]) == (4, 1)  # s4e1 has no release
        assert before["titles"] == {"withBoth": 2, "filesOnly": 1, "discsOnly": 0}

        # The Blu-ray is ripped; two of three season 3 episodes are confirmed against the set.
        await ac.patch("/api/catalog/media-files/alien-hd/link", json={"discId": combo["discs"][0]["id"]})
        linked = await ac.post(f"/api/catalog/releases/{season['id']}/link-files", json={"fileIds": ["s3e1", "s3e2"]})
        assert linked.status_code == 200

        after = (await ac.get("/api/catalog/coverage")).json()
        assert after["discs"] == {"total": 5, "ripped": 1, "covered": 2, "unripped": 1, "skipped": 1, "done": 4}
        assert after["releases"]["complete"] == 1 and after["releases"]["partial"] == 1 and after["releases"]["none"] == 1
        assert after["files"] == {
            "total": 6, "linkedDisc": 1, "linkedRelease": 2, "suggested": 1, "noSource": 1, "notPhysical": 1,
            "linked": 3, "unlinked": 2,
        }
        assert loose["releaseId"]

    @pytest.mark.asyncio
    async def test_incomplete_set_is_counted(self, stack):
        ac, _ = stack
        await ac.post("/api/catalog/releases", json={**SEASON, "expectedDiscCount": 4})
        assert (await ac.get("/api/catalog/coverage")).json()["releases"]["incompleteSets"] == 1


@integration
class TestFileSuggestions:
    @pytest.mark.asyncio
    async def test_movie_release_offers_main_and_version_with_fit(self, stack):
        ac, _ = stack
        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        body = (await ac.get(f"/api/catalog/releases/{combo['id']}/file-suggestions")).json()
        assert body["releaseId"] == combo["id"] and body["state"] == "none"
        assert body["formats"] == ["Blu-ray", "DVD"]
        assert len(body["groups"]) == 1
        group = body["groups"][0]
        assert (group["mediaType"], group["mediaId"], group["title"]) == ("movie", ALIEN, "Alien")
        assert (group["have"], group["expected"], group["satisfied"]) == (0, 1, False)
        # The DVD is skipped, so only the Blu-ray's resolution counts. The extra is never offered.
        assert {f["id"]: (f["fit"], f["preselected"]) for f in group["files"]} == {
            "alien-hd": ("fits", True), "alien-sd": ("mismatch", False),
        }
        assert group["files"][0]["fileName"] and group["files"][0]["height"]

    @pytest.mark.asyncio
    async def test_season_release_offers_only_that_season(self, stack):
        ac, _ = stack
        season = (await ac.post("/api/catalog/releases", json=SEASON)).json()
        group = (await ac.get(f"/api/catalog/releases/{season['id']}/file-suggestions")).json()["groups"][0]
        assert (group["seasonNumber"], group["expected"]) == (3, 3)
        assert [f["id"] for f in group["files"]] == ["s3e1", "s3e2", "s3e3"]
        assert all(f["preselected"] for f in group["files"])

    @pytest.mark.asyncio
    async def test_linked_files_drop_out_and_the_release_completes(self, stack):
        ac, sessions = stack
        from db.models import MediaFile

        season = (await ac.post("/api/catalog/releases", json=SEASON)).json()
        url = f"/api/catalog/releases/{season['id']}"
        resp = await ac.post(f"{url}/link-files", json={"fileIds": ["s3e1", "s3e2", "s3e2"]})
        assert resp.status_code == 200
        assert resp.json() == {"releaseId": season["id"], "discId": None, "linked": ["s3e1", "s3e2"]}

        body = (await ac.get(f"{url}/file-suggestions")).json()
        assert body["state"] == "partial"
        assert [f["id"] for f in body["groups"][0]["files"]] == ["s3e3"]
        assert (body["groups"][0]["have"], body["groups"][0]["satisfied"]) == (2, False)

        await ac.post(f"{url}/link-files", json={"fileIds": ["s3e3"]})
        body = (await ac.get(f"{url}/file-suggestions")).json()
        assert body["state"] == "complete" and body["groups"][0]["files"] == []
        assert (await ac.get(url)).json()["linkedFileCount"] == 3
        async with sessions() as s:
            row = await s.get(MediaFile, "s3e1")
            assert (row.release_id, row.disc_id, row.source_kind) == (season["id"], None, "disc")

    @pytest.mark.asyncio
    async def test_a_loose_disc_linked_to_a_title_gets_suggestions_too(self, stack):
        """What the phone app makes today: a disc with a title link, no release contents."""
        ac, _ = stack
        disc = (await ac.post("/api/catalog/discs", json={"title": "Alien", "format": "Blu-ray"})).json()
        await ac.post(f"/api/catalog/discs/{disc['id']}/links", json={"mediaType": "movie", "mediaId": ALIEN})
        body = (await ac.get(f"/api/catalog/releases/{disc['releaseId']}/file-suggestions")).json()
        assert [f["id"] for f in body["groups"][0]["files"] if f["preselected"]] == ["alien-hd"]

    @pytest.mark.asyncio
    async def test_unknown_release_is_a_404(self, stack):
        ac, _ = stack
        assert (await ac.get("/api/catalog/releases/nope/file-suggestions")).status_code == 404
        assert (await ac.post("/api/catalog/releases/nope/link-files", json={"fileIds": ["alien-hd"]})).status_code == 404


@integration
class TestLinkFiles:
    @pytest.mark.asyncio
    async def test_with_a_disc_ties_the_files_to_that_disc(self, stack):
        ac, sessions = stack
        from db.models import MediaFile

        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        blu_ray = combo["discs"][0]["id"]
        resp = await ac.post(f"/api/catalog/releases/{combo['id']}/link-files", json={"fileIds": ["alien-hd"], "discId": blu_ray})
        assert resp.json() == {"releaseId": combo["id"], "discId": blu_ray, "linked": ["alien-hd"]}
        async with sessions() as s:
            row = await s.get(MediaFile, "alien-hd")
            assert (row.disc_id, row.release_id) == (blu_ray, combo["id"])
        detail = (await ac.get(f"/api/catalog/releases/{combo['id']}")).json()
        assert [d["linkedFileCount"] for d in detail["discs"]] == [1, 0]

        # Linked again without a disc: the disc it already names (one of this release's) is kept.
        await ac.post(f"/api/catalog/releases/{combo['id']}/link-files", json={"fileIds": ["alien-hd"]})
        async with sessions() as s:
            assert (await s.get(MediaFile, "alien-hd")).disc_id == blu_ray

    @pytest.mark.asyncio
    async def test_moving_a_file_to_another_release_drops_the_old_disc(self, stack):
        ac, sessions = stack
        from db.models import MediaFile

        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        other = (await ac.post("/api/catalog/releases", json={"title": "Alien (4K)", "discs": [{"format": "4K UHD"}]})).json()
        await ac.post(f"/api/catalog/releases/{combo['id']}/link-files",
                      json={"fileIds": ["alien-hd"], "discId": combo["discs"][0]["id"]})
        await ac.post(f"/api/catalog/releases/{other['id']}/link-files", json={"fileIds": ["alien-hd"]})
        async with sessions() as s:
            row = await s.get(MediaFile, "alien-hd")
            assert (row.disc_id, row.release_id) == (None, other["id"])

    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [{}, {"fileIds": []}, {"fileIds": "alien-hd"}, {"fileIds": [1]}, {"fileIds": [""]}])
    async def test_bad_bodies_are_a_422(self, stack, body):
        ac, _ = stack
        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        assert (await ac.post(f"/api/catalog/releases/{combo['id']}/link-files", json=body)).status_code == 422

    @pytest.mark.asyncio
    async def test_a_disc_of_another_release_is_refused(self, stack):
        ac, _ = stack
        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        season = (await ac.post("/api/catalog/releases", json=SEASON)).json()
        resp = await ac.post(f"/api/catalog/releases/{combo['id']}/link-files",
                             json={"fileIds": ["alien-hd"], "discId": season["discs"][0]["id"]})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_nothing_is_linked_when_one_file_is_missing(self, stack):
        ac, sessions = stack
        from db.models import MediaFile

        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        resp = await ac.post(f"/api/catalog/releases/{combo['id']}/link-files", json={"fileIds": ["alien-hd", "gone"]})
        assert resp.status_code == 404
        assert resp.json()["detail"]["fileIds"] == ["gone"]
        async with sessions() as s:
            assert (await s.get(MediaFile, "alien-hd")).release_id is None


@integration
class TestReleaseSuggestionsList:
    @pytest.mark.asyncio
    async def test_lists_releases_with_candidates_most_preselected_first(self, stack):
        ac, _ = stack
        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()
        season = (await ac.post("/api/catalog/releases", json=SEASON)).json()
        await ac.post("/api/catalog/releases", json={"title": "Nothing in the library", "discs": [{"format": "DVD"}]})
        await ac.post("/api/catalog/releases", json={
            "title": "Aliens", "contents": [{"mediaType": "movie", "mediaId": ALIENS}], "discs": [{"format": "DVD"}],
        })  # its only file is a download: no candidates

        rows = (await ac.get("/api/catalog/release-suggestions")).json()
        assert [(r["id"], r["candidates"], r["preselected"], r["discCount"], r["state"]) for r in rows] == [
            (season["id"], 3, 3, 2, "none"),
            (combo["id"], 2, 1, 2, "none"),
        ]
        await ac.post(f"/api/catalog/releases/{season['id']}/link-files", json={"fileIds": ["s3e1", "s3e2", "s3e3"]})
        rows = (await ac.get("/api/catalog/release-suggestions")).json()
        assert [r["id"] for r in rows] == [combo["id"]]
        assert len((await ac.get("/api/catalog/release-suggestions", params={"limit": 1})).json()) == 1


@integration
class TestToDoAfterLinking:
    @pytest.mark.asyncio
    async def test_unripped_disc_items_follow_release_links_and_skips(self, stack):
        """GET /api/attention/items through the real loader: a skipped disc is never
        listed, and discs stop being listed once their release has the files."""
        ac, _ = stack
        from services import attention_service

        combo = (await ac.post("/api/catalog/releases", json=COMBO)).json()

        async def unripped():
            attention_service.invalidate_summary()
            resp = await ac.get("/api/attention/items", params={"kind": "unripped_disc"})
            assert resp.status_code == 200, resp.text
            body = resp.json()
            items = body["items"] if isinstance(body, dict) else body
            return sorted(item["discId"] for item in items)

        assert await unripped() == [combo["discs"][0]["id"]]   # the skipped DVD is not there
        await ac.post(f"/api/catalog/releases/{combo['id']}/link-files", json={"fileIds": ["alien-hd"]})
        assert await unripped() == []
