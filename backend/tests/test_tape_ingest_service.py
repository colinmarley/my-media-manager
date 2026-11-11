import os

from config.settings import settings
from services.tape_ingest_service import TapeIngestService


def test_home_videos_go_to_the_home_videos_root(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "home_videos_path", os.fspath(tmp_path / "home-videos"))
    service = TapeIngestService()

    folder, filename = service._resolve_destination(
        {
            "content_type": "home_video",
            "file_name": "tape1.mp4",
            "home_video_metadata": {"date": "1994-07-04", "title": "Lake Trip"},
        },
        "/ark/media/jellyfin",
    )

    assert os.path.dirname(folder) == os.fspath(tmp_path / "home-videos")
    assert "jellyfin" not in folder
    assert filename == f"{os.path.basename(folder)}.mp4"


def test_unclassified_items_have_no_destination():
    service = TapeIngestService()
    assert service._resolve_destination({"content_type": "unclassified", "file_name": "a.mp4"}, "/dest") is None
    # A typed item missing its metadata is unclassified too.
    assert service._resolve_destination({"content_type": "movie", "file_name": "a.mp4"}, "/dest") is None
    assert service._resolve_destination({"content_type": "skip", "file_name": "a.mp4"}, "/dest") == ("", "")


def test_processing_leaves_unclassified_files_in_place(tmp_path):
    source = tmp_path / "capture" / "a.mp4"
    source.parent.mkdir()
    source.write_bytes(b"x")
    dest = tmp_path / "library"
    service = TapeIngestService()
    service._jobs["t1"] = {
        "task_id": "t1", "overall_status": "running", "total": 1, "completed": 0,
        "failed": 0, "skipped": 0,
        "items": [{"file_path": os.fspath(source), "file_name": "a.mp4", "status": "pending",
                   "target_path": None, "error": None, "progress_pct": 0.0}],
    }

    service._process_items("t1", {
        "destination_base": os.fspath(dest),
        "items": [{"file_path": os.fspath(source), "file_name": "a.mp4", "content_type": "unclassified"}],
    })

    job = service._jobs["t1"]
    assert job["items"][0]["status"] == "skipped"
    assert job["skipped"] == 1 and job["failed"] == 0
    assert job["overall_status"] == "completed"
    assert source.exists()
    assert not dest.exists(), "no _NeedsReview folder is created"
