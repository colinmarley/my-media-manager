"""Recorded execution of ingest plans, and undo (ingest redesign 6.3 / 6.7).

The organizer writes one ``ingest_operations`` row before each filesystem step
of a plan (status ``running``) and updates it afterwards (``done`` with the
real destination and time, or ``failed`` with the error). A failed step stops
the plan, so the rows of a queue item are always a prefix of its plan.

Undo replays a queue item's ``done`` rows in reverse, and only when every
recorded move destination still exists with the recorded size and nothing has
appeared at its source since. Otherwise nothing is touched.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from utils.logging import logger

OP_MOVE = "move"
OP_MKDIR = "mkdir"
OP_WRITE_NFO = "write_nfo"

STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

_FIELDS = (
    "id",
    "queue_item_id",
    "assignment_id",
    "op",
    "src",
    "dst",
    "planned_dst",
    "size_before",
    "status",
    "error",
    "executed_at",
    "undone_at",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _file_size(path: Optional[str]) -> Optional[int]:
    if not path:
        return None
    try:
        return os.path.getsize(path)
    except OSError:
        return None


class OperationLog:
    """``ingest_operations`` rows, through an async SQLAlchemy session factory."""

    def __init__(self, db_session_factory: Callable):
        self.db_session_factory = db_session_factory

    @staticmethod
    def _as_dict(row: Any) -> Dict[str, Any]:
        return {name: getattr(row, name) for name in _FIELDS}

    async def start(self, **fields: Any) -> str:
        from db.models import IngestOperation

        op_id = str(uuid.uuid4())
        async with self.db_session_factory() as session:
            # created_at from here, not the server: it orders a plan's steps.
            session.add(IngestOperation(id=op_id, status=STATUS_RUNNING, created_at=_now(), **fields))
            await session.commit()
        return op_id

    async def finish(self, op_id: str, **fields: Any) -> None:
        from db.models import IngestOperation

        async with self.db_session_factory() as session:
            row = await session.get(IngestOperation, op_id)
            if row is None:
                raise LookupError(f"ingest operation {op_id} not found")
            for name, value in fields.items():
                setattr(row, name, value)
            await session.commit()

    async def for_queue_item(self, queue_item_id: str) -> List[Dict[str, Any]]:
        """All rows of a queue item, oldest first."""
        from sqlalchemy import select
        from db.models import IngestOperation

        async with self.db_session_factory() as session:
            result = await session.execute(
                select(IngestOperation)
                .where(IngestOperation.queue_item_id == queue_item_id)
                .order_by(IngestOperation.created_at)
            )
            return [self._as_dict(row) for row in result.scalars().all()]


class OperationRecorder:
    """The organizer's handle on the log for one plan: who the rows belong to."""

    def __init__(self, log: Optional[Any], queue_item_id: Optional[str], assignment_id: Optional[str]):
        self.log = log
        self.queue_item_id = queue_item_id
        self.assignment_id = assignment_id

    async def before(
        self,
        op: str,
        *,
        src: Optional[str] = None,
        dst: Optional[str] = None,
        planned_dst: Optional[str] = None,
        size_before: Optional[int] = None,
    ) -> Optional[str]:
        """Row for a step about to run. Raises if it cannot be written, so the
        step does not run unrecorded."""
        if self.log is None:
            return None
        return await self.log.start(
            queue_item_id=self.queue_item_id,
            assignment_id=self.assignment_id,
            op=op,
            src=src,
            dst=dst,
            planned_dst=planned_dst,
            size_before=size_before,
        )

    async def done(self, op_id: Optional[str], *, dst: Optional[str] = None, size: Optional[int] = None) -> None:
        if self.log is None or op_id is None:
            return
        fields: Dict[str, Any] = {"status": STATUS_DONE, "executed_at": _now()}
        if dst is not None:
            fields["dst"] = dst
        if size is not None:
            fields["size_before"] = size
        await self.log.finish(op_id, **fields)

    async def failed(self, op_id: Optional[str], error: str) -> None:
        if self.log is None or op_id is None:
            return
        try:
            await self.log.finish(op_id, status=STATUS_FAILED, error=error)
        except Exception as exc:  # the step already failed; keep its own error
            logger.warning("Could not record failed ingest operation", op_id=op_id, error=str(exc))


class UndoError(Exception):
    """Undo refused. ``code`` is the API error code, ``problems`` the reasons."""

    def __init__(self, code: str, message: str, problems: Optional[List[str]] = None):
        super().__init__(message)
        self.code = code
        self.problems = problems or []


class IngestUndoService:
    """Undo of an executed queue item from its ``ingest_operations`` rows."""

    def __init__(
        self,
        operation_log: Any,
        file_manager: Any,
        queue_service: Any,
        db_session_factory: Optional[Callable] = None,
    ):
        self.operation_log = operation_log
        self.file_manager = file_manager
        self.queue_service = queue_service
        self.db_session_factory = db_session_factory

    @staticmethod
    def _undoable(operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [op for op in operations if op.get("status") == STATUS_DONE and not op.get("undone_at")]

    @staticmethod
    def _preflight(operations: List[Dict[str, Any]]) -> List[str]:
        """Every reason the recorded moves can no longer be replayed."""
        problems: List[str] = []
        for op in operations:
            if op.get("op") != OP_MOVE:
                continue
            src, dst, size = op.get("src"), op.get("dst"), op.get("size_before")
            if not src or not dst:
                problems.append(f"Move {op.get('id')} has no recorded source or destination")
            elif not os.path.isfile(dst):
                problems.append(f"Organized file is gone: {dst}")
            elif size is not None and _file_size(dst) != size:
                problems.append(f"Organized file changed size since the move: {dst}")
            elif os.path.exists(src):
                problems.append(f"Something already exists at the original location: {src}")
        return problems

    async def undo_queue_item(self, queue_item_id: str) -> Dict[str, Any]:
        queue_service = self.queue_service
        hydrate = getattr(queue_service, "hydrate_item", None)
        if hydrate is not None:
            await hydrate(queue_item_id)
        with queue_service.lock:
            item = queue_service.items_by_id.get(queue_item_id)
            if item is None:
                raise UndoError("QUEUE_ITEM_NOT_FOUND", f"Queue item not found: {queue_item_id}")
            if item.status == "processing":
                raise UndoError("QUEUE_ITEM_BUSY", f"Queue item '{queue_item_id}' is being processed")
            previous_status = item.status
            # Claim it so the auto-processor and accept routes leave it alone.
            item.status = "processing"

        try:
            return await self._undo_claimed(item)
        finally:
            with queue_service.lock:
                if item.status == "processing":  # undo refused or raised before finishing
                    item.status = previous_status

    async def _undo_claimed(self, item: Any) -> Dict[str, Any]:
        operations = self._undoable(await self.operation_log.for_queue_item(item.id))
        if not any(op.get("op") == OP_MOVE for op in operations):
            raise UndoError("NOTHING_TO_UNDO", f"Queue item '{item.id}' has no executed moves to undo")

        problems = self._preflight(operations)
        if problems:
            raise UndoError(
                "UNDO_CONFLICT",
                "The organized files no longer match what was recorded; nothing was undone",
                problems,
            )

        undone: List[Dict[str, Any]] = []
        kept: List[str] = []
        failures: List[str] = []
        for op in reversed(operations):
            kind, src, dst = op.get("op"), str(op.get("src") or ""), str(op.get("dst") or "")
            try:
                if kind == OP_MOVE:
                    os.makedirs(os.path.dirname(src), exist_ok=True)
                    result = self.file_manager.move_file(dst, src, merge_contents=False)
                    if isinstance(result, dict) and result.get("success") is False:
                        raise RuntimeError(result.get("error") or "move failed")
                    if not os.path.isfile(src):
                        raise RuntimeError(f"file did not arrive at {src}")
                elif kind == OP_WRITE_NFO:
                    if dst and os.path.isfile(dst):
                        if op.get("size_before") is not None and _file_size(dst) != op.get("size_before"):
                            kept.append(dst)  # edited since it was written
                            continue
                        os.remove(dst)
                elif kind == OP_MKDIR:
                    if dst and os.path.isdir(dst):
                        if os.listdir(dst):
                            kept.append(dst)  # holds files that were not ours
                            continue
                        os.rmdir(dst)
                else:
                    continue
            except Exception as exc:
                failures.append(f"{kind} {dst} -> {src}: {exc}")
                break
            await self.operation_log.finish(op["id"], undone_at=_now())
            undone.append(op)

        assignment_ids = {str(op["assignment_id"]) for op in operations if op.get("assignment_id")}
        fully_undone = not failures
        if fully_undone:
            for assignment_id in assignment_ids:
                await self._clear_catalog(assignment_id, operations)
            await self._return_to_review(item)
        else:
            with self.queue_service.lock:
                item.status = "failed"
                item.last_error = "Undo stopped: " + "; ".join(failures)
            await self.queue_service._persist_queue_item(item)

        return {
            "success": fully_undone,
            "item": item.to_dict(),
            "operationsUndone": len(undone),
            "filesRestored": sum(1 for op in undone if op.get("op") == OP_MOVE),
            "kept": kept,
            "errors": failures,
        }

    async def _return_to_review(self, item: Any) -> None:
        with self.queue_service.lock:
            item.status = "needs_review"
            item.last_error = None
            item.processed_at = None
        # The file is back at its source: the stored proposal pointed at the
        # place it had been organized to, so resolve it again with its group.
        await self.queue_service.refresh_proposals([item.id])
        await self.queue_service._persist_queue_item(item)

    async def _clear_catalog(self, assignment_id: str, operations: List[Dict[str, Any]]) -> None:
        """Undo what the organize step wrote to the catalog for this assignment:
        the assignment's organized state, ``media_files.target_path``, and the
        title's ``jellyfin_info`` once its folder no longer holds any video."""
        if self.db_session_factory is None:
            return
        from db.models import MediaAssignment, MediaFile, Movie, Series

        moved_dirs = {
            os.path.normpath(os.path.dirname(op["dst"]))
            for op in operations
            if op.get("op") == OP_MOVE and op.get("dst")
        }
        try:
            async with self.db_session_factory() as session:
                assignment = await session.get(MediaAssignment, assignment_id)
                if assignment is None:
                    return
                assignment.organization_status = "pending"
                assignment.organization_date = None
                assignment.organization_error = None
                assignment.operations = []
                if assignment.primary_file_id:
                    media_file = await session.get(MediaFile, assignment.primary_file_id)
                    if media_file is not None:
                        media_file.target_path = None
                        media_file.organization_status = "pending"
                        media_file.needs_organization = True

                model = Series if assignment.media_type in ("episode", "series") else Movie
                row = await session.get(model, assignment.media_id) if assignment.media_id else None
                if row is not None:
                    info = dict(row.jellyfin_info or {})
                    folder = info.get("folderPath")
                    if folder and self._owns_folder(folder, moved_dirs) and not self._has_video(folder):
                        row.jellyfin_info = {}
                        raw = dict(row.raw_data or {})
                        for key in ("jellyfinInfo", "folderPath", "lastOrganized", "primaryVideoPath"):
                            raw.pop(key, None)
                        raw["isOrganized"] = False
                        raw["linkedVideoFiles"] = []
                        raw["videoFiles"] = []
                        raw["sourceFiles"] = []
                        row.raw_data = raw
                await session.commit()
        except Exception as exc:
            logger.warning("Failed to clear catalog after undo", assignment_id=assignment_id, error=str(exc))

    @staticmethod
    def _owns_folder(folder: str, moved_dirs: set) -> bool:
        """Whether the catalog folder is (or contains) one the undone moves wrote into."""
        folder = os.path.normpath(folder)
        return any(d == folder or d.startswith(folder + os.sep) for d in moved_dirs)

    @staticmethod
    def _has_video(folder: str) -> bool:
        from services.file_organization_service import FileOrganizationService

        if not os.path.isdir(folder):
            return False
        for _, _, files in os.walk(folder):
            for name in files:
                if os.path.splitext(name)[1].lower() in FileOrganizationService.VIDEO_EXTENSIONS:
                    return True
        return False
