"""Grouped ingress-queue listing and bulk triage actions (issue #34).

The grouped listing and the group selector read the persisted `ingress_queue` rows, so
these tests feed fake session rows and check the shape plus the per-item result contract.
"""

import asyncio
import os
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

TEST_DB_URL = os.environ.get("INGRESS_TRIAGE_TEST_DATABASE_URL")
integration = pytest.mark.skipif(not TEST_DB_URL, reason="INGRESS_TRIAGE_TEST_DATABASE_URL not set")

from services.ingress_queue_service import (
    IngressQueueService,
    QUEUE_COMPLETED,
    QUEUE_FAILED,
    QUEUE_IGNORED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
)
from services.ingress_triage_service import (
    MAX_GROUP_ITEMS,
    UNPARSED_TITLE_BUCKET,
    IngressTriageService,
    TriageQueryError,
    item_group_key,
    source_folder_for,
)

QUEUED_AT = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)


class _CapturingAssignmentOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({'queue_item': dict(queue_item), 'force_organize': force_organize})
        proposed_path = queue_item.get('proposed_path') or ''
        return {
            'assignment_id': 'assignment-bulk',
            'organized': True,
            'organization_result': {
                'success': True,
                'targetPath': os.fspath(os.path.dirname(proposed_path)) if proposed_path else None,
                'operations': [{'destination': proposed_path}],
            },
        }


class _FailingAssignmentOrchestrator:
    async def auto_assign(self, queue_item, force_organize=False):
        return None


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


def _group_row(media_type, ingress_path, title, status, count, confidence_min=None, confidence_max=None,
               source_folder=''):
    return SimpleNamespace(
        media_type=media_type,
        ingress_path=ingress_path,
        title=title,
        source_folder=source_folder,
        status=status,
        item_count=count,
        min_confidence=confidence_min,
        max_confidence=confidence_max,
        first_queued_at=QUEUED_AT,
        last_queued_at=QUEUED_AT,
    )


def _persisted_row(item_id, file_name, status=QUEUE_PENDING, ingress_path='/inbox', best_match=None, **overrides):
    row = {
        'id': item_id,
        'file_path': os.path.join(ingress_path, file_name),
        'file_name': file_name,
        'ingress_path': ingress_path,
        'file_size': 1024,
        'detected_at': QUEUED_AT,
        'queued_at': QUEUED_AT,
        'status': status,
        'priority': 5,
        'attempts': 0,
        'parsed_info': {'title': (best_match or {}).get('title', file_name)},
        'best_match': best_match or {},
        'match_candidates': [],
    }
    row.update(overrides)
    return row


def _matrix_row(item_id, status=QUEUE_PENDING, confidence_score=90):
    return _persisted_row(
        item_id,
        f'The.Matrix.{item_id}.mkv',
        status=status,
        best_match={'media_type': 'movie', 'title': 'The Matrix'},
        confidence_score=confidence_score,
    )


def _movie_source(tmp_path, name='matrix.mkv'):
    source_file = tmp_path / 'ingest' / name
    source_file.parent.mkdir(parents=True, exist_ok=True)
    source_file.write_bytes(b'bulk-triage')
    return source_file


def test_get_queue_groups_returns_paged_groups_with_counts_and_previews():
    group_rows = [
        _group_row('movie', '/inbox', 'the matrix', 'pending', 2, 70, 91),
        _group_row('movie', '/inbox', 'the matrix', 'failed', 1, 40, 40),
        _group_row('series', '/inbox', 'firefly', QUEUE_NEEDS_REVIEW, 1, 65, 65),
    ]
    item_rows = [
        SimpleNamespace(**_matrix_row('item-1', confidence_score=91)),
        SimpleNamespace(**_matrix_row('item-2', confidence_score=70)),
        SimpleNamespace(**_matrix_row('item-3', status=QUEUE_FAILED, confidence_score=40)),
        SimpleNamespace(**_persisted_row('item-4', 'firefly.s01e01.mkv', status=QUEUE_NEEDS_REVIEW,
                                         best_match={'media_type': 'series', 'title': 'Firefly'})),
    ]

    service = IngressQueueService()
    triage = IngressTriageService(service, db_session_factory=_FakeSession(group_rows, item_rows))

    data = asyncio.run(triage.get_queue_groups(limit=1, preview_size=2))

    assert data['total_groups'] == 2
    assert data['total_items'] == 4
    assert data['status_counts'] == {
        QUEUE_PENDING: 2,
        'processing': 0,
        'auto_assigned': 0,
        QUEUE_NEEDS_REVIEW: 1,
        QUEUE_FAILED: 1,
        QUEUE_COMPLETED: 0,
        QUEUE_IGNORED: 0,
    }
    assert len(data['groups']) == 1
    group = data['groups'][0]
    assert group['group_key'] == {'media_type': 'movie', 'ingress_path': '/inbox', 'title': 'the matrix'}
    assert group['item_count'] == 3
    assert group['status_counts'] == {QUEUE_PENDING: 2, QUEUE_FAILED: 1}
    assert group['confidence_min'] == 40
    assert group['confidence_max'] == 91
    assert group['first_queued_at'] == QUEUED_AT.isoformat()
    assert group['last_queued_at'] == QUEUED_AT.isoformat()
    assert [item['id'] for item in group['preview_items']] == ['item-1', 'item-2']
    assert service.get_item('item-3') is not None


def test_get_queue_groups_offsets_previews_and_honours_status_filter():
    group_rows = [
        _group_row('movie', '/inbox', 'the matrix', 'pending', 2, 70, 91),
        _group_row('movie', '/inbox', 'the matrix', 'failed', 1, 40, 40),
        _group_row('series', '/inbox', 'firefly', QUEUE_NEEDS_REVIEW, 1, 65, 65),
    ]
    failed_rows = [SimpleNamespace(**_matrix_row('item-3', status=QUEUE_FAILED, confidence_score=40))]
    second_page_rows = [
        SimpleNamespace(**_persisted_row('item-4', 'firefly.s01e01.mkv', status=QUEUE_NEEDS_REVIEW,
                                         best_match={'media_type': 'series', 'title': 'Firefly'})),
    ]

    service = IngressQueueService()
    triage = IngressTriageService(
        service,
        db_session_factory=_FakeSession(group_rows, failed_rows, group_rows, second_page_rows),
    )

    filtered = asyncio.run(triage.get_queue_groups(statuses=[QUEUE_FAILED], limit=10))
    assert filtered['total_groups'] == 1
    assert filtered['total_items'] == 1
    assert filtered['groups'][0]['matching_count'] == 1
    assert filtered['groups'][0]['status_counts'] == {QUEUE_PENDING: 2, QUEUE_FAILED: 1}
    assert [item['id'] for item in filtered['groups'][0]['preview_items']] == ['item-3']

    paged = asyncio.run(triage.get_queue_groups(limit=1, offset=1))
    assert [group['title'] for group in paged['groups']] == ['firefly']
    assert paged['offset'] == 1
    assert [item['id'] for item in paged['groups'][0]['preview_items']] == ['item-4']


def test_get_queue_groups_collapses_titles_for_files_loose_in_one_ingress_folder():
    group_rows = [
        _group_row('movie', '/inbox', None, QUEUE_PENDING, 3, 40, 91),
        _group_row('movie', '/inbox', None, QUEUE_FAILED, 1, 30, 30),
    ]
    item_rows = [
        SimpleNamespace(**_matrix_row('item-1', confidence_score=91)),
        SimpleNamespace(**_persisted_row('item-2', 'the.matrix.revolver.2009.mkv',
                                         best_match={'media_type': 'movie', 'title': 'The Matrix Revolver'})),
        SimpleNamespace(**_matrix_row('item-3', status=QUEUE_FAILED, confidence_score=30)),
        SimpleNamespace(**_persisted_row('item-4', 'firefly.s01e01.mkv', ingress_path='/tv',
                                         status=QUEUE_NEEDS_REVIEW,
                                         best_match={'media_type': 'series', 'title': 'Firefly'})),
    ]

    service = IngressQueueService()
    triage = IngressTriageService(service, db_session_factory=_FakeSession(group_rows, item_rows))

    data = asyncio.run(triage.get_queue_groups(group_by='source_folder', preview_size=4))

    assert data['group_by'] == 'source_folder'
    assert data['total_groups'] == 1
    assert data['total_items'] == 4
    group = data['groups'][0]
    assert group['group_key'] == {'media_type': 'movie', 'ingress_path': '/inbox', 'title': None,
                                  'source_folder': ''}
    assert group['item_count'] == 4
    assert group['status_counts'] == {QUEUE_PENDING: 3, QUEUE_FAILED: 1}
    assert (group['confidence_min'], group['confidence_max']) == (30, 91)
    assert [item['id'] for item in group['preview_items']] == ['item-1', 'item-2', 'item-3']


def test_get_queue_groups_splits_source_folder_groups_by_the_rip_folder():
    """AC2: one watched root, two rips -> two source_folder groups, not one."""
    group_rows = [
        _group_row('movie', '/inbox', None, QUEUE_PENDING, 1, 91, 91, source_folder='The.Matrix.1999.DISC1'),
        _group_row('movie', '/inbox', None, QUEUE_PENDING, 1, 70, 70, source_folder='Heat.2022.DISC1'),
    ]
    item_rows = [
        SimpleNamespace(**_persisted_row('disc-1', 'The.Matrix.1999.DISC1/movie.mkv',
                                         best_match={'media_type': 'movie', 'title': 'The Matrix'})),
        SimpleNamespace(**_persisted_row('disc-2', 'Heat.2022.DISC1/movie.mkv',
                                         best_match={'media_type': 'movie', 'title': 'Heat'})),
    ]

    service = IngressQueueService()
    triage = IngressTriageService(service, db_session_factory=_FakeSession(group_rows, item_rows))

    data = asyncio.run(triage.get_queue_groups(group_by='source_folder', preview_size=4))

    assert data['total_groups'] == 2
    assert data['total_items'] == 2
    assert [
        (group['group_key']['source_folder'], group['item_count'])
        for group in data['groups']
    ] == [('Heat.2022.DISC1', 1), ('The.Matrix.1999.DISC1', 1)]
    assert all(group['group_key']['title'] is None for group in data['groups'])
    assert [entry['id'] for entry in data['groups'][0]['preview_items']] == ['disc-2']
    assert [entry['id'] for entry in data['groups'][1]['preview_items']] == ['disc-1']


def test_source_folder_for_is_the_first_segment_below_the_ingress_root():
    assert source_folder_for('/inbox', '/inbox/The.Matrix.1999.DISC1 DISC1/movie.mkv') == 'The.Matrix.1999.DISC1 DISC1'
    assert source_folder_for('/inbox', '/inbox/The.Matrix.1999.DISC1/DISC2/movie.mkv') == 'The.Matrix.1999.DISC1'
    assert source_folder_for('/inbox/', '/inbox/movie.mkv') == ''
    assert source_folder_for('/inbox', '/inbox') == ''
    assert source_folder_for('', '/inbox/movie.mkv') == ''
    assert source_folder_for(None, '/inbox/movie.mkv') == ''
    assert source_folder_for('/inbox2', '/inbox/The.Matrix.1999.DISC1/movie.mkv') == ''


def test_title_group_bucket_falls_back_to_the_unparsed_bucket():
    assert item_group_key({'file_name': 'broken.mkv', 'ingress_path': '/inbox'})[:3] == (
        'unclassified', '/inbox', UNPARSED_TITLE_BUCKET,
    )
    assert item_group_key({
        'file_name': 'broken.mkv',
        'ingress_path': '/inbox',
        'best_match': {'title': ''},
        'parsed_info': {'title': '   '},
    })[2] == UNPARSED_TITLE_BUCKET
    assert item_group_key({
        'file_name': 'broken.mkv',
        'ingress_path': '/inbox',
        'parsed_info': {'title': 'The   Matrix'},
    })[2] == 'the matrix'


def test_get_queue_groups_rejects_unknown_group_by():
    triage = IngressTriageService(IngressQueueService(), db_session_factory=_FakeSession())

    with pytest.raises(ValueError, match='Unsupported group_by'):
        asyncio.run(triage.get_queue_groups(group_by='size'))


def test_bulk_accept_uses_orchestrator_and_records_one_batch_history_row(tmp_path, monkeypatch):
    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base',
                        os.fspath(tmp_path / 'jellyfin'))
    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(_movie_source(tmp_path)))
    item.best_match = {'title': 'The Matrix', 'year': 2000, 'media_type': 'movie', 'media_id': 'movie-1'}
    item.confidence_score = 96

    triage = IngressTriageService(service, db_session_factory=_FakeSession())
    result = asyncio.run(triage.bulk_action(action='accept', item_ids=[item.id, 'missing-item']))

    assert result['action'] == 'accept'
    assert (result['succeeded'], result['failed'], result['skipped']) == (1, 1, 0)
    assert result['results'][0]['item_status'] == QUEUE_COMPLETED
    assert result['results'][1]['error'] == 'Queue item not found'
    assert orchestrator.calls and orchestrator.calls[0]['force_organize'] is True

    history = [entry for entry in service.get_processing_history(limit=10) if entry['item_id'] == item.id]
    assert len(history) == 1
    assert history[0]['event'] == 'accepted_assignment'
    assert history[0]['batch_id'] == result['batch_id']
    assert history[0]['action'] == 'accept'
    assert history[0]['source'] == 'bulk'


def test_bulk_ignore_is_terminal_and_blocks_retry(tmp_path):
    service = IngressQueueService()
    item = service.add_manual_file(os.fspath(_movie_source(tmp_path)))

    triage = IngressTriageService(service, db_session_factory=_FakeSession())
    result = asyncio.run(triage.bulk_action(action='ignore', item_ids=[item.id]))

    assert result['succeeded'] == 1
    assert service.get_item(item.id)['status'] == QUEUE_IGNORED
    assert service.get_queue_items(status=QUEUE_PENDING) == []
    assert service.get_retry_candidate_ids() == []
    assert asyncio.run(triage.bulk_action(action='retry', item_ids=[item.id]))['skipped'] == 1

    history = [entry for entry in service.get_processing_history(limit=10) if entry['item_id'] == item.id]
    assert len(history) == 1
    assert history[0]['event'] == 'item_ignored'
    assert history[0]['batch_id'] == result['batch_id']
    assert history[0]['source'] == 'bulk'


def test_bulk_retry_and_classify_report_partial_success(tmp_path):
    ingress = tmp_path / 'ingest'
    ingress.mkdir(parents=True)
    service = IngressQueueService()
    pending = service.add_manual_file(os.fspath(ingress / 'pending.mkv'))
    needs_review = service.add_manual_file(os.fspath(ingress / 'review.mkv'))
    completed = service.add_manual_file(os.fspath(ingress / 'done.mkv'))
    completed.status = QUEUE_COMPLETED

    triage = IngressTriageService(service, db_session_factory=_FakeSession())

    retry = asyncio.run(triage.bulk_action(
        action='retry',
        item_ids=[pending.id, needs_review.id, completed.id, 'missing-item'],
    ))
    assert (retry['succeeded'], retry['skipped'], retry['failed']) == (2, 1, 1)
    assert service.get_item(pending.id)['status'] == QUEUE_PENDING
    retry_history = [entry for entry in service.get_processing_history(limit=10) if entry['item_id'] == pending.id]
    assert len(retry_history) == 1
    assert retry_history[0]['event'] == 'retry_requested'
    assert retry_history[0]['batch_id'] == retry['batch_id']

    classified = asyncio.run(triage.bulk_action(
        action='classify',
        item_ids=[pending.id, 'missing-item'],
        classification='special_feature',
    ))
    assert (classified['succeeded'], classified['failed']) == (1, 1)
    assert service.get_item(pending.id)['classification_override'] == 'special_feature'
    classify_history = [
        entry for entry in service.get_processing_history(limit=10)
        if entry['item_id'] == pending.id and entry['event'] == 'classification_updated'
    ]
    assert len(classify_history) == 1
    assert classify_history[0]['source'] == 'bulk'
    assert classify_history[0]['action'] == 'classify'

    assert 'error' in asyncio.run(triage.bulk_action(action='classify', item_ids=[pending.id], classification='nope'))
    assert 'error' in asyncio.run(triage.bulk_action(action='delete', item_ids=[pending.id]))
    assert 'error' in asyncio.run(triage.bulk_action(action='ignore'))


def test_bulk_classify_and_retry_of_a_failed_item_report_success(tmp_path):
    """Classify leaves a failed item failed; that is not a failed action, and its stale last_error isn't the result."""
    ingress = tmp_path / 'ingest'
    ingress.mkdir(parents=True)
    service = IngressQueueService()
    failed = service.add_manual_file(os.fspath(ingress / 'failed.mkv'))
    failed.status = QUEUE_FAILED
    failed.last_error = 'organize blew up earlier'
    triage = IngressTriageService(service, db_session_factory=_FakeSession())

    classified = asyncio.run(triage.bulk_action(
        action='classify',
        item_ids=[failed.id],
        classification='special_feature',
    ))
    assert (classified['succeeded'], classified['failed']) == (1, 0)
    [result] = classified['results']
    assert result['status'] == 'succeeded'
    assert result['item_status'] == QUEUE_FAILED
    assert result['error'] is None
    assert service.get_item(failed.id)['classification_override'] == 'special_feature'

    retried = asyncio.run(triage.bulk_action(action='retry', item_ids=[failed.id]))
    assert (retried['succeeded'], retried['failed']) == (1, 0)
    assert retried['results'][0]['item_status'] == QUEUE_PENDING


def test_search_treats_like_wildcards_literally():
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    [search] = triage._filters(None, None, r'50%_off\x')
    compiled = search.compile(dialect=postgresql.dialect())
    assert "ESCAPE" in str(compiled)
    assert set(map(str, compiled.params.values())) == {r'%50\%\_off\\x%'}


def test_bulk_group_selector_resolves_ids_from_persisted_rows(tmp_path):
    service = IngressQueueService()
    rows = [SimpleNamespace(**_matrix_row('backlog-1')), SimpleNamespace(**_matrix_row('backlog-2'))]
    session = _FakeSession(rows)
    triage = IngressTriageService(service, db_session_factory=session)

    result = asyncio.run(triage.bulk_action(
        action='ignore',
        group={'media_type': 'movie', 'ingress_path': '/inbox', 'title': 'the matrix'},
        statuses=[QUEUE_PENDING],
        exclude_item_ids=['backlog-2'],
    ))

    assert result['requested'] == 1
    assert result['succeeded'] == 1
    assert service.get_item('backlog-1')['status'] == QUEUE_IGNORED
    assert service.get_item('backlog-2')['status'] == QUEUE_PENDING
    assert len(session.statements) == 1


def test_bulk_accept_reports_failure_when_organization_fails(tmp_path):
    service = IngressQueueService(assignment_orchestrator=_FailingAssignmentOrchestrator())
    item = service.add_manual_file(os.fspath(_movie_source(tmp_path)))

    triage = IngressTriageService(service, db_session_factory=_FakeSession())

    result = asyncio.run(triage.bulk_action(action='accept', item_ids=[item.id]))

    assert (result['succeeded'], result['failed']) == (0, 1)
    assert result['results'][0]['item_status'] == QUEUE_FAILED
    assert service.get_item(item.id)['status'] == QUEUE_FAILED


def test_item_group_key_matches_persisted_row_grouping():
    assert item_group_key({
        'ingress_path': '/inbox',
        'file_path': '/inbox/The.Matrix.1999.DISC1/the.matrix.1999.mkv',
        'file_name': 'The.Matrix.1999.mkv',
        'best_match': {'media_type': 'movie_fallback'},
        'parsed_info': {'title': 'The   Matrix'},
    }) == ('movie', '/inbox', 'the matrix', 'The.Matrix.1999.DISC1')
    assert item_group_key({'file_name': 'random.mkv', 'file_path': '/inbox/random.mkv'}) == (
        'unclassified', '', UNPARSED_TITLE_BUCKET, ''
    )


def test_bulk_group_selector_targets_one_rip_folder():
    service = IngressQueueService()
    session = _FakeSession([
        SimpleNamespace(**_persisted_row('backlog-1', 'The.Matrix.1999.DISC1/the.matrix.mkv',
                                         best_match={'media_type': 'movie', 'title': 'The Matrix'})),
    ])
    triage = IngressTriageService(service, db_session_factory=session)

    ids = asyncio.run(triage.resolve_group_item_ids({
        'media_type': 'movie', 'ingress_path': '/inbox', 'source_folder': 'The.Matrix.1999.DISC1',
    }))
    assert ids == ['backlog-1']

    from sqlalchemy.dialects import postgresql

    where = str(session.statements[0].compile(dialect=postgresql.dialect())).split('WHERE')[1]
    assert 'strpos' in where and 'ingress_queue.file_path' in where


def test_bulk_group_selector_without_a_title_targets_the_whole_folder():
    service = IngressQueueService()
    rows = [SimpleNamespace(**_matrix_row('backlog-1')), SimpleNamespace(**_matrix_row('backlog-2'))]
    triage = IngressTriageService(service, db_session_factory=_FakeSession(rows))

    ids = asyncio.run(triage.resolve_group_item_ids({'media_type': 'movie', 'ingress_path': '/inbox', 'title': None}))

    assert ids == ['backlog-1', 'backlog-2']


def test_group_statement_renders_postgres_json_grouping_and_search():
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    statement = triage._group_statement(triage._filters(['movie'], ['/inbox'], 'matrix'))
    sql = str(statement.compile(dialect=postgresql.dialect()))

    assert "ingress_queue.best_match ->> " in sql
    assert "ingress_queue.parsed_info ->> " in sql
    assert 'regexp_replace' in sql and 'GROUP BY' in sql and 'ILIKE' in sql


def test_group_statement_groups_by_folder_only_when_asked_to():
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)

    def compile(statement):
        return str(statement.compile(dialect=postgresql.dialect()))

    # regexp_replace() is the parsed-title normalization: it is selected, grouped and ordered by
    # for parsed_title, and absent altogether when grouping by source folder.
    title_sql = compile(triage._group_statement([], 'parsed_title'))
    folder_sql = compile(triage._group_statement([], 'source_folder'))
    assert title_sql.count('regexp_replace') >= 3
    assert 'regexp_replace' not in folder_sql
    assert 'ingress_queue.file_path' in folder_sql.split('GROUP BY')[1]

    # a q= search still matches parsed titles even when the grouping itself is per folder
    searched = compile(triage._group_statement(triage._filters(None, None, 'matrix'), 'source_folder'))
    assert 'ILIKE' in searched and 'regexp_replace' in searched


def test_group_statement_derives_the_source_folder_from_the_file_path():
    """AC2: source_folder is the rip folder under the ingress root, not the ingress_path column."""
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    folder_sql = str(triage._group_statement([], 'source_folder').compile(dialect=postgresql.dialect()))
    group_by = folder_sql.split('GROUP BY')[1]

    assert 'AS source_folder' in folder_sql.split('FROM')[0]
    assert 'ingress_queue.file_path' in group_by
    assert 'strpos' in group_by and 'substr' in group_by and 'ingress_queue.ingress_path' in group_by
    assert 'rtrim' in group_by and 'concat' in group_by, group_by  # the root prefix is built, never LIKE'd
    assert 'regexp_replace' not in group_by


def test_group_statement_buckets_titles_the_parser_did_not_provide():
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    query = triage._group_statement([], 'parsed_title').compile(dialect=postgresql.dialect())

    assert UNPARSED_TITLE_BUCKET in query.params.values(), query.params
    assert 'ingress_queue.file_name' not in str(query).split('WHERE')[0]



class _BrokenSession(_FakeSession):
    async def execute(self, statement):
        raise ConnectionRefusedError("connection refused")


def test_triage_query_failure_raises_instead_of_returning_an_empty_listing():
    triage = IngressTriageService(IngressQueueService(), db_session_factory=_BrokenSession())

    with pytest.raises(TriageQueryError):
        asyncio.run(triage.get_queue_groups())
    with pytest.raises(TriageQueryError):
        asyncio.run(triage.bulk_action(action='ignore', group={'media_type': 'movie'}))


def test_group_selector_over_the_cap_is_ordered_capped_and_reported():
    rows = [SimpleNamespace(**_matrix_row(f'backlog-{n:04d}')) for n in range(MAX_GROUP_ITEMS + 1)]
    session = _FakeSession(rows)
    triage = IngressTriageService(IngressQueueService(), db_session_factory=session)

    ids, truncated = asyncio.run(triage.resolve_group({'media_type': 'movie', 'ingress_path': '/inbox'}))

    assert truncated is True
    assert ids == [f'backlog-{n:04d}' for n in range(MAX_GROUP_ITEMS)]
    from sqlalchemy.dialects import postgresql

    sql = str(session.statements[0].compile(dialect=postgresql.dialect()))
    assert 'ORDER BY ingress_queue.queued_at, ingress_queue.id' in sql
    assert session.statements[0]._limit_clause.value == MAX_GROUP_ITEMS + 1


def test_bulk_summary_reports_an_untruncated_group():
    session = _FakeSession([SimpleNamespace(**_matrix_row('backlog-1'))])
    triage = IngressTriageService(IngressQueueService(), db_session_factory=session)

    summary = asyncio.run(triage.bulk_action(action='ignore', group={'media_type': 'movie'}))

    assert (summary['group_truncated'], summary['group_limit']) == (False, MAX_GROUP_ITEMS)

@integration
@pytest.mark.integration
async def test_grouped_listing_and_bulk_ignore_run_against_postgres():
    """Real Postgres: JSON-derived group keys, per-status counts and one history row per item."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from db.models import Base
    from db.models import IngressProcessingHistory as DBHistory
    from db.models import IngressQueueItem as DBQueueItem

    engine = create_async_engine(TEST_DB_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

        def row(item_id, file_name, status, confidence, best_match, folder=None, ingress_path='/inbox',
                parsed_info=None):
            parts = [ingress_path] + ([folder] if folder else []) + [file_name]
            return DBQueueItem(
                id=item_id,
                file_path=os.path.join(*parts),
                file_name=file_name,
                ingress_path=ingress_path,
                file_size=1024,
                detected_at=QUEUED_AT,
                queued_at=QUEUED_AT,
                status=status,
                priority=5,
                attempts=0,
                confidence_score=confidence,
                parsed_info={'title': file_name} if parsed_info is None else parsed_info,
                best_match=best_match,
                match_candidates=[],
            )

        matrix = {'media_type': 'movie', 'title': 'The Matrix'}
        async with sessions() as session:
            session.add_all([
                row('triage-1', 'The.Matrix.2000.mkv', QUEUE_PENDING, 91, matrix),
                row('triage-2', 'The.Matrix.2000.1080p.mkv', QUEUE_PENDING, 70, matrix),
                row('triage-3', 'The.Matrix.2000.mkv', QUEUE_FAILED, 40, matrix),
                row('triage-4', 'firefly.s01e01.mkv', QUEUE_NEEDS_REVIEW, 65,
                    {'media_type': 'series', 'title': 'Firefly'}),
            ])
            await session.commit()

        queue_service = IngressQueueService(db_session_factory=sessions)
        triage = IngressTriageService(queue_service, db_session_factory=sessions)

        listing = await triage.get_queue_groups(statuses=[QUEUE_PENDING], limit=1, preview_size=2)
        assert listing['total_groups'] == 1
        assert listing['total_items'] == 2
        assert listing['status_counts'][QUEUE_NEEDS_REVIEW] == 1
        group = listing['groups'][0]
        assert group['group_key'] == {'media_type': 'movie', 'ingress_path': '/inbox', 'title': 'the matrix'}
        assert group['item_count'] == 3
        assert group['matching_count'] == 2
        assert group['status_counts'] == {QUEUE_PENDING: 2, QUEUE_FAILED: 1}
        assert (group['confidence_min'], group['confidence_max']) == (40, 91)
        assert sorted(item['id'] for item in group['preview_items']) == ['triage-1', 'triage-2']

        bulk = await triage.bulk_action(
            action='ignore',
            group={'media_type': 'movie', 'ingress_path': '/inbox', 'title': 'the matrix'},
        )
        assert (bulk['requested'], bulk['succeeded'], bulk['failed']) == (3, 3, 0)

        # AC2: two rips under one watched root are two source_folder groups, and the folder
        # group_key feeds back into the bulk group selector.
        async with sessions() as session:
            session.add_all([
                row('rip-1', 'disc1.mkv', QUEUE_PENDING, 88, matrix, folder='The.Matrix.1999.DISC1'),
                row('rip-2', 'heat.mkv', QUEUE_PENDING, 66, {'media_type': 'movie', 'title': 'Heat'},
                    folder='Heat.2022.DISC1'),
            ])
            await session.commit()

        folders = await triage.get_queue_groups(group_by='source_folder', limit=10, preview_size=5)
        assert folders['total_groups'] == 4
        assert [
            (group['group_key']['media_type'], group['group_key']['source_folder'], group['item_count'])
            for group in folders['groups']
        ] == [
            ('movie', '', 3),
            ('movie', 'Heat.2022.DISC1', 1),
            ('movie', 'The.Matrix.1999.DISC1', 1),
            ('series', '', 1),
        ]
        assert [group['group_key']['title'] for group in folders['groups']] == [None, None, None, None]
        assert [item['id'] for item in folders['groups'][2]['preview_items']] == ['rip-1']

        # a row neither parsed_info nor best_match gave a title to falls in the (unparsed) bucket
        async with sessions() as session:
            session.add(row('no-title', 'broken-rip.mkv', QUEUE_PENDING, 0, {}, parsed_info={}))
            await session.commit()

        unparsed = await triage.get_queue_groups(limit=20, preview_size=2)
        bucket = [group for group in unparsed['groups'] if group['group_key']['title'] == UNPARSED_TITLE_BUCKET]
        assert [(group['group_key']['media_type'], group['item_count']) for group in bucket] == [('unclassified', 1)]
        assert [item['id'] for item in bucket[0]['preview_items']] == ['no-title']

        rip_bulk = await triage.bulk_action(
            action='ignore',
            group={'media_type': 'movie', 'ingress_path': '/inbox', 'source_folder': 'The.Matrix.1999.DISC1'},
        )
        assert (rip_bulk['requested'], rip_bulk['succeeded'], rip_bulk['failed']) == (1, 1, 0)

        async with sessions() as session:
            ignored = (await session.execute(
                select(DBQueueItem).where(DBQueueItem.status == QUEUE_IGNORED)
            )).scalars().all()
            history = (await session.execute(select(DBHistory))).scalars().all()

        assert sorted(item.id for item in ignored) == ['rip-1', 'triage-1', 'triage-2', 'triage-3']
        assert len(history) == 4
        assert all(entry.snapshot['action'] == 'ignore'
                   and entry.snapshot['source'] == 'bulk'
                   for entry in history)
        assert sorted(entry.snapshot['batch_id'] for entry in history) == sorted(
            [bulk['batch_id']] * 3 + [rip_bulk['batch_id']]
        )
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()
