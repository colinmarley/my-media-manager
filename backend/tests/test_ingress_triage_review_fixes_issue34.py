"""Issue #34 final-review findings (PR #44):

1. group previews were fetched by an offset into an SQL ordering that the Python page order didn't
   share, so previews landed on the wrong group (or none);
2. bulk accept/ignore of an item the auto-processor holds (`processing`) was overwritten by it;
3. an ignored file came back as pending (or as a duplicate row after a restart) when re-detected.

Postgres tests run when INGRESS_TRIAGE_TEST_DATABASE_URL is set (a throwaway database).
"""

import asyncio
import os
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from services.ingress_queue_service import (
    QUEUE_COMPLETED,
    QUEUE_FAILED,
    QUEUE_IGNORED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
    QUEUE_PROCESSING,
    IngressQueueService,
    QueueItemBusy,
)
from services.ingress_triage_service import BULK_ACTION_STATUSES, BULK_ACCEPT, BULK_IGNORE, IngressTriageService

TEST_DB_URL = os.environ.get("INGRESS_TRIAGE_TEST_DATABASE_URL")
integration = pytest.mark.skipif(not TEST_DB_URL, reason="INGRESS_TRIAGE_TEST_DATABASE_URL not set")
QUEUED_AT = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)


def _watched(path: str, ingress_path: str = "/inbox") -> SimpleNamespace:
    """What FileWatcherService hands to add_from_watcher."""
    now = time.time()
    return SimpleNamespace(file_path=path, file_name=os.path.basename(path), ingress_path=ingress_path,
                           file_size=1024, detected_at=now, queued_at=now)


def _queued(service: IngressQueueService, path: str, status: str):
    item = service.add_from_watcher(_watched(path))
    item.status = status
    return item


# ── finding 2: `processing` items are not actionable ────────────────────────────────────────


def test_bulk_accept_and_ignore_never_target_processing_items():
    assert QUEUE_PROCESSING not in BULK_ACTION_STATUSES[BULK_ACCEPT]
    assert QUEUE_PROCESSING not in BULK_ACTION_STATUSES[BULK_IGNORE]


def test_mark_ignored_refuses_an_item_the_processor_holds():
    service = IngressQueueService()
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_PROCESSING)

    with pytest.raises(QueueItemBusy):
        asyncio.run(service.mark_ignored(item.id))
    assert service.get_item(item.id)["status"] == QUEUE_PROCESSING


def test_bulk_ignore_skips_a_processing_item_with_the_reason():
    service = IngressQueueService()
    busy = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_PROCESSING)
    free = _queued(service, "/inbox/Heat/heat-extras.mkv", QUEUE_NEEDS_REVIEW)
    triage = IngressTriageService(service, db_session_factory=None)

    summary = asyncio.run(triage.bulk_action(action="ignore", item_ids=[busy.id, free.id]))

    by_id = {result["item_id"]: result for result in summary["results"]}
    assert by_id[busy.id]["status"] == "skipped" and "processing" in by_id[busy.id]["error"]
    assert by_id[free.id]["status"] == "succeeded"
    assert service.get_item(busy.id)["status"] == QUEUE_PROCESSING  # untouched: the processor still owns it


def test_bulk_ignore_that_races_the_processor_is_skipped_not_failed():
    """The status check passes, then the processor claims the item before mark_ignored takes the lock."""
    service = IngressQueueService()
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_NEEDS_REVIEW)
    triage = IngressTriageService(service, db_session_factory=None)
    real_mark_ignored = service.mark_ignored

    async def claimed_first(item_id, history_extra=None):
        service.items_by_id[item_id].status = QUEUE_PROCESSING
        return await real_mark_ignored(item_id, history_extra=history_extra)

    service.mark_ignored = claimed_first
    summary = asyncio.run(triage.bulk_action(action="ignore", item_ids=[item.id]))

    assert summary["results"][0]["status"] == "skipped"
    assert summary["failed"] == 0


class _ObservingOrchestrator:
    """Records the item's status while organizing (it must be claimed), then succeeds or raises."""

    def __init__(self, service, raises=False):
        self.service, self.raises, self.seen = service, raises, []

    async def auto_assign(self, queue_item, force_organize=False):
        self.seen.append(self.service.items_by_id[queue_item["id"]].status)
        if self.raises:
            raise RuntimeError("organizer exploded")
        return {"assignment_id": "a-1", "organized": True, "organization_result": {"success": True}}


def test_mark_complete_claims_the_item_while_it_organizes():
    service = IngressQueueService()
    orchestrator = _ObservingOrchestrator(service)
    service.assignment_orchestrator = orchestrator
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_NEEDS_REVIEW)

    done = asyncio.run(service.mark_complete(item.id))

    assert orchestrator.seen == [QUEUE_PROCESSING]  # the auto-processor can't pick it up meanwhile
    assert done.status == QUEUE_COMPLETED


def test_mark_complete_refuses_an_item_the_processor_holds():
    service = IngressQueueService()
    service.assignment_orchestrator = _ObservingOrchestrator(service)
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_PROCESSING)

    with pytest.raises(QueueItemBusy):
        asyncio.run(service.mark_complete(item.id))
    assert service.assignment_orchestrator.seen == []


def test_mark_complete_settles_a_status_when_the_organizer_raises():
    """The claim must never outlive the call: a failing organizer leaves the item failed, not `processing`."""
    service = IngressQueueService()
    service.assignment_orchestrator = _ObservingOrchestrator(service, raises=True)
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_NEEDS_REVIEW)

    done = asyncio.run(service.mark_complete(item.id))

    assert done.status == QUEUE_FAILED and done.last_error  # _attempt_auto_assignment logs and swallows it


def test_mark_complete_settles_a_status_when_the_assignment_step_itself_raises():
    """If _attempt_auto_assignment raised, assignment_result used to be unbound (NameError)."""
    service = IngressQueueService()
    service.assignment_orchestrator = _ObservingOrchestrator(service)
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_NEEDS_REVIEW)

    async def boom(queue_item, force_organize=False):
        raise RuntimeError("assignment step exploded")

    service._attempt_auto_assignment = boom
    done = asyncio.run(service.mark_complete(item.id))

    assert done.status == QUEUE_FAILED and "assignment step exploded" in done.last_error


def test_mark_complete_without_an_orchestrator_completes():
    service = IngressQueueService()
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_NEEDS_REVIEW)

    assert asyncio.run(service.mark_complete(item.id)).status == QUEUE_COMPLETED


@pytest.mark.asyncio
async def test_mark_complete_endpoint_answers_409_for_a_busy_item():
    from main import app

    class _Busy:
        async def mark_complete(self, item_id, history_extra=None):
            raise QueueItemBusy(f"Queue item '{item_id}' is being processed; try again once it finishes")

    saved = getattr(app.state, "ingress_queue_service", None)
    app.state.ingress_queue_service = _Busy()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/ingress/queue/mark-complete", json={"itemId": "item-1"})
    finally:
        app.state.ingress_queue_service = saved

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "QUEUE_ITEM_BUSY"


# ── finding 3: ignored stays ignored; re-detection reuses the row ───────────────────────────


def test_redetecting_an_ignored_file_leaves_it_ignored():
    service = IngressQueueService()
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_IGNORED)

    again = service.add_from_watcher(_watched("/inbox/Heat/heat.mkv"))

    assert again is item and again.status == QUEUE_IGNORED
    assert service.get_queue_items(status=QUEUE_PENDING) == []


def test_redetecting_a_failed_file_still_requeues_it():
    service = IngressQueueService()
    item = _queued(service, "/inbox/Heat/heat.mkv", QUEUE_FAILED)

    assert service.add_from_watcher(_watched("/inbox/Heat/heat.mkv")).status == QUEUE_PENDING
    assert item.status == QUEUE_PENDING


def test_after_a_restart_an_ignored_file_is_skipped_and_others_reuse_their_row():
    service = IngressQueueService()  # fresh process: nothing in memory
    service.persisted_paths = {
        "/inbox/Heat/heat.mkv": ("row-ignored", QUEUE_IGNORED),
        "/inbox/Alien/alien.mkv": ("row-review", QUEUE_NEEDS_REVIEW),
    }

    assert service.add_from_watcher(_watched("/inbox/Heat/heat.mkv")) is None
    assert service.get_item("row-ignored") is None

    alien = service.add_from_watcher(_watched("/inbox/Alien/alien.mkv"))
    assert alien.id == "row-review" and alien.status == QUEUE_PENDING  # updates that row, no duplicate

    new = service.add_from_watcher(_watched("/inbox/Brand/new.mkv"))
    assert new.id not in {"row-ignored", "row-review"}


def test_a_manual_add_may_requeue_an_ignored_file_on_the_same_row(tmp_path):
    source = tmp_path / "ingest" / "Heat" / "heat.mkv"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"x")
    service = IngressQueueService()
    service.persisted_paths = {os.fspath(source): ("row-ignored", QUEUE_IGNORED)}

    item = service.add_manual_file(os.fspath(source))

    assert item.id == "row-ignored" and item.status == QUEUE_PENDING


class _IndexSession:
    def __init__(self, rows):
        self.rows, self.statements = rows, []

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(all=lambda: list(self.rows))


def test_load_persisted_paths_keeps_the_newest_row_per_path():
    rows = [("/inbox/Heat/heat.mkv", "old-row", QUEUE_PENDING),  # ordered by queued_at: newest last
            ("/inbox/Heat/heat.mkv", "new-row", QUEUE_IGNORED),
            ("/inbox/Alien/alien.mkv", "alien-row", QUEUE_FAILED)]
    service = IngressQueueService(db_session_factory=_IndexSession(rows))

    assert asyncio.run(service.load_persisted_paths()) == 2
    assert service.persisted_paths["/inbox/Heat/heat.mkv"] == ("new-row", QUEUE_IGNORED)
    assert "ORDER BY ingress_queue.queued_at" in str(service.db_session_factory.statements[0])


# ── Postgres ────────────────────────────────────────────────────────────────────────────────


async def _scratch_database(name: str, icu: bool):
    """Create a scratch database next to TEST_DB_URL (optionally with an ICU en-US collation)."""
    from sqlalchemy import text
    from sqlalchemy.engine import make_url
    from sqlalchemy.ext.asyncio import create_async_engine

    admin = create_async_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            locale = "LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C'" if icu else ""
            await conn.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0 {locale}'))
    finally:
        await admin.dispose()
    return make_url(TEST_DB_URL).set(database=name).render_as_string(hide_password=False)


async def _drop_database(name: str):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    admin = create_async_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    finally:
        await admin.dispose()


def _row(item_id, folder, file_name, title, status=QUEUE_PENDING, queued_at=QUEUED_AT):
    from db.models import IngressQueueItem as DBQueueItem

    return DBQueueItem(
        id=item_id, file_path=f"/inbox/{folder}/{file_name}", file_name=file_name, ingress_path="/inbox",
        file_size=1024, detected_at=queued_at, queued_at=queued_at, status=status, priority=5, attempts=0,
        confidence_score=80, parsed_info={"title": title}, best_match={"media_type": "movie", "title": title},
        match_candidates=[],
    )


@integration
@pytest.mark.integration
async def test_every_page_previews_its_own_group_even_when_collation_disagrees_with_python():
    """ICU en-US sorts "éclair" before "zorro"; Python (and the page order) puts "zorro" first. The old
    offset window then fetched éclair's rows for zorro's page. Folder and title orders also cross."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.models import Base

    try:
        url = await _scratch_database("triage_icu_previews", icu=True)
    except Exception as exc:  # e.g. a server built without ICU
        pytest.skip(f"no ICU collation available: {exc}")
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add_all([
                _row("z-1", "A.Folder", "z1.mkv", "Zorro"),
                _row("z-2", "A.Folder", "z2.mkv", "Zorro"),
                _row("e-1", "B.Folder", "e1.mkv", "Éclair"),
                _row("e-2", "C.Folder", "e2.mkv", "Éclair"),
                _row("a-1", "Z.Folder", "a1.mkv", "Apple"),
            ])
            await session.commit()

        triage = IngressTriageService(IngressQueueService(db_session_factory=sessions), db_session_factory=sessions)
        seen_titles = []
        for offset in range(3):
            page = await triage.get_queue_groups(limit=1, offset=offset, preview_size=5)
            (group,) = page["groups"]
            seen_titles.append(group["title"])
            previews = group["preview_items"]
            assert len(previews) == group["matching_count"], (offset, group["title"], previews)
            assert {item["best_match"]["title"].lower() for item in previews} == {group["title"]}
        assert sorted(seen_titles) == ["apple", "zorro", "éclair"]

        # Folder grouping, page by page.
        for offset in range(4):
            page = await triage.get_queue_groups(limit=1, offset=offset, preview_size=5, group_by="source_folder")
            (group,) = page["groups"]
            folders = {item["file_path"].split("/")[2] for item in group["preview_items"]}
            assert folders == {group["source_folder"]}, (offset, group["source_folder"], folders)
    finally:
        await engine.dispose()
        await _drop_database("triage_icu_previews")


@integration
@pytest.mark.integration
async def test_previews_are_capped_per_group_and_newest_first():
    from datetime import timedelta

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.models import Base

    url = await _scratch_database("triage_preview_cap", icu=False)
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add_all([_row(f"m-{n}", "Matrix", f"m{n}.mkv", "The Matrix", queued_at=QUEUED_AT + timedelta(minutes=n))
                             for n in range(7)])
            session.add(_row("h-1", "Heat", "h1.mkv", "Heat"))
            await session.commit()

        triage = IngressTriageService(IngressQueueService(db_session_factory=sessions), db_session_factory=sessions)
        page = await triage.get_queue_groups(limit=10, preview_size=3)
        by_title = {group["title"]: group for group in page["groups"]}

        assert [item["id"] for item in by_title["the matrix"]["preview_items"]] == ["m-6", "m-5", "m-4"]
        assert by_title["the matrix"]["matching_count"] == 7
        assert [item["id"] for item in by_title["heat"]["preview_items"]] == ["h-1"]
    finally:
        await engine.dispose()
        await _drop_database("triage_preview_cap")


@integration
@pytest.mark.integration
async def test_an_ignored_file_survives_a_restart_and_redetection_makes_no_duplicates():
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.models import Base
    from db.models import IngressQueueItem as DBQueueItem

    url = await _scratch_database("triage_redetect", icu=False)
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add_all([
                _row("heat-row", "Heat", "heat.mkv", "Heat", status=QUEUE_PENDING),
                _row("alien-row", "Alien", "alien.mkv", "Alien", status=QUEUE_NEEDS_REVIEW),
            ])
            await session.commit()

        before = IngressQueueService(db_session_factory=sessions)
        triage = IngressTriageService(before, db_session_factory=sessions)
        summary = await triage.bulk_action(action="ignore", item_ids=["heat-row"])
        assert summary["succeeded"] == 1

        after = IngressQueueService(db_session_factory=sessions)  # the backend restarted
        assert await after.load_persisted_paths() == 2
        assert after.add_from_watcher(_watched("/inbox/Heat/heat.mkv")) is None

        alien = after.add_from_watcher(_watched("/inbox/Alien/alien.mkv"))
        assert alien.id == "alien-row"
        await after._persist_queue_item(alien)

        async with sessions() as session:
            rows = dict((await session.execute(select(DBQueueItem.id, DBQueueItem.status))).all())
            total = (await session.execute(select(func.count()).select_from(DBQueueItem))).scalar_one()
        assert total == 2  # no duplicate rows
        assert rows == {"heat-row": QUEUE_IGNORED, "alien-row": QUEUE_PENDING}
        assert after.persisted_paths["/inbox/Alien/alien.mkv"] == ("alien-row", QUEUE_PENDING)
    finally:
        await engine.dispose()
        await _drop_database("triage_redetect")
