"""
Error handling for the catalog write endpoints (api/catalog.py) and the
app-wide JSON error responses (api/errors.py).

The handler/helper tests need no database. The rest are marked
`integration` and run against a real Postgres given by
CATALOG_TEST_DATABASE_URL (or STORAGE_LOCATIONS_TEST_DATABASE_URL) — skipped
when neither is set. They create and drop the full schema, so point it only
at a throwaway database, e.g.:

  docker run -d --rm -p 127.0.0.1:5439:5432 -e POSTGRES_PASSWORD=t postgres:16
  CATALOG_TEST_DATABASE_URL=postgresql+asyncpg://postgres:t@127.0.0.1:5439/postgres pytest tests/test_catalog_errors.py
"""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

TEST_DB_URL = os.environ.get("CATALOG_TEST_DATABASE_URL") or os.environ.get("STORAGE_LOCATIONS_TEST_DATABASE_URL")


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _override_auth(app):
    from api.mobile_auth import require_any_auth

    async def override():
        return MagicMock()

    app.dependency_overrides[require_any_auth] = override


# ---------------------------------------------------------------------------
# App-wide JSON errors
# ---------------------------------------------------------------------------

class TestErrorResponses:
    @pytest.mark.asyncio
    async def test_integrity_error_is_json_409_with_correlation_id(self, app):
        from sqlalchemy.exc import IntegrityError
        from db.database import get_db

        db = MagicMock()
        db.execute = AsyncMock(side_effect=IntegrityError("INSERT", {}, Exception("duplicate key")))

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/catalog/discs", json={"title": "Alien"}, headers={"X-Correlation-ID": "abc-123"})
            assert resp.status_code == 409
            assert resp.json()["correlation_id"] == "abc-123"
            assert "conflicts" in resp.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_unhandled_error_is_json_500_with_header(self, app):
        from db.database import get_db

        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("boom"))

        async def override_db():
            yield db

        app.dependency_overrides[get_db] = override_db
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/catalog/discs/d1", headers={"X-Correlation-ID": "req-9"})
            assert resp.status_code == 500
            assert resp.json() == {"detail": "Something went wrong on the server.", "correlation_id": "req-9"}
            assert resp.headers["X-Correlation-ID"] == "req-9"
        finally:
            app.dependency_overrides.clear()


class TestHelpers:
    def test_int_or_none_coerces_and_rejects(self):
        from api.catalog import _int_or_none

        assert _int_or_none("3", "Disc number") == 3
        assert _int_or_none(2.0, "Disc number") == 2
        assert _int_or_none("", "Disc number") is None
        assert _int_or_none(None, "Disc number") is None
        with pytest.raises(HTTPException) as exc:
            _int_or_none("Disc 1", "Disc number")
        assert exc.value.status_code == 422
        with pytest.raises(HTTPException):
            _int_or_none(True, "Disc number")


# ---------------------------------------------------------------------------
# Integration (real Postgres)
# ---------------------------------------------------------------------------

integration = pytest.mark.skipif(not TEST_DB_URL, reason="CATALOG_TEST_DATABASE_URL not set")


@pytest_asyncio.fixture()
async def db_app(app):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.database import get_db
    from db.models import Base, Disc, DiscSet, Movie

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
            DiscSet(id="set1", title="Alien Anthology"),
            Disc(id="d1", title="Alien", barcode="024543617907", storage_type="Box", storage_id="MED0001",
                 raw_data={"title": "Alien", "barcode": "024543617907", "storageType": "Box",
                           "storageId": "MED0001", "imageFiles": [{"fileName": "/x/cover.jpg"}],
                           "loan": {"to": "Sam"}}),
            Movie(id="tt0078748", title="Alien", image_files=[{"fileName": "/m/poster.jpg"}],
                  raw_data={"title": "Alien", "imageFiles": [{"fileName": "/m/poster.jpg"}],
                            "jellyfinInfo": {"folderPath": "/ark/Alien"}}),
        ])
        await s.commit()

    yield app, sessions
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@integration
@pytest.mark.integration
class TestCatalogErrorsIntegration:
    @pytest.mark.asyncio
    async def test_duplicate_barcode_is_409_only_when_checked(self, db_app):
        app, _ = db_app
        body = {"title": "Alien (copy)", "barcode": "024543617907"}
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            checked = await ac.post("/api/catalog/discs?check_duplicates=true", json=body)
            override = await ac.post("/api/catalog/discs?check_duplicates=true",
                                     json={**body, "allowDuplicateBarcode": True})
            unchecked = await ac.post("/api/catalog/discs", json=body)
        assert checked.status_code == 409
        assert checked.json()["detail"]["code"] == "duplicate_barcode"
        assert checked.json()["detail"]["existingId"] == "d1"
        assert override.status_code == 200
        assert "allowDuplicateBarcode" not in override.json()  # control flag isn't stored
        assert unchecked.status_code == 200  # disc-ripper-service path unchanged

    @pytest.mark.asyncio
    async def test_bad_disc_number_and_missing_set_are_422(self, db_app):
        app, _ = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            bad_number = await ac.post("/api/catalog/discs", json={"title": "X", "discNumber": "Disc 1"})
            string_number = await ac.post("/api/catalog/discs", json={"title": "X", "discNumber": "2", "setId": "set1"})
            missing_set = await ac.post("/api/catalog/discs", json={"title": "X", "setId": "gone"})
            bad_storage = await ac.post("/api/catalog/discs", json={"title": "X", "storageId": "MED/1"})
        assert bad_number.status_code == 422
        assert "whole number" in bad_number.json()["detail"]
        assert string_number.status_code == 200
        assert string_number.json()["discNumber"] == 2
        assert missing_set.status_code == 422
        assert bad_storage.status_code == 422

    @pytest.mark.asyncio
    async def test_storage_id_is_trimmed(self, db_app):
        app, _ = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/catalog/discs", json={"title": "X", "storageType": "Box", "storageId": " MED0002 "})
        assert resp.json()["storageId"] == "MED0002"

    @pytest.mark.asyncio
    async def test_merge_put_keeps_fields_it_was_not_sent(self, db_app):
        app, sessions = db_app
        from db.models import Disc

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.put("/api/catalog/discs/d1?merge=true", json={"title": "Alien", "condition": "Good", "storageId": None})
        assert resp.status_code == 200
        body = resp.json()
        assert body["imageFiles"] == [{"fileName": "/x/cover.jpg"}]
        assert body["loan"] == {"to": "Sam"}
        assert body["condition"] == "Good"
        assert body["storageId"] is None  # explicit null still clears
        async with sessions() as s:
            row = await s.get(Disc, "d1")
            assert row.storage_id is None
            assert row.barcode == "024543617907"

    @pytest.mark.asyncio
    async def test_movie_create_only_conflicts_and_plain_put_keeps_images(self, db_app):
        app, _ = db_app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            conflict = await ac.put("/api/catalog/movies/tt0078748?create_only=true", json={"title": "Alien"})
            fresh = await ac.put("/api/catalog/movies/tt0090605?create_only=true", json={"title": "Aliens", "imdbId": "tt0090605"})
            plain = await ac.put("/api/catalog/movies/tt0078748", json={"title": "Alien", "runtime": "117 min"})
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["existingId"] == "tt0078748"
        assert fresh.status_code == 200
        assert plain.json()["imageFiles"] == [{"fileName": "/m/poster.jpg"}]
        assert plain.json()["jellyfinInfo"] == {"folderPath": "/ark/Alien"}

    @pytest.mark.asyncio
    async def test_adding_the_same_link_twice_is_fine(self, db_app):
        app, _ = db_app
        link = {"mediaType": "movie", "mediaId": "tt0078748"}
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            first = await ac.post("/api/catalog/discs/d1/links", json=link)
            second = await ac.post("/api/catalog/discs/d1/links", json=link)
            links = (await ac.get("/api/catalog/discs/d1/links")).json()
        assert first.status_code == second.status_code == 200
        assert len(links) == 1
