from services.filename_parser import FilenameParser


def test_parse_filename_uses_parent_movie_title_for_extras_disc_files():
    parser = FilenameParser()

    parsed = parser.parse_filename(
        'A12_t06.mkv',
        folder_name='Alfred Hitchcock-A Legacy of Suspense D4 (2011)',
    )

    assert parsed.title == 'Alfred Hitchcock-A Legacy of Suspense'
    assert parsed.year == 2011
    assert parsed.media_type == 'movie'
    assert parsed.classification_hint == 'special_feature'
    assert parsed.is_companion is True
