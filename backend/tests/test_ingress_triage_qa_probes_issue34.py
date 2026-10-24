"""Tester-owned QA probes for issue #34 (ingest triage API: DB-backed grouped queue + bulk actions).

Each probe maps to an acceptance criterion of the issue:

  AC1 grouped listing / bulk actions read the persisted `ingress_queue` table (pre-restart backlog)
  AC2 group + per-status counts are correct for a mixed pending/needs_review/failed/completed set
  AC3 `q` matches file_name and parsed_info->>'title'; limit/offset page groups, limit is capped
  AC4 bulk endpoint accepts explicit ids and a group selector, per-item results, no abort on failure
  AC5 bulk ignore writes `ignored` to the row, bulk classify reuses `update_classification` validation
  AC6 one `ingress_processing_history` row per mutated item carrying batch_id/action/source
  AC7 ignored items are skipped by the pending processor and by failed-item auto-retry
"""

import asyncio
import os
import time
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
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
    VALID_CLASSIFICATION_OVERRIDES,
    queue_item_from_row,
)
from services.ingress_triage_service import (
    MAX_GROUP_PAGE_SIZE,
    MAX_PREVIEW_ITEMS,
    MAX_PREVIEW_ROWS,
    QUEUE_GROUP_BY_FOLDER,
    QUEUE_GROUP_BY_TITLE,
    UNPARSED_TITLE_BUCKET,
    IngressTriageService,
    item_group_key,
)

QUEUED_AT = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
INGRESS_ROOT = '/ark/media/ingest'


def _row(item_id, file_name, status=QUEUE_PENDING, ingress_path=INGRESS_ROOT,
         best_match=None, parsed_info=None, **overrides):
    """A persisted `ingress_queue` row shape (attribute access, like an ORM instance)."""
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
        last_error='transient matcher failure' if status == QUEUE_FAILED else None,
        confidence_score=80,
        assignment_id=None,
        parsed_info=parsed_info if parsed_info is not None else {'title': file_name},
        best_match=best_match or {},
        match_candidates=[],
        media_duration_ms=None,
        proposed_path=None,
    )
    for field, value in overrides.items():
        setattr(row, field, value)
    return row


def _matrix():
    return {'media_type': 'movie', 'title': 'The Matrix'}


def _id_criteria(statement):
    """Queue item ids pinned by ``ingress_queue.id = :x`` in a statement (best effort)."""
    ids = set()
    clause = getattr(statement, 'whereclause', None)
    stack = [clause] if clause is not None else []
    while stack:
        node = stack.pop()
        try:
            if str(node).startswith('ingress_queue.id ='):
                value = getattr(getattr(node, 'right', None), 'value', None)
                if isinstance(value, str):
                    ids.add(value)
            stack.extend(list(node.get_children()))
        except Exception:  # pragma: no cover - the fake stays tolerant of SQLAlchemy internals
            continue
    return ids


class _BacklogSession:
    """Async-session stand-in over persisted queue rows.

    GROUP BY statements answer with (media_type, ingress_path, title, source_folder, status, count) rows
    and plain SELECTs with the row objects, which is what the two query shapes of #34 expect. Only
    ``id =`` equality is interpreted from WHERE, so probes must not rely on other SQL filtering here.
    """

    def __init__(self, rows):
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

    def _aggregate_rows(self):
        buckets = {}
        for row in self.rows.values():
            key = item_group_key(queue_item_from_row(row)) + (row.status,)
            buckets.setdefault(key, []).append(row)
        return [
            SimpleNamespace(
                media_type=key[0],
                ingress_path=key[1],
                title=key[2],
                source_folder=key[3],
                status=key[4],
                item_count=len(members),
                min_confidence=min(member.confidence_score for member in members),
                max_confidence=max(member.confidence_score for member in members),
                first_queued_at=QUEUED_AT,
                last_queued_at=QUEUED_AT,
            )
            for key, members in buckets.items()
        ]

    async def execute(self, statement):
        self.statements.append(statement)
        if 'GROUP BY' in str(statement):
            rows = self._aggregate_rows()
        else:
            rows = list(self.rows.values())
            wanted = _id_criteria(statement)
            if wanted:
                rows = [row for row in rows if row.id in wanted]
        return SimpleNamespace(
            all=lambda: list(rows),
            scalars=lambda: SimpleNamespace(first=lambda: rows[0] if rows else None, all=lambda: list(rows)),
        )

    async def get(self, model, ident):
        return self.rows.get(ident)

    def add(self, instance):
        self.added.append(instance)

    async def commit(self):
        self.commits += 1


class _FixtureTriage(IngressTriageService):
    """Runs the real grouping/paging code over fixture result rows (no Postgres in unit runs)."""

    def __init__(self, queue_service, group_counts, item_rows=()):
        super().__init__(queue_service, db_session_factory=None)
        self.group_counts = group_counts
        self.item_rows = list(item_rows)
        self.statements = []

    async def _fetch(self, statement):
        self.statements.append(statement)
        if 'GROUP BY' in str(statement):
            return [
                SimpleNamespace(
                    media_type=key[0], ingress_path=key[1], title=key[2], source_folder=key[4] if len(key) > 4 else '',
                    status=key[3] if len(key) == 4 else key[4], item_count=count,
                    min_confidence=None, max_confidence=None, first_queued_at=QUEUED_AT, last_queued_at=QUEUED_AT,
                )
                for key, count in self.group_counts.items()
            ]
        return list(self.item_rows)


def _wire_app(queue_service, triage_service=None):
    from main import app as fastapi_app

    fastapi_app.state.ingress_queue_service = queue_service
    if triage_service is None:
        if hasattr(fastapi_app.state, 'ingress_triage_service'):
            del fastapi_app.state.ingress_triage_service
    else:
        fastapi_app.state.ingress_triage_service = triage_service
    return fastapi_app


def _restore_app(saved):
    from main import app as fastapi_app

    for name in ('ingress_queue_service', 'ingress_triage_service'):
        if name in saved:
            setattr(fastapi_app.state, name, saved[name])
        elif hasattr(fastapi_app.state, name):
            delattr(fastapi_app.state, name)


def _app_state_snapshot():
    from main import app as fastapi_app

    return {
        name: getattr(fastapi_app.state, name)
        for name in ('ingress_queue_service', 'ingress_triage_service')
        if hasattr(fastapi_app.state, name)
    }


def test_qa_grouped_listing_returns_the_persisted_backlog_this_process_never_saw():
    """AC1: GET /api/ingress/queue/groups answers from the queue table, not process memory."""
    rows = [
        _row('backlog-1', 'The.Matrix.2000.mkv', best_match=_matrix()),
        _row('backlog-2', 'The.Matrix.2000.1080p.mkv', best_match=_matrix()),
        _row('backlog-3', 'broken.mkv', status=QUEUE_FAILED),
    ]
    session = _BacklogSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    assert queue_service.get_queue_items() == []  # nothing was queued during this process lifetime

    saved = _app_state_snapshot()
    app = _wire_app(queue_service)

    async def fetch():
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            return await client.get('/api/ingress/queue/groups', params={'previewSize': 10})

    try:
        response = asyncio.run(fetch())
        triage_service = app.state.ingress_triage_service
    finally:
        _restore_app(saved)

    assert response.status_code == 200
    payload = response.json()
    assert payload['success'] is True
    data = payload['data']
    assert data['total_groups'] == 2
    assert data['total_items'] == 3
    assert data['status_counts'][QUEUE_PENDING] == 2
    assert data['status_counts'][QUEUE_FAILED] == 1

    matrix = next(group for group in data['groups'] if group['group_key']['title'] == 'the matrix')
    assert matrix['group_key'] == {'media_type': 'movie', 'ingress_path': INGRESS_ROOT, 'title': 'the matrix'}
    assert matrix['item_count'] == 2
    assert sorted(item['id'] for item in matrix['preview_items']) == ['backlog-1', 'backlog-2']
    # the endpoint builds its triage service on the queue service's session factory, so the DB is the source
    assert triage_service.db_session_factory is session
    # backlog rows are hydrated into the queue service, so single-item actions reach them too
    assert queue_service.get_item('backlog-1') is not None
    assert len(session.statements) >= 2


def test_qa_group_and_global_status_counts_cover_completed_and_ignored():
    """AC2: a mixed pending/needs_review/failed/completed/ignored fixture counts correctly."""
    counts = {
        ('movie', '/inbox', 'the matrix', QUEUE_PENDING): 2,
        ('movie', '/inbox', 'the matrix', QUEUE_FAILED): 1,
        ('movie', '/inbox', 'the matrix', QUEUE_COMPLETED): 1,
        ('movie', '/inbox', 'the matrix', QUEUE_IGNORED): 1,
        ('movie', '/inbox', 'heat', QUEUE_NEEDS_REVIEW): 3,
    }
    triage = _FixtureTriage(IngressQueueService(), counts)

    listing = asyncio.run(triage.get_queue_groups(limit=10, preview_size=0))

    assert listing['total_groups'] == 2
    assert listing['total_items'] == 8
    assert set(listing['status_counts']) == set(QUEUE_ALL_STATUSES)
    assert {status: n for status, n in listing['status_counts'].items() if n} == {
        QUEUE_PENDING: 2, QUEUE_NEEDS_REVIEW: 3, QUEUE_FAILED: 1, QUEUE_COMPLETED: 1, QUEUE_IGNORED: 1,
    }
    matrix = next(group for group in listing['groups'] if group['group_key']['title'] == 'the matrix')
    assert (matrix['item_count'], matrix['matching_count']) == (5, 5)
    assert matrix['status_counts'] == {
        QUEUE_PENDING: 2, QUEUE_FAILED: 1, QUEUE_COMPLETED: 1, QUEUE_IGNORED: 1,
    }

    completed_only = asyncio.run(triage.get_queue_groups(statuses=[QUEUE_COMPLETED], limit=10, preview_size=0))
    assert completed_only['total_items'] == 1
    group = next(g for g in completed_only['groups'] if g['group_key']['title'] == 'the matrix')
    assert (group['item_count'], group['matching_count']) == (5, 1)


def test_qa_group_paging_honours_limit_offset_and_caps_them_server_side():
    """AC3: limit/offset page the groups, and over-large limit/previewSize are clamped."""
    counts = {('movie', '/inbox', f'title {index}', QUEUE_PENDING): 1 for index in range(4)}
    triage = _FixtureTriage(IngressQueueService(), counts)

    first = asyncio.run(triage.get_queue_groups(limit=2, offset=0, preview_size=0))
    second = asyncio.run(triage.get_queue_groups(limit=2, offset=2, preview_size=0))
    beyond = asyncio.run(triage.get_queue_groups(limit=2, offset=9, preview_size=0))

    assert first['total_groups'] == 4
    assert [group['group_key']['title'] for group in first['groups']] == ['title 0', 'title 1']
    assert [group['group_key']['title'] for group in second['groups']] == ['title 2', 'title 3']
    assert beyond['groups'] == [] and beyond['total_groups'] == 4

    clamped = asyncio.run(triage.get_queue_groups(limit=10_000, offset=-5, preview_size=99))
    assert clamped['limit'] == MAX_GROUP_PAGE_SIZE
    assert clamped['preview_size'] == MAX_PREVIEW_ITEMS
    assert clamped['offset'] == 0
    assert len(clamped['groups']) <= MAX_GROUP_PAGE_SIZE

    many = _FixtureTriage(
        IngressQueueService(),
        {('movie', '/inbox', 'matrix', QUEUE_PENDING): MAX_PREVIEW_ROWS + 100},
        [_row(f'copy-{index}', f'copy-{index}.mkv', best_match=_matrix()) for index in range(50)],
    )
    asyncio.run(many.get_queue_groups(limit=MAX_GROUP_PAGE_SIZE, preview_size=MAX_PREVIEW_ITEMS))

    from sqlalchemy.dialects import postgresql

    preview_statement = next(s for s in many.statements if 'GROUP BY' not in str(s))
    assert 'LIMIT' in str(preview_statement), str(preview_statement)
    params = list(preview_statement.compile(dialect=postgresql.dialect()).params.values())
    assert MAX_PREVIEW_ROWS in params, params  # preview fetch is capped, whatever the caller asks for


def test_qa_api_rejects_page_sizes_beyond_the_server_side_cap():
    """AC3: the HTTP layer refuses out-of-range paging instead of silently serving it."""
    saved = _app_state_snapshot()
    _wire_app(IngressQueueService(db_session_factory=None))

    async def run():
        from main import app as fastapi_app

        async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url='http://test') as client:
            cases = {
                'limit_high': {'limit': MAX_GROUP_PAGE_SIZE + 1},
                'preview_high': {'previewSize': MAX_PREVIEW_ITEMS + 1},
                'limit_zero': {'limit': 0},
                'offset_negative': {'offset': -1},
                'at_the_cap': {'limit': MAX_GROUP_PAGE_SIZE, 'previewSize': MAX_PREVIEW_ITEMS},
            }
            return {label: (await client.get('/api/ingress/queue/groups', params=params)).status_code
                    for label, params in cases.items()}

    try:
        codes = asyncio.run(run())
    finally:
        _restore_app(saved)

    assert [codes[k] for k in ('limit_high', 'preview_high', 'limit_zero', 'offset_negative')] == [422] * 4
    assert codes['at_the_cap'] == 200


def test_qa_q_compiles_to_file_name_and_parsed_title_ilike_predicates():
    """AC3: `q` filters on file_name and the parsed title (parsed_info->>'title'), per folder too."""
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    filters = triage._filters(None, None, 'matrix')
    assert len(filters) == 1

    def compiled(group_by):
        return triage._group_statement(filters, group_by).compile(dialect=postgresql.dialect())

    title_query = compiled(QUEUE_GROUP_BY_TITLE)
    sql = str(title_query)
    where = sql.split('WHERE', 1)[1]

    assert 'ingress_queue.file_name ILIKE' in where, sql
    assert 'ingress_queue.best_match ->> ' in where, sql
    assert 'ingress_queue.parsed_info ->> ' in where, sql
    assert where.upper().count('ILIKE') == 4, where  # file_name, file_path, parsed title, proposed path
    assert any('%matrix%' == str(value) for value in title_query.params.values()), title_query.params

    folder_sql = str(compiled(QUEUE_GROUP_BY_FOLDER))
    assert 'ingress_queue.file_name ILIKE' in folder_sql
    assert 'ingress_queue.parsed_info ->> ' in folder_sql


def test_qa_bulk_accepts_ids_and_group_selector_and_does_not_abort_on_the_first_failure():
    """AC4: explicit ids plus a group selector, per-item results, failure first does not stop the batch."""
    rows = [
        _row('backlog-1', 'The.Matrix.2000.mkv', best_match=_matrix()),
        _row('backlog-2', 'The.Matrix.2000.720p.mkv', best_match=_matrix()),
    ]
    session = _BacklogSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    result = asyncio.run(triage.bulk_action(
        action='ignore',
        item_ids=['ghost-item', 'backlog-1'],
        group={'media_type': 'movie', 'ingress_path': INGRESS_ROOT, 'title': 'the matrix'},
    ))

    assert result['action'] == 'ignore'
    assert (result['requested'], result['succeeded'], result['failed'], result['skipped']) == (3, 2, 1, 0)
    assert [(entry['item_id'], entry['status']) for entry in result['results']] == [
        ('ghost-item', 'failed'), ('backlog-1', 'succeeded'), ('backlog-2', 'succeeded'),
    ]
    assert result['results'][0]['error'] == 'Queue item not found'
    assert queue_service.get_item('backlog-1')['status'] == QUEUE_IGNORED
    assert queue_service.get_item('backlog-2')['status'] == QUEUE_IGNORED


def test_qa_bulk_ignore_writes_ignored_to_the_persisted_row_with_one_batch_history_row_each():
    """AC5 + AC6: the row flips to `ignored` with processed_at, and each item gets one bulk history row."""
    rows = [
        _row('backlog-1', 'The.Matrix.2000.mkv', best_match=_matrix()),
        _row('backlog-2', 'The.Matrix.2000.720p.mkv', best_match=_matrix()),
    ]
    session = _BacklogSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    result = asyncio.run(triage.bulk_action(action='ignore', item_ids=['backlog-1', 'backlog-1', 'backlog-2']))

    assert (result['requested'], result['succeeded']) == (2, 2)
    for item_id in ('backlog-1', 'backlog-2'):
        persisted = session.rows[item_id]
        assert persisted.status == QUEUE_IGNORED
        assert persisted.processed_at is not None
        assert queue_service.get_item(item_id)['status'] == QUEUE_IGNORED
        assert queue_service.get_item(item_id)['processed_at'] is not None

    history = [entry for entry in session.added if isinstance(entry, DBHistory)]
    assert len(history) == 2
    assert sorted(entry.queue_item_id for entry in history) == ['backlog-1', 'backlog-2']
    for entry in history:
        assert entry.snapshot['batch_id'] == result['batch_id']
        assert entry.snapshot['action'] == 'ignore'
        assert entry.snapshot['source'] == 'bulk'
    assert session.commits >= 2


def test_qa_bulk_classify_reuses_the_single_item_update_classification_validation():
    """AC5: bulk classify goes through the same override validation as /queue/update-classification."""
    rows = [_row('backlog-1', 'the.matrix.2000.mkv', parsed_info={'title': 'The Matrix'})]
    session = _BacklogSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    rejected = asyncio.run(triage.bulk_action(action='classify', item_ids=['backlog-1'], classification='bonus'))
    assert rejected.get('error') == 'Unsupported classification override: bonus'
    assert session.rows['backlog-1'].parsed_info.get('classification_override') is None

    accepted = asyncio.run(triage.bulk_action(action='classify', item_ids=['backlog-1'], classification='main_feature'))
    assert (accepted['requested'], accepted['succeeded']) == (1, 1)
    assert 'main_feature' in VALID_CLASSIFICATION_OVERRIDES
    assert queue_service.get_item('backlog-1')['classification_override'] == 'main_feature'
    assert session.rows['backlog-1'].parsed_info['classification_override'] == 'main_feature'

    history = [entry for entry in session.added if isinstance(entry, DBHistory)]
    assert len(history) == 1
    assert history[0].snapshot['event'] == 'classification_updated'
    assert history[0].snapshot['action'] == 'classify' and history[0].snapshot['source'] == 'bulk'

    saved = _app_state_snapshot()
    _wire_app(queue_service, triage)

    async def run():
        from main import app as fastapi_app

        async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url='http://test') as client:
            bulk = await client.post('/api/ingress/queue/bulk', json={
                'action': 'classify', 'itemIds': ['backlog-1'], 'classification': 'bonus',
            })
            single = await client.post('/api/ingress/queue/update-classification', json={
                'itemId': 'backlog-1', 'classification': 'bonus',
            })
            return bulk, single

    try:
        bulk_response, single_response = asyncio.run(run())
    finally:
        _restore_app(saved)

    assert bulk_response.status_code == 400
    assert bulk_response.json()['detail']['code'] == 'INVALID_BULK_REQUEST'
    assert single_response.status_code == 400
    assert single_response.json()['detail']['code'] == 'INVALID_CLASSIFICATION_OVERRIDE'
    assert bulk_response.json()['detail']['message'] == single_response.json()['detail']['message']


def test_qa_ignored_rows_stay_out_of_the_pending_processor_and_failed_item_auto_retry():
    """AC7: auto-processor and retry candidate selection never pick ignored (or completed) rows."""
    rows = [
        _row('ignored-1', 'unwatchable.mkv', status=QUEUE_IGNORED),
        _row('completed-1', 'already-done.mkv', status=QUEUE_COMPLETED),
        _row('failed-1', 'broken.mkv', status=QUEUE_FAILED, attempts=1, last_attempt=time.time() - 3600),
        _row('pending-1', 'fresh.mkv', status=QUEUE_PENDING),
    ]
    session = _BacklogSession(rows)
    queue_service = IngressQueueService(db_session_factory=session)
    triage = IngressTriageService(queue_service, db_session_factory=session)

    ids = asyncio.run(triage.resolve_group_item_ids(
        {'media_type': 'unclassified', 'ingress_path': INGRESS_ROOT, 'title': None},
    ))
    assert sorted(ids) == ['completed-1', 'failed-1', 'ignored-1', 'pending-1']

    assert queue_service._get_next_pending_item().id == 'pending-1'
    assert 'ignored-1' not in queue_service.get_retry_candidate_ids(now=time.time())
    assert queue_service.get_retry_candidate_ids(now=time.time() + 7200) == ['failed-1']

    retried = asyncio.run(triage.bulk_action(action='retry', item_ids=['ignored-1', 'completed-1']))
    assert (retried['succeeded'], retried['skipped']) == (0, 2)
    assert session.rows['ignored-1'].status == QUEUE_IGNORED
    assert session.rows['completed-1'].status == QUEUE_COMPLETED
    assert queue_service._get_next_pending_item().id == 'pending-1'


def test_qa_source_folder_grouping_keys_on_the_rip_folder_under_the_ingress_root():
    """AC2 (reopened by QA): `source_folder` is the rip folder relative to `ingress_path`.

    The issue defines `source_folder` as the path *relative to* the item's `ingress_path`, i.e. the disc
    folder the rip landed in. Grouping by the persisted `ingress_path` column instead — which
    `_infer_ingress_root` fills with the watched root — merged every rip under one root into a single
    group. The probe pins the corrected grouping: the folder is derived from `file_path`, while
    `ingress_path` still scopes the group so identically named rips under different roots stay apart.
    """
    from sqlalchemy.dialects import postgresql

    triage = IngressTriageService(IngressQueueService(), db_session_factory=None)
    folder_sql = str(triage._group_statement([], QUEUE_GROUP_BY_FOLDER).compile(dialect=postgresql.dialect()))
    group_by_clause = folder_sql.split('GROUP BY', 1)[1]

    assert 'ingress_path' in group_by_clause, folder_sql
    assert 'ingress_queue.file_path' in group_by_clause, group_by_clause  # the rip folder comes from file_path

    # two discs dropped under the same watched root: parsed_title and source_folder both keep them apart
    rows = [
        _row('disc-a', 'The.Matrix.1999.DISC1/movie.mkv', best_match=_matrix()),
        _row('disc-b', 'Heat.2022.DISC1/movie.mkv', best_match={'media_type': 'movie', 'title': 'Heat'}),
    ]
    session = _BacklogSession(rows)
    fixture = IngressTriageService(IngressQueueService(db_session_factory=session), db_session_factory=session)

    titles = asyncio.run(fixture.get_queue_groups(limit=10, preview_size=0))
    folders = asyncio.run(fixture.get_queue_groups(group_by=QUEUE_GROUP_BY_FOLDER, limit=10, preview_size=5))

    assert titles['total_groups'] == 2
    assert [group['group_key']['title'] for group in titles['groups']] == ['heat', 'the matrix']
    assert folders['total_groups'] == 2
    assert [
        (group['group_key']['source_folder'], group['item_count']) for group in folders['groups']
    ] == [('Heat.2022.DISC1', 1), ('The.Matrix.1999.DISC1', 1)]
    assert all(group['group_key']['title'] is None for group in folders['groups'])
    assert [item['id'] for item in folders['groups'][0]['preview_items']] == ['disc-b']
    assert [item['id'] for item in folders['groups'][1]['preview_items']] == ['disc-a']

    # the same rip folder name under two watched roots stays two groups
    twin_session = _BacklogSession([
        _row('root-a', 'The.Matrix.1999.DISC1/movie.mkv', ingress_path=INGRESS_ROOT, best_match=_matrix()),
        _row('root-b', 'The.Matrix.1999.DISC1/movie.mkv', ingress_path='/mnt/usb', best_match=_matrix()),
    ])
    twins = IngressTriageService(IngressQueueService(db_session_factory=twin_session), db_session_factory=twin_session)

    twin_folders = asyncio.run(twins.get_queue_groups(group_by=QUEUE_GROUP_BY_FOLDER, limit=10, preview_size=5))
    assert [
        (group['group_key']['ingress_path'], group['group_key']['source_folder'])
        for group in twin_folders['groups']
    ] == [(INGRESS_ROOT, 'The.Matrix.1999.DISC1'), ('/mnt/usb', 'The.Matrix.1999.DISC1')]


def test_qa_rows_without_a_parsed_title_bucket_as_unparsed():
    """AC2: a row the parser never filled in is one `(unparsed)` group, not one group per file name."""
    rows = [
        _row('no-title-1', 'broken.mkv', parsed_info={}, best_match={}),
        _row('no-title-2', 'also-broken.mkv', parsed_info={}, best_match={}),
        _row('titled-1', 'The.Matrix.2000.mkv', parsed_info={'title': 'The Matrix'}),
    ]
    session = _BacklogSession(rows)
    fixture = IngressTriageService(IngressQueueService(db_session_factory=session), db_session_factory=session)

    titles = asyncio.run(fixture.get_queue_groups(limit=10, preview_size=5))

    assert titles['total_groups'] == 2
    unparsed = next(group for group in titles['groups'] if group['group_key']['title'] == UNPARSED_TITLE_BUCKET)
    assert unparsed['group_key'] == {'media_type': 'unclassified', 'ingress_path': INGRESS_ROOT,
                                     'title': UNPARSED_TITLE_BUCKET}
    assert unparsed['item_count'] == 2
    assert sorted(item['id'] for item in unparsed['preview_items']) == ['no-title-1', 'no-title-2']
    assert [group['group_key']['title'] for group in titles['groups'] if group['item_count'] == 1] == ['the matrix']
