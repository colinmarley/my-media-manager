import os

from services.jellyfin_movie_organizer import JellyfinMovieOrganizer


def test_moves_suffix_extras_into_supported_folders(tmp_path):
    movie_dir = tmp_path / "Movie One (2020) [imdbid-tt1111111]"
    movie_dir.mkdir(parents=True)

    main = movie_dir / "Movie One (2020) [imdbid-tt1111111].mkv"
    trailer = movie_dir / "Preview Trailer.trailer.mp4"
    featurette = movie_dir / "Making Of-featurette.mp4"

    main.write_bytes(b"0" * 100)
    trailer.write_bytes(b"1" * 10)
    featurette.write_bytes(b"2" * 10)

    organizer = JellyfinMovieOrganizer(dry_run=False)
    result = organizer.reorganize_movie_folder(str(movie_dir))

    assert result["success"] is True
    assert main.exists()
    assert (movie_dir / "trailers" / trailer.name).exists()
    assert (movie_dir / "featurettes" / featurette.name).exists()


def test_promotes_largest_unknown_video_as_main_when_missing(tmp_path):
    movie_dir = tmp_path / "Movie Two (2021)"
    movie_dir.mkdir(parents=True)

    unknown_big = movie_dir / "some.random.release.mkv"
    unknown_small = movie_dir / "bonus_clip.mkv"

    unknown_big.write_bytes(b"a" * 100)
    unknown_small.write_bytes(b"b" * 10)

    organizer = JellyfinMovieOrganizer(dry_run=False)
    organizer.reorganize_movie_folder(str(movie_dir))

    assert (movie_dir / "Movie Two (2021).mkv").exists()
    assert (movie_dir / "clips" / "bonus_clip.mkv").exists()


def test_classifies_large_unmatched_video_as_version(tmp_path):
    movie_dir = tmp_path / "Movie Three (2022)"
    movie_dir.mkdir(parents=True)

    main = movie_dir / "Movie Three (2022).mkv"
    alt = movie_dir / "Movie Three directors cut.mp4"

    main.write_bytes(b"a" * 100)
    alt.write_bytes(b"b" * 90)

    organizer = JellyfinMovieOrganizer(dry_run=False)
    organizer.reorganize_movie_folder(str(movie_dir))

    version_files = [name for name in os.listdir(movie_dir) if name.startswith("Movie Three (2022) -")]
    assert version_files
    assert (movie_dir / main.name).exists()


def test_preview_includes_editable_move_plan(tmp_path):
    movie_dir = tmp_path / "Movie Four (2023)"
    movie_dir.mkdir(parents=True)

    main = movie_dir / "Movie Four (2023).mkv"
    trailer = movie_dir / "Trailer Cut.trailer.mp4"
    main.write_bytes(b"a" * 100)
    trailer.write_bytes(b"b" * 10)

    organizer = JellyfinMovieOrganizer(dry_run=True)
    preview = organizer.preview_movie_folder(str(movie_dir))

    assert preview["success"] is True
    assert preview["moves"]
    trailer_move = [m for m in preview["moves"] if m["sourceName"] == trailer.name][0]
    assert trailer_move["category"] == "trailers"
    assert trailer_move["targetSubfolder"] == "trailers"


def test_apply_honors_override_category_and_file_name(tmp_path):
    movie_dir = tmp_path / "Movie Five (2024)"
    movie_dir.mkdir(parents=True)

    main = movie_dir / "Movie Five (2024).mkv"
    clip = movie_dir / "bonus_clip.mp4"
    main.write_bytes(b"a" * 100)
    clip.write_bytes(b"b" * 10)

    organizer = JellyfinMovieOrganizer(dry_run=False)
    result = organizer.apply_movie_folder(
        str(movie_dir),
        overrides=[{
            "sourcePath": str(clip),
            "category": "featurettes",
            "targetFileName": "Behind the Film.mp4",
        }],
    )

    assert result["success"] is True
    assert (movie_dir / "featurettes" / "Behind the Film.mp4").exists()
