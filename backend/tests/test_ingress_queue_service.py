import asyncio
import os
import shutil

from services.ingress_queue_service import IngressQueueItem, IngressQueueService, QUEUE_COMPLETED, QUEUE_PENDING


class _CapturingAssignmentOrchestrator:
    def __init__(self):
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({
            'queue_item': dict(queue_item),
            'force_organize': force_organize,
        })
        proposed_path = queue_item.get('proposed_path') or ''
        return {
            'assignment_id': 'assignment-1',
            'organized': True,
            'organization_result': {
                'success': True,
                'targetPath': os.path.dirname(proposed_path) if proposed_path else None,
                'operations': [
                    {
                        'destination': proposed_path,
                    }
                ],
            },
        }


class _RequiresForceOrganizeAssignmentOrchestrator(_CapturingAssignmentOrchestrator):
    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({
            'queue_item': dict(queue_item),
            'force_organize': force_organize,
        })
        proposed_path = queue_item.get('proposed_path') or ''
        if not force_organize:
            return {
                'assignment_id': 'assignment-1',
                'organized': False,
                'organization_result': None,
            }
        return {
            'assignment_id': 'assignment-1',
            'organized': True,
            'organization_result': {
                'success': True,
                'targetPath': os.path.dirname(proposed_path) if proposed_path else None,
                'operations': [
                    {
                        'destination': proposed_path,
                    }
                ],
            },
        }


def test_add_manual_file_requeues_existing_completed_item(tmp_path):
    media_file = tmp_path / 'movie.mkv'
    media_file.write_bytes(b'test-data')

    service = IngressQueueService()

    item = service.add_manual_file(os.fspath(media_file))
    item.status = QUEUE_COMPLETED
    item.last_error = 'old error'

    requeued = service.add_manual_file(os.fspath(media_file))

    assert requeued.id == item.id
    assert requeued.status == QUEUE_PENDING
    assert requeued.last_error is None


def test_add_manual_file_skips_non_video_files(tmp_path):
    subtitle_file = tmp_path / 'movie.srt'
    subtitle_file.write_text('1\n00:00:00,000 --> 00:00:01,000\nHello\n', encoding='utf-8')

    service = IngressQueueService()

    item = service.add_manual_file(os.fspath(subtitle_file))

    assert item is None
    assert service.get_queue_items() == []


def test_add_manual_file_uses_provided_ingress_root(tmp_path):
    ingress_root = tmp_path / 'ingest'
    media_dir = ingress_root / 'Movie'
    media_dir.mkdir(parents=True)
    media_file = media_dir / 'movie.mkv'
    media_file.write_bytes(b'test-data')

    service = IngressQueueService()

    item = service.add_manual_file(os.fspath(media_file), ingress_path=os.fspath(ingress_root))

    assert item is not None
    assert item.ingress_path == os.fspath(ingress_root)


def test_finalize_source_folder_moves_non_video_leftovers_to_target(tmp_path):
    ingress_root = tmp_path / 'ingest'
    source_root = ingress_root / 'Ant-man'
    soundtrack_dir = source_root / 'soundtrack'
    soundtrack_dir.mkdir(parents=True)
    (source_root / 'subtitle.srt').write_text('subtitle', encoding='utf-8')
    (soundtrack_dir / 'track1.flac').write_bytes(b'flac-data')

    target_root = tmp_path / 'movies' / 'Ant-man (2015) [imdbid-tt0478970]'
    target_root.mkdir(parents=True)

    service = IngressQueueService()
    item = IngressQueueItem(
        id='item-1',
        file_path=os.fspath(source_root / 'Ant-man.mkv'),
        file_name='Ant-man.mkv',
        ingress_path=os.fspath(ingress_root),
        file_size=123,
        detected_at=0.0,
        queued_at=0.0,
        status=QUEUE_COMPLETED,
        priority=5,
        proposed_path=os.fspath(target_root / 'Ant-man (2015) [imdbid-tt0478970].mkv'),
    )
    service.items_by_id[item.id] = item
    service.item_order.append(item.id)

    asyncio.run(service._finalize_source_folder(item))

    assert (target_root / 'subtitle.srt').exists()
    assert (target_root / 'soundtrack' / 'track1.flac').exists()
    assert not source_root.exists()


def test_finalize_source_folder_does_not_move_when_sibling_items_need_review(tmp_path):
    ingress_root = tmp_path / 'ingest'
    source_root = ingress_root / 'Burlesque (2010)'
    extras_dir = source_root / 'extras'
    extras_dir.mkdir(parents=True)

    main_file = source_root / 'Burlesque (2010).mkv'
    extra_file = extras_dir / 'Burlesque-B4_t06.mkv'
    main_file.write_bytes(b'main')
    extra_file.write_bytes(b'extra')

    target_root = tmp_path / 'movies' / 'Burlesque (2010)'
    target_root.mkdir(parents=True)

    service = IngressQueueService()
    main_item = IngressQueueItem(
        id='main-item',
        file_path=os.fspath(main_file),
        file_name='Burlesque (2010).mkv',
        ingress_path=os.fspath(ingress_root),
        file_size=123,
        detected_at=0.0,
        queued_at=0.0,
        status=QUEUE_COMPLETED,
        priority=5,
        proposed_path=os.fspath(target_root / 'Burlesque (2010).mkv'),
    )
    extra_item = IngressQueueItem(
        id='extra-item',
        file_path=os.fspath(extra_file),
        file_name='Burlesque-B4_t06.mkv',
        ingress_path=os.fspath(ingress_root),
        file_size=45,
        detected_at=0.0,
        queued_at=0.0,
        status='needs_review',
        priority=5,
    )
    service.items_by_id[main_item.id] = main_item
    service.items_by_id[extra_item.id] = extra_item
    service.item_order.extend([main_item.id, extra_item.id])

    asyncio.run(service._finalize_source_folder(main_item))

    assert source_root.exists()
    assert extra_file.exists()


def test_process_next_item_marks_duplicate_movie_as_alternate_version(tmp_path, monkeypatch):
    jellyfin_root = tmp_path / 'jellyfin'
    movie_folder = jellyfin_root / 'Movies' / 'Duplicated Title (2024)'
    movie_folder.mkdir(parents=True)
    (movie_folder / 'Duplicated Title (2024).mkv').write_bytes(b'existing-main-feature')

    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(jellyfin_root))

    ingress_root = tmp_path / 'ingest'
    source_file = ingress_root / 'Duplicated Title 2024 copy.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'new-version')

    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator, auto_assign_threshold=80)
    item = service.add_manual_file(os.fspath(source_file))
    item.best_match = {
        'title': 'Duplicated Title',
        'year': 2024,
        'media_type': 'movie',
        'confidence_score': 95,
        'media_id': 'movie-1',
    }
    item.match_candidates = [item.best_match]
    item.confidence_score = 95

    asyncio.run(service.mark_complete(item.id))

    captured = orchestrator.calls[-1]['queue_item']
    assert captured['is_alternate_version'] is True
    assert captured['version_number'] == 2
    assert captured['proposed_path'].endswith('Duplicated Title (2024) - Version 2.mkv')


def test_manual_assign_item_marks_duplicate_movie_as_alternate_version(tmp_path, monkeypatch):
    jellyfin_root = tmp_path / 'jellyfin'
    movie_folder = jellyfin_root / 'Movies' / 'Manual Duplicate (2023)'
    movie_folder.mkdir(parents=True)
    (movie_folder / 'Manual Duplicate (2023).mkv').write_bytes(b'existing-main-feature')

    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(jellyfin_root))

    ingress_root = tmp_path / 'ingest'
    source_file = ingress_root / 'manual-duplicate.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'second-copy')

    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))

    asyncio.run(
        service.manual_assign_item(
            item.id,
            {
                'source': 'manual',
                'title': 'Manual Duplicate',
                'year': 2023,
                'media_type': 'movie',
                'media_id': 'movie-2',
            },
            organize_now=True,
        )
    )

    captured = orchestrator.calls[-1]['queue_item']
    assert captured['is_alternate_version'] is True
    assert captured['version_number'] == 2
    assert captured['proposed_path'].endswith('Manual Duplicate (2023) - Version 2.mkv')


def test_episode_proposed_path_uses_parsed_season_and_episode_when_match_lacks_them():
    service = IngressQueueService()
    items = [
        {
            'id': 'ep-1',
            'file_name': "What I Like About You S02E20 Rollin' in It.mkv",
            'best_match': {
                'title': 'What I Like About You',
                'year': 2002,
                'media_type': 'series',
            },
            'parsed_info': {
                'title': 'What I Like About You',
                'media_type': 'episode',
                'season': 2,
                'episode': 20,
            },
            'media_duration_ms': None,
        }
    ]

    service._enrich_proposed_paths(items)

    from config.settings import settings as _settings
    assert items[0]['proposed_path'] == (
        f"{_settings.folder_tv_shows}/What I Like About You (2002)/Season 02/What I Like About You (2002) S02E20.mkv"
    )


def test_unknown_episode_keeps_original_filename_when_numbers_cannot_be_determined():
    service = IngressQueueService()
    original_name = 'What I Like About You mystery encode.mkv'
    items = [
        {
            'id': 'ep-unknown',
            'file_name': original_name,
            'best_match': {
                'title': 'What I Like About You',
                'year': 2002,
                'media_type': 'series',
            },
            'parsed_info': {
                'title': 'What I Like About You',
                'media_type': 'episode',
            },
            'media_duration_ms': None,
        }
    ]

    service._enrich_proposed_paths(items)

    assert items[0]['proposed_path'].endswith(f'/Season 00/{original_name}')


def test_generic_extras_file_inherits_parent_movie_match():
    service = IngressQueueService()
    items = [
        {
            'id': 'main',
            'file_path': '/ingest/Harry Potter and the Deathly Hallows- Part 1 (2010)/movie.mkv',
            'ingress_path': '/ingest',
            'file_name': 'movie.mkv',
            'best_match': {
                'title': 'Harry Potter and the Deathly Hallows- Part 1',
                'year': 2010,
                'media_type': 'movie',
            },
            'parsed_info': {
                'title': 'Harry Potter and the Deathly Hallows- Part 1',
                'media_type': 'movie',
                'year': 2010,
            },
            'media_duration_ms': 7_000_000,
        },
        {
            'id': 'extra',
            'file_path': '/ingest/Harry Potter and the Deathly Hallows- Part 1 (2010)/extras/C1_t01.mkv',
            'ingress_path': '/ingest',
            'file_name': 'C1_t01.mkv',
            'best_match': {
                'title': 'Extras',
                'year': 1998,
                'media_type': 'movie',
            },
            'parsed_info': {
                'title': 'Extras',
                'media_type': 'unknown',
            },
            'media_duration_ms': 600_000,
        },
    ]

    service._enrich_proposed_paths(items)

    assert items[1]['best_match']['title'] == 'Harry Potter and the Deathly Hallows- Part 1'
    assert items[1]['best_match']['year'] == 2010
    assert 'Harry Potter and the Deathly Hallows- Part 1 (2010)' in items[1]['proposed_path']
    assert 'Special Feature' in items[1]['proposed_path']


def test_update_classification_override_forces_special_feature_path(tmp_path):
    source_file = tmp_path / 'ingest' / 'featurette.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'featurette-data')

    service = IngressQueueService()
    item = service.add_manual_file(os.fspath(source_file))
    item.best_match = {
        'title': 'Override Movie',
        'year': 2024,
        'media_type': 'movie',
        'confidence_score': 95,
        'media_id': 'movie-override',
    }
    item.match_candidates = [item.best_match]
    item.confidence_score = 95

    updated = asyncio.run(service.update_classification(item.id, 'special_feature'))

    assert updated is not None
    assert updated.proposed_path.endswith('Movies/Override Movie (2024)/Special Feature 1.mkv')
    assert updated.special_feature_number == 1


def test_mark_complete_uses_special_feature_override(tmp_path, monkeypatch):
    jellyfin_root = tmp_path / 'jellyfin'
    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(jellyfin_root))

    source_file = tmp_path / 'ingest' / 'bonus.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'bonus-data')

    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))
    item.best_match = {
        'title': 'Override Accept',
        'year': 2023,
        'media_type': 'movie',
        'confidence_score': 94,
        'media_id': 'movie-accept-override',
    }
    item.match_candidates = [item.best_match]
    item.confidence_score = 94

    asyncio.run(service.update_classification(item.id, 'special_feature'))
    asyncio.run(service.mark_complete(item.id))

    captured = orchestrator.calls[-1]['queue_item']
    assert captured['classification_override'] == 'special_feature'
    assert captured['proposed_path'].endswith('Movies/Override Accept (2023)/Special Feature 1.mkv')


def test_manual_assign_item_organize_now_forces_organization(tmp_path):
    source_file = tmp_path / 'ingest' / 'force-organize.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'force-organize')

    orchestrator = _RequiresForceOrganizeAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))

    result = asyncio.run(
        service.manual_assign_item(
            item.id,
            {
                'source': 'manual',
                'title': 'Force Organize',
                'year': 2026,
                'media_type': 'movie',
                'media_id': 'force-organize-id',
            },
            organize_now=True,
        )
    )

    assert result is not None
    assert orchestrator.calls[-1]['force_organize'] is True
    assert result.status == QUEUE_COMPLETED


def test_manual_assign_item_allows_unknown_episode_mapping(tmp_path):
    source_file = tmp_path / 'ingest' / 'Mystery Episode encode.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'unknown-episode')

    orchestrator = _RequiresForceOrganizeAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))

    result = asyncio.run(
        service.manual_assign_item(
            item.id,
            {
                'source': 'manual',
                'title': 'Mystery Show',
                'year': 2024,
                'media_type': 'episode',
                'media_id': 'series-mystery',
            },
            organize_now=True,
        )
    )

    assert result is not None
    assert result.status == QUEUE_COMPLETED
    assert orchestrator.calls[-1]['force_organize'] is True
    assert 'Season 00' in (result.proposed_path or '')


def test_mark_complete_history_records_proposed_and_match_snapshot(tmp_path, monkeypatch):
    jellyfin_root = tmp_path / 'jellyfin'
    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(jellyfin_root))

    source_file = tmp_path / 'ingest' / 'history-movie.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'history-data')

    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))
    item.best_match = {
        'title': 'History Movie',
        'year': 2024,
        'media_type': 'movie',
        'confidence_score': 98,
        'media_id': 'movie-history',
    }
    item.match_candidates = [item.best_match]
    item.confidence_score = 98

    asyncio.run(service.mark_complete(item.id))

    history = service.get_processing_history(limit=1)
    assert len(history) == 1
    assert history[0]['event'] == 'accepted_assignment'
    assert history[0]['best_match']['title'] == 'History Movie'
    assert history[0]['proposed_path'].endswith('History Movie (2024).mkv')


def test_manual_assignment_history_records_training_fields(tmp_path, monkeypatch):
    jellyfin_root = tmp_path / 'jellyfin'
    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(jellyfin_root))

    source_file = tmp_path / 'ingest' / 'manual-history.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'manual-history')

    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    item = service.add_manual_file(os.fspath(source_file))

    asyncio.run(
        service.manual_assign_item(
            item.id,
            {
                'source': 'manual',
                'title': 'Manual History',
                'year': 2025,
                'media_type': 'movie',
                'media_id': 'movie-manual-history',
            },
            organize_now=True,
        )
    )

    history = service.get_processing_history(limit=1)
    assert len(history) == 1
    assert history[0]['manual_assignment'] is True
    assert history[0]['event'] == 'manual_assignment'
    assert history[0]['best_match']['title'] == 'Manual History'
    assert history[0]['proposed_path'].endswith('Manual History (2025).mkv')

# ---------------------------------------------------------------------------
# Honest confidence, ambiguity, durable dismiss, DB restore (2026-11 quick wins)
# ---------------------------------------------------------------------------


class _StubMatcher:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def search_and_match(self, parsed_info):
        self.calls.append(dict(parsed_info))
        return self.result


def _make_source_file(tmp_path, name='Some Movie (2010).mkv'):
    source_file = tmp_path / 'ingest' / 'Some Movie (2010)' / name
    source_file.parent.mkdir(parents=True, exist_ok=True)
    source_file.write_bytes(b'x')
    return source_file


def test_no_match_leaves_confidence_empty_and_records_parse_quality(tmp_path):
    matcher = _StubMatcher({'status': 'success', 'found': False, 'candidates': [], 'best_match': None})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)
    item = service.add_manual_file(os.fspath(_make_source_file(tmp_path)))

    processed = asyncio.run(service.process_next_item())

    assert processed.id == item.id
    assert processed.status == 'needs_review'
    assert processed.confidence_score is None, 'parse quality must not masquerade as match confidence'
    assert processed.parsed_info['parse_quality'] >= 80
    assert processed.parsed_info['review_reason'].startswith('no metadata match')


def test_ambiguous_match_is_held_for_review_even_above_threshold(tmp_path):
    best = {
        'source': 'omdb', 'title': 'The Office', 'year': 2005, 'media_type': 'series',
        'confidence_score': 85, 'imdb_id': 'tt0386676',
        'score_breakdown': [{'rule': 'ambiguous', 'points': 0, 'note': "ambiguous: 'The Office' (2001) scored 85"}],
    }
    matcher = _StubMatcher({'status': 'success', 'found': True, 'candidates': [best], 'best_match': best,
                            'ambiguous': True, 'margin': 0})
    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(auto_matcher_service=matcher, assignment_orchestrator=orchestrator,
                                  auto_assign_threshold=80)
    service.add_manual_file(os.fspath(_make_source_file(tmp_path, 'The Office S01E01.mkv')))

    processed = asyncio.run(service.process_next_item())

    assert processed.status == 'needs_review'
    assert processed.confidence_score == 85
    assert processed.parsed_info['ambiguous_match'] is True
    assert processed.parsed_info['review_reason'].startswith('ambiguous match')
    assert orchestrator.calls == []


def test_confident_unambiguous_match_auto_assigns(tmp_path):
    best = {
        'source': 'omdb', 'title': 'Some Movie', 'year': 2010, 'media_type': 'movie',
        'confidence_score': 80, 'imdb_id': 'tt0000001', 'score_breakdown': [],
    }
    matcher = _StubMatcher({'status': 'success', 'found': True, 'candidates': [best], 'best_match': best,
                            'ambiguous': False, 'margin': 25})
    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(auto_matcher_service=matcher, assignment_orchestrator=orchestrator,
                                  auto_assign_threshold=80)
    service.add_manual_file(os.fspath(_make_source_file(tmp_path)))

    processed = asyncio.run(service.process_next_item())

    assert processed.status == QUEUE_COMPLETED
    assert 'review_reason' not in processed.parsed_info
    assert len(orchestrator.calls) == 1
    # proposal carries the imdb tag exactly as the organizer will name the folder
    assert '[imdbid-tt0000001]' in orchestrator.calls[0]['queue_item']['proposed_path']


def test_mark_failed_is_not_eligible_for_auto_retry(tmp_path):
    service = IngressQueueService()
    item = service.add_manual_file(os.fspath(_make_source_file(tmp_path)))

    asyncio.run(service.mark_failed(item.id, 'Manually dismissed'))

    assert item.status == 'failed'
    assert item.attempts >= IngressQueueService.MANUAL_FAILURE_ATTEMPTS
    assert item.last_attempt is not None


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _query):
        return _FakeScalarResult(self.rows)


class _Row:
    def __init__(self, **kw):
        defaults = dict(
            id='row', file_path='', file_name='', ingress_path=None, file_size=1, detected_at=None,
            queued_at=None, status='needs_review', priority=5, attempts=1, last_attempt=None,
            processed_at=None, last_error=None, confidence_score=None, assignment_id=None,
            parsed_info={}, best_match={}, match_candidates=[], media_duration_ms=None,
            proposed_path=None, created_at=None,
        )
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


def test_restore_from_db_dedupes_by_path_and_skips_missing_files(tmp_path):
    from datetime import datetime, timezone

    present = _make_source_file(tmp_path)
    missing = tmp_path / 'ingest' / 'Gone (2001)' / 'Gone (2001).mkv'
    newer = datetime(2026, 11, 8, tzinfo=timezone.utc)
    older = datetime(2026, 4, 18, tzinfo=timezone.utc)
    rows = [
        _Row(id='new', file_path=os.fspath(present), file_name=present.name, queued_at=newer,
             status='processing', parsed_info={'classification_override': 'special_feature'}),
        _Row(id='old', file_path=os.fspath(present), file_name=present.name, queued_at=older),
        _Row(id='gone', file_path=os.fspath(missing), file_name=missing.name, queued_at=older),
    ]

    service = IngressQueueService(db_session_factory=lambda: _FakeSession(rows))
    restored = asyncio.run(service.restore_from_db())

    assert restored == 1
    item = service.items_by_id['new']
    assert service.path_to_item_id[os.fspath(present)] == 'new'
    assert item.status == QUEUE_PENDING, 'interrupted processing rows go back to pending'
    assert item.classification_override == 'special_feature'
    assert item.queued_at == newer.timestamp()
    assert 'old' not in service.items_by_id and 'gone' not in service.items_by_id


# ---------------------------------------------------------------------------
# Stored proposals; unresolved files stay in place (2026-11)
# ---------------------------------------------------------------------------


class _MovingAssignmentOrchestrator:
    """Organizes like the real one: moves the file into the library and reports
    the absolute destination."""

    def __init__(self, library_root):
        self.library_root = os.fspath(library_root)
        self.calls = []

    async def auto_assign(self, queue_item, force_organize=False):
        self.calls.append({'queue_item': dict(queue_item), 'force_organize': force_organize})
        destination = os.path.join(self.library_root, *queue_item['proposed_path'].split('/'))
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.move(queue_item['file_path'], destination)
        return {
            'assignment_id': f'assignment-{len(self.calls)}',
            'organized': True,
            'organization_result': {
                'success': True,
                'targetPath': os.path.dirname(destination),
                'operations': [{'destination': destination}],
            },
        }


_SOME_MOVIE = {'title': 'Some Movie', 'year': 2010, 'media_type': 'movie', 'confidence_score': 60}


def _use_library(tmp_path, monkeypatch):
    library_root = tmp_path / 'jellyfin'
    monkeypatch.setattr('services.ingress_queue_service.settings.jellyfin_dest_base', os.fspath(library_root))
    return library_root


def _add_reviewed(service, tmp_path, folder, name, duration_ms, match=_SOME_MOVIE):
    """Queue a file under <tmp>/ingest/<folder> as if it had been processed."""
    source_file = tmp_path / 'ingest' / folder / name
    source_file.parent.mkdir(parents=True, exist_ok=True)
    source_file.write_bytes(b'x')
    item = service.add_manual_file(os.fspath(source_file), ingress_path=os.fspath(tmp_path / 'ingest'))
    item.best_match = dict(match) if match else None
    # A processed item always carries the parsed title; an item without one
    # counts as a companion file and is never the anchor of its folder.
    item.parsed_info = {'title': match['title'] if match else os.path.splitext(name)[0]}
    item.media_duration_ms = duration_ms
    item.status = 'needs_review'
    return item


def test_unmatched_item_has_no_proposal_and_stays_in_place(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    matcher = _StubMatcher({'status': 'success', 'found': False, 'candidates': [], 'best_match': None})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)
    source_file = _make_source_file(tmp_path)
    service.add_manual_file(os.fspath(source_file), ingress_path=os.fspath(tmp_path / 'ingest'))

    processed = asyncio.run(service.process_next_item())

    assert processed.status == 'needs_review'
    assert processed.proposed_path is None
    assert service.get_queue_items()[0]['proposed_path'] is None
    assert source_file.exists(), 'an unresolved file is never moved'
    assert not library_root.exists(), 'no _NeedsReview holding folder is created'


def test_refresh_drops_a_needs_review_path_stored_by_an_older_version(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    service = IngressQueueService()
    item = _add_reviewed(service, tmp_path, 'Mystery Disc', 'A12_t06.mkv', None, match=None)
    item.proposed_path = '_NeedsReview/A12_t06 - NEEDS REVIEW.mkv'

    assert asyncio.run(service.refresh_proposals()) == 1
    assert item.proposed_path is None


def test_reading_the_queue_does_not_touch_the_filesystem(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    service = IngressQueueService()
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    extra = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'C1_t01.mkv', 600_000, match=None)

    asyncio.run(service.refresh_proposals())

    def _no_filesystem(*args, **kwargs):
        raise AssertionError('queue reads must not resolve proposals or touch the filesystem')

    with monkeypatch.context() as scoped:
        scoped.setattr(service, '_enrich_proposed_paths', _no_filesystem)
        scoped.setattr(os, 'listdir', _no_filesystem)
        scoped.setattr(os.path, 'isdir', _no_filesystem)
        scoped.setattr(os.path, 'isfile', _no_filesystem)
        scoped.setattr(os.path, 'exists', _no_filesystem)
        views = {view['id']: view for view in service.get_queue_items()}
        extra_view = service.get_item(extra.id)

    assert views[main.id]['proposed_path'].endswith('Some Movie (2010)/Some Movie (2010).mkv')
    assert extra_view['proposed_path'].endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert extra_view['special_feature_number'] == 1
    # The companion file is shown with the match it inherits from its folder ...
    assert extra_view['best_match']['title'] == 'Some Movie'
    assert extra_view['best_match']['inferred_from_source_root'] is True
    # ... while its own (empty) match is left alone until it is accepted.
    assert extra.best_match is None


def test_processing_a_longer_copy_renumbers_the_stored_sibling_proposal(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    durations = {'copy-one.mkv': 600_000, 'copy-two.mkv': 7_000_000}
    monkeypatch.setattr(
        'services.ingress_queue_service._get_file_duration',
        lambda path: durations.get(os.path.basename(path)),
    )
    matcher = _StubMatcher({'status': 'success', 'found': True, 'candidates': [_SOME_MOVIE],
                            'best_match': _SOME_MOVIE, 'ambiguous': False, 'margin': 25})
    service = IngressQueueService(auto_matcher_service=matcher, auto_assign_threshold=80)

    def _queue(folder, name):
        source_file = tmp_path / 'ingest' / folder / name
        source_file.parent.mkdir(parents=True)
        source_file.write_bytes(b'x')
        return service.add_manual_file(os.fspath(source_file), ingress_path=os.fspath(tmp_path / 'ingest'))

    short = _queue('Rip A', 'copy-one.mkv')
    asyncio.run(service.process_next_item())
    assert short.status == 'needs_review'
    assert short.proposed_path.endswith('Some Movie (2010)/Some Movie (2010).mkv')

    long = _queue('Rip B', 'copy-two.mkv')
    asyncio.run(service.process_next_item())

    assert long.proposed_path.endswith('Some Movie (2010)/Some Movie (2010).mkv')
    assert short.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert short.special_feature_number == 1

    # Overriding the role of one item renumbers the item it is grouped with.
    asyncio.run(service.update_classification(long.id, 'special_feature'))

    assert long.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert short.proposed_path.endswith('Some Movie (2010)/Some Movie (2010).mkv')
    assert short.special_feature_number is None


def test_accepting_the_main_feature_turns_the_sibling_into_a_version(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    monkeypatch.setattr('services.ingress_queue_service._get_file_duration', lambda path: 7_000_000)
    service = IngressQueueService(assignment_orchestrator=_MovingAssignmentOrchestrator(library_root))
    main = _add_reviewed(service, tmp_path, 'Rip A', 'copy-one.mkv', 7_000_000)
    other = _add_reviewed(service, tmp_path, 'Rip B', 'copy-two.mkv', 6_900_000)

    asyncio.run(service.refresh_proposals())
    assert other.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')

    persisted = []

    async def _record_persist(item):
        persisted.append((item.id, item.proposed_path))

    monkeypatch.setattr(service, '_persist_queue_item', _record_persist)

    asyncio.run(service.mark_complete(main.id))

    organized = library_root / 'Movies' / 'Some Movie (2010)' / 'Some Movie (2010).mkv'
    assert organized.exists()
    assert main.status == QUEUE_COMPLETED
    assert main.proposed_path == os.fspath(organized)
    # The main feature now exists in the library, so the near-identical copy is
    # a version of it, and that is what gets stored on its row.
    assert other.proposed_path.endswith('Some Movie (2010)/Some Movie (2010) - Version 2.mkv')
    assert other.is_alternate_version is True
    assert other.version_number == 2
    assert other.special_feature_number is None
    assert (other.id, other.proposed_path) in persisted


def test_accept_resolves_the_role_again_within_its_group(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    long = _add_reviewed(service, tmp_path, '', 'copy-one.mkv', 7_000_000)
    short = _add_reviewed(service, tmp_path, '', 'copy-two.mkv', 600_000)
    asyncio.run(service.refresh_proposals())

    # The stored proposal of the sibling must not hide it from the grouping:
    # on its own the shorter file would be taken for the main feature.
    asyncio.run(service.mark_complete(short.id))

    captured = orchestrator.calls[-1]['queue_item']
    assert captured['proposed_path'].endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert captured['special_feature_number'] == 1
    assert long.proposed_path.endswith('Some Movie (2010)/Some Movie (2010).mkv')


def test_accepting_an_unmatched_companion_uses_the_match_of_its_folder(tmp_path, monkeypatch):
    _use_library(tmp_path, monkeypatch)
    orchestrator = _CapturingAssignmentOrchestrator()
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    extra = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'C1_t01.mkv', 600_000, match=None)

    asyncio.run(service.mark_complete(extra.id))

    captured = orchestrator.calls[-1]['queue_item']
    assert captured['best_match']['title'] == 'Some Movie'
    assert captured['best_match']['inferred_from_source_root'] is True
    assert captured['proposed_path'].endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert captured['special_feature_number'] == 1


def test_an_extra_keeps_its_inherited_proposal_after_the_main_feature_is_organized(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    service = IngressQueueService(assignment_orchestrator=_MovingAssignmentOrchestrator(library_root))
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    extra = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'Making Of.mkv', 600_000, match=None)
    extra.parsed_info = {'title': 'Some Movie', 'is_companion': True}
    asyncio.run(service.refresh_proposals())
    assert extra.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')

    asyncio.run(service.mark_complete(main.id))

    organized = library_root / 'Movies' / 'Some Movie (2010)' / 'Some Movie (2010).mkv'
    assert main.status == QUEUE_COMPLETED
    # The organized main feature is not rewritten ...
    assert main.proposed_path == os.fspath(organized)
    assert main.best_match == _SOME_MOVIE
    # ... and the extra left in its folder still has somewhere to go.
    assert extra.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert extra.special_feature_number == 1
    view = service.get_item(extra.id)
    assert view['best_match']['title'] == 'Some Movie'
    assert view['best_match']['inferred_from_source_root'] is True

    # A later whole-queue refresh keeps it too.
    asyncio.run(service.refresh_proposals())
    assert extra.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')
    assert main.proposed_path == os.fspath(organized)


def test_an_extra_queued_after_the_main_feature_was_organized_inherits_its_match(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    orchestrator = _MovingAssignmentOrchestrator(library_root)
    service = IngressQueueService(assignment_orchestrator=orchestrator)
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000, match=None)

    # Assigned by hand with nothing else in the folder yet: organized at once.
    asyncio.run(service.manual_assign_item(main.id, {'title': 'Some Movie', 'year': 2010, 'media_type': 'movie'}))
    assert main.status == QUEUE_COMPLETED

    extra = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'Making Of.mkv', 600_000, match=None)
    extra.parsed_info = {'title': 'Some Movie', 'is_companion': True}
    asyncio.run(service.refresh_proposals())
    assert extra.proposed_path.endswith('Some Movie (2010)/Special Feature 1.mkv')

    # Accepting it organizes it next to the main feature, with the inherited match.
    asyncio.run(service.mark_complete(extra.id))
    captured = orchestrator.calls[-1]['queue_item']
    assert captured['best_match']['title'] == 'Some Movie'
    assert captured['best_match']['inferred_from_source_root'] is True
    assert (library_root / 'Movies' / 'Some Movie (2010)' / 'Special Feature 1.mkv').exists()
    assert extra.status == QUEUE_COMPLETED


def test_an_organized_extra_is_never_the_anchor_and_is_not_renumbered(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    service = IngressQueueService(assignment_orchestrator=_MovingAssignmentOrchestrator(library_root))
    main = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    first = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'Making Of.mkv', 900_000, match=None)
    second = _add_reviewed(service, tmp_path, 'Some Movie (2010)/extras', 'Trailer.mkv', 120_000, match=None)
    for extra in (first, second):
        extra.parsed_info = {'title': 'Some Movie', 'is_companion': True}

    asyncio.run(service.mark_complete(main.id))
    asyncio.run(service.mark_complete(first.id))

    first_path = os.fspath(library_root / 'Movies' / 'Some Movie (2010)' / 'Special Feature 1.mkv')
    assert first.status == QUEUE_COMPLETED
    assert first.proposed_path == first_path
    # The second extra takes the next free number; the organized one keeps its path.
    assert second.proposed_path.endswith('Some Movie (2010)/Special Feature 2.mkv')
    asyncio.run(service.refresh_proposals())
    assert first.proposed_path == first_path
    assert second.proposed_path.endswith('Some Movie (2010)/Special Feature 2.mkv')


def test_accept_merges_leftover_files_into_the_library_not_the_working_directory(tmp_path, monkeypatch):
    library_root = _use_library(tmp_path, monkeypatch)
    working_dir = tmp_path / 'cwd'
    working_dir.mkdir()
    monkeypatch.chdir(working_dir)

    service = IngressQueueService(assignment_orchestrator=_MovingAssignmentOrchestrator(library_root))
    item = _add_reviewed(service, tmp_path, 'Some Movie (2010)', 'Some Movie (2010).mkv', 7_000_000)
    source_root = tmp_path / 'ingest' / 'Some Movie (2010)'
    (source_root / 'Some Movie (2010).srt').write_text('subtitle', encoding='utf-8')

    asyncio.run(service.mark_complete(item.id))

    movie_folder = library_root / 'Movies' / 'Some Movie (2010)'
    assert (movie_folder / 'Some Movie (2010).mkv').exists()
    assert (movie_folder / 'Some Movie (2010).srt').exists()
    assert not source_root.exists()
    assert list(working_dir.iterdir()) == []


def test_a_relative_proposal_is_never_a_target_for_leftover_files():
    assert IngressQueueService._resolve_target_media_root('Movies/X (2020)/X (2020).mkv') is None
    assert IngressQueueService._resolve_target_media_root(None) is None


def test_mark_complete_without_an_orchestrator_completes_the_item(tmp_path):
    service = IngressQueueService()
    item = service.add_manual_file(os.fspath(_make_source_file(tmp_path)))
    item.status = 'needs_review'
    item.last_error = 'old error'

    result = asyncio.run(service.mark_complete(item.id))

    assert result.status == QUEUE_COMPLETED
    assert result.last_error is None
