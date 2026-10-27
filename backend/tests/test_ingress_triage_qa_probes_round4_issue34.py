"""Round-4 QA probes for issue #34 (tester-owned, independent of the builder's tests).

Round 3 blocked on two findings that only show up with the shapes a real Postgres driver
produces, so these probes pin exactly those shapes rather than the convenient fakes:

  AC1/AC4  `(await session.execute(select(DBQueueItem))).all()` really returns one-element
           `sqlalchemy.engine.Row` objects, not bare ORM entities. The probes below hand the
           service *real* `Row` instances, so the unwrap fix is pinned: if it regresses,
           `row.id`/`queue_item_from_row` break here instead of only on Postgres.
  AC1/AC3  a failing query must raise `TriageQueryError` out of `get_queue_groups`,
           `resolve_group` and `bulk_action`, and the real HTTP routes must answer 503
           `TRIAGE_QUERY_FAILED` (the round-3 fakes never failed, so an empty 200 could hide).
  AC3      the `q` filter is compiled with the Postgres dialect and asserted to reach
           `ingress_queue.file_name` and `parsed_info ->> 'title'`.
  AC4      a group selector is capped at `MAX_GROUP_ITEMS`, oldest `queued_at`/`id` first, and
           the truncation is reported to the caller instead of silently dropping items.

Nothing here touches product code.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Row
from sqlalchemy.engine.result import result_tuple

from db.models import IngressQueueItem as DBQueueItem
from services.ingress_queue_service import (
    IngressQueueService,
    QUEUE_PENDING,
)
import services.ingress_triage_service as triage_module
from services.ingress_triage_service import (
    IngressTriageService,
    MAX_GROUP_ITEMS,
    MAX_GROUP_PAGE_SIZE,
    MAX_PREVIEW_ITEMS,
    TriageQueryError,
)

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


def _orm(item_id, file_name, status=QUEUE_PENDING, queued_at=QUEUED_AT, title="The Matrix"):
    """A detached `ingress_queue` ORM entity - the object a real session yields per row."""
    return DBQueueItem(
        id=item_id,
        file_path=os.path.join(INGRESS_ROOT, "The.Matrix.1999.DISC1", file_name),
        file_name=file_name,
        ingress_path=INGRESS_ROOT,
        file_size=1024,
        detected_at=queued_at,
        queued_at=queued_at,
        status=status,
        priority=5,
        attempts=1,
        confidence_score=80,
        parsed_info={"title": title},
        best_match={"title": title, "year": 1999, "media_type": "movie", "media_id": "movie-1"},
        match_candidates=[],
    )


def _as_rows(entities):
    """Wrap entities the way `select(Entity)` results really come back: one-element Rows."""
    rows = [_one_element_row(entity) for entity in entities]
    assert all(isinstance(row, Row) and not isinstance(row, DBQueueItem) for row in rows)
    return rows


def _one_element_row(entity):
    """A genuine `sqlalchemy.engine.Row` holding exactly one ORM entity.

    Built with SQLAlchemy's own row factory (`result_tuple`), so `isinstance(row, Row)` is
    true and `row.id` raises AttributeError - exactly the shape a live session hands back.
    """
    row = result_tuple(["ingress_queue"])([entity])
    assert isinstance(row, Row) and not isinstance(row, DBQueueItem)
    return row


def _two_column_row(*values):
    """A genuine `Row` for a multi-column select (what the grouped aggregate query yields)."""
    row = result_tuple(["item_id", "status"])(list(values))
    assert isinstance(row, Row) and len(row) == 2
    return row


class _StaticSession:
    """Async session stand-in handing back a fixed list of rows."""

    def __init__(self, rows):
        self.rows = list(rows)
        self.statements = []

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(all=lambda: list(self.rows))


class _RowSession:
    """Async session stand-in returning real `Row` objects and honouring SELECT ... LIMIT."""

    def __init__(self, entities=(), aggregate_rows=()):
        self.entities = list(entities)
        self.aggregate_rows = list(aggregate_rows)
        self.statements = []
        self.added = []
        self.commits = 0

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.statements.append(statement)
        if self.aggregate_rows and "GROUP BY" in str(statement).upper():
            rows = list(self.aggregate_rows)
        else:
            rows = _as_rows(self.entities)
            limit = getattr(statement, "_limit_int_value", None)
            offset = getattr(statement, "_offset_int_value", None)
            if isinstance(offset, int):
                rows = rows[offset:]
            if isinstance(limit, int):
                rows = rows[:limit]
        return SimpleNamespace(
            all=lambda: rows,
            first=lambda: rows[0] if rows else None,
            scalars=lambda: SimpleNamespace(
                all=lambda: [row[0] if isinstance(row, Row) and len(row) == 1 else row for row in rows],
                first=lambda: (rows[0][0] if rows and isinstance(rows[0], Row) and len(rows[0]) == 1 else rows[0])
                if rows else None,
                unique=lambda: SimpleNamespace(all=lambda: rows),
            ),
        )

    def add(self, instance):
        self.added.append(instance)

    async def commit(self):
        self.commits += 1


class _BrokenSession:
    """Async session stand-in whose every query fails, like an unreachable Postgres."""

    def __init__(self):
        self.attempts = 0

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        self.attempts += 1
        raise RuntimeError("connection to server at 10.0.0.7 port 5432 refused")


def _aggregate(title, status, count, media_type="movie", ingress_path=INGRESS_ROOT):
    return SimpleNamespace(
        media_type=media_type,
        ingress_path=ingress_path,
        title=title,
        source_folder=None,
        status=status,
        item_count=count,
        min_confidence=80,
        max_confidence=91,
        first_queued_at=QUEUED_AT,
        last_queued_at=QUEUED_AT,
    )


# --------------------------------------------------------------------------------------
# AC1 + AC4 - the row shapes a real Postgres session yields
# --------------------------------------------------------------------------------------

def test_qa4_resolve_group_survives_real_one_element_rows():
    """Round-3 blocker: a real `select(DBQueueItem)` result yields Rows, not entities."""
    entities = [_orm("item-1", "The.Matrix.1999.1080p.mkv"), _orm("item-2", "The.Matrix.1999.720p.mkv")]
    session = _RowSession(entities)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    ids, truncated = asyncio.run(triage.resolve_group({"title": "the matrix"}, statuses=[QUEUE_PENDING]))

    assert ids == ["item-1", "item-2"]
    assert truncated is False
    # the rows also have to survive hydration, or the DB-only backlog stays unactionable
    assert queue_service.get_item("item-1")["file_name"] == "The.Matrix.1999.1080p.mkv"
    assert queue_service.get_item("item-2")["status"] == QUEUE_PENDING


def test_qa4_group_listing_previews_survive_real_one_element_rows():
    """`_load_items` feeds the same Row shapes into `hydrate_items`/`queue_item_from_row`."""
    entities = [_orm("item-1", "The.Matrix.1999.1080p.mkv"), _orm("item-2", "The.Matrix.1999.720p.mkv")]
    session = _RowSession(entities, aggregate_rows=[_aggregate("the matrix", QUEUE_PENDING, 2)])
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    data = asyncio.run(triage.get_queue_groups(statuses=[QUEUE_PENDING], preview_size=5))

    assert data["total_groups"] == 1
    assert data["status_counts"]["pending"] == 2
    assert [item["id"] for item in data["groups"][0]["preview_items"]] == ["item-1", "item-2"]


def test_qa4_fetch_leaves_multi_column_rows_alone():
    """Aggregate rows are not one-element Rows; unwrapping them would break the grouped listing."""
    pair = _two_column_row("item-1", QUEUE_PENDING)
    session = _StaticSession([pair])
    triage = IngressTriageService(IngressQueueService(db_session_factory=session), db_session_factory=session)

    rows = asyncio.run(triage._fetch(select(DBQueueItem.id, DBQueueItem.status)))

    assert len(pair) == 2
    assert rows[0] is pair, "a two-column row must come back untouched, not as its first column"


# --------------------------------------------------------------------------------------
# AC1 - a database that cannot be queried is reported, never answered with an empty page
# --------------------------------------------------------------------------------------

def test_qa4_a_failing_query_raises_from_every_triage_read():
    session = _BrokenSession()
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    for call in (
        lambda: triage.get_queue_groups(statuses=[QUEUE_PENDING]),
        lambda: triage.resolve_group({"title": "the matrix"}),
        lambda: triage.bulk_action(action="ignore", group={"title": "the matrix"}),
    ):
        with pytest.raises(TriageQueryError):
            asyncio.run(call())

    assert session.attempts >= 3


def test_qa4_http_group_listing_returns_503_when_the_queue_table_is_unreachable():
    from main import app

    session = _BrokenSession()
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    saved = _app_state_snapshot()
    app.state.ingress_queue_service = queue_service
    app.state.ingress_triage_service = triage

    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/api/ingress/queue/groups")

    try:
        response = asyncio.run(run())
        assert response.status_code == 503, response.text
        assert "TRIAGE_QUERY_FAILED" in response.text
        assert session.attempts >= 1, "the route really queried the database"
    finally:
        _restore_app(saved)


def test_qa4_http_bulk_action_returns_503_when_the_group_selector_cannot_be_resolved():
    from main import app

    session = _BrokenSession()
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    saved = _app_state_snapshot()
    app.state.ingress_queue_service = queue_service
    app.state.ingress_triage_service = triage

    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/ingress/queue/bulk",
                                     json={"action": "ignore", "group": {"title": "the matrix"}})

    try:
        response = asyncio.run(run())
        assert response.status_code == 503, response.text
        assert "TRIAGE_QUERY_FAILED" in response.text
    finally:
        _restore_app(saved)


# --------------------------------------------------------------------------------------
# AC3 - the search filter really reaches file_name and parsed_info->>'title' on Postgres
# --------------------------------------------------------------------------------------

def test_qa4_search_filter_compiles_for_postgres_to_file_name_and_parsed_title():
    triage = IngressTriageService(IngressQueueService())
    statement = triage._group_statement(triage._filters(None, None, "matrix"), "parsed_title")
    sql = str(statement.compile(dialect=postgresql.dialect()))
    params = list(statement.compile(dialect=postgresql.dialect()).params.values())

    assert "ingress_queue.file_name ILIKE" in sql
    assert "ingress_queue.parsed_info ->>" in sql, "q has to reach parsed_info->>'title'"
    assert "ingress_queue.best_match ->>" in sql
    assert any("matrix" in str(value) for value in params), "the q term must reach the ILIKE bind"
    assert "title" in params, "the JSON path being matched is the parsed title"


def test_qa4_group_limit_and_preview_size_are_capped_server_side():
    session = _RowSession()
    triage = IngressTriageService(IngressQueueService(db_session_factory=session), db_session_factory=session)

    data = asyncio.run(triage.get_queue_groups(limit=10_000, offset=-5, preview_size=10_000))

    assert data["limit"] == MAX_GROUP_PAGE_SIZE
    assert data["offset"] == 0
    assert data["preview_size"] == MAX_PREVIEW_ITEMS
    group_statement = session.statements[0]
    assert "GROUP BY" in str(group_statement).upper()


# --------------------------------------------------------------------------------------
# AC4 - a group selector is capped, oldest first, and the cap is reported
# --------------------------------------------------------------------------------------

def test_qa4_group_selector_is_capped_oldest_first_and_reports_truncation(tmp_path, monkeypatch):
    monkeypatch.setattr(triage_module, "MAX_GROUP_ITEMS", 2)

    # handed back in the order Postgres answers an `ORDER BY queued_at, id` scan
    older = _orm("item-old", "The.Matrix.1999.1080p.mkv", queued_at=QUEUED_AT - timedelta(days=2))
    middle = _orm("item-middle", "The.Matrix.1999.720p.mkv", queued_at=QUEUED_AT - timedelta(days=1))
    newer = _orm("item-new", "The.Matrix.2003.1080p.mkv", queued_at=QUEUED_AT + timedelta(days=1),
                 title="The Matrix Reloaded")
    session = _RowSession([older, middle, newer])
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    ids, truncated = asyncio.run(triage.resolve_group({"media_type": "movie", "ingress_path": INGRESS_ROOT}))

    assert ids == ["item-old", "item-middle"], "the oldest items act first, so a repeat picks up the rest"
    assert truncated is True

    selector = session.statements[-1]
    compiled = selector.compile(dialect=postgresql.dialect())
    assert "ORDER BY ingress_queue.queued_at, ingress_queue.id" in str(compiled)
    assert "LIMIT" in str(compiled).upper()
    assert 3 in list(compiled.params.values()), "the cap is enforced in SQL by asking for MAX_GROUP_ITEMS + 1"


def test_qa4_capped_group_bulk_action_acts_on_the_oldest_items_and_says_so(monkeypatch):
    monkeypatch.setattr(triage_module, "MAX_GROUP_ITEMS", 2)

    older = _orm("item-old", "The.Matrix.1999.1080p.mkv", queued_at=QUEUED_AT - timedelta(days=2))
    middle = _orm("item-middle", "The.Matrix.1999.720p.mkv", queued_at=QUEUED_AT - timedelta(days=1))
    newer = _orm("item-new", "The.Matrix.2003.1080p.mkv", queued_at=QUEUED_AT + timedelta(days=1))
    session = _RowSession([older, middle, newer])
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    applied = []

    async def _record(batch_id, history_extra, action, item_id, override, min_confidence=None):
        applied.append((item_id, action, history_extra))
        return triage._result(item_id, action, "succeeded", item_status="ignored")

    monkeypatch.setattr(triage, "_apply_bulk_item", _record)

    summary = asyncio.run(triage.bulk_action(action="ignore", group={"media_type": "movie"}))

    assert [item_id for item_id, _, _ in applied] == ["item-old", "item-middle"]
    assert (summary["requested"], summary["succeeded"], summary["failed"]) == (2, 2, 0)
    assert summary["group_truncated"] is True
    assert summary["group_limit"] == 2
    assert {extra["source"] for _, _, extra in applied} == {"bulk"}
    assert {extra["action"] for _, _, extra in applied} == {"ignore"}
    assert {extra["batch_id"] for _, _, extra in applied} == {summary["batch_id"]}
