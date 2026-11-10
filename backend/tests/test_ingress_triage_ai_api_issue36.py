"""HTTP coverage for the Jev confidence floor and the re-classify route (issue #36).

The bulk endpoint has to hand `min_confidence` to the triage service (which raises it to the
configured floor), and `/queue/ai-classify` has to be a pass-through to the decision model on
feat/jev-ingest-decisions: 503 when this backend has no classifier, never a made-up label.
"""

from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

STATE_KEYS = ("ingress_queue_service", "ingress_triage_service")


@pytest.fixture()
def app():
    from main import app as fastapi_app

    previous = {key: getattr(fastapi_app.state, key, None) for key in STATE_KEYS}
    yield fastapi_app
    for key, value in previous.items():
        setattr(fastapi_app.state, key, value)


class _StubTriageService:
    def __init__(self):
        self.bulk_kwargs = None

    async def bulk_action(self, **kwargs):
        self.bulk_kwargs = kwargs
        return {
            "batch_id": "batch-ai",
            "action": kwargs["action"],
            "requested": 2,
            "succeeded": 1,
            "failed": 0,
            "skipped": 1,
            "group_truncated": False,
            "group_limit": 1000,
            "confidence_floor": max(kwargs["min_confidence"] or 0.0, 0.7),
            "results": [
                {"item_id": "confident", "action": "accept", "status": "succeeded",
                 "item_status": "completed", "error": None},
                {"item_id": "short", "action": "accept", "status": "skipped",
                 "item_status": "pending", "error": "Jev confidence 0.55 is under the 0.8 floor"},
            ],
        }


def _wire(app, triage=None, queue_service=None):
    app.state.ingress_triage_service = triage
    app.state.ingress_queue_service = queue_service if queue_service is not None else SimpleNamespace(
        db_session_factory=None,
    )
    return triage


async def _post(ac, path, body):
    return await ac.post(path, json=body)


class TestBulkConfidenceFloor:
    @pytest.mark.asyncio
    async def test_forwards_min_confidence_and_surfaces_the_effective_floor(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await _post(ac, "/api/ingress/queue/bulk", {
                "action": "accept",
                "group_key": {"media_type": "movie", "ingress_path": "/inbox", "title": "the matrix"},
                "group_by": "parsed_title",
                "status": ["pending", "needs_review"],
                "min_confidence": 0.8,
            })

        assert resp.status_code == 200
        assert triage.bulk_kwargs["min_confidence"] == 0.8
        assert triage.bulk_kwargs["group"] == {
            "media_type": "movie", "ingress_path": "/inbox", "title": "the matrix",
        }
        body = resp.json()["data"]
        assert body["confidence_floor"] == 0.8
        assert body["skipped"] == 1
        assert body["results"][1]["error"] == "Jev confidence 0.55 is under the 0.8 floor"

    @pytest.mark.asyncio
    async def test_a_group_selector_uses_the_same_group_shape_as_the_listing(self, app):
        triage = _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await _post(ac, "/api/ingress/queue/bulk", {
                "action": "accept",
                "group": {"media_type": "movie", "ingress_path": "/inbox", "title": "the matrix"},
                "statuses": ["pending"],
                "min_confidence": 0,
            })

        assert resp.status_code == 200
        assert triage.bulk_kwargs["min_confidence"] == 0
        assert triage.bulk_kwargs["statuses"] == ["pending"]

    @pytest.mark.asyncio
    async def test_rejects_a_confidence_outside_the_zero_to_one_scale(self, app):
        _wire(app, _StubTriageService())

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            over = await _post(ac, "/api/ingress/queue/bulk", {"action": "accept", "itemIds": ["a"],
                                                               "min_confidence": 1.5})
            under = await _post(ac, "/api/ingress/queue/bulk", {"action": "accept", "itemIds": ["a"],
                                                                "min_confidence": -0.1})

        assert over.status_code == 422
        assert under.status_code == 422


class TestAIClassifyRoute:
    @pytest.mark.asyncio
    async def test_refuses_to_guess_when_this_backend_has_no_classifier(self, app):
        _wire(app, queue_service=SimpleNamespace(items_by_id={}, ai_classifier=None))

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await _post(ac, "/api/ingress/queue/ai-classify", {"itemId": "item-1"})

        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "INGEST_AI_NOT_CONFIGURED"

    @pytest.mark.asyncio
    async def test_hands_the_item_to_the_classifier_and_returns_its_answers(self, app):
        asked = []

        async def _refresh(item_id):
            asked.append(item_id)
            return [{"label": "alternate_version", "confidence": 0.83, "probabilities": {},
                     "model": "jev-decisions", "group_size": 3, "latency_ms": 41,
                     "classified_at": 1714564800.0, "demoted_from_main": False}]

        _wire(app, queue_service=SimpleNamespace(
            items_by_id={"item-1": object()},
            ai_classifier=SimpleNamespace(mode="shadow"),
            refresh_ai_classification=_refresh,
        ))

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await _post(ac, "/api/ingress/queue/ai-classify", {"itemId": "item-1"})

        assert resp.status_code == 200
        assert asked == ["item-1"]
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["mode"] == "shadow"
        assert body["data"]["classifications"][0]["label"] == "alternate_version"

    @pytest.mark.asyncio
    async def test_reports_a_queue_item_that_is_not_there(self, app):
        async def _refresh(item_id):
            return []

        _wire(app, queue_service=SimpleNamespace(
            items_by_id={}, ai_classifier=SimpleNamespace(mode="assist"), refresh_ai_classification=_refresh,
        ))

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await _post(ac, "/api/ingress/queue/ai-classify", {"itemId": "gone"})

        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "QUEUE_ITEM_NOT_FOUND"
