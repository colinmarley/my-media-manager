import asyncio
import os

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

    assert items[0]['proposed_path'] == "shows/What I Like About You (2002)/Season 02/What I Like About You (2002) S02E20.mkv"


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