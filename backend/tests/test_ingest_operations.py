"""ingest_operations: recorded plan execution and undo (redesign 6.3 / 6.7).

The organizer writes a row before and after each filesystem step; a failed
step stops the plan. Undo replays a queue item's steps in reverse while every
recorded destination still matches, and returns the item to review.
"""

import asyncio
import os
import shutil
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from services.assignment_orchestrator import AssignmentOrchestrator
from services.file_organization_service import FileOrganizationService
from services.ingest_operations import (
    OP_MKDIR,
    OP_MOVE,
    OP_WRITE_NFO,
    STATUS_DONE,
    STATUS_FAILED,
    IngestUndoService,
    UndoError,
)
from services.ingress_queue_service import QUEUE_COMPLETED, QUEUE_NEEDS_REVIEW, IngressQueueService
from tests.test_ingest_plan_execute import _MovingFilesystem, _RenamingEnrichment
from tests.test_ingress_queue_service import _add_reviewed, _use_library
from services import assignment_orchestrator as orchestrator_module


class _MemoryLog:
    """In-memory stand-in for OperationLog (same async interface)."""

    def __init__(self, fail_start_for=None):
        self.rows = []
        self.fail_start_for = fail_start_for or set()

    async def start(self, **fields):
        if fields.get('op') in self.fail_start_for:
            raise RuntimeError('database unavailable')
        row = dict(fields, id=f'op-{len(self.rows) + 1}', status='running', error=None,
                   executed_at=None, undone_at=None)
        self.rows.append(row)
        return row['id']

    async def finish(self, op_id, **fields):
        next(r for r in self.rows if r['id'] == op_id).update(fields)

    async def for_queue_item(self, queue_item_id):
        return [dict(r) for r in self.rows if r['queue_item_id'] == queue_item_id]

    def ops(self, item_id=None):
        return [(r['op'], r['status']) for r in self.rows if item_id is None or r['queue_item_id'] == item_id]


class _FailingFilesystem(_MovingFilesystem):
    def __init__(self, fail_on):
        super().__init__()
        self.fail_on = fail_on

    def move_file(self, source, destination, merge_contents=False):
        if os.path.basename(source) == self.fail_on:
            return {'success': False, 'error': 'disk full'}
        return super().move_file(source, destination, merge_contents)


class _CatalogSession:
    """Async session over a dict of rows keyed by (model name, id)."""

    def __init__(self, rows):
        self.rows = rows
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, model, row_id):
        return self.rows.get((model.__name__, row_id))

    async def commit(self):
        self.commits += 1


def _pipeline(tmp_path, monkeypatch, log, filesystem=None):
    library_root = _use_library(tmp_path, monkeypatch)
    monkeypatch.setattr(orchestrator_module, 'metadata_enrichment_service', _RenamingEnrichment())
    filesystem = filesystem or _MovingFilesystem()
    organizer = FileOrganizationService(
        filesystem_manager=filesystem,
        jellyfin_dest_base=os.fspath(library_root),
        operation_log=log,
    )
    orchestrator = AssignmentOrchestrator(file_organization_service=organizer, auto_organize_enabled=True)
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    return service, library_root, filesystem


_MOVIE = {'title': 'Some Movie', 'year': 2010, 'media_type': 'movie', 'imdb_id': 'tt0123456'}


def _accepted_movie(tmp_path, monkeypatch, log, filesystem=None):
    service, library_root, filesystem = _pipeline(tmp_path, monkeypatch, log, filesystem)
    item = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000, match=_MOVIE)
    asyncio.run(service.refresh_proposals())
    proposal = item.proposed_path
    source = item.file_path
    done = asyncio.run(service.mark_complete(item.id, manual_action=True))
    assert done.status == QUEUE_COMPLETED, done.last_error
    return service, library_root, filesystem, item, proposal, source


def _move_row(log, item_id):
    return next(r for r in log.rows if r['queue_item_id'] == item_id and r['op'] == OP_MOVE)


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------


def test_accept_records_each_step_before_and_after(tmp_path, monkeypatch):
    log = _MemoryLog()
    _, library_root, _, item, proposal, source = _accepted_movie(tmp_path, monkeypatch, log)

    # jellyfin/, Movies/ and the title folder were created, then the move, then movie.nfo.
    assert log.ops(item.id) == [
        (OP_MKDIR, STATUS_DONE), (OP_MKDIR, STATUS_DONE), (OP_MKDIR, STATUS_DONE),
        (OP_MOVE, STATUS_DONE),
        (OP_WRITE_NFO, STATUS_DONE),
    ]
    move = _move_row(log, item.id)
    destination = os.path.join(os.fspath(library_root), *proposal.split('/'))
    assert move['src'] == source
    assert os.path.normpath(move['dst']) == os.path.normpath(destination)
    assert os.path.normpath(move['planned_dst']) == os.path.normpath(destination)
    assert move['size_before'] == 1
    assert move['executed_at'] is not None
    assert move['assignment_id'] == item.assignment_id
    assert all(r['assignment_id'] == item.assignment_id for r in log.rows)


def test_existing_folders_are_not_recorded_as_created(tmp_path, monkeypatch):
    log = _MemoryLog()
    library_root = _use_library(tmp_path, monkeypatch)
    (library_root / 'Movies').mkdir(parents=True)
    _, _, _, item, _, _ = _accepted_movie(tmp_path, monkeypatch, log)

    mkdirs = [r['dst'] for r in log.rows if r['op'] == OP_MKDIR]
    assert [os.path.basename(d) for d in mkdirs] == ['Some Movie (2010) [imdbid-tt0123456]']


def test_a_failed_move_stops_the_plan_and_keeps_earlier_steps(tmp_path, monkeypatch):
    log = _MemoryLog()
    filesystem = _FailingFilesystem(fail_on='b.mkv')
    organizer = FileOrganizationService(
        filesystem_manager=filesystem, jellyfin_dest_base=os.fspath(tmp_path / 'jellyfin'), operation_log=log,
    )
    sources = []
    for name in ('a.mkv', 'b.mkv', 'c.mkv'):
        path = tmp_path / 'ingest' / 'Disc' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'xy')
        sources.append(os.fspath(path))

    async def three_files(_assignment):
        return list(sources)

    monkeypatch.setattr(organizer, '_get_source_files', three_files)
    result = asyncio.run(organizer.organize_assignment(
        {'id': 'a1', 'queueItemId': 'q1', 'mediaType': 'movie',
         'sourceFile': {'filePath': sources[0], 'fileName': 'a.mkv'}},
        {'title': 'Disc', 'year': 2001},
    ))

    assert result['success'] is False
    assert result['filesMoved'] == 1
    assert result['totalFiles'] == 3
    assert 'disk full' in result['error']
    moves = [r for r in log.rows if r['op'] == OP_MOVE]
    assert [(os.path.basename(r['src']), r['status']) for r in moves] == [
        ('a.mkv', STATUS_DONE), ('b.mkv', STATUS_FAILED),
    ]
    assert moves[1]['error'] == 'disk full'
    # c.mkv was never attempted, and no NFO was written for a half-done plan.
    assert os.path.exists(sources[2])
    assert [m[0] for m in filesystem.moves] == [sources[0]]
    assert not any(r['op'] == OP_WRITE_NFO for r in log.rows)


def test_a_move_that_cannot_be_recorded_is_not_made(tmp_path, monkeypatch):
    log = _MemoryLog(fail_start_for={OP_MOVE})
    service, _, filesystem = _pipeline(tmp_path, monkeypatch, log)
    item = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000, match=_MOVIE)
    asyncio.run(service.refresh_proposals())

    done = asyncio.run(service.mark_complete(item.id, manual_action=True))

    assert done.status != QUEUE_COMPLETED
    assert 'Could not record the move' in (done.last_error or '')
    assert filesystem.moves == []
    assert os.path.exists(item.file_path)


# ---------------------------------------------------------------------------
# Undo
# ---------------------------------------------------------------------------


def _undo(service, log, filesystem, item_id, db_session_factory=None):
    undo = IngestUndoService(log, filesystem, service, db_session_factory=db_session_factory)
    return asyncio.run(undo.undo_queue_item(item_id))


def test_undo_restores_the_file_removes_what_the_plan_made_and_returns_to_review(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, library_root, filesystem, item, proposal, source = _accepted_movie(tmp_path, monkeypatch, log)
    destination = _move_row(log, item.id)['dst']

    result = _undo(service, log, filesystem, item.id)

    assert result['success'] is True, result
    assert result['filesRestored'] == 1
    assert result['operationsUndone'] == 5
    assert os.path.isfile(source)
    assert not os.path.exists(destination)
    # movie.nfo and every folder the plan created are gone; the library root too, since the plan made it.
    assert not library_root.exists()
    assert all(r['undone_at'] is not None for r in log.rows)
    assert item.status == QUEUE_NEEDS_REVIEW
    assert item.last_error is None
    # The proposal is resolved again from the file's source, not left at the executed path.
    assert item.proposed_path == proposal


def test_undo_twice_has_nothing_left_to_undo(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, _, filesystem, item, _, _ = _accepted_movie(tmp_path, monkeypatch, log)
    _undo(service, log, filesystem, item.id)

    with pytest.raises(UndoError) as exc:
        _undo(service, log, filesystem, item.id)
    assert exc.value.code == 'NOTHING_TO_UNDO'
    assert item.status == QUEUE_NEEDS_REVIEW


def test_undo_then_accept_again_records_a_fresh_plan(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, library_root, filesystem, item, proposal, _ = _accepted_movie(tmp_path, monkeypatch, log)
    _undo(service, log, filesystem, item.id)

    done = asyncio.run(service.mark_complete(item.id, manual_action=True))

    assert done.status == QUEUE_COMPLETED, done.last_error
    assert os.path.isfile(os.path.join(os.fspath(library_root), *proposal.split('/')))
    live = [r for r in log.rows if r['status'] == STATUS_DONE and r['undone_at'] is None]
    assert [r['op'] for r in live].count(OP_MOVE) == 1


@pytest.mark.parametrize('tamper', ['resized', 'removed', 'source_reused'])
def test_undo_refuses_when_the_recorded_destination_no_longer_matches(tmp_path, monkeypatch, tamper):
    log = _MemoryLog()
    service, _, filesystem, item, _, source = _accepted_movie(tmp_path, monkeypatch, log)
    destination = _move_row(log, item.id)['dst']
    if tamper == 'resized':
        with open(destination, 'ab') as f:
            f.write(b'more')
    elif tamper == 'removed':
        os.remove(destination)
    else:
        # Accept prunes the emptied source folder; a new rip recreates it.
        os.makedirs(os.path.dirname(source), exist_ok=True)
        with open(source, 'wb') as f:
            f.write(b'a new rip')

    with pytest.raises(UndoError) as exc:
        _undo(service, log, filesystem, item.id)

    assert exc.value.code == 'UNDO_CONFLICT'
    assert exc.value.problems
    # Nothing was touched, and the item keeps its status.
    assert len(filesystem.moves) == 1
    assert all(r['undone_at'] is None for r in log.rows)
    assert item.status == QUEUE_COMPLETED


def test_undo_keeps_an_edited_nfo_and_a_folder_with_other_files(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, library_root, filesystem, item, _, source = _accepted_movie(tmp_path, monkeypatch, log)
    title_dir = os.path.dirname(_move_row(log, item.id)['dst'])
    nfo = os.path.join(title_dir, 'movie.nfo')
    with open(nfo, 'a', encoding='utf-8') as f:
        f.write('<!-- hand edited -->\n')

    result = _undo(service, log, filesystem, item.id)

    assert result['success'] is True
    assert os.path.isfile(source)
    assert os.path.isfile(nfo)
    assert os.path.normpath(nfo) in [os.path.normpath(k) for k in result['kept']]
    # The title folder still holds the edited NFO, so it (and its parents) stay.
    assert os.path.isdir(title_dir)


def test_undo_refuses_an_item_being_processed(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, _, filesystem, item, _, _ = _accepted_movie(tmp_path, monkeypatch, log)
    item.status = 'processing'

    with pytest.raises(UndoError) as exc:
        _undo(service, log, filesystem, item.id)
    assert exc.value.code == 'QUEUE_ITEM_BUSY'
    assert item.status == 'processing'


def _catalog_rows(item, folder, media_type='movie'):
    assignment = SimpleNamespace(
        id=item.assignment_id, media_type=media_type, media_id='m1', primary_file_id='f1',
        organization_status='completed', organization_date='2026-11-10', organization_error=None,
        operations=[{'op': 'move'}],
    )
    media_file = SimpleNamespace(target_path=folder, organization_status='completed', needs_organization=False)
    title = SimpleNamespace(
        jellyfin_info={'folderPath': folder, 'isOrganized': True},
        raw_data={'jellyfinInfo': {'folderPath': folder}, 'isOrganized': True, 'folderPath': folder,
                  'title': 'Some Movie'},
    )
    model = 'Series' if media_type == 'episode' else 'Movie'
    return {('MediaAssignment', item.assignment_id): assignment, ('MediaFile', 'f1'): media_file,
            (model, 'm1'): title}


def test_undo_clears_what_organize_wrote_to_the_catalog(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, _, filesystem, item, _, _ = _accepted_movie(tmp_path, monkeypatch, log)
    folder = os.path.dirname(_move_row(log, item.id)['dst'])
    rows = _catalog_rows(item, folder)
    session = _CatalogSession(rows)

    result = _undo(service, log, filesystem, item.id, db_session_factory=lambda: session)

    assert result['success'] is True
    assignment = rows[('MediaAssignment', item.assignment_id)]
    media_file = rows[('MediaFile', 'f1')]
    movie = rows[('Movie', 'm1')]
    assert assignment.organization_status == 'pending'
    assert assignment.operations == []
    assert media_file.target_path is None
    assert media_file.needs_organization is True
    assert movie.jellyfin_info == {}
    assert movie.raw_data['isOrganized'] is False
    assert 'jellyfinInfo' not in movie.raw_data
    assert movie.raw_data['title'] == 'Some Movie'
    assert session.commits == 1


def test_undoing_one_episode_keeps_the_series_organized_while_others_remain(tmp_path, monkeypatch):
    log = _MemoryLog()
    service, library_root, filesystem = _pipeline(tmp_path, monkeypatch, log)
    match = {'title': 'Some Show', 'year': 2002, 'media_type': 'episode', 'season': 1, 'episode': 1}
    item = _add_reviewed(service, tmp_path, 'Some Show', 'Some.Show.S01E01.mkv', 1_300_000, match=match)
    item.parsed_info = {'title': 'Some Show', 'season': 1, 'episode': 1}
    asyncio.run(service.refresh_proposals())
    assert asyncio.run(service.mark_complete(item.id, manual_action=True)).status == QUEUE_COMPLETED
    season_dir = os.path.dirname(_move_row(log, item.id)['dst'])
    series_dir = os.path.dirname(season_dir)
    # Another episode organized earlier lives in the same season folder.
    with open(os.path.join(season_dir, 'Some Show (2002) S01E02.mkv'), 'wb') as f:
        f.write(b'other')
    rows = _catalog_rows(item, series_dir, media_type='episode')

    result = _undo(service, log, filesystem, item.id, db_session_factory=lambda: _CatalogSession(rows))

    assert result['success'] is True
    assert rows[('MediaFile', 'f1')].target_path is None
    assert rows[('Series', 'm1')].jellyfin_info == {'folderPath': series_dir, 'isOrganized': True}
    assert os.path.isdir(season_dir)


def test_operation_log_writes_and_updates_ingest_operation_rows():
    from db.models import IngestOperation
    from services.ingest_operations import OperationLog, OperationRecorder

    stored = {}

    class _Session(_CatalogSession):
        def add(self, row):
            stored[row.id] = row

        async def get(self, model, row_id):
            assert model is IngestOperation
            return stored.get(row_id)

    recorder = OperationRecorder(OperationLog(lambda: _Session({})), 'q1', 'a1')
    op_id = asyncio.run(recorder.before(OP_MOVE, src='/in/a.mkv', dst='/lib/a.mkv', planned_dst='/lib/a.mkv',
                                        size_before=5))
    row = stored[op_id]
    assert (row.queue_item_id, row.assignment_id, row.op, row.status) == ('q1', 'a1', OP_MOVE, 'running')
    assert row.created_at is not None

    asyncio.run(recorder.done(op_id, dst='/lib/a (1).mkv', size=5))
    assert (row.status, row.dst, row.size_before) == (STATUS_DONE, '/lib/a (1).mkv', 5)
    assert row.executed_at is not None


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _wire(app, db_session_factory):
    app.state.ingress_queue_service = SimpleNamespace(
        db_session_factory=db_session_factory, lock=threading.RLock(), items_by_id={},
    )
    app.state.file_manager = MagicMock()


async def _post_undo(app, item_id='q1'):
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        return await client.post('/api/ingress/queue/undo', json={'itemId': item_id})


@pytest.mark.asyncio
async def test_undo_route_needs_the_operation_log(app):
    _wire(app, None)
    response = await _post_undo(app)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'OPERATION_LOG_UNAVAILABLE'


@pytest.mark.asyncio
async def test_undo_route_reports_a_conflict_with_its_reasons(app, monkeypatch):
    import api.ingress_operations as routes

    _wire(app, MagicMock())
    refused = AsyncMock(side_effect=UndoError('UNDO_CONFLICT', 'no longer matches', ['Organized file is gone: x']))
    monkeypatch.setattr(routes.IngestUndoService, 'undo_queue_item', refused)

    response = await _post_undo(app)

    assert response.status_code == 409
    detail = response.json()['detail']
    assert detail['code'] == 'UNDO_CONFLICT'
    assert detail['problems'] == ['Organized file is gone: x']


@pytest.mark.asyncio
async def test_undo_route_returns_the_result(app, monkeypatch):
    import api.ingress_operations as routes

    _wire(app, MagicMock())
    outcome = {'success': True, 'item': {'id': 'q1', 'status': 'needs_review'}, 'operationsUndone': 3,
               'filesRestored': 1, 'kept': [], 'errors': []}
    monkeypatch.setattr(routes.IngestUndoService, 'undo_queue_item', AsyncMock(return_value=outcome))

    response = await _post_undo(app)

    assert response.status_code == 200
    assert response.json()['data'] == outcome


def test_undo_moves_the_media_file_row_back_to_the_source_and_drops_title_links(tmp_path, monkeypatch):
    from db.models import MediaAssignment, MediaFile, Movie
    from services import media_file_index
    from tests.fake_db import FakeSession

    log = _MemoryLog()
    service, _, filesystem, item, _, source = _accepted_movie(tmp_path, monkeypatch, log)
    monkeypatch.setattr('services.storage_paths.settings.ingress_default_paths', [os.fspath(tmp_path / 'ingest')])
    destination = _move_row(log, item.id)['dst']
    media_file = MediaFile(id='f1', file_name='x.mkv', disc_id='disc-1', organization_status='completed')
    media_file_index.apply_path(media_file, destination)
    media_file.movie_id = 'm1'
    assert media_file.location == 'library' and media_file.role == 'main'
    session = FakeSession([
        MediaAssignment(id=item.assignment_id, media_type='movie', media_id='m1', primary_file_id='f1',
                        organization_status='completed', operations=[{'op': 'move'}]),
        media_file,
        Movie(id='m1', title='Some Movie', jellyfin_info={}, raw_data={}),
    ])

    result = _undo(service, log, filesystem, item.id, db_session_factory=session)

    assert result['success'] is True
    assert media_file.file_path == media_file_index.normalize_path(source)
    assert media_file.id == 'f1' and media_file.disc_id == 'disc-1'
    assert media_file.movie_id is None and media_file.role is None
    assert media_file.location == 'ingest' and media_file.relative_path is None
    assert media_file.target_path is None and media_file.organization_status == 'pending'
