"""
Parser regression tests built from the real filenames found in
/ark/media/jellyfin/ingest on 2026-11-08 (see
docs/architecture/INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md §4.2).
"""

import pytest

from services.filename_parser import FilenameParser

ROOT = "/ark/media/jellyfin/ingest"


def _parse(filename, folder, subpath=""):
    parser = FilenameParser()
    path = f"{ROOT}/{folder}/{subpath}{filename}" if folder else f"{ROOT}/{filename}"
    return parser.parse_filename(filename, folder_name=folder.split("/")[0] if folder else None, file_path=path)


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
    assert parsed.makemkv_track == 6
    assert parsed.disc_number == 4


@pytest.mark.parametrize(
    "filename,folder,subpath,expected",
    [
        # Sonarr/TRaSH style: year must come out of the title and into `year`
        (
            "The Fresh Prince of Bel-Air (1990) - S04E18 - Stop Will! In the Name of Love (480p DVD x265 Panda).mkv",
            "The Fresh Prince of Bel-Air", "Season 4/",
            dict(media_type="episode", title="The Fresh Prince of Bel-Air", year=1990, season=4, episode=18,
                 episode_title="Stop Will! In the Name of Love"),
        ),
        (
            "Unsolved Mysteries - S06E16 - Episode #180.mkv", "Unsolved Mysteries (1987)", "Season 6/",
            dict(media_type="episode", title="Unsolved Mysteries", year=1987, season=6, episode=16),
        ),
        (
            "The.Big.Bang.Theory.S03E09.720p.HDTV.ReEnc-Max.mkv", "The Big Bang Theory (2007)", "Season 03/",
            dict(media_type="episode", title="The Big Bang Theory", year=2007, season=3, episode=9, episode_title=None),
        ),
        # Track-numbered disc rips under a season folder are episodes, not extras
        (
            "15 Aunt Mommy.avi", "Modern Family", "Season 3/",
            dict(media_type="episode", title="Modern Family", season=3, episode=15, episode_title="Aunt Mommy",
                 is_companion=False),
        ),
        (
            "23_Founder's_Day.m4v", "Little House on the Prairie (1974) [imdbid-tt0071007]", "Season 01/",
            dict(media_type="episode", title="Little House on the Prairie", year=1974, season=1, episode=23,
                 imdb_id="tt0071007"),
        ),
        # Bare SxxExx and S00Exx get the show from the path
        (
            "s03e28.avi", "Cheers", "Season 3/",
            dict(media_type="episode", title="Cheers", season=3, episode=28),
        ),
        (
            "S00E09 - The Rise Of Tommy Shelby (1080p YouTube WEB-DL x265 Ghost).mkv",
            "Peaky Blinders (2013) [imdbid-tt2442560]", "Season 00/",
            dict(media_type="episode", title="Peaky Blinders", year=2013, season=0, episode=9,
                 imdb_id="tt2442560", classification_hint="special_feature"),
        ),
        # Volume numbering
        (
            "Looney Tunes Collector's Choice (1945) - V01E10 - Foo.mkv", "Looney Tunes Collectors Choice Volume 1", "",
            dict(media_type="episode", title="Looney Tunes Collector's Choice", year=1945, season=1, episode=10),
        ),
        # Disc-ripper deliveries with an IMDb tag on the folder
        (
            "Premium Rush_t00.mkv", "Premium Rush (2012) [imdbid-tt1547234]", "",
            dict(media_type="movie", title="Premium Rush", year=2012, imdb_id="tt1547234", makemkv_track=0,
                 is_companion=False),
        ),
        (
            "Premium Rush.m4v", "Premium Rush (2012) [imdbid-tt1547234]", "",
            dict(media_type="movie", title="Premium Rush", year=2012, imdb_id="tt1547234"),
        ),
        (
            "Big.Hero.6.2014.1080p.3D.BluRay.Half-SBS.x264.mkv",
            "Big Hero 6 (2014) [imdbid-tt2245084] [3D Half-SBS]", "",
            dict(media_type="movie", title="Big Hero 6", year=2014, imdb_id="tt2245084"),
        ),
        # MakeMKV default name and user-named discs fall back to the folder chain
        (
            "title_t00.mkv", "Mythbusters/Mega Movie Myths", "",
            dict(media_type="unknown", title="Mega Movie Myths", makemkv_track=0, is_companion=False),
        ),
        (
            "Disc 1.mkv", "Drake & Josh/Best of Seasons 1 & 2", "",
            dict(media_type="unknown", title="Drake and Josh"),
        ),
        (
            "A5_t02.mkv", "Alfred Hitchcock-A Legacy of Suspense D2 (2011)", "extras/",
            dict(media_type="movie", title="Alfred Hitchcock-A Legacy of Suspense", year=2011, is_companion=True,
                 disc_number=2, makemkv_track=2),
        ),
        # Scene-style movie names
        (
            "The.Worlds.End.2013.1080p.BluRay.x265.mp4", "The Worlds End (2013)", "",
            dict(media_type="movie", title="The Worlds End", year=2013),
        ),
        (
            "50-50.DvdRip.H264.720p.m4v", "50-50 (2011)", "",
            dict(media_type="movie", title="50-50", year=2011, is_companion=False),
        ),
        (
            "Anne_Frank.mkv", "Anne_Frank", "",
            dict(media_type="unknown", title="Anne Frank", year=None),
        ),
        (
            "Top Gun D2 (1986).mkv", "Top Gun D2 (1986)", "",
            dict(media_type="movie", title="Top Gun", year=1986, disc_number=2),
        ),
        (
            "Men in Black 3 (2012).mkv", "Men in Black³ (2012)", "",
            dict(media_type="movie", title="Men in Black 3", year=2012),
        ),
        (
            "2012.mkv", "2012 (2009)", "",
            dict(media_type="movie", title="2012", year=2009),
        ),
    ],
)
def test_parse_real_ingest_filenames(filename, folder, subpath, expected):
    parsed = _parse(filename, folder, subpath)
    for key, value in expected.items():
        assert getattr(parsed, key) == value, f"{filename}: {key}={getattr(parsed, key)!r}, expected {value!r}"


def test_parse_notes_explain_folder_derived_facts():
    parsed = _parse("Premium Rush.m4v", "Premium Rush (2012) [imdbid-tt1547234]")
    joined = " | ".join(parsed.parse_notes)
    assert "imdb id tt1547234" in joined
    assert "year 2012 from folder" in joined
    assert parsed.title_source == "filename"


def test_edition_hints_collected_from_folder_and_filename():
    parsed = _parse(
        "Big.Hero.6.2014.1080p.3D.BluRay.Half-SBS.x264.mkv",
        "Big Hero 6 (2014) [imdbid-tt2245084] [3D Half-SBS]",
    )
    lowered = {h.lower() for h in parsed.edition_hints}
    assert "3d" in lowered
    assert "half-sbs" in lowered


def test_multi_episode_and_three_digit_episode_numbers():
    parsed = _parse("Show S10E25E26.mkv", "Show")
    assert (parsed.season, parsed.episode, parsed.episode_end) == (10, 25, 26)

    parsed = _parse("One Piece S01E1042.mkv", "One Piece")
    assert parsed.episode == 1042


def test_generic_root_folders_are_never_titles():
    parser = FilenameParser()
    parsed = parser.parse_filename("B1_t00.mkv", file_path=f"{ROOT}/B1_t00.mkv")
    assert parsed.title == ""
    assert parsed.is_companion is True
