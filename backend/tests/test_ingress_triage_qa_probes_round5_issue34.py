"""Round-5 QA probes for issue #34 (tester-owned, no product code touched).

What this file adds on top of the round-1/3/4 probes:

  AC5  "bulk accept organizes exactly like single-item accept (`mark_complete` path)" is proven by
       running BOTH surfaces over the same service and comparing what actually happened: the same
       `mark_complete` implementation is entered, the orchestrator is invoked with
       `force_organize=True` from both, and the accepted rows land in the same state with the same
       organization side effects on disk.

  AC5+AC6 the group-selector form of bulk accept (the only bulk path that has to hydrate persisted
       rows first) is proven to organize every matched row and to write exactly one
       `ingress_processing_history` row per mutated item, and no row for the ones it did not touch.

Nothing here changes product code.
"""

import asyncio
import os
import shutil
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient

from db.models import IngressProcessingHistory as DBHistory
from services.ingress_queue_service import (
    IngressQueueService,
    QUEUE_COMPLETED,
    QUEUE_PENDING,
)
from services.ingress_triage_service import IngressTriageService

QUEUED_AT = __import__("datetime").datetime(2024, 5, 1, 12, 0, tzinfo=__import__("datetime").timezone.utc)
INGRESS_ROOT = "/ark/media/ingest"

APP_STATE_KEYS = ("ingress_queue_service", "ingress_triage_service", "ingress_watcher_service")


def _app_state_snapshot():
    from main import app

    return {key: getattr(app.state, key, None) for key in APP_STATE_KEYS}


def _restore_app(saved):
    from main import app

    for key in APP_STATE_KEYS:
        setattr(app.state, key, saved[key])


def _row(item_id, file_name, status=QUEUE_PENDING, best_match=None):
    """Attribute-shaped stand-in for a persisted `ingress_queue` row."""
    return SimpleNamespace(
        id=item_id,
        file_path=os.path.join(INGRESS_ROOT, file_name),
        file_name=file_name,
        ingress_path=INGRESS_ROOT,
        file_size=1024,
        detected_at=QUEUED_AT,
        queued_at=QUEUED_AT,
        status=status,
        priority=5,
        attempts=1,
        last_attempt=None,
        processed_at=None,
        last_error=None,
        confidence_score=90,
        assignment_id=None,
        parsed_info={"title": (best_match or {}).get("title", file_name)},
        best_match=best_match or {},
        match_candidates=[],
        media_duration_ms=None,
        proposed_path=None,
        classification_override=None,
    )


class _RecordingSession:
    """Fake async session: answers row lookups, records every add()/commit()."""

    def __init__(self, rows=()):
        self.rows = {row.id: row for row in rows}
        self.added = []
        self.commits = 0

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, statement):
        rows = list(self.rows.values())
        return SimpleNamespace(
            all=lambda: rows,
            first=lambda: (rows[0],) if rows else None,
            scalar_one_or_none=lambda: rows[0] if rows else None,
            scalars=lambda: SimpleNamespace(
                all=lambda: rows,
                first=lambda: rows[0] if rows else None,
                unique=lambda: SimpleNamespace(all=lambda: rows),
            ),
        )

    async def get(self, model, ident):
        return self.rows.get(str(ident))

    def add(self, instance):
        self.added.append(instance)

    async def commit(self):
        self.commits += 1

    def history_rows(self):
        return [entry for entry in self.added if isinstance(entry, DBHistory)]

    def history_snapshots(self):
        return [entry.snapshot for entry in self.history_rows()]


class _OrganizingOrchestrator:
    """Records the payload both accept surfaces send it and really moves the file, like the real one."""

    def __init__(self, dest_root):
        self.dest_root = dest_root
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        source = queue_item["file_path"]
        title = (queue_item.get("best_match") or {}).get("title") or "Unknown"
        target_dir = os.path.join(self.dest_root, "Movies", title)
        os.makedirs(target_dir, exist_ok=True)
        destination = os.path.join(target_dir, os.path.basename(source))
        self.calls.append({
            "item_id": queue_item["id"],
            "force_organize": force_organize,
            "confidence_score": queue_item.get("confidence_score"),
            "classification_override": queue_item.get("classification_override"),
        })
        if force_organize:
            shutil.move(source, destination)
        return {
            "assignment_id": f"assignment-{queue_item['id']}",
            "organized": bool(force_organize),
            "organization_result": {
                "success": bool(force_organize),
                "targetPath": destination,
                "operations": [{"source": source, "destination": destination}],
            },
        }


class _RecordingOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({"item_id": queue_item["id"], "force_organize": force_organize})
        return {
            "assignment_id": f"assignment-{queue_item['id']}",
            "organized": bool(force_organize),
            "organization_result": {"success": bool(force_organize), "targetPath": None, "operations": []},
        }


def _accepted_movie(tmp_path, service, name, ingress_root):
    source = ingress_root / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"qa-round5")
    item = service.add_manual_file(os.fspath(source))
    item.best_match = {"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}
    item.confidence_score = 96
    return item


# --------------------------------------------------------------------------------------
# AC5 - bulk accept organizes exactly like the single-item accept endpoint
# --------------------------------------------------------------------------------------

def test_qa5_bulk_accept_and_single_item_accept_take_the_same_mark_complete_path(tmp_path, monkeypatch):
    jellyfin = tmp_path / "jellyfin"
    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base", os.fspath(jellyfin))
    ingress_root = tmp_path / "ingest"

    session = _RecordingSession()
    orchestrator = _OrganizingOrchestrator(os.fspath(jellyfin))
    service = IngressQueueService(assignment_orchestrator=orchestrator, db_session_factory=session)
    single_item = _accepted_movie(tmp_path, service, "single.mkv", ingress_root)
    bulk_item = _accepted_movie(tmp_path, service, "bulk.mkv", ingress_root)

    # spy on the one method both surfaces must share, without changing it
    mark_complete_calls = []
    original_mark_complete = IngressQueueService.mark_complete

    async def spy(self, item_id, history_extra=None):
        mark_complete_calls.append({"item_id": item_id, "history_extra": history_extra})
        return await original_mark_complete(self, item_id, history_extra)

    monkeypatch.setattr(IngressQueueService, "mark_complete", spy)

    triage = IngressTriageService(service, db_session_factory=session)
    saved = _app_state_snapshot()
    from main import app

    app.state.ingress_queue_service = service
    app.state.ingress_triage_service = triage

    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            single = await client.post("/api/ingress/queue/mark-complete", json={"itemId": single_item.id})
            bulk = await client.post(
                "/api/ingress/queue/bulk", json={"action": "accept", "itemIds": [bulk_item.id]}
            )
            return single, bulk

    try:
        single_response, bulk_response = asyncio.run(run())
    finally:
        _restore_app(saved)

    assert single_response.status_code == 200, single_response.text
    assert bulk_response.status_code == 200, bulk_response.text

    # AC5: both surfaces enter the same `mark_complete`, and only the bulk one tags the batch
    assert sorted(entry["item_id"] for entry in mark_complete_calls) == sorted([single_item.id, bulk_item.id])
    by_item = {entry["item_id"]: entry for entry in mark_complete_calls}
    assert by_item[single_item.id]["history_extra"] is None
    bulk_extra = by_item[bulk_item.id]["history_extra"]
    assert bulk_extra["action"] == "accept" and bulk_extra["source"] == "bulk" and bulk_extra["batch_id"]

    # AC5: both ask the orchestrator to organize, with the same effective payload
    assert len(orchestrator.calls) == 2
    assert {call["force_organize"] for call in orchestrator.calls} == {True}
    assert {call["confidence_score"] for call in orchestrator.calls} == {96}

    single_after = service.get_item(single_item.id)
    bulk_after = service.get_item(bulk_item.id)
    assert single_after["status"] == bulk_after["status"] == QUEUE_COMPLETED
    assert single_after["last_error"] == bulk_after["last_error"] is None
    assert single_after["assignment_id"] == f"assignment-{single_item.id}"
    assert bulk_after["assignment_id"] == f"assignment-{bulk_item.id}"
    assert bulk_response.json()["data"]["results"][0]["item_status"] == QUEUE_COMPLETED

    # AC5: both really organized on disk, into the same destination layout
    single_destination = os.path.join(os.fspath(jellyfin), "Movies", "The Matrix", "single.mkv")
    bulk_destination = os.path.join(os.fspath(jellyfin), "Movies", "The Matrix", "bulk.mkv")
    assert os.path.isfile(single_destination) and os.path.isfile(bulk_destination)
    assert not os.path.exists(single_item.file_path) and not os.path.exists(bulk_item.file_path)
    assert single_after["proposed_path"] == single_destination
    assert bulk_after["proposed_path"] == bulk_destination

    # AC6: one history row per mutated item, and the bulk one carries batch_id/action/source
    history = session.history_snapshots()
    assert len(history) == 2
    assert sorted(entry["item_id"] for entry in history) == sorted([single_item.id, bulk_item.id])
    bulk_history = [entry for entry in history if entry["item_id"] == bulk_item.id]
    assert len(bulk_history) == 1
    assert bulk_history[0]["batch_id"] == bulk_extra["batch_id"]
    assert bulk_history[0]["action"] == "accept"
    assert bulk_history[0]["source"] == "bulk"
    single_history = [entry for entry in history if entry["item_id"] == single_item.id]
    assert len(single_history) == 1
    assert "source" not in single_history[0] or single_history[0].get("source") != "bulk"


# --------------------------------------------------------------------------------------
# AC5 + AC6 - the group selector form of bulk accept, over rows this process never saw
# --------------------------------------------------------------------------------------

def test_qa5_bulk_accept_of_a_group_organizes_every_persisted_row_with_one_history_row_each(tmp_path, monkeypatch):
    monkeypatch.setattr("services.ingress_queue_service.settings.jellyfin_dest_base",
                        os.fspath(tmp_path / "jellyfin"))
    matrix = {"title": "The Matrix", "year": 1999, "media_type": "movie", "media_id": "movie-1"}
    rows = [
        _row("group-1", "The.Matrix.1999.1080p.mkv", best_match=matrix),
        _row("group-2", "The.Matrix.1999.720p.mkv", best_match=matrix),
        _row("group-3", "The.Matrix.1999.Bluray.mkv", best_match=matrix),
    ]
    session = _RecordingSession(rows)
    orchestrator = _RecordingOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator, db_session_factory=session)
    triage = IngressTriageService(service, db_session_factory=session)

    assert service.get_item("group-1") is None, "the accepted rows are DB-only until the group resolves"

    result = asyncio.run(triage.bulk_action(
        action="accept",
        group={"media_type": "movie", "ingress_path": INGRESS_ROOT, "title": "the matrix"},
    ))

    assert result["action"] == "accept"
    assert (result["requested"], result["succeeded"], result["failed"], result["skipped"]) == (3, 3, 0, 0)
    assert sorted(entry["item_id"] for entry in result["results"]) == ["group-1", "group-2", "group-3"]

    # AC5: the group selector accepts through mark_complete, which forces organization
    assert len(orchestrator.calls) == 3
    assert {call["force_organize"] for call in orchestrator.calls} == {True}
    assert sorted(call["item_id"] for call in orchestrator.calls) == ["group-1", "group-2", "group-3"]

    statuses = {row.id: row.status for row in rows}
    assert statuses == {"group-1": QUEUE_COMPLETED, "group-2": QUEUE_COMPLETED, "group-3": QUEUE_COMPLETED}

    # AC6: exactly one ingress_processing_history row per mutated item - the organization itself
    # must not add a second row for the same item
    history = session.history_snapshots()
    assert len(history) == len(rows)
    assert sorted(entry["item_id"] for entry in history) == ["group-1", "group-2", "group-3"]
    for entry in history:
        assert entry["batch_id"] == result["batch_id"]
        assert entry["action"] == "accept"
        assert entry["source"] == "bulk"
        assert entry["event"] == "accepted_assignment"
