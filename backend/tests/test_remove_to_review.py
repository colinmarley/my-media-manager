"""remove-to-review moves the folder into ingest, and the queue holds those files for review."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from config.settings import settings
from services import storage_paths
from services.ingress_queue_service import (
    HOLD_REASON_KEY,
    QUEUE_AUTO_ASSIGNED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
    IngressQueueService,
)


@pytest.fixture(autouse=True)
def _reset_overrides():
    storage_paths.clear_overrides()
    yield
    storage_paths.clear_overrides()


# ---------------------------------------------------------------------------
# Queue: hold_files_for_review
# ---------------------------------------------------------------------------

class _StubMatcher:
    def __init__(self, result):
        self.result = result

    def search_and_match(self, parsed_info):
        return self.result


class _CapturingOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append(dict(queue_item))
        return {'assignment_id': 'a-1', 'organized': False, 'organization_result': None}


CONFIDENT = {
    'source': 'omdb', 'title': 'Some Movie', 'year': 2010, 'media_type': 'movie',
    'confidence_score': 100, 'imdb_id': 'tt0000001', 'score_breakdown': [],
}


def _held_service(tmp_path):
    folder = tmp_path / 'ingest' / 'Some Movie (2010) [imdbid-tt0000001]'
    folder.mkdir(parents=True)
    video = folder / 'Some Movie (2010) [imdbid-tt0000001].mkv'
    video.write_bytes(b'x')
    (folder / 'movie.nfo').write_text('<movie/>')
    matcher = _StubMatcher({'status': 'success', 'found': True, 'candidates': [CONFIDENT],
                            'best_match': CONFIDENT, 'ambiguous': False, 'margin': 50})
    orchestrator = _CapturingOrchestrator()
    service = IngressQueueService(auto_matcher_service=matcher, assignment_orchestrator=orchestrator,
                                  auto_assign_threshold=80)
    return service, orchestrator, folder, video


def test_held_file_is_matched_but_never_auto_assigned(tmp_path):
    service, orchestrator, folder, video = _held_service(tmp_path)

    held = asyncio.run(service.hold_files_for_review(
        [os.fspath(video), os.fspath(folder / 'movie.nfo')], reason='removed from library'))

    assert [item.file_path for item in held] == [os.fspath(video)], 'only videos are queued'
    assert held[0].status == QUEUE_PENDING
    assert held[0].parsed_info[HOLD_REASON_KEY] == 'removed from library'

    processed = asyncio.run(service.process_next_item())

    assert processed.status == QUEUE_NEEDS_REVIEW
    assert processed.confidence_score == 100
    assert processed.best_match['imdb_id'] == 'tt0000001', 'the proposal is still pre-filled'
    assert processed.parsed_info['review_reason'] == 'held for review: removed from library'
    assert orchestrator.calls == []


def test_hold_survives_a_retry_and_is_cleared_by_manual_assignment(tmp_path):
    service, orchestrator, _folder, video = _held_service(tmp_path)
    item = asyncio.run(service.hold_files_for_review([os.fspath(video)], reason='removed'))[0]
    asyncio.run(service.process_next_item())

    asyncio.run(service.retry_item(item.id))
    reprocessed = asyncio.run(service.process_next_item())
    assert reprocessed.status == QUEUE_NEEDS_REVIEW
    assert reprocessed.parsed_info[HOLD_REASON_KEY] == 'removed'
    assert orchestrator.calls == []

    assigned = asyncio.run(service.manual_assign_item(
        item.id, {'title': 'Some Movie', 'year': 2010, 'media_type': 'movie', 'imdb_id': 'tt0000001'}))
    assert HOLD_REASON_KEY not in assigned.parsed_info
    assert assigned.status in (QUEUE_AUTO_ASSIGNED, 'completed')


def test_unheld_confident_match_still_auto_assigns(tmp_path):
    service, orchestrator, _folder, video = _held_service(tmp_path)
    service.add_manual_file(os.fspath(video))
    processed = asyncio.run(service.process_next_item())
    assert processed.status != QUEUE_NEEDS_REVIEW
    assert len(orchestrator.calls) == 1


# ---------------------------------------------------------------------------
# API: /api/catalog/{movies,series}/{id}/remove-to-review
# ---------------------------------------------------------------------------

def _row(record_id, folder_path):
    row = MagicMock()
    row.id = record_id
    row.raw_data = {'title': 'Some Movie', 'folderPath': folder_path}
    return row


def _db(row):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db


@pytest.fixture()
def roots(tmp_path, monkeypatch):
    library = tmp_path / 'jellyfin'
    ingest = tmp_path / 'ingest'
    monkeypatch.setattr(settings, 'jellyfin_dest_base', os.fspath(library))
    monkeypatch.setattr(settings, 'ingress_default_paths', [os.fspath(ingest)])
    return library, ingest


async def _post(path, db, queue_service):
    from api.mobile_auth import require_any_auth
    from db.database import get_db
    from main import app

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_any_auth] = lambda: SimpleNamespace(session_id='s')
    saved = getattr(app.state, 'ingress_queue_service', None)
    app.state.ingress_queue_service = queue_service
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
            return await ac.post(path)
    finally:
        app.dependency_overrides.clear()
        app.state.ingress_queue_service = saved


@pytest.mark.asyncio
@pytest.mark.parametrize('kind, category', [('movies', 'Movies'), ('series', 'TV Shows')])
async def test_remove_to_review_moves_into_ingest_and_holds_the_files(roots, kind, category):
    library, ingest = roots
    folder = library / category / 'Some Title (2010) [imdbid-tt0000001]'
    (folder / 'Season 01').mkdir(parents=True)
    (folder / 'Season 01' / 'ep.mkv').write_bytes(b'x')
    (folder / 'main.mkv').write_bytes(b'x')
    queue = SimpleNamespace(hold_files_for_review=AsyncMock(return_value=[]))
    db = _db(_row('record-123456789', os.fspath(folder)))

    resp = await _post(f'/api/catalog/{kind}/record-123456789/remove-to-review', db, queue)

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {'deleted', 'movedTo'}
    assert body['deleted'] == 'record-123456789'
    moved = ingest / folder.name
    assert os.path.realpath(body['movedTo']) == os.path.realpath(moved)
    assert moved.is_dir() and not folder.exists()
    assert not (library / '_NeedsReview').exists()

    queue.hold_files_for_review.assert_awaited_once()
    args, kwargs = queue.hold_files_for_review.call_args
    queued = sorted(os.path.relpath(path, moved).replace('\\', '/') for path in args[0])
    assert queued == ['Season 01/ep.mkv', 'main.mkv']
    assert kwargs['ingress_path'] == os.fspath(ingest)
    assert 'removed from library' in kwargs['reason']
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_remove_to_review_suffixes_a_name_taken_in_ingest(roots):
    library, ingest = roots
    folder = library / 'Movies' / 'Dup (2000)'
    folder.mkdir(parents=True)
    (ingest / 'Dup (2000)').mkdir(parents=True)
    queue = SimpleNamespace(hold_files_for_review=AsyncMock(return_value=[]))

    resp = await _post('/api/catalog/movies/abcdef123/remove-to-review', _db(_row('abcdef123', os.fspath(folder))), queue)

    assert resp.status_code == 200
    assert resp.json()['movedTo'].endswith('Dup (2000)__abcdef12')


@pytest.mark.asyncio
async def test_remove_to_review_refuses_a_folder_outside_the_library(roots, tmp_path):
    outside = tmp_path / 'elsewhere' / 'X'
    outside.mkdir(parents=True)
    queue = SimpleNamespace(hold_files_for_review=AsyncMock())

    resp = await _post('/api/catalog/movies/m1/remove-to-review', _db(_row('m1', os.fspath(outside))), queue)

    assert resp.status_code == 403
    assert outside.exists()
    queue.hold_files_for_review.assert_not_awaited()


@pytest.mark.asyncio
async def test_remove_to_review_without_a_folder_only_deletes(roots):
    queue = SimpleNamespace(hold_files_for_review=AsyncMock())
    resp = await _post('/api/catalog/movies/m1/remove-to-review', _db(_row('m1', None)), queue)
    assert resp.status_code == 200
    assert resp.json() == {'deleted': 'm1', 'movedTo': None}
