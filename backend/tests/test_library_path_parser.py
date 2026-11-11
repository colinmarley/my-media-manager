"""parse_library_relative: what a library file is, from its relative path."""

import pytest

from services.library_path_parser import (
    episode_numbers,
    imdb_id_from_name,
    parse_library_relative,
    season_from_folder,
    title_key,
)

TAGGED = "Inception (2010) [imdbid-tt1375666]"
SHOW = "Some Show (2002) [imdbid-tt0123456]"

CASES = [
    # (relative path, expected subset)
    (f"Movies/{TAGGED}/{TAGGED}.mkv",
     dict(media_type="movie", title_folder=TAGGED, imdb_id="tt1375666", year=2010, role="main")),
    ("Movies/Inception (2010)/Inception (2010).mkv",
     dict(media_type="movie", imdb_id=None, year=2010, role="main")),
    # File named without the tag in a tagged folder is still the main feature.
    (f"Movies/{TAGGED}/Inception (2010).mp4", dict(role="main")),
    (f"Movies/{TAGGED}/{TAGGED} - Version 2.mkv", dict(role="version")),
    (f"Movies/{TAGGED}/Inception (2010) - 1080p.mkv", dict(role="version")),
    (f"Movies/{TAGGED}/Special Feature 1.mkv", dict(role="extra", extra_category=None)),
    (f"Movies/{TAGGED}/Featurettes/Making Of.mkv", dict(role="extra", extra_category="featurette")),
    (f"Movies/{TAGGED}/behind the scenes/x.mkv", dict(role="extra", extra_category="behind_the_scenes")),
    (f"Movies/{TAGGED}/extras/x.mkv", dict(role="extra", extra_category="extras")),
    (f"Movies/{TAGGED}/Inception-trailer.mkv", dict(role="extra", extra_category="trailer")),
    (f"Movies/{TAGGED}/random rip name.mkv", dict(role="other")),
    (f"Movies/{TAGGED}/Disc 2/title_t01.mkv", dict(role="other")),
    ("Documentaries/Planet (2006)/Planet (2006).mkv", dict(media_type="documentary", role="main")),
    ("Live Performances/Band Live (1999)/Band Live (1999).mkv",
     dict(media_type="live_performance", role="main")),
    # TV
    (f"TV Shows/{SHOW}/Season 01/{SHOW} S01E02 Pilot.mkv",
     dict(media_type="series", imdb_id="tt0123456", year=2002, role="episode",
          season_number=1, episode_number=2, episode_end_number=None)),
    (f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01E02.mkv",
     dict(role="episode", season_number=1, episode_number=1, episode_end_number=2)),
    (f"TV Shows/{SHOW}/Season 01/Some.Show.S01E03-E04.mkv",
     dict(role="episode", episode_number=3, episode_end_number=4)),
    (f"TV Shows/{SHOW}/Season 01/Some.Show.S01E05-06.mkv",
     dict(role="episode", episode_number=5, episode_end_number=6)),
    (f"TV Shows/{SHOW}/Season 01/Some Show S01E07 - 1080p.mkv",
     dict(role="episode", episode_number=7, episode_end_number=None)),
    (f"TV Shows/{SHOW}/Specials/{SHOW} S00E01.mkv", dict(role="episode", season_number=0, episode_number=1)),
    (f"TV Shows/{SHOW}/Season 00/Some unknown episode.mkv",
     dict(role="other", season_number=0, episode_number=None)),
    (f"TV Shows/{SHOW}/Season 01/{SHOW} E012.mkv", dict(role="episode", season_number=1, episode_number=12)),
    ("TV Shows/Home Tapes/Season 01/Home Tapes - S01E01 - Birthday.mkv",
     dict(role="episode", season_number=1, episode_number=1, imdb_id=None, year=None)),
    (f"TV Shows/{SHOW}/Season 02/extras/Gag reel.mkv", dict(role="extra", season_number=2)),
    (f"TV Shows/{SHOW}/featurettes/Making Of.mkv",
     dict(role="extra", season_number=None, extra_category="featurette")),
    (f"TV Shows/{SHOW}/{SHOW} S03E04.mkv", dict(role="episode", season_number=3, episode_number=4)),
    # Outside the categories / loose files
    ("Movies/loose.mkv", dict(media_type="movie", title_folder=None, role="other")),
    ("_NeedsReview/x/x.mkv", dict(media_type=None, role="other")),
    ("", dict(media_type=None)),
    # Backslashes are tolerated
    ("Movies\\Inception (2010)\\Inception (2010).mkv", dict(media_type="movie", role="main")),
]


@pytest.mark.parametrize("rel, expected", CASES)
def test_parse_library_relative(rel, expected):
    parsed = parse_library_relative(rel)
    for key, value in expected.items():
        assert parsed[key] == value, (rel, key, parsed)


def test_result_always_has_every_key():
    keys = {"media_type", "title_folder", "imdb_id", "year", "role", "season_number",
            "episode_number", "episode_end_number", "extra_category"}
    assert set(parse_library_relative("Movies/A (2000)/A (2000).mkv")) == keys
    assert set(parse_library_relative(None)) == keys


@pytest.mark.parametrize("name, expected", [
    ("Title (2010) [imdbid-tt1375666]", "tt1375666"),
    ("Title (2010) {imdb-tt1375666}", "tt1375666"),
    ("Title (2010) [tt1375666]", "tt1375666"),
    ("Title (2010)", None),
])
def test_imdb_id_from_name(name, expected):
    assert imdb_id_from_name(name) == expected


@pytest.mark.parametrize("name, expected", [
    ("Season 01", 1), ("Season 1", 1), ("season 12", 12), ("Specials", 0), ("Season 00", 0),
    ("S02", 2), ("Extras", None),
])
def test_season_from_folder(name, expected):
    assert season_from_folder(name) == expected


@pytest.mark.parametrize("stem, expected", [
    ("Show S01E02", (1, 2, None)),
    ("Show s1e2", (1, 2, None)),
    ("Show S01E02E03", (1, 2, 3)),
    ("Show S01E02-E03", (1, 2, 3)),
    ("Show S01E02-03", (1, 2, 3)),
    ("Show S01E05 - 720p", (1, 5, None)),
    ("Show 1x05", (1, 5, None)),
    ("Show - S02E01 - Title", (2, 1, None)),
    ("No numbers here", (None, None, None)),
])
def test_episode_numbers(stem, expected):
    assert episode_numbers(stem) == expected


@pytest.mark.parametrize("path, expected", [
    ("/ark/media/jellyfin/Movies/Inception (2010)", "movies/inception (2010)"),
    ("/old/root/Movies/Inception (2010)/", "movies/inception (2010)"),
    ("/ark/media/jellyfin/TV Shows/Show (2002)", "tv shows/show (2002)"),
    ("/ark/media/jellyfin/TV Shows/Show (2002)/Season 01", "tv shows/show (2002)"),
    ("C:\\lib\\Documentaries\\Planet (2006)", "documentaries/planet (2006)"),
    ("/somewhere/else", None),
    (None, None),
])
def test_title_key(path, expected):
    assert title_key(path) == expected
