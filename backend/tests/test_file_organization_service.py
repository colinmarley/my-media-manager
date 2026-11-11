import asyncio
import os
from unittest.mock import MagicMock

from services.file_organization_service import FileOrganizationService


def test_unresolvable_media_type_leaves_the_file_in_place(tmp_path):
    source_file = tmp_path / 'ingest' / 'Mystery Disc' / 'A12_t06.mkv'
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b'x')
    library_root = tmp_path / 'jellyfin'
    filesystem_manager = MagicMock()
    service = FileOrganizationService(
        filesystem_manager=filesystem_manager,
        jellyfin_dest_base=library_root.as_posix(),
    )

    result = asyncio.run(
        service.organize_assignment(
            {
                'id': 'assignment-1',
                'mediaType': 'home_video',
                'sourceFile': {'fileName': 'A12_t06.mkv', 'filePath': os.fspath(source_file)},
            },
            {'title': 'Mystery'},
        )
    )

    assert result['success'] is False
    assert result['needsReview'] is True
    assert result['targetPath'] is None
    assert result['operations'] == []
    assert result['filesMoved'] == 0
    assert 'left in place' in result['error']
    # Nothing is renamed, moved or created: no _NeedsReview holding folder.
    assert source_file.exists()
    assert not library_root.exists()
    assert filesystem_manager.mock_calls == []


def test_library_root_is_resolved_at_call_time_unless_pinned(monkeypatch):
    from config.settings import settings
    from services import storage_paths

    monkeypatch.setattr(settings, 'jellyfin_dest_base', '/env/library')
    storage_paths.clear_overrides()
    service = FileOrganizationService()
    assert service.jellyfin_dest_base == '/env/library'

    storage_paths.set_overrides({'jellyfinDestBase': '/saved/library'})
    try:
        assert service.jellyfin_dest_base == '/saved/library'
        assert FileOrganizationService(jellyfin_dest_base='/pinned/').jellyfin_dest_base == '/pinned'
        service.jellyfin_dest_base = None
        assert service.jellyfin_dest_base == '/saved/library'
    finally:
        storage_paths.clear_overrides()


def test_catalog_upsert_returns_the_catalog_row_id(tmp_path):
    from db.models import Movie, Series
    from tests.fake_db import FakeSession

    existing = Movie(id='movie-1', title='Inception', imdb_id='tt1375666', jellyfin_info={}, raw_data={})
    session = FakeSession([existing])
    service = FileOrganizationService(filesystem_manager=MagicMock(), db_session_factory=session)
    folder = os.fspath(tmp_path / 'Movies' / 'Inception (2010)')

    found = asyncio.run(service._upsert_catalog_jellyfin_info(
        media_type='movie', media_id='tt1375666', folder_path=folder,
        organized_at='2026-11-11T00:00:00', media={'title': 'Inception', 'imdbId': 'tt1375666'},
    ))
    created = asyncio.run(service._upsert_catalog_jellyfin_info(
        media_type='episode', media_id=None, folder_path=os.fspath(tmp_path / 'TV Shows' / 'Show' / 'Season 01'),
        organized_at='2026-11-11T00:00:00', media={'seriesTitle': 'Show', 'imdbId': 'tt0000009'},
    ))

    assert found == 'movie-1'
    (series,) = session.all_of(Series)
    assert created == series.id == 'tt0000009'


def test_catalog_upsert_returns_none_when_the_write_fails(tmp_path):
    class Broken:
        def __call__(self):
            raise RuntimeError('database went away')

    service = FileOrganizationService(filesystem_manager=MagicMock(), db_session_factory=Broken())
    assert asyncio.run(service._upsert_catalog_jellyfin_info(
        media_type='movie', media_id='m', folder_path=os.fspath(tmp_path), organized_at='x', media={},
    )) is None
