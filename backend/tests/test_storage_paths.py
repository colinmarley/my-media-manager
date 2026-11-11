import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from config.settings import settings
from services import storage_paths


@pytest.fixture(autouse=True)
def _reset_overrides(monkeypatch):
    monkeypatch.setattr(settings, "jellyfin_dest_base", "/ark/media/jellyfin")
    monkeypatch.setattr(settings, "ingress_default_paths", ["/ark/media/ingest"])
    monkeypatch.setattr(settings, "home_videos_path", "/ark/media/home-videos")
    storage_paths.clear_overrides()
    yield
    storage_paths.clear_overrides()


def test_roots_come_from_settings_by_default():
    assert storage_paths.library_root() == "/ark/media/jellyfin"
    assert storage_paths.ingest_roots() == ["/ark/media/ingest"]
    assert storage_paths.primary_ingest_root() == "/ark/media/ingest"
    assert storage_paths.home_videos_root() == "/ark/media/home-videos"


def test_settings_are_read_at_call_time(monkeypatch):
    monkeypatch.setattr(settings, "jellyfin_dest_base", "/mnt/library/")
    assert storage_paths.library_root() == "/mnt/library"


def test_overrides_win_over_settings():
    storage_paths.set_overrides({
        "jellyfinDestBase": "/new/library/",
        "defaultIngressPaths": ["/new/ingest/", "", "/other/ingest"],
    })
    assert storage_paths.library_root() == "/new/library"
    assert storage_paths.ingest_roots() == ["/new/ingest", "/other/ingest"]
    storage_paths.clear_overrides()
    assert storage_paths.library_root() == "/ark/media/jellyfin"


def test_empty_override_falls_back_to_settings():
    storage_paths.set_overrides({"jellyfinDestBase": "", "defaultIngressPaths": []})
    assert storage_paths.library_root() == "/ark/media/jellyfin"
    assert storage_paths.ingest_roots() == ["/ark/media/ingest"]


def test_category_root_uses_folder_settings(monkeypatch):
    assert storage_paths.category_root("movie") == "/ark/media/jellyfin/Movies"
    assert storage_paths.category_root("series") == "/ark/media/jellyfin/TV Shows"
    assert storage_paths.category_root("episode") == "/ark/media/jellyfin/TV Shows"
    assert storage_paths.category_root("documentary") == "/ark/media/jellyfin/Documentaries"
    assert storage_paths.category_root("live_performance") == "/ark/media/jellyfin/Live Performances"
    assert storage_paths.category_root("home_video") is None
    monkeypatch.setattr(settings, "folder_movies", "Films")
    assert storage_paths.category_root("movie") == "/ark/media/jellyfin/Films"


def test_category_folders_are_the_four_categories():
    assert storage_paths.category_folders() == ["Movies", "TV Shows", "Documentaries", "Live Performances"]


@pytest.mark.parametrize(
    "path, expected",
    [
        ("/ark/media/jellyfin/Movies/A (2000)/A (2000).mkv", "Movies/A (2000)/A (2000).mkv"),
        ("/ark/media/jellyfin", ""),
        ("/ark/media/jellyfin/", ""),
        ("/ark/media/jellyfin/./Movies/../TV Shows/X", "TV Shows/X"),
        ("/ark/media/jellyfin-old/Movies/A.mkv", None),
        ("/ark/media/ingest/A.mkv", None),
        ("/ark/media/jellyfin/../ingest/A.mkv", None),
        ("", None),
        (None, None),
    ],
)
def test_to_library_relative_posix(path, expected):
    assert storage_paths.to_library_relative(path) == expected


def test_relative_helpers_handle_windows_paths():
    root = "C:\\Users\\x\\lib"
    assert storage_paths.to_library_relative("C:\\Users\\x\\lib\\Movies\\A.mkv", root) == "Movies/A.mkv"
    assert storage_paths.to_library_relative("c:/users/x/LIB/Movies/A.mkv", root) == "Movies/A.mkv"
    assert storage_paths.to_library_relative("C:\\Users\\x\\library\\A.mkv", root) is None
    assert storage_paths.is_in_library("C:\\Users\\x\\lib\\Movies", root)


def test_from_library_relative_round_trips():
    rel = "Movies/A (2000) [imdbid-tt1]/A (2000) [imdbid-tt1].mkv"
    absolute = storage_paths.from_library_relative(rel)
    assert absolute == f"/ark/media/jellyfin/{rel}"
    assert storage_paths.to_library_relative(absolute) == rel
    assert storage_paths.from_library_relative("/already/absolute.mkv") == "/already/absolute.mkv"
    assert storage_paths.from_library_relative("Movies/A.mkv", "/root/") == "/root/Movies/A.mkv"


def test_ingest_is_a_sibling_not_inside_the_library():
    storage_paths.set_overrides({"defaultIngressPaths": ["/ark/media/ingest"]})
    assert storage_paths.is_in_ingest("/ark/media/ingest/Disc/A.mkv")
    assert not storage_paths.is_in_library("/ark/media/ingest/Disc/A.mkv")
    assert not storage_paths.is_in_ingest("/ark/media/jellyfin/Movies/A.mkv")
    assert storage_paths.is_in_ingest("/x/y.mkv", roots=["/x"])


def test_clean_root_keeps_filesystem_roots():
    assert storage_paths.clean_root("/") == "/"
    assert storage_paths.clean_root("C:\\") == "C:\\"
    assert storage_paths.clean_root("/a/b//") == "/a/b"
    assert storage_paths.clean_root(None) == ""


def _db_with(row):
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


def test_persisted_config_load_and_save():
    row = MagicMock()
    row.value = json.dumps({"jellyfinDestBase": "/lib"})
    assert asyncio.run(storage_paths.load_persisted_config(_db_with(row))) == {"jellyfinDestBase": "/lib"}
    assert asyncio.run(storage_paths.load_persisted_config(_db_with(None))) == {}

    bad = MagicMock()
    bad.value = "not json"
    assert asyncio.run(storage_paths.load_persisted_config(_db_with(bad))) == {}

    db = _db_with(None)
    asyncio.run(storage_paths.save_persisted_config(db, {"a": 1}))
    added = db.add.call_args.args[0]
    assert added.key == storage_paths.CONFIG_KEY
    assert json.loads(added.value) == {"a": 1}
    db.commit.assert_awaited_once()

    db = _db_with(row)
    asyncio.run(storage_paths.save_persisted_config(db, {"b": 2}))
    assert json.loads(row.value) == {"b": 2}
    db.add.assert_not_called()
