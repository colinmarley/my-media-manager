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
