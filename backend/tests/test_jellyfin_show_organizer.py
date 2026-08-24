import os

from services.jellyfin_show_organizer import JellyfinShowOrganizer


def test_preview_detects_multi_episode_file_and_specials(tmp_path):
    show_dir = tmp_path / "Series Name A (2024) [imdbid-tt1234567]"
    season_01 = show_dir / "Season 01"
    season_00 = show_dir / "Season 00"
    season_01.mkdir(parents=True)
    season_00.mkdir(parents=True)

    multi = season_01 / "Series Name A S01E01-E02.mkv"
    special = season_00 / "Series Name A S00E01.mkv"
    multi.write_bytes(b"a" * 100)
    special.write_bytes(b"b" * 50)

    organizer = JellyfinShowOrganizer(dry_run=True)
    preview = organizer.preview_show_folder(str(show_dir))

    assert preview["success"] is True
    by_name = {m["sourceName"]: m for m in preview["moves"]}

    multi_move = by_name[multi.name]
    assert multi_move["category"] == "episode"
    assert multi_move["seasonNumber"] == 1
    assert multi_move["episodeStart"] == 1
    assert multi_move["episodeEnd"] == 2
    assert "S01E01-E02" in multi_move["targetFileName"]

    special_move = by_name[special.name]
    assert special_move["category"] == "special"
    assert special_move["seasonNumber"] == 0
    assert "/Season 00/" in special_move["targetPath"].replace("\\", "/")


def test_preview_detects_multipart_episode_naming(tmp_path):
    show_dir = tmp_path / "Series Name B (2025)"
    season_01 = show_dir / "Season 01"
    season_01.mkdir(parents=True)

    part1 = season_01 / "Series Name B S01E03-part-1.mkv"
    part2 = season_01 / "Series Name B S01E03-part-2.mkv"
    part1.write_bytes(b"a" * 100)
    part2.write_bytes(b"b" * 100)

    organizer = JellyfinShowOrganizer(dry_run=True)
    preview = organizer.preview_show_folder(str(show_dir))

    assert preview["success"] is True
    by_name = {m["sourceName"]: m for m in preview["moves"]}

    p1 = by_name[part1.name]
    p2 = by_name[part2.name]
    assert p1["partNumber"] == 1
    assert p2["partNumber"] == 2
    assert "Part 1" in p1["targetFileName"]
    assert "Part 2" in p2["targetFileName"]


def test_apply_honors_multi_episode_override(tmp_path):
    show_dir = tmp_path / "Series Name C (2026)"
    season_01 = show_dir / "Season 01"
    season_01.mkdir(parents=True)

    single = season_01 / "Series Name C S01E01.mkv"
    single.write_bytes(b"x" * 100)

    organizer = JellyfinShowOrganizer(dry_run=False)
    result = organizer.apply_show_folder(
        str(show_dir),
        overrides=[{
            "sourcePath": str(single),
            "category": "episode",
            "seasonNumber": 1,
            "episodeStart": 1,
            "episodeEnd": 2,
            "partNumber": 1,
        }],
    )

    assert result["success"] is True
    files = os.listdir(season_01)
    assert any("S01E01-E02" in name and "Part 1" in name for name in files)
