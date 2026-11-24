"""Filing a show's files writes an episode .nfo for each episode, never for an extra.

An episodedetails file next to an extra gives it an episode number (1 when none
is known) and a title made from its ingest name; Jellyfin then lists the extra
as a second "S06E01 Everybody Loves Raymond 8-clip".
"""

import os

from services.file_organization_service import FileOrganizationService, _is_extra_path


def test_extras_are_told_apart_from_episodes():
    season = "/lib/TV Shows/Show (1996)/Season 06"
    assert _is_extra_path(f"{season}/Show (1996)-other.mkv")
    assert _is_extra_path(f"{season}/Show (1996) 19-deletedscene.mkv")
    assert _is_extra_path(f"{season}/Show (1996)-blooper.mkv")
    assert _is_extra_path(f"{season}/featurettes/Making Of.mkv")
    assert not _is_extra_path(f"{season}/Show (1996) [imdbid-tt1] S06E22 Mother's Day.mkv")
    # An episode whose name happens to end like a suffix keeps its .nfo.
    assert not _is_extra_path(f"{season}/Show (1996) S06E03-trailer.mkv")


async def test_no_episode_nfo_is_written_for_an_extra(tmp_path):
    season = tmp_path / "Show (1996)" / "Season 06"
    season.mkdir(parents=True)
    episode = season / "Show (1996) S06E21 Call Me Mom.mkv"
    extra = season / "Show (1996)-featurette.mkv"
    for path in (episode, extra):
        path.write_bytes(b"x")

    service = FileOrganizationService()
    created = await service._create_jellyfin_nfo_files(
        "episode",
        os.fspath(season),
        [{"success": True, "destination": os.fspath(episode)},
         {"success": True, "destination": os.fspath(extra)}],
        {"seasonNumber": 6, "episodeNumber": 21, "parsedInfo": {"episode_title": "Call Me Mom"}},
        {"seriesTitle": "Show", "year": 1996},
    )

    assert (season / "Show (1996) S06E21 Call Me Mom.nfo").is_file()
    assert not (season / "Show (1996)-featurette.nfo").exists()
    assert os.fspath(season / "Show (1996)-featurette.nfo") not in created
