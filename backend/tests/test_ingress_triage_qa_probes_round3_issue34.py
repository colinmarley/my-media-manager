"""Round-3 QA probes for issue #34 (tester-owned, independent of the builder's tests).

What this file adds on top of the round-2 probes:

  AC6  `exactly one ingress_processing_history row per mutated bulk item` is proven at the
       *database* layer (a recorded `session.add(IngressProcessingHistory(...))`) for accept,
       retry and classify - the round-2 probes only counted DB rows for ignore/classify and
       only counted in-memory entries for accept.
  AC4  the group selector is scoped server-side by `statuses` and `excludeItemIds`: only the
       intended persisted rows change status.
  AC1/AC4/AC6 `POST /api/ingress/queue/bulk` is exercised end-to-end through the real route and
       the real `IngressTriageService` (the builder's API tests stub the triage service, and the
       service tests never go through HTTP).

Nothing here touches product code.
"""

import asyncio
import os
from datetime import datetime, timezone
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient

from db.models import IngressProcessingHistory as DBHistory
from services.ingress_queue_service import (
    IngressQueueService,
    QUEUE_ALL_STATUSES,
    QUEUE_COMPLETED,
    QUEUE_FAILED,
    QUEUE_IGNORED,
    QUEUE_PENDING,
)
from services.ingress_triage_service import IngressTriageService

QUEUED_AT = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
INGRESS_ROOT = "/ark/media/ingest"

APP_STATE_KEYS = ("ingress_queue_service", "ingress_triage_service", "ingress_watcher_service")


def _app_state_snapshot():
    from main import app

    return {key: getattr(app.state, key, None) for key in APP_STATE_KEYS}


def _restore_app(saved):
    from main import app

    for key in APP_STATE_KEYS:
        setattr(app.state, key, saved[key])


def _row(item_id, file_name, status=QUEUE_PENDING, ingress_path=INGRESS_ROOT, best_match=None, **overrides):
    """Attribute-shaped stand-in for a persisted `ingress_queue` row."""
    row = SimpleNamespace(
        id=item_id,
        file_path=os.path.join(ingress_path, file_name),
        file_name=file_name,
        ingress_path=ingress_path,
        file_size=1024,
        detected_at=QUEUED_AT,
        queued_at=QUEUED_AT,
        status=status,
        priority=5,
        attempts=1,
        last_attempt=None,
        processed_at=None,
        last_error="transient matcher failure" if status == QUEUE_FAILED else None,
        confidence_score=80,
        assignment_id=None,
        parsed_info={"title": (best_match or {}).get("title", file_name)},
        best_match=best_match or {},
        match_candidates=[],
        media_duration_ms=None,
        proposed_path=None,
        classification_override=None,
    )
    for field, value in overrides.items():
        setattr(row, field, value)
    return row


class _RecordingSession:
    """Fake async session: answers id lookups from `rows`, records every add()/commit()."""

    def __init__(self, rows=()):
        self.rows = {row.id: row for row in rows}
        self.added = []
        self.commits = 0
        self.statements = []

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def _ids_in(self, statement):
        """Read the `ingress_queue.id = <literal>` equalities out of the statement tree."""
        ids = set()
        stack = [getattr(statement, "whereclause", None)]
        while stack:
            node = stack.pop()
            if node is None:
                continue
            try:
                if str(node).startswith("ingress_queue.id ="):
                    value = getattr(getattr(node, "right", None), "value", None)
                    if isinstance(value, str):
                        ids.add(value)
                stack.extend(list(node.get_children()))
            except Exception:  # the fake stays tolerant of SQLAlchemy internals
                continue
        return ids

    def _status_filter(self, statement):
        """Statuses pushed into the statement by the product (`status IN (...)` / `status = ...`)."""
        try:
            params = statement.compile().params
        except Exception:
            return None
        for value in params.values():
            if isinstance(value, str) and value in QUEUE_ALL_STATUSES:
                return {value}
            if isinstance(value, (list, tuple)) and value and all(v in QUEUE_ALL_STATUSES for v in value):
                return set(value)
        return None

    async def execute(self, statement):
        self.statements.append(statement)
        ids = self._ids_in(statement)
        if ids:
            rows = [self.rows[item_id] for item_id in ids if item_id in self.rows]
        else:
            rows = list(self.rows.values())
        statuses = self._status_filter(statement)
        if statuses:
            rows = [row for row in rows if getattr(row, "status", None) in statuses]
        result = SimpleNamespace(
            all=lambda: rows,
            first=lambda: (rows[0],) if rows else None,
            scalar_one_or_none=lambda: rows[0] if rows else None,
            scalars=lambda: SimpleNamespace(
                all=lambda: rows,
                first=lambda: rows[0] if rows else None,
                unique=lambda: SimpleNamespace(all=lambda: rows),
            ),
        )
        return result

    async def get(self, model, item_id):
        return self.rows.get(str(item_id))

    def add(self, instance):
        self.added.append(instance)

    async def commit(self):
        self.commits += 1

    def history_snapshots(self):
        """Every `ingress_processing_history` row this session was asked to insert."""
        return [getattr(instance, "snapshot", None) for instance in self.added if isinstance(instance, DBHistory)]


class _AutoAssignOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({"item_id": queue_item.get("id"), "force_organize": force_organize})
        return {
            "assignment_id": f"assignment-{queue_item.get('id')}",
            "organized": True,
            "organization_result": {"success": True, "targetPath": None, "operations": []},
        }


def _movie_source(tmp_path, name):
    source = tmp_path / "ingest" / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"qa-round3")
    return source


def _pending_items(tmp_path, service, count):
    items = []
    for index in range(count):
        item = service.add_manual_file(os.fspath(_movie_source(tmp_path, f"matrix-{index}.mkv")))
        item.best_match = {"title": "The Matrix", "year": 2000, "media_type": "movie", "media_id": "movie-1"}
        item.confidence_score = 96
        items.append(item)
    return items


# --------------------------------------------------------------------------------------
# AC6 - one persisted history row per mutated item, for every bulk action
# --------------------------------------------------------------------------------------

def test_qa3_bulk_accept_writes_exactly_one_history_row_per_item_to_the_database(tmp_path, monkeypatch):
    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base",
                        os.fspath(tmp_path / "jellyfin"))
    session = _RecordingSession()
    orchestrator = _AutoAssignOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator, db_session_factory=session)
    items = _pending_items(tmp_path, service, 2)

    triage = IngressTriageService(service, db_session_factory=session)
    result = asyncio.run(triage.bulk_action(action="accept", item_ids=[item.id for item in items]))

    assert (result["succeeded"], result["failed"], result["skipped"]) == (2, 0, 0)
    history = session.history_snapshots()
    assert len(history) == 2, f"one ingress_processing_history row per mutated item, got {len(history)}"
    for snapshot in history:
        assert snapshot["batch_id"] == result["batch_id"]
        assert snapshot["action"] == "accept"
        assert snapshot["source"] == "bulk"
    assert {snapshot["item_id"] for snapshot in history} == {item.id for item in items}
    assert [len(orchestrator.calls)] == [2]
    assert all(service.get_item(item.id)["status"] == QUEUE_COMPLETED for item in items)


def test_qa3_bulk_retry_and_classify_write_one_history_row_per_item_to_the_database(tmp_path):
    session = _RecordingSession()
    service = IngressQueueService(db_session_factory=session)
    retried = _pending_items(tmp_path, service, 2)
    classified = _pending_items(tmp_path, service, 3)

    triage = IngressTriageService(service, db_session_factory=session)
    retry_result = asyncio.run(triage.bulk_action(action="retry", item_ids=[item.id for item in retried]))
    classify_result = asyncio.run(
        triage.bulk_action(action="classify", item_ids=[item.id for item in classified],
                           classification="main_feature")
    )

    assert (retry_result["succeeded"], classify_result["succeeded"]) == (2, 3)
    history = session.history_snapshots()
    assert len(history) == 5, f"2 retried + 3 classified items -> 5 history rows, got {len(history)}"
    by_action = {}
    for snapshot in history:
        by_action.setdefault(snapshot["action"], []).append(snapshot)
    assert sorted(by_action) == ["classify", "retry"]
    assert len(by_action["retry"]) == 2 and len(by_action["classify"]) == 3
    for snapshots in by_action.values():
        assert {snapshot["source"] for snapshot in snapshots} == {"bulk"}
        assert len({snapshot["batch_id"] for snapshot in snapshots}) == 1


def test_qa3_failed_and_skipped_bulk_items_write_no_history_rows(tmp_path):
    """Only mutated items get a history row: ghosts and terminal rows mutate nothing."""
    session = _RecordingSession()
    service = IngressQueueService(db_session_factory=session)
    item = _pending_items(tmp_path, service, 1)[0]

    triage = IngressTriageService(service, db_session_factory=session)
    result = asyncio.run(triage.bulk_action(action="accept", item_ids=[item.id, "ghost", "another-ghost"]))

    assert (result["succeeded"], result["failed"]) == (1, 2)
    history = session.history_snapshots()
    assert len(history) == 1
    assert history[0]["item_id"] == item.id


# --------------------------------------------------------------------------------------
# AC4 / AC5 - group selector scoped by statuses and excludeItemIds
# --------------------------------------------------------------------------------------

def test_qa3_group_selector_with_statuses_and_exclusions_only_mutates_the_intended_rows():
    matrix = {"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}
    rows = [
        _row("pending-1", "The.Matrix.1999.1080p.mkv", status=QUEUE_PENDING, best_match=matrix),
        _row("pending-2", "The.Matrix.1999.720p.mkv", status=QUEUE_PENDING, best_match=matrix),
        _row("failed-1", "The.Matrix.1999.mkv", status=QUEUE_FAILED, best_match=matrix),
    ]
    session = _RecordingSession(rows)
    service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(service, db_session_factory=session)

    result = asyncio.run(triage.bulk_action(
        action="ignore",
        group={"media_type": "movie", "ingress_path": INGRESS_ROOT, "title": "the matrix"},
        statuses=[QUEUE_PENDING],
        exclude_item_ids=["pending-2"],
    ))

    assert (result["requested"], result["succeeded"], result["failed"], result["skipped"]) == (1, 1, 0, 0)
    assert [entry["item_id"] for entry in result["results"]] == ["pending-1"]
    assert result["results"][0]["item_status"] == QUEUE_IGNORED
    statuses = {row.id: row.status for row in rows}
    assert statuses == {
        "pending-1": QUEUE_IGNORED,
        "pending-2": QUEUE_PENDING,
        "failed-1": QUEUE_FAILED,
    }, "statuses=[pending] + excludeItemIds must scope the group selector"
    assert len(session.history_snapshots()) == 1


def test_qa3_group_selector_without_statuses_reaches_every_status_in_the_group():
    matrix = {"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}
    rows = [
        _row("pending-1", "The.Matrix.1999.1080p.mkv", status=QUEUE_PENDING, best_match=matrix),
        _row("failed-1", "The.Matrix.1999.720p.mkv", status=QUEUE_FAILED, best_match=matrix),
        _row("done-1", "The.Matrix.1999.2160p.mkv", status=QUEUE_COMPLETED, best_match=matrix),
        _row("ignored-1", "The.Matrix.1999.mkv", status=QUEUE_IGNORED, best_match=matrix),
    ]
    session = _RecordingSession(rows)
    service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(service, db_session_factory=session)

    result = asyncio.run(triage.bulk_action(
        action="ignore",
        group={"media_type": "movie", "ingress_path": INGRESS_ROOT, "title": "the matrix"},
    ))

    assert result["requested"] == 4
    statuses = {row.id: row.status for row in rows}
    assert statuses["pending-1"] == QUEUE_IGNORED and statuses["failed-1"] == QUEUE_IGNORED
    assert statuses["done-1"] == QUEUE_IGNORED, "ignoring a completed row is allowed (only ignored is final)"
    assert statuses["ignored-1"] == QUEUE_IGNORED
    assert (result["succeeded"], result["skipped"]) == (3, 1)
    skipped = next(entry for entry in result["results"] if entry["item_id"] == "ignored-1")
    assert skipped["status"] == "skipped" and "Cannot ignore" in skipped["error"]
    assert len(session.history_snapshots()) == 3, "skipped items write no history row"


# --------------------------------------------------------------------------------------
# AC1 + AC4 + AC6 - the real HTTP route against the real triage service and a persisted backlog
# --------------------------------------------------------------------------------------

def test_qa3_http_bulk_ignore_of_a_persisted_backlog_persists_status_and_one_history_row_each():
    from main import app

    rows = [
        _row("backlog-1", "The.Matrix.1999.1080p.mkv", status=QUEUE_PENDING,
             best_match={"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}),
        _row("backlog-2", "The.Matrix.1999.720p.mkv", status=QUEUE_PENDING,
             best_match={"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}),
    ]
    session = _RecordingSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    saved = _app_state_snapshot()
    app.state.ingress_queue_service = queue_service
    app.state.ingress_triage_service = triage

    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/ingress/queue/bulk",
                                     json={"action": "ignore", "itemIds": ["backlog-1", "backlog-2"]})

    try:
        assert queue_service.get_item("backlog-1") is None, "the backlog is DB-only before the call"

        response = asyncio.run(run())

        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert (data["requested"], data["succeeded"], data["failed"]) == (2, 2, 0)
        assert {entry["item_status"] for entry in data["results"]} == {QUEUE_IGNORED}

        # the persisted rows changed, and the pre-restart backlog is now actionable
        assert {row.status for row in rows} == {QUEUE_IGNORED}
        assert queue_service.get_item("backlog-1")["status"] == QUEUE_IGNORED

        history = session.history_snapshots()
        assert len(history) == 2
        assert {snapshot["batch_id"] for snapshot in history} == {data["batch_id"]}
        assert {snapshot["action"] for snapshot in history} == {"ignore"}
        assert {snapshot["source"] for snapshot in history} == {"bulk"}

        # AC7: an ignored backlog row never comes back through auto-retry
        assert queue_service.get_retry_candidate_ids() == []
    finally:
        _restore_app(saved)


def test_qa3_http_group_listing_of_a_persisted_backlog_reports_counts_without_mutating():
    from main import app

    matrix = {"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}
    rows = [
        _row("backlog-1", "The.Matrix.1999.1080p.mkv", status=QUEUE_PENDING, best_match=matrix),
        _row("backlog-2", "The.Matrix.1999.720p.mkv", status=QUEUE_COMPLETED, best_match=matrix),
        _row("backlog-3", "Unparsed.File.mkv", status=QUEUE_IGNORED),
    ]
    session = _RecordingSession(rows)

    class _GroupsSession(_RecordingSession):
        async def execute(self, statement):
            self.statements.append(statement)
            if "count()" in str(statement) or "GROUP BY" in str(statement).upper():
                group_rows = [
                    SimpleNamespace(
                        media_type="movie", ingress_path=INGRESS_ROOT, title="the matrix", source_folder=None,
                        status="pending", item_count=1, min_confidence=80, max_confidence=80,
                        first_queued_at=QUEUED_AT, last_queued_at=QUEUED_AT,
                    ),
                    SimpleNamespace(
                        media_type="movie", ingress_path=INGRESS_ROOT, title="the matrix", source_folder=None,
                        status="completed", item_count=1, min_confidence=80, max_confidence=80,
                        first_queued_at=QUEUED_AT, last_queued_at=QUEUED_AT,
                    ),
                ]
                return SimpleNamespace(
                    all=lambda: group_rows,
                    first=lambda: (group_rows[0],) if group_rows else None,
                    scalar_one_or_none=lambda: group_rows[0] if group_rows else None,
                )
            return await super().execute(statement)

    group_session = _GroupsSession(rows)
    queue_service = IngressQueueService(db_session_factory=group_session)
    triage = IngressTriageService(queue_service, db_session_factory=group_session)

    saved = _app_state_snapshot()
    app.state.ingress_queue_service = queue_service
    app.state.ingress_triage_service = triage

    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/ingress/queue/groups", params={"status": "pending"})

    try:
        response = asyncio.run(run())
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["total_groups"] == 1
        group = data["groups"][0]
        assert group["item_count"] == 2 and group["matching_count"] == 1
        assert group["status_counts"] == {"pending": 1, "completed": 1}
        assert data["status_counts"]["pending"] == 1

        # listing is read-only: nothing was written, nothing changed status
        assert group_session.added == []
        assert {row.status for row in rows} == {QUEUE_PENDING, QUEUE_COMPLETED, QUEUE_IGNORED}
    finally:
        _restore_app(saved)
