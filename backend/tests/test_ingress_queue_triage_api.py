"""HTTP coverage for the grouped queue listing and bulk triage endpoints (issue #34)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


class _StubTriageService:
    def __init__(self):
        self.groups_kwargs = None
        self.bulk_kwargs = None

    async def get_queue_groups(self, **kwargs):
        self.groups_kwargs = kwargs
        return {
            "groups": [{"group_key": {"media_type": "movie", "ingress_path": "/inbox", "title": "the matrix"},
                        "item_count": 2, "preview_items": []}],
            "total_groups": 1,
            "total_items": 2,
            "status_counts": {"pending": 2},
            "limit": 25,
            "offset": 0,
            "preview_size": 5,
        }

    async def bulk_action(self, **kwargs):
        self.bulk_kwargs = kwargs
        return {
            "batch_id": "batch-1",
            "action": kwargs["action"],
            "requested": 1,
            "succeeded": 1,
            "failed": 0,
            "skipped": 0,
            "results": [{"item_id": "item-1", "action": kwargs["action"], "status": "succeeded",
                         "item_status": "ignored", "error": None}],
        }


def _wire(app, triage):
    app.state.ingress_queue_service = SimpleNamespace(db_session_factory=None)
    app.state.ingress_triage_service = triage
    return triage


class TestQueueGroupsEndpoint:
    @pytest.mark.asyncio
    async def test_splits_csv_filters_and_wraps_the_group_page(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get(
                "/api/ingress/queue/groups",
                params={"status": "pending,failed", "mediaType": "movie", "ingressPath": "/inbox",
                        "search": "matrix", "limit": 10, "offset": 5, "previewSize": 3},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["total_items"] == 2
        assert triage.groups_kwargs == {
            "statuses": ["pending", "failed"],
            "media_types": ["movie"],
            "ingress_paths": ["/inbox"],
            "search": "matrix",
            "limit": 10,
            "offset": 5,
            "preview_size": 3,
            "group_by": "parsed_title",
        }

    @pytest.mark.asyncio
    async def test_group_by_reaches_the_service(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/queue/groups", params={"groupBy": "source_folder"})

        assert resp.status_code == 200
        assert triage.groups_kwargs["group_by"] == "source_folder"

    @pytest.mark.asyncio
    async def test_400s_when_group_by_is_unknown(self, app):
        from services.ingress_triage_service import IngressTriageService

        app.state.ingress_queue_service = MagicMock()
        app.state.ingress_triage_service = IngressTriageService(app.state.ingress_queue_service,
                                                                db_session_factory=None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/queue/groups", params={"groupBy": "size"})

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_GROUP_BY"

    @pytest.mark.asyncio
    async def test_q_filters_groups_by_file_name_or_parsed_title(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/queue/groups", params={"q": "matrix"})

        assert resp.status_code == 200
        assert triage.groups_kwargs["search"] == "matrix"
        assert triage.groups_kwargs["statuses"] is None

    @pytest.mark.asyncio
    async def test_creates_a_triage_service_from_the_queue_service_when_absent(self, app):
        app.state.ingress_queue_service = SimpleNamespace(db_session_factory=None)
        if hasattr(app.state, "ingress_triage_service"):
            del app.state.ingress_triage_service

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ingress/queue/groups")

        # Unit runs point DATABASE_URL at a dead port: the failed query is a 503, not an empty 200.
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "TRIAGE_QUERY_FAILED"
        assert app.state.ingress_triage_service is not None


class TestQueueBulkEndpoint:
    @pytest.mark.asyncio
    async def test_returns_partial_success_summary(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/api/ingress/queue/bulk",
                json={
                    "action": "ignore",
                    "itemIds": ["item-1"],
                    "group": {"media_type": "movie", "ingress_path": "/inbox", "title": "the matrix"},
                    "statuses": ["pending"],
                    "excludeItemIds": ["item-9"],
                },
            )

        assert resp.status_code == 200
        assert resp.json()["data"]["batch_id"] == "batch-1"
        assert triage.bulk_kwargs["item_ids"] == ["item-1"]
        assert triage.bulk_kwargs["exclude_item_ids"] == ["item-9"]
        assert triage.bulk_kwargs["group"]["title"] == "the matrix"

    @pytest.mark.asyncio
    async def test_passes_a_source_folder_group_selector_through(self, app):
        triage = _wire(app, _StubTriageService())
        group = {"media_type": "movie", "ingress_path": "/inbox", "source_folder": "The.Matrix.1999.DISC1"}

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/ingress/queue/bulk", json={"action": "ignore", "group": group})

        assert resp.status_code == 200
        assert triage.bulk_kwargs["action"] == "ignore"
        assert triage.bulk_kwargs["group"] == group

    @pytest.mark.asyncio
    async def test_400s_when_the_bulk_request_is_invalid(self, app):
        from services.ingress_triage_service import IngressTriageService

        app.state.ingress_queue_service = MagicMock()
        app.state.ingress_triage_service = IngressTriageService(app.state.ingress_queue_service,
                                                                db_session_factory=None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/ingress/queue/bulk", json={"action": "delete", "itemIds": ["item-1"]})

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_BULK_REQUEST"
        assert "Unsupported bulk action" in resp.json()["detail"]["message"]


class _FailingTriageService:
    async def get_queue_groups(self, **kwargs):
        from services.ingress_triage_service import TriageQueryError
        raise TriageQueryError("db down")

    async def bulk_action(self, **kwargs):
        from services.ingress_triage_service import TriageQueryError
        raise TriageQueryError("db down")


@pytest.mark.asyncio
async def test_db_failure_is_a_503_not_an_empty_listing(app):
    _wire(app, _FailingTriageService())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        groups = await ac.get("/api/ingress/queue/groups")
        bulk = await ac.post("/api/ingress/queue/bulk", json={"action": "ignore", "itemIds": ["item-1"]})

    for resp in (groups, bulk):
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "TRIAGE_QUERY_FAILED"
