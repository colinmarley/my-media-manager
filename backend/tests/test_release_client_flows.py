"""
The request sequences the current phone app (media-manager-mobile) and web
app send, replayed against the release-aware catalog API on a real Postgres.

Neither client knows about releases yet. These tests pin the contract that
keeps them working unchanged:

- a disc that is not in a boxed set still reads as "not in a set" (no truthy
  ``setId``), although it now has a loose release behind it;
- full-record and partial saves never move a disc between releases by
  accident;
- boxed sets made the old way (``POST /disc-sets`` + ``setId`` on the disc)
  behave as before and are releases.

Each test names the client code it mirrors. Skipped without
CATALOG_TEST_DATABASE_URL (see tests/test_releases.py for how to run).
"""

import os
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get("CATALOG_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DB_URL, reason="CATALOG_TEST_DATABASE_URL not set")

ALIEN = "tt0078748"
ALIEN_FILE = "/lib/Alien (1979)/Alien (1979).mkv"


@pytest_asyncio.fixture()
async def ac():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.mobile_auth import require_any_auth
    from db.database import get_db
    from db.models import Base, MediaFile, Movie
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

    async with sessions() as s:
        s.add(Movie(id=ALIEN, title="Alien", raw_data={"title": "Alien"}))
        await s.flush()
        s.add(MediaFile(id="f1", file_path=ALIEN_FILE, file_name="Alien (1979).mkv", movie_id=ALIEN, role="main"))
        await s.commit()

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def mobile_disc_payload(**overrides):
    """What mobile's draftToPayload (src/screens/AddFlow/draft.ts) builds for
    a disc: every key present, ``setId`` null when no boxed set was picked."""
    payload = {
        "title": "Alien",
        "format": "Blu-ray",
        "barcode": "024543617907",
        "condition": "Good",
        "regionCode": "A",
        "edition": None,
        "purchaseDate": None,
        "storageType": None,
        "storageId": None,
        "isRentalDisc": False,
        "containsSpecialFeatures": False,
        "isPartOfSet": False,
        "discNumber": None,
        "setId": None,
    }
    payload.update(overrides)
    return payload


def shows_boxed_set(disc: dict) -> bool:
    """Mobile's MediaDetailScreen renders its "Boxed set" section, and the
    edit form pre-selects a set, exactly when the record's setId is truthy."""
    return bool(disc.get("setId"))


async def release_count(ac) -> int:
    return len((await ac.get("/api/catalog/releases")).json())


# ---------------------------------------------------------------------------
# Phone app
# ---------------------------------------------------------------------------

class TestMobileLooseDisc:
    async def _add(self, ac, **overrides):
        resp = await ac.post(
            "/api/catalog/discs", params={"check_duplicates": "true"}, json=mobile_disc_payload(**overrides),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    @pytest.mark.asyncio
    async def test_add_then_open_the_detail_screen(self, ac):
        """useSaveItem.ts add (POST ?check_duplicates=true), then the GETs the
        detail screen makes."""
        created = await self._add(ac)
        assert not shows_boxed_set(created)

        detail = (await ac.get(f"/api/catalog/discs/{created['id']}")).json()
        assert not shows_boxed_set(detail)
        assert detail["title"] == "Alien" and detail["isPartOfSet"] is False
        assert (await ac.get(f"/api/catalog/discs/{created['id']}/files")).json() == []
        assert (await ac.get(f"/api/catalog/discs/{created['id']}/links")).json() == []

        listed = (await ac.get("/api/catalog/discs")).json()
        assert len(listed) == 1
        assert not shows_boxed_set(listed[0]) and listed[0]["linkedFileCount"] == 0
        # The "join an existing set" picker (BoxedSetPicker) is not offered the wrapper.
        assert (await ac.get("/api/catalog/disc-sets", params={"title": "Alien"})).json() == []

    @pytest.mark.asyncio
    async def test_bulk_set_location_full_record_put(self, ac):
        """useBulkUpdate.buildMergedBody: the cached list item, minus
        linkedFileCount, with the location laid over it — a plain PUT."""
        await self._add(ac)
        item = (await ac.get("/api/catalog/discs")).json()[0]
        body = {k: v for k, v in item.items() if k != "linkedFileCount"}
        body.update({"storageType": "Binder", "storageId": "DVD_0001"})
        saved = await ac.put(f"/api/catalog/discs/{item['id']}", json=body)
        assert saved.status_code == 200, saved.text
        assert not shows_boxed_set(saved.json())
        assert (saved.json()["storageType"], saved.json()["storageId"]) == ("Binder", "DVD_0001")
        assert saved.json()["releaseId"] == item["releaseId"]
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_lend_out_and_rip_next_full_record_puts(self, ac):
        """useLoans.ts / useRipQueue.ts: the detail record with a flag added, plain PUT."""
        created = await self._add(ac)
        url = f"/api/catalog/discs/{created['id']}"
        record = (await ac.get(url)).json()
        lent = (await ac.put(url, json={**record, "loanedTo": "Sam", "loanedAt": "2026-11-18"})).json()
        assert lent["loanedTo"] == "Sam" and not shows_boxed_set(lent)
        queued = (await ac.put(url, json={**lent, "ripQueuedAt": "2026-11-18T10:00:00Z"})).json()
        assert queued["ripQueuedAt"] and queued["loanedTo"] == "Sam"
        assert queued["releaseId"] == created["releaseId"]
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_edit_sends_only_changed_keys(self, ac):
        """useSaveItem.ts edit: PUT ?merge=true with the changed fields."""
        created = await self._add(ac, storageType="Box", storageId="MED0001")
        saved = await ac.put(
            f"/api/catalog/discs/{created['id']}", params={"merge": "true"}, json={"condition": "Like new"},
        )
        assert saved.status_code == 200
        body = saved.json()
        assert body["condition"] == "Like new"
        assert (body["storageType"], body["storageId"], body["barcode"]) == ("Box", "MED0001", "024543617907")
        assert not shows_boxed_set(body)
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_stale_cached_record_with_null_set_does_not_churn(self, ac):
        """A record cached before the upgrade carries setId null; echoing it
        back in a full PUT must leave the disc in its one release."""
        created = await self._add(ac)
        stale = {**mobile_disc_payload(), "id": created["id"]}
        for _ in range(2):
            saved = await ac.put(f"/api/catalog/discs/{created['id']}", json=stale)
            assert saved.json()["releaseId"] == created["releaseId"]
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_duplicate_barcode_prompt(self, ac):
        """ReviewScreen.tsx handles 409 duplicate_barcode, then resends with allowDuplicateBarcode."""
        first = await self._add(ac)
        dup = await ac.post(
            "/api/catalog/discs", params={"check_duplicates": "true"}, json=mobile_disc_payload(),
        )
        assert dup.status_code == 409
        assert dup.json()["detail"]["code"] == "duplicate_barcode"
        assert dup.json()["detail"]["existingId"] == first["id"]
        second = await ac.post(
            "/api/catalog/discs", params={"check_duplicates": "true"},
            json=mobile_disc_payload(allowDuplicateBarcode=True),
        )
        assert second.status_code == 200
        assert "allowDuplicateBarcode" not in second.json()
        # Two copies: two discs, each with its own loose release.
        assert second.json()["releaseId"] != first["releaseId"]

    @pytest.mark.asyncio
    async def test_offline_outbox_sync(self, ac):
        """offline/outbox.ts: barcode search for a conflict, then a plain POST."""
        assert (await ac.get("/api/catalog/discs/search", params={"barcode": "024543617907"})).json() == []
        created = (await ac.post("/api/catalog/discs", json=mobile_disc_payload())).json()
        # Next sync of another queued copy sees exactly one conflict, not the
        # disc twice (once directly and once through its loose release).
        found = (await ac.get("/api/catalog/discs/search", params={"barcode": "024543617907"})).json()
        assert [d["id"] for d in found] == [created["id"]]

    @pytest.mark.asyncio
    async def test_title_links_and_physical_copies(self, ac):
        """discLinks.ts add/list/remove and physicalCopies.ts reverse lookup."""
        created = await self._add(ac)
        url = f"/api/catalog/discs/{created['id']}/links"
        assert (await ac.post(url, json={"mediaType": "movie", "mediaId": ALIEN})).status_code == 200
        # A retried save posts the link again.
        assert (await ac.post(url, json={"mediaType": "movie", "mediaId": ALIEN})).status_code == 200
        links = (await ac.get(url)).json()
        assert len(links) == 1
        assert {k: links[0][k] for k in ("mediaType", "mediaId", "title")} == {
            "mediaType": "movie", "mediaId": ALIEN, "title": "Alien",
        }
        copies = (await ac.get(f"/api/catalog/media/movie/{ALIEN}/discs")).json()
        assert [d["id"] for d in copies["discs"]] == [created["id"]]
        assert copies["discs"][0]["linkedFileCount"] == 0 and copies["tapes"] == []
        assert not shows_boxed_set(copies["discs"][0])
        assert (await ac.delete(f"{url}/movie/{ALIEN}")).json()["deleted"] is True
        assert (await ac.get(url)).json() == []

    @pytest.mark.asyncio
    async def test_delete_leaves_nothing_behind(self, ac):
        created = await self._add(ac)
        assert (await ac.delete(f"/api/catalog/discs/{created['id']}")).status_code == 200
        assert (await ac.get("/api/catalog/discs")).json() == []
        assert await release_count(ac) == 0


class TestMobileBoxedSet:
    async def _set_with_two_discs(self, ac):
        """useSaveItem.ts: create the set, then POST each disc with its setId."""
        boxed = (await ac.post("/api/catalog/disc-sets", json={"title": "Alien Anthology"})).json()
        assert set(boxed) == {"id", "title"}
        discs = []
        for number, title in ((1, "Alien"), (2, "Alien - Special Features")):
            resp = await ac.post(
                "/api/catalog/discs", params={"check_duplicates": "true"},
                json=mobile_disc_payload(title=title, barcode=None, setId=boxed["id"], isPartOfSet=True, discNumber=number),
            )
            assert resp.status_code == 200, resp.text
            discs.append(resp.json())
        return boxed, discs

    @pytest.mark.asyncio
    async def test_set_made_the_old_way_is_a_release(self, ac):
        boxed, discs = await self._set_with_two_discs(ac)
        assert all(shows_boxed_set(d) and d["setId"] == boxed["id"] == d["releaseId"] for d in discs)

        # BoxedSetPicker search, the detail screen's set header and sibling list.
        assert (await ac.get("/api/catalog/disc-sets", params={"title": "Anthology"})).json() == [boxed]
        assert (await ac.get(f"/api/catalog/disc-sets/{boxed['id']}")).json() == boxed
        siblings = (await ac.get(f"/api/catalog/disc-sets/{boxed['id']}/discs")).json()
        assert [(d["discNumber"], d["title"]) for d in siblings] == [(1, "Alien"), (2, "Alien - Special Features")]

        # The same set through the release API: two discs, no wrappers made.
        releases = (await ac.get("/api/catalog/releases")).json()
        assert [(r["id"], r["discCount"], r["packaging"]) for r in releases] == [(boxed["id"], 2, None)]

    @pytest.mark.asyncio
    async def test_remove_from_set_then_join_again(self, ac):
        """BoxedSetPicker "Change" with nothing picked sends setId null and
        isPartOfSet false in a merge PUT; picking the set again sends its id."""
        boxed, discs = await self._set_with_two_discs(ac)
        url = f"/api/catalog/discs/{discs[1]['id']}"

        removed = (await ac.put(url, params={"merge": "true"}, json={"setId": None, "isPartOfSet": False})).json()
        assert not shows_boxed_set(removed)
        assert removed["releaseId"] != boxed["id"]
        assert len((await ac.get(f"/api/catalog/disc-sets/{boxed['id']}/discs")).json()) == 1
        assert await release_count(ac) == 2

        joined = (await ac.put(url, params={"merge": "true"}, json={"setId": boxed["id"], "isPartOfSet": True})).json()
        assert joined["setId"] == boxed["id"] == joined["releaseId"]
        assert len((await ac.get(f"/api/catalog/disc-sets/{boxed['id']}/discs")).json()) == 2
        # The wrapper it had in between is gone.
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_full_record_put_keeps_the_set(self, ac):
        """Bulk location / loans on a disc that is in a set echo its setId."""
        boxed, discs = await self._set_with_two_discs(ac)
        item = next(d for d in (await ac.get("/api/catalog/discs")).json() if d["id"] == discs[0]["id"])
        body = {k: v for k, v in item.items() if k != "linkedFileCount"}
        saved = (await ac.put(f"/api/catalog/discs/{item['id']}", json={**body, "storageId": "MED0002", "storageType": "Box"})).json()
        assert saved["setId"] == boxed["id"] == saved["releaseId"]
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_deleted_set_is_a_422_with_a_message(self, ac):
        """ReviewScreen.tsx shows this 422's message next to the set picker."""
        resp = await ac.post("/api/catalog/discs", json=mobile_disc_payload(setId="gone", isPartOfSet=True))
        assert resp.status_code == 422
        assert "boxed set" in resp.json()["detail"]
        assert (await ac.get("/api/catalog/discs")).json() == []
        assert await release_count(ac) == 0


# ---------------------------------------------------------------------------
# Web app
# ---------------------------------------------------------------------------

class TestWebPhysicalMedia:
    @pytest.mark.asyncio
    async def test_edit_dialog_create_then_partial_replace(self, ac):
        """DiscEditDialog.tsx: POST the fields that were filled in, later a
        plain PUT of the dialog's fields (no setId key at all)."""
        created = (await ac.post("/api/catalog/discs", json={
            "title": "Alien", "format": "Blu-ray", "isPartOfSet": False, "isRentalDisc": False,
            "containsSpecialFeatures": False,
        })).json()
        saved = await ac.put(f"/api/catalog/discs/{created['id']}", json={
            "id": created["id"], "title": "Alien", "format": "4K UHD", "barcode": "0555", "isPartOfSet": False,
            "isRentalDisc": False, "containsSpecialFeatures": False,
        })
        assert saved.status_code == 200
        assert saved.json()["format"] == "4K UHD"
        assert saved.json()["releaseId"] == created["releaseId"]
        assert await release_count(ac) == 1
        # The list page's rows.
        row = (await ac.get("/api/catalog/discs")).json()[0]
        assert (row["title"], row["format"], row["linkedFileCount"]) == ("Alien", "4K UHD", 0)

    @pytest.mark.asyncio
    async def test_admin_disc_form_creates_by_put(self, ac):
        """useAddDisc.ts -> CatalogService.addDocument: PUT to a client-made
        uuid with a full CatalogDisc literal."""
        body = {
            "id": "3f0c7a52-0000-4000-8000-000000000001", "title": "Alien", "videoFiles": [], "imageFiles": [],
            "isPartOfSet": False, "isRentalDisc": False, "containsSpecialFeatures": False, "mediaId": ALIEN,
            "releaseDate": "", "language": "English", "subtitles": [], "regionCode": "A",
        }
        saved = await ac.put(f"/api/catalog/discs/{body['id']}", json=body)
        assert saved.status_code == 200, saved.text
        assert saved.json()["id"] == body["id"] and saved.json()["releaseId"]
        assert await release_count(ac) == 1

    @pytest.mark.asyncio
    async def test_connect_and_disconnect_a_file(self, ac):
        """ConnectFileDialog / MediaFileLinkService: search unlinked files,
        PATCH {discId}, list the disc's files, PATCH {discId: null}."""
        disc = (await ac.post("/api/catalog/discs", json={"title": "Alien", "format": "Blu-ray"})).json()
        found = (await ac.get("/api/catalog/media-files/search", params={"q": "Alien", "unlinked": "true"})).json()
        assert [f["id"] for f in found] == ["f1"]

        linked = (await ac.patch("/api/catalog/media-files/f1/link", json={"discId": disc["id"]})).json()
        assert linked["discId"] == disc["id"] and linked["tapeId"] is None
        assert [f["id"] for f in (await ac.get(f"/api/catalog/discs/{disc['id']}/files")).json()] == ["f1"]
        assert (await ac.get("/api/catalog/discs")).json()[0]["linkedFileCount"] == 1
        assert (await ac.get("/api/catalog/media-files/search", params={"unlinked": "true"})).json() == []

        cleared = (await ac.patch("/api/catalog/media-files/f1/link", json={"discId": None})).json()
        assert cleared["discId"] is None and cleared["releaseId"] is None
        assert (await ac.get(f"/api/catalog/discs/{disc['id']}/files")).json() == []

    @pytest.mark.asyncio
    async def test_deleting_a_disc_unlinks_its_files_from_the_release_too(self, ac):
        disc = (await ac.post("/api/catalog/discs", json={"title": "Alien"})).json()
        await ac.patch("/api/catalog/media-files/f1/link", json={"discId": disc["id"]})
        assert (await ac.delete(f"/api/catalog/discs/{disc['id']}")).status_code == 200
        found = (await ac.get("/api/catalog/media-files/search", params={"unlinked": "true"})).json()
        assert [(f["id"], f["discId"], f["releaseId"]) for f in found] == [("f1", None, None)]


class TestWebDiscRipper:
    @pytest.mark.asyncio
    async def test_link_panel_create_scan_and_delivery(self, ac):
        """DiscCatalogLinkPanel.tsx: create {title, barcode}; a later barcode
        scan auto-links when exactly one disc matches; disc-ripper-service
        then posts the delivered paths to /link-source."""
        created = (await ac.post("/api/catalog/discs", json={"title": "Alien", "barcode": "024543617907"})).json()
        found = (await ac.get("/api/catalog/discs/search", params={"barcode": "024543617907"})).json()
        assert [d["id"] for d in found] == [created["id"]]  # exactly one: the panel auto-links

        delivered = await ac.post("/api/catalog/link-source", json={"filePaths": [ALIEN_FILE], "discId": created["id"]})
        assert delivered.status_code == 200
        assert delivered.json()["linked"] == [ALIEN_FILE]
        files = (await ac.get(f"/api/catalog/discs/{created['id']}/files")).json()
        assert [(f["id"], f["releaseId"], f["sourceKind"]) for f in files] == [("f1", created["releaseId"], "disc")]

    @pytest.mark.asyncio
    async def test_scanning_a_set_barcode_offers_every_disc_in_it(self, ac):
        """A multi-disc release's barcode is on the release, so the panel gets
        all its discs (it shows chips instead of auto-linking)."""
        release = (await ac.post("/api/catalog/releases", json={
            "title": "Alien", "barcode": "024543617907", "packaging": "combo_pack",
            "discs": [{"format": "Blu-ray"}, {"format": "DVD"}],
        })).json()
        found = (await ac.get("/api/catalog/discs/search", params={"barcode": "024543617907"})).json()
        assert [d["discNumber"] for d in found] == [1, 2]
        assert {d["id"] for d in found} == {d["id"] for d in release["discs"]}
