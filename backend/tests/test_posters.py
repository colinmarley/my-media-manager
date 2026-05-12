from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import posters


@pytest.mark.asyncio
async def test_resolve_poster_url_falls_back_to_omdb_lookup_when_missing(monkeypatch):
    row = SimpleNamespace(
        id='movie-9',
        raw_data={
            'title': '9',
            'releaseDate': '2009-01-01',
            'externalIds': {'imdbId': 'tt0472033'},
        },
    )

    fake_result = SimpleNamespace(scalar_one_or_none=lambda: row)
    fake_db = SimpleNamespace(execute=AsyncMock(return_value=fake_result))

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                'Response': 'True',
                'Poster': 'https://example.com/poster.jpg',
                'imdbID': 'tt0472033',
            }

    monkeypatch.setattr(posters.requests, 'get', lambda *args, **kwargs: FakeResponse())

    url = await posters._resolve_poster_url('movie', 'movie-9', fake_db)

    assert url == 'https://example.com/poster.jpg'


@pytest.mark.asyncio
async def test_apply_manual_poster_source_updates_raw_data_and_image_files():
    row = SimpleNamespace(
        raw_data={
            'title': 'Example Movie',
            'imageFiles': [{'fileName': 'https://old.example/poster.jpg', 'format': 'jpg'}],
            'omdbData': {'Poster': 'https://old.example/poster.jpg'},
        },
        image_files=[{'fileName': 'https://old.example/poster.jpg', 'format': 'jpg'}],
        omdb_data={'Poster': 'https://old.example/poster.jpg'},
    )

    posters._apply_manual_poster_source(row, 'https://new.example/poster.png')

    assert row.raw_data['imageFiles'][0]['fileName'] == 'https://new.example/poster.png'
    assert row.raw_data['omdbData']['Poster'] == 'https://new.example/poster.png'
    assert row.image_files[0]['fileName'] == 'https://new.example/poster.png'
