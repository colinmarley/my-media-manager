"""
Tests for backend/api/storage_locations.py

The auth/validation tests need no database. The rest are marked
`integration` and run against a real Postgres (JSONB + GROUP BY semantics
matter here) given by STORAGE_LOCATIONS_TEST_DATABASE_URL — skipped when
it isn't set. They create (and drop) the full schema in that database, so
point it only at a throwaway database.
"""

import os
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get("STORAGE_LOCATIONS_TEST_DATABASE_URL")


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


class TestValidation:
    @pytest.mark.asyncio
    async def test_writes_require_auth(self, app):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                put = await ac.put("/api/storage-locations/Box/MED0001", json={"name": "Horror"})
                rename = await ac.post("/api/storage-locations/Box/MED0001/rename", json={"newId": "MED0002"})
            assert put.status_code == 401
            assert rename.status_code == 401
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_unknown_storage_type_and_bad_id_are_rejected(self, app):
        _override_auth(app)
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                bad_type = await ac.put("/api/storage-locations/Shelf/MED0001", json={})
                bad_id = await ac.post("/api/storage-locations/Box/MED0001/rename", json={"newId": "no/slashes"})
                bad_capacity = await ac.put("/api/storage-locations/Box/MED0001", json={"capacity": 0})
            assert bad_type.status_code == 422
            assert bad_id.status_code == 422
            assert bad_capacity.status_code == 422
        finally:
            app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Integration (real Postgres)
# ---------------------------------------------------------------------------

integration = pytest.mark.skipif(not TEST_DB_URL, reason="STORAGE_LOCATIONS_TEST_DATABASE_URL not set")


@pytest_asyncio.fixture()
async def db_app(app):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.database import get_db
    from db.models import Base, Disc, Tape

    engine = create_async_engine(TEST_DB_URL)
    # Full schema: discs/tapes carry FKs to other tables (releases, disc_sets).
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
            Disc(id="d1", title="Alien", storage_type="Box", storage_id="MED0001",
                 raw_data={"id": "d1", "title": "Alien", "storageType": "Box", "storageId": "MED0001", "format": "DVD"}),
            Disc(id="d2", title="Heat", storage_type="Box", storage_id="MED0001",
                 raw_data={"id": "d2", "title": "Heat", "storageType": "Box", "storageId": "MED0001"}),
            Disc(id="d3", title="Jaws", storage_type="Binder", storage_id="MED0001", raw_data={"id": "d3"}),
            Disc(id="d4", title="Loose", raw_data={"id": "d4"}),
            Tape(id="t1", title="Home video", storage_type="Box", storage_id="MED0001",
                 raw_data={"id": "t1", "storageType": "Box", "storageId": "MED0001"}),
            Disc(id="d5", title="Other box", storage_type="Box", storage_id="MED0009", raw_data={"id": "d5"}),
        ])
        await s.commit()

    yield app, sessions
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@integration
@pytest.mark.integration
class TestStorageLocationsIntegration:
    @pytest.mark.asyncio
    async def test_list_counts_items_per_type_and_id_and_merges_metadata(self, db_app):
        app, _ = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            await ac.put("/api/storage-locations/Box/MED0001", json={"name": "Horror", "capacity": 40})
            await ac.put("/api/storage-locations/Binder/EMPTY01", json={"name": "New binder"})
            resp = await ac.get("/api/storage-locations")
        by_key = {(l["storageType"], l["storageId"]): l for l in resp.json()}
        assert by_key[("Box", "MED0001")] | {} == {
            "storageType": "Box", "storageId": "MED0001", "name": "Horror", "capacity": 40, "notes": None,
            "discCount": 2, "tapeCount": 1, "itemCount": 3,
        }
        assert by_key[("Binder", "MED0001")]["itemCount"] == 1
        assert by_key[("Binder", "EMPTY01")]["itemCount"] == 0  # metadata-only location still listed
        assert [l["storageType"] for l in resp.json()][0] == "Box"  # boxes first

    @pytest.mark.asyncio
    async def test_rename_moves_columns_and_raw_data_and_carries_metadata(self, db_app):
        app, sessions = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            await ac.put("/api/storage-locations/Box/MED0001", json={"name": "Horror"})
            resp = await ac.post("/api/storage-locations/Box/MED0001/rename", json={"newId": "HOR0001"})
            listing = (await ac.get("/api/storage-locations")).json()
        assert resp.status_code == 200
        assert resp.json()["moved"] == 3

        from sqlalchemy import select
        from db.models import Disc, Tape

        async with sessions() as s:
            d1 = (await s.execute(select(Disc).where(Disc.id == "d1"))).scalar_one()
            d3 = (await s.execute(select(Disc).where(Disc.id == "d3"))).scalar_one()
            t1 = (await s.execute(select(Tape).where(Tape.id == "t1"))).scalar_one()
        assert (d1.storage_id, d1.raw_data["storageId"], d1.raw_data["format"]) == ("HOR0001", "HOR0001", "DVD")
        assert t1.storage_id == "HOR0001" and t1.raw_data["storageId"] == "HOR0001"
        assert d3.storage_id == "MED0001"  # same ID, different type: untouched
        keys = {(l["storageType"], l["storageId"]): l for l in listing}
        assert ("Box", "MED0001") not in keys
        assert keys[("Box", "HOR0001")]["name"] == "Horror"

    @pytest.mark.asyncio
    async def test_rename_refuses_to_merge_into_an_occupied_id(self, db_app):
        app, sessions = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/storage-locations/Box/MED0001/rename", json={"newId": "MED0009"})
            same = await ac.post("/api/storage-locations/Box/MED0001/rename", json={"newId": "MED0001"})
        assert resp.status_code == 409
        assert same.status_code == 400

        from sqlalchemy import select
        from db.models import Disc

        async with sessions() as s:
            d1 = (await s.execute(select(Disc).where(Disc.id == "d1"))).scalar_one()
        assert d1.storage_id == "MED0001"
