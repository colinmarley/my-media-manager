from scripts.rebase_paths import format_plan, plan_rebase, rebase_value

OLD = "/ark/media/jellyfin/ingest"
NEW = "/ark/media/ingest"


def test_rebase_value_matches_whole_segments_only():
    assert rebase_value(f"{OLD}/Disc/A.mkv", OLD, NEW) == f"{NEW}/Disc/A.mkv"
    assert rebase_value(OLD, OLD, NEW) == NEW
    assert rebase_value(f"{OLD}-old/A.mkv", OLD, NEW) is None
    assert rebase_value("/elsewhere/A.mkv", OLD, NEW) is None
    assert rebase_value(None, OLD, NEW) is None
    assert rebase_value(f"{OLD}/A.mkv", OLD + "/", NEW + "/") == f"{NEW}/A.mkv"


def test_plan_lists_every_rewritten_column():
    rows = {
        "ingress_queue": [
            {"id": "q1", "file_path": f"{OLD}/Disc/A.mkv", "ingress_path": OLD},
            {"id": "q2", "file_path": "/other/B.mkv", "ingress_path": "/other"},
        ],
        "media_files": [
            {"id": "m1", "file_path": f"{OLD}/Disc/A.mkv", "folder_path": f"{OLD}/Disc"},
        ],
        "ingest_operations": [
            {"id": "o1", "src": f"{OLD}/Disc/A.mkv"},
            {"id": "o2", "src": None},
        ],
    }
    plan = plan_rebase(rows, OLD, NEW)

    got = {(c.table, c.row_id, c.column): c.new for c in plan.changes}
    assert got == {
        ("ingress_queue", "q1", "file_path"): f"{NEW}/Disc/A.mkv",
        ("ingress_queue", "q1", "ingress_path"): NEW,
        ("media_files", "m1", "file_path"): f"{NEW}/Disc/A.mkv",
        ("media_files", "m1", "folder_path"): f"{NEW}/Disc",
        ("ingest_operations", "o1", "src"): f"{NEW}/Disc/A.mkv",
    }
    assert plan.collisions == []
    assert plan.counts()["ingress_queue.file_path"] == 1
    assert "No unique-constraint collisions" in format_plan(plan)


def test_collision_with_an_existing_row_is_reported():
    rows = {
        "ingress_queue": [
            {"id": "q1", "file_path": f"{OLD}/A.mkv", "ingress_path": OLD},
            {"id": "q2", "file_path": f"{NEW}/A.mkv", "ingress_path": NEW},
        ],
    }
    plan = plan_rebase(rows, OLD, NEW)
    assert len(plan.collisions) == 1
    collision = plan.collisions[0]
    assert (collision.table, collision.column, collision.value) == ("ingress_queue", "file_path", f"{NEW}/A.mkv")
    assert collision.row_ids == ("q1", "q2")
    assert "1 unique-constraint collision" in format_plan(plan)


def test_rows_that_both_move_do_not_collide_with_each_others_old_value():
    # /a -> /b while /b/x already moved away is fine: swap-free chains are checked on final values.
    rows = {
        "media_files": [
            {"id": "m1", "file_path": "/a/x.mkv", "folder_path": "/a"},
            {"id": "m2", "file_path": "/a/y.mkv", "folder_path": "/a"},
        ],
    }
    plan = plan_rebase(rows, "/a", "/b")
    assert plan.collisions == []
    assert len(plan.changes) == 4


def test_non_unique_columns_never_collide():
    rows = {
        "ingest_operations": [
            {"id": "o1", "src": f"{OLD}/A.mkv"},
            {"id": "o2", "src": f"{NEW}/A.mkv"},
        ],
    }
    plan = plan_rebase(rows, OLD, NEW)
    assert plan.collisions == []
    assert len(plan.changes) == 1
