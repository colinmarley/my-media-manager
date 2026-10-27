"""The Jev suggestion/confidence surface triage exposes (issue #36, epic #17 slice 3).

Triage never classifies: it reads the answer the decision model stores at
`parsed_info["ai_classification"]` ({label, confidence, probabilities, model, group_size,
latency_ms, classified_at, demoted_from_main}), rolls it up per group, and refuses to let a bulk
accept go under `MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE`. Fake session rows stand in for the
Postgres aggregates; the fake queue service stands in for organizing.
"""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql
from db.models import IngressQueueItem as DBQueueItem
from services.ingress_queue_service import IngressQueueService, QUEUE_NEEDS_REVIEW, QUEUE_PENDING
from services.ingress_triage_service import (
    AI_LABELS,
    DEFAULT_AI_MIN_CONFIDENCE,
    IngressTriageService,
    ai_answer,
    ai_confidence,
    ai_settings,
)

QUEUED_AT = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)


class _FakeSession:
    """Async-session stand-in returning one queued row batch per execute() call."""

    def __init__(self, *row_batches):
        self.row_batches = list(row_batches)
        self.statements = []

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statements.append(statement)
        index = len(self.statements) - 1
        rows = self.row_batches[index] if index < len(self.row_batches) else []
        return SimpleNamespace(all=lambda: list(rows))


def _group_row(status, count, ai_answered=None, ai_agree=None, ai_conflict=None, ai_confidence_min=None):
    """One (group, status) aggregate row; None columns mimic rows predating the AI roll-up."""
    return SimpleNamespace(
        media_type="movie",
        ingress_path="/inbox",
        title="the matrix",
        source_folder="",
        status=status,
        item_count=count,
        min_confidence=80,
        max_confidence=95,
        first_queued_at=QUEUED_AT,
        last_queued_at=QUEUED_AT,
        ai_answered=ai_answered,
        ai_agree=ai_agree,
        ai_conflict=ai_conflict,
        ai_confidence_min=ai_confidence_min,
    )


def _queued_item(item_id, answer, status=QUEUE_PENDING):
    parsed_info = {"title": "The Matrix", "classification_hint": "main_feature"}
    if answer is not None:
        parsed_info["ai_classification"] = answer
    return {
        "id": item_id,
        "status": status,
        "file_name": "the.matrix.1999.mkv",
        "file_path": "/inbox/the.matrix.1999.mkv",
        "ingress_path": "/inbox",
        "parsed_info": parsed_info,
    }


class _StubQueueService:
    """Queue stand-in with items in hand: the confidence gate runs, nothing gets organized twice."""

    def __init__(self, items):
        self.items = {item["id"]: item for item in items}
        self.items_by_id = self.items
        self.organized = []

    def get_item(self, item_id):
        return self.items.get(item_id)

    async def mark_complete(self, item_id, history_extra=None):
        self.organized.append(item_id)
        return SimpleNamespace(id=item_id, status="completed", last_error=None)


def _triage(items):
    service = _StubQueueService(items)
    return service, IngressTriageService(service, db_session_factory=_FakeSession())


def _groups(rows, **kwargs):
    session = _FakeSession(rows)
    triage = IngressTriageService(IngressQueueService(db_session_factory=session), db_session_factory=session)
    return asyncio.run(triage.get_queue_groups(preview_size=0, **kwargs))


def test_ai_settings_come_from_the_environment_the_classifier_reads(monkeypatch):
    monkeypatch.delenv("MEDIA_LIBRARY_INGEST_AI_MODE", raising=False)
    monkeypatch.delenv("MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE", raising=False)
    assert ai_settings() == {"mode": "off", "min_confidence": DEFAULT_AI_MIN_CONFIDENCE}

    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MODE", "Shadow")
    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE", "1.4")
    assert ai_settings() == {"mode": "shadow", "min_confidence": 1.0}

    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MODE", "everything")
    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE", "not-a-number")
    assert ai_settings() == {"mode": "off", "min_confidence": DEFAULT_AI_MIN_CONFIDENCE}


def test_only_the_classifiers_own_labels_count_as_an_answer():
    assert set(AI_LABELS) == {"main_feature", "alternate_version", "special_feature"}
    answer = {"label": "alternate_version", "confidence": 0.83, "model": "jev"}
    assert ai_answer({"ai_classification": answer}) == answer
    assert ai_answer({}) is None
    assert ai_answer({"ai_classification": {"label": "documentary", "confidence": 0.99}}) is None
    assert ai_answer({"ai_classification_failed": "timeout"}) is None
    assert ai_confidence(answer) == 0.83
    assert ai_confidence({"label": "main_feature", "confidence": "0.4"}) == 0.4
    assert ai_confidence({"label": "main_feature", "confidence": "1.5"}) is None
    assert ai_confidence({"label": "main_feature"}) is None
    assert ai_confidence(None) is None


def test_group_rollup_reports_agreement_conflict_and_the_lowest_confidence():
    rows = [
        _group_row(QUEUE_PENDING, 4, ai_answered=3, ai_agree=2, ai_conflict=1, ai_confidence_min=0.72),
        _group_row(QUEUE_NEEDS_REVIEW, 2, ai_answered=1, ai_agree=1, ai_conflict=0, ai_confidence_min=0.61),
    ]
    result = _groups(rows)

    assert result["groups"][0]["ai_summary"] == {
        "answered": 4, "missing": 2, "agree": 3, "conflict": 1, "min_confidence": 0.61,
    }
    # The mode the answers came from travels with them, so the UI can say "advisory only".
    assert result["ai"] == {"mode": "off", "min_confidence": DEFAULT_AI_MIN_CONFIDENCE}


def test_group_rollup_only_counts_the_statuses_being_triaged(monkeypatch):
    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MODE", "shadow")
    rows = [
        _group_row(QUEUE_PENDING, 4, ai_answered=3, ai_agree=2, ai_conflict=1, ai_confidence_min=0.72),
        _group_row(QUEUE_NEEDS_REVIEW, 6, ai_answered=6, ai_agree=6, ai_conflict=0, ai_confidence_min=0.1),
    ]
    result = _groups(rows, statuses=[QUEUE_PENDING])

    assert result["groups"][0]["ai_summary"]["answered"] == 3
    assert result["groups"][0]["ai_summary"]["missing"] == 1
    assert result["groups"][0]["ai_summary"]["min_confidence"] == 0.72
    assert result["ai"] == {"mode": "shadow", "min_confidence": DEFAULT_AI_MIN_CONFIDENCE}


def test_groups_without_any_answer_still_report_zero_answered(monkeypatch):
    rows = [_group_row(QUEUE_PENDING, 5)]  # rows written before the roll-up existed
    result = _groups(rows)

    assert result["groups"][0]["ai_summary"] == {
        "answered": 0, "missing": 5, "agree": 0, "conflict": 0, "min_confidence": None,
    }


def test_group_statement_aggregates_the_stored_answer_shape():
    """The roll-up reads parsed_info->ai_classification, so the classifier's own shape is the contract."""
    statement = IngressTriageService(
        IngressQueueService(db_session_factory=_FakeSession()), db_session_factory=_FakeSession()
    )._group_statement([], "parsed_title")
    sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    for label in ("ai_answered", "ai_agree", "ai_conflict", "ai_confidence_min"):
        assert label in sql
    # The answer is read out of the classifier's own jsonb key, and measured against the parser hint.
    assert "'ai_classification'" in sql
    assert "'classification_hint'" in sql
    # Compared case-insensitively: the Postgres dialect renders this aggregate as `count(*) FILTER`.
    assert "count(*) filter" in sql.lower()
    assert DBQueueItem.parsed_info.name in sql


def test_bulk_accept_above_threshold_skips_shortfall_per_item(monkeypatch):
    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE", "0.70")
    items = [
        _queued_item("confident", {"label": "alternate_version", "confidence": 0.83}),
        _queued_item("short", {"label": "main_feature", "confidence": 0.55}),
        _queued_item("unanswered", None),
        _queued_item("unusable", {"label": "main_feature", "confidence": "n/a"}),
        _queued_item("failed-status", {"label": "main_feature", "confidence": 0.9}, status="processing"),
    ]
    service, triage = _triage(items)

    summary = asyncio.run(triage.bulk_action(action="accept", item_ids=[item["id"] for item in items],
                                             min_confidence=0.6))

    # The requested 0.6 is raised to the configured floor, so a hand-crafted request cannot lower it.
    assert summary["confidence_floor"] == 0.7
    assert service.organized == ["confident"]
    assert (summary["succeeded"], summary["skipped"], summary["failed"]) == (1, 4, 0)
    by_id = {result["item_id"]: result for result in summary["results"]}
    assert by_id["confident"]["status"] == "succeeded"
    assert "under the 0.7 floor" in by_id["short"]["error"]
    assert "No Jev answer" in by_id["unanswered"]["error"]
    assert "No Jev answer" in by_id["unusable"]["error"]
    assert "processing" in by_id["failed-status"]["error"]


def test_bulk_accept_without_a_threshold_still_accepts_unanswered_items():
    """AI off means no answer to gate on: accept keeps the issue #34 behaviour."""
    items = [_queued_item("unanswered", None), _queued_item("answered", {"label": "special_feature",
                                                                          "confidence": 0.2})]
    service, triage = _triage(items)

    summary = asyncio.run(triage.bulk_action(action="accept", item_ids=[item["id"] for item in items]))

    assert summary["confidence_floor"] is None
    assert service.organized == ["unanswered", "answered"]
    assert summary["succeeded"] == 2


def test_bulk_accept_threshold_of_zero_only_needs_an_answer(monkeypatch):
    monkeypatch.setenv("MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE", "0")
    items = [
        _queued_item("zero", {"label": "main_feature", "confidence": 0.0}),
        _queued_item("unanswered", None),
    ]
    service, triage = _triage(items)

    summary = asyncio.run(triage.bulk_action(action="accept", item_ids=["zero", "unanswered"], min_confidence=0))

    assert summary["confidence_floor"] == 0.0
    assert service.organized == ["zero"]
    assert summary["skipped"] == 1


def test_bulk_rejects_a_threshold_it_cannot_read():
    _, triage = _triage([_queued_item("any", None)])

    summary = asyncio.run(triage.bulk_action(action="accept", item_ids=["any"], min_confidence="maybe"))

    assert summary["error"] == "Unsupported minimum confidence: maybe"
