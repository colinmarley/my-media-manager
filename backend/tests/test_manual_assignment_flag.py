"""``is_manual_assignment`` comes from the route that received the person's action
(quick win 13), and the queue hands the file duration to the matcher (quick win 11).
"""

import asyncio
import os

import pytest

from db.models import MediaAssignment
from services.assignment_orchestrator import AssignmentOrchestrator
from services.ingress_queue_service import IngressQueueService
from services.ingress_triage_service import IngressTriageService
from tests.test_assignment_orchestrator import _FakeSessionFactory, _queue_item


class _CapturingOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append(dict(queue_item))
        return {"assignment_id": "a-1", "organized": False, "organization_result": None}


class _StubMatcher:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def search_and_match(self, parsed_info):
        self.calls.append(dict(parsed_info))
        return self.result


def _source_file(tmp_path, name="Some Movie (2010).mkv"):
    path = tmp_path / "ingest" / "Some Movie (2010)" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return os.fspath(path)


def _matched_item(service, tmp_path):
    item = service.add_manual_file(_source_file(tmp_path))
    item.best_match = {"source": "tmdb", "title": "Some Movie", "year": 2010, "media_type": "movie",
                       "confidence_score": 95, "media_id": "123", "imdb_id": "tt0000123"}
    item.match_candidates = [item.best_match]
    item.confidence_score = 95
    return item


# ---------------------------------------------------------------------------
# Orchestrator: the flag is read from the queue payload, not the match source
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("manual, source, expected", [
    (True, "tmdb", True),     # a person accepted a TMDB suggestion
    (False, "manual", False),  # the source string alone no longer makes it manual
    (None, "omdb", False),    # flag absent: automatic
])
async def test_orchestrator_records_manual_flag_from_queue_payload(manual, source, expected):
    factory = _FakeSessionFactory()
    orchestrator = AssignmentOrchestrator(auto_organize_enabled=False, db_session_factory=factory)
    item = _queue_item(best_match={"title": "Inception", "year": 2010, "media_id": "tt1375666",
                                   "media_type": "movie", "source": source})
    if manual is not None:
        item["manual_assignment"] = manual

    await orchestrator.auto_assign(item)

    assignment = next(obj for obj in factory.session.added if isinstance(obj, MediaAssignment))
    assert assignment.is_manual_assignment is expected


# ---------------------------------------------------------------------------
# Queue service: which entry points pass the flag
# ---------------------------------------------------------------------------


def test_accept_route_marks_assignment_manual(tmp_path):
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = _matched_item(service, tmp_path)

    asyncio.run(service.mark_complete(item.id, manual_action=True))

    assert orchestrator.calls[-1]["manual_assignment"] is True


def test_mark_complete_without_a_person_stays_automatic(tmp_path):
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = _matched_item(service, tmp_path)

    asyncio.run(service.mark_complete(item.id))

    assert orchestrator.calls[-1]["manual_assignment"] is False


def test_manual_assign_route_marks_assignment_manual(tmp_path):
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(_source_file(tmp_path))

    asyncio.run(service.manual_assign_item(
        item.id,
        {"source": "tmdb", "title": "Some Movie", "year": 2010, "media_type": "movie", "media_id": "123"},
        manual_action=True,
    ))

    assert orchestrator.calls[-1]["manual_assignment"] is True


def test_automatic_approval_is_not_manual(tmp_path):
    best = {"source": "manual", "title": "Some Movie", "year": 2010, "media_type": "movie",
            "confidence_score": 95, "media_id": "123", "imdb_id": "tt0000123"}
    matcher = _StubMatcher({"status": "success", "found": True, "candidates": [best], "best_match": best,
                            "ambiguous": False, "margin": None})
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(auto_matcher_service=matcher, assignment_orchestrator=orchestrator,
                                  auto_assign_threshold=80)
    service.add_manual_file(_source_file(tmp_path))

    asyncio.run(service.process_next_item())

    assert orchestrator.calls, "the item should have been auto-assigned"
    assert orchestrator.calls[-1]["manual_assignment"] is False


def test_bulk_accept_marks_assignments_manual(tmp_path):
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = _matched_item(service, tmp_path)
    item.status = "needs_review"
    triage = IngressTriageService(service)

    summary = asyncio.run(triage.bulk_action(action="accept", item_ids=[item.id]))

    assert summary.get("error") is None
    assert orchestrator.calls and orchestrator.calls[-1]["manual_assignment"] is True


def test_routes_pass_manual_action():
    """The two HTTP routes that receive a person's accept/assign set the flag."""
    import inspect

    from api import ingress_operations

    mark_complete_src = inspect.getsource(ingress_operations.mark_ingress_item_complete)
    manual_assign_src = inspect.getsource(ingress_operations.manual_assign_ingress_item)
    assert "manual_action=True" in mark_complete_src
    assert "manual_action=True" in manual_assign_src


# ---------------------------------------------------------------------------
# Queue → matcher: the duration is handed over but not stored in parsed_info
# ---------------------------------------------------------------------------


def test_queue_passes_media_duration_to_matcher(tmp_path, monkeypatch):
    monkeypatch.setattr("services.ingress_queue_service._get_file_duration", lambda path: 5_400_000)
    matcher = _StubMatcher({"status": "success", "found": False, "candidates": [], "best_match": None})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)
    service.add_manual_file(_source_file(tmp_path))

    processed = asyncio.run(service.process_next_item())

    assert matcher.calls[-1]["media_duration_ms"] == 5_400_000
    assert "media_duration_ms" not in processed.parsed_info
