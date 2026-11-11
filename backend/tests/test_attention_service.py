"""services/attention_service.py and services/canonical_path.py: the To-Do list builders."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from db.models import (
    AssignmentExtraFile,
    AttentionDismissal,
    ComplianceFinding,
    ComplianceScan,
    Disc,
    DiscMediaLink,
    Episode,
    IngestOperation,
    IngressQueueItem,
    MediaAssignment,
    MediaFile,
    Movie,
    Series,
)
from services import attention_service as svc
from services import canonical_path
from tests.fake_db import FakeSession

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
ROOT = "/ark/media/jellyfin"

INCEPTION = "Inception (2010) [imdbid-tt1375666]"
SHOW = "The Show (2005) [imdbid-tt0000123]"


def movie(id_="m1", title="Inception", year="2010-07-16", imdb="tt1375666", raw=None):
    return Movie(id=id_, title=title, release_date=year, imdb_id=imdb, raw_data=raw or {"title": title})


def series(id_="s1", title="The Show", years=("2005",), imdb="tt0000123"):
    return Series(id=id_, title=title, running_years=list(years), imdb_id=imdb, raw_data={"title": title, "seasons": []})


def lib_file(id_, rel, **fields):
    fields.setdefault("is_available", True)
    fields.setdefault("location", "library")
    fields.setdefault("probed_at", T0)
    row = MediaFile(
        id=id_,
        file_path=f"{ROOT}/{rel}",
        file_name=rel.rsplit("/", 1)[-1],
        relative_path=rel,
        **fields,
    )
    row.created_at = T0
    return row


def inputs_for(files=(), titles=(), **kw):
    inputs = svc.AttentionInputs(files=list(files), **kw)
    for kind, row in titles:
        inputs.titles[(kind, row.id)] = svc.title_info(kind, row)
    return inputs


def by_kind(items, kind):
    return [i for i in items if i["kind"] == kind]


# ---------------------------------------------------------------------------
# needs_rename tolerance table
# ---------------------------------------------------------------------------

MOVIE_EQUAL = [
    f"Movies/{INCEPTION}/{INCEPTION}.mkv",                     # canonical
    f"Movies/{INCEPTION}/{INCEPTION} (2).mkv",                 # unique_path numeric suffix
    f"Movies/{INCEPTION}/inception (2010)  [IMDBID-tt1375666].MKV",  # case + whitespace
    f"Movies/{INCEPTION}/Inception(2010)[imdbid-tt1375666].mkv",     # whitespace removed
]
MOVIE_DIFFERENT = [
    f"Movies/{INCEPTION}/Inception.2010.1080p.mkv",
    f"Movies/{INCEPTION}/Inception (2010).mkv",                # missing the IMDb tag the catalog has
    f"Movies/{INCEPTION}/Inception (2011) [imdbid-tt1375666].mkv",
]


@pytest.mark.parametrize("rel", MOVIE_EQUAL)
def test_movie_names_treated_as_canonical(rel):
    items = svc.build_needs_rename(inputs_for([lib_file("f1", rel, role="main", movie_id="m1")], [("movie", movie())]))
    assert items == []


@pytest.mark.parametrize("rel", MOVIE_DIFFERENT)
def test_movie_names_flagged(rel):
    items = svc.build_needs_rename(inputs_for([lib_file("f1", rel, role="main", movie_id="m1")], [("movie", movie())]))
    assert [i["id"] for i in items] == ["needs_rename:media_file:f1"]
    item = items[0]
    assert item["current"] == rel
    assert item["expected"] == f"Movies/{INCEPTION}/{INCEPTION}.mkv"
    assert item["fingerprint"] == rel and item["mediaId"] == "m1" and item["mediaType"] == "movie"


@pytest.mark.parametrize("rel", [
    f"Movies/{INCEPTION}/{INCEPTION} - Version 2.mkv",
    f"Movies/{INCEPTION}/{INCEPTION} - Version 3.mkv",
    f"Movies/{INCEPTION}/{INCEPTION} - Director's Cut.mkv",
    f"Movies/{INCEPTION}/{INCEPTION} - 1080p.mkv",
])
def test_version_labels_are_equal(rel):
    items = svc.build_needs_rename(inputs_for([lib_file("f1", rel, role="version", movie_id="m1")], [("movie", movie())]))
    assert items == []


EPISODE_EQUAL = [
    f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01.mkv",
    f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01 Pilot.mkv",       # episode-title tail
    f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01 - Something Else.mkv",
    f"TV Shows/{SHOW}/Season 01/{SHOW} s01e01.mkv",
]


@pytest.mark.parametrize("rel", EPISODE_EQUAL)
def test_episode_names_treated_as_canonical(rel):
    f = lib_file("e1", rel, role="episode", series_id="s1", season_number=1, episode_number=1)
    assert svc.build_needs_rename(inputs_for([f], [("series", series())])) == []


def test_specials_and_season_00_are_equal():
    for folder in ("Specials", "Season 00"):
        rel = f"TV Shows/{SHOW}/{folder}/{SHOW} S00E03.mkv"
        f = lib_file("e1", rel, role="episode", series_id="s1", season_number=0, episode_number=3)
        assert svc.build_needs_rename(inputs_for([f], [("series", series())])) == [], folder


@pytest.mark.parametrize("name", [f"{SHOW} S01E01-E02.mkv", f"{SHOW} S01E01E02.mkv", f"{SHOW} S01E01-02.mkv"])
def test_multi_episode_spellings_are_equal(name):
    rel = f"TV Shows/{SHOW}/Season 01/{name}"
    f = lib_file("e1", rel, role="episode", series_id="s1", season_number=1, episode_number=1, episode_end_number=2)
    assert svc.build_needs_rename(inputs_for([f], [("series", series())])) == []


def test_episode_flagged_with_episode_title_from_the_catalog():
    rel = "TV Shows/The Show (2005) [imdbid-tt0000123]/Season 1/show.s01e02.720p.mkv"
    f = lib_file("e1", rel, role="episode", series_id="s1", season_number=1, episode_number=2)
    inputs = inputs_for([f], [("series", series())], episode_titles={("s1", 1, 2): "The Second"})
    [item] = svc.build_needs_rename(inputs)
    assert item["expected"] == f"TV Shows/{SHOW}/Season 01/{SHOW} S01E02 The Second.mkv"


def test_no_imdb_anywhere_is_never_flagged_and_imdb_tag_ignored_without_catalog_id():
    plain = movie(imdb=None)
    loose = lib_file("f1", "Movies/Inception (2010)/whatever.mkv", role="main", movie_id="m1")
    assert svc.build_needs_rename(inputs_for([loose], [("movie", plain)])) == []
    tagged_folder = lib_file("f2", f"Movies/{INCEPTION}/Inception (2010).mkv", role="main", movie_id="m1")
    assert svc.build_needs_rename(inputs_for([tagged_folder], [("movie", plain)])) == []


def test_extras_other_unlinked_and_missing_files_are_not_rename_candidates():
    files = [
        lib_file("x", f"Movies/{INCEPTION}/extras/thing.mkv", role="extra", movie_id="m1"),
        lib_file("o", f"Movies/{INCEPTION}/random.mkv", role="other", movie_id="m1"),
        lib_file("u", f"Movies/{INCEPTION}/bad.mkv", role="main"),
        lib_file("g", f"Movies/{INCEPTION}/bad2.mkv", role="main", movie_id="m1", is_available=False),
        lib_file("i", "x/bad3.mkv", role="main", movie_id="m1", location="ingest"),
    ]
    assert svc.build_needs_rename(inputs_for(files, [("movie", movie())])) == []


def test_non_canonical_folder_with_matching_files_is_one_title_item():
    folder = "Inception (2010)"
    files = [
        lib_file("f1", f"Movies/{folder}/{INCEPTION}.mkv", role="main", movie_id="m1"),
        lib_file("f2", f"Movies/{folder}/{INCEPTION} - Version 2.mkv", role="version", movie_id="m1"),
    ]
    [item] = svc.build_needs_rename(inputs_for(files, [("movie", movie())]))
    assert item["id"] == "needs_rename:title:m1"
    assert item["current"] == folder and item["expected"] == INCEPTION
    assert item["relativePath"] == f"Movies/{folder}"


def test_file_item_mentions_folder_and_target_stays_in_folder():
    rel = "Movies/inception/inception.mkv"
    [item] = svc.build_needs_rename(inputs_for([lib_file("f1", rel, role="main", movie_id="m1")], [("movie", movie())]))
    assert item["expected"] == f"Movies/inception/{INCEPTION}.mkv"
    assert "rename the folder separately" in item["detail"]


def test_naming_findings_deduplicated_against_file_and_folder_items():
    rel = f"Movies/{INCEPTION}/bad name.mkv"
    f = lib_file("f1", rel, role="main", movie_id="m1")
    findings = [
        ComplianceFinding(id="n1", scan_id="s", issue_type="naming_mismatch", file_path=f"{ROOT}/{rel}",
                          status="open", severity="low", rationale="Bad."),
        ComplianceFinding(id="n2", scan_id="s", issue_type="episode_naming_mismatch",
                          file_path=f"{ROOT}/TV Shows/X/Season 01/x.mkv", status="open", severity="medium",
                          current_state={"fileName": "x.mkv"}, expected_state={"suggestedFileName": "X S01E01.mkv"}),
        ComplianceFinding(id="n3", scan_id="s", issue_type="naming_mismatch", folder_path=f"{ROOT}/Movies/Y",
                          status="open", severity="medium", current_state={"folderName": "Y"},
                          expected_state={"pattern": "Title (Year)"}),
        ComplianceFinding(id="n4", scan_id="s", issue_type="naming_mismatch", folder_path=f"{ROOT}/Movies/inception",
                          status="open", severity="medium"),
    ]
    folder_file = lib_file("f2", "Movies/inception/inception.mkv", role="main", movie_id="m2")
    inputs = inputs_for([f, folder_file], [("movie", movie()), ("movie", movie("m2"))], findings=findings)
    items = svc.build_needs_rename(inputs)
    ids = sorted(i["id"] for i in items)
    assert ids == [
        "needs_rename:finding:n2", "needs_rename:finding:n3",
        "needs_rename:media_file:f1", "needs_rename:media_file:f2",
    ]
    n2 = next(i for i in items if i["subjectId"] == "n2")
    assert n2["current"] == "x.mkv" and n2["expected"] == "X S01E01.mkv" and n2["severity"] == "medium"


def test_canonical_strict_target_and_refusals():
    title = canonical_path.title_identity("movie", movie())
    ok = canonical_path.compute(lib_file("f", "Movies/inception/a.MKV", role="main", movie_id="m1"), title)
    assert ok.ok and ok.target_relative == f"Movies/inception/{INCEPTION}.MKV"
    assert ok.canonical_relative == f"Movies/{INCEPTION}/{INCEPTION}.MKV"
    assert not ok.folder_matches and ok.notes

    cases = [
        (lib_file("f", "x.mkv", role="main", movie_id="m1", location="ingest"), canonical_path.NOT_IN_LIBRARY),
        (lib_file("f", "Movies/A/a.mkv", role="main", movie_id="m1", is_available=False), canonical_path.FILE_MISSING),
        (lib_file("f", "Movies/A/a.mkv", role="main"), canonical_path.NO_TITLE_LINK),
        (lib_file("f", "Movies/A/extras/a.mkv", role="extra", movie_id="m1"), canonical_path.ROLE_NOT_RENAMABLE),
        (lib_file("f", "TV Shows/A/Season 01/a.mkv", role="episode", movie_id="m1", episode_number=1),
         canonical_path.CATEGORY_MISMATCH),
    ]
    for row, code in cases:
        assert canonical_path.compute(row, title).code == code
    show = canonical_path.title_identity("series", series())
    no_ep = lib_file("f", "TV Shows/A/Season 01/a.mkv", role="episode", series_id="s1", season_number=1)
    assert canonical_path.compute(no_ep, show).code == canonical_path.NO_EPISODE_NUMBER


def test_naming_key_table():
    key = canonical_path.naming_key
    assert key("TV Shows/A/Specials/A S00E01.mkv", "episode") == key("TV Shows/A/Season 00/A S00E01.mkv", "episode")
    assert key("TV Shows/A/Season 1/A S01E01.mkv", "episode") != key("TV Shows/A/Season 01/A S01E01.mkv", "episode")
    assert key("Movies/A (2000)/A (2000) (3).mkv", "main") == key("Movies/A (2000)/A (2000).mkv", "main")
    # A year in parentheses is not a unique-path suffix.
    assert key("Movies/A/A (2000).mkv", "main") != key("Movies/A/A.mkv", "main")
    assert key("Movies/A/A [imdbid-tt1234567].mkv", "main", strip_imdb=True) == key("Movies/A/A.mkv", "main")


# ---------------------------------------------------------------------------
# Other kinds
# ---------------------------------------------------------------------------

def test_needs_assignment_queue_items_and_unlinked_files():
    queue = [
        IngressQueueItem(id="q1", file_path="/ingest/a.mkv", file_name="a.mkv", status="needs_review",
                         parsed_info={"review_reason": "confidence 50 below threshold 80"},
                         best_match={"title": "Alpha", "year": 1999}, confidence_score=50,
                         proposed_path="/ark/media/jellyfin/Movies/Alpha (1999)/Alpha (1999).mkv", queued_at=T0),
        IngressQueueItem(id="q2", file_path="/ingest/b.mkv", file_name="b.mkv", status="failed",
                         last_error="disk full", parsed_info={}, best_match={}, queued_at=T0),
        IngressQueueItem(id="q3", file_path="/ingest/c.mkv", file_name="c.mkv", status="completed"),
    ]
    files = [
        lib_file("u1", "Movies/Z/Z.mkv", role="main"),
        lib_file("u2", "Movies/Z/Z2.mkv", role="main", movie_id="m1"),
        lib_file("u3", "Movies/Z/Z3.mkv", role="main", is_available=False),
    ]
    items = svc.build_needs_assignment(inputs_for(files, [("movie", movie())], queue_items=queue))
    by_id = {i["id"]: i for i in items}
    assert set(by_id) == {"needs_assignment:queue_item:q1", "needs_assignment:queue_item:q2",
                          "needs_assignment:media_file:u1"}
    q1 = by_id["needs_assignment:queue_item:q1"]
    assert q1["severity"] == "medium" and q1["queueItemId"] == "q1" and q1["current"] == "Alpha (1999)"
    assert q1["queue"]["reviewReason"].startswith("confidence 50") and q1["queue"]["confidence"] == 50
    assert q1["expected"].endswith("Alpha (1999).mkv")
    assert by_id["needs_assignment:queue_item:q2"]["severity"] == "high"
    assert "disk full" in by_id["needs_assignment:queue_item:q2"]["detail"]


def test_needs_review_merges_reasons_per_file():
    f = lib_file("f1", f"Movies/{INCEPTION}/{INCEPTION}.mkv", role="main", movie_id="m1",
                 needs_review=True, review_note="audio out of sync")
    g = lib_file("f2", f"Movies/{INCEPTION}/x.mkv", role="extra", movie_id="m1")
    h = lib_file("f3", f"Movies/{INCEPTION}/{INCEPTION} - Version 2.mkv", role="version", movie_id="m1")
    inputs = inputs_for(
        [f, g, h], [("movie", movie())],
        assignments=[
            MediaAssignment(id="a1", primary_file_id="f1", media_type="movie", media_id="m1", confidence=60,
                            is_manual_assignment=False),
            MediaAssignment(id="a2", primary_file_id="f2", media_type="movie", media_id="m1", confidence=60,
                            is_manual_assignment=True),
            MediaAssignment(id="a3", primary_file_id="f2", media_type="movie", media_id="m1", confidence=95,
                            is_manual_assignment=False),
        ],
        extra_files=[AssignmentExtraFile(id="x1", assignment_id="a1", media_file_id="f2", category="trailer",
                                         confirmed=False)],
        operations=[
            IngestOperation(id="o1", op="move", status="done", src="/in/v.mkv", dst=h.file_path,
                            planned_dst=f"{ROOT}/Movies/{INCEPTION}/{INCEPTION}.mkv"),
            IngestOperation(id="o2", op="move", status="done", src="/in/w.mkv", dst=f"{ROOT}/gone.mkv",
                            planned_dst=f"{ROOT}/other.mkv"),
        ],
        findings=[ComplianceFinding(id="d1", scan_id="s", issue_type="duplicate_main_feature",
                                    file_path=h.file_path, status="open",
                                    current_state={"primaryCandidate": "a.mkv", "secondaryCandidate": "b.mkv"})],
    )
    items = {i["id"]: i for i in svc.build_needs_review(inputs)}
    assert set(items) == {"needs_review:media_file:f1", "needs_review:media_file:f2", "needs_review:media_file:f3"}
    f1 = items["needs_review:media_file:f1"]
    assert f1["reasons"] == ["flagged", "low_confidence"] and f1["dismissible"] is False
    assert "audio out of sync" in f1["detail"]
    f2 = items["needs_review:media_file:f2"]
    assert f2["reasons"] == ["extra_unconfirmed"] and f2["severity"] == "low" and f2["dismissible"] is True
    f3 = items["needs_review:media_file:f3"]
    assert f3["reasons"] == ["duplicate_main_feature", "moved_elsewhere"] and f3["severity"] == "high"


def test_missing_and_unprobed():
    files = [
        lib_file("m", "Movies/A/A.mkv", role="main", movie_id="m1", is_available=False, missing_since=T0),
        lib_file("p", "Movies/A/B.mkv", role="extra", probed_at=None),
        lib_file("e", "Movies/A/C.mkv", role="extra", probe_error="no media information"),
        lib_file("ok", "Movies/A/D.mkv", role="extra"),
        lib_file("i", "x.mkv", location="ingest", probed_at=None),
    ]
    inputs = inputs_for(files, [("movie", movie())])
    [missing] = svc.build_missing_file(inputs)
    assert missing["subjectId"] == "m" and missing["severity"] == "high" and missing["fingerprint"] == T0.isoformat()
    assert missing["createdAt"] == T0.isoformat()
    unprobed = {i["subjectId"]: i for i in svc.build_unprobed(inputs)}
    assert set(unprobed) == {"p", "e"}
    assert unprobed["e"]["reasons"] == ["probe_failed"] and "no media information" in unprobed["e"]["detail"]


def test_no_disc_link_and_unripped_disc():
    discs = [
        Disc(id="d1", title="Inception BD", format="Blu-ray", raw_data={}),
        Disc(id="d2", title="Show S1", raw_data={"mediaId": "s1"}),  # legacy link
        Disc(id="d3", title="Ripped", raw_data={}),
        Disc(id="d4", title="Lonely", raw_data={}),
    ]
    links = [DiscMediaLink(disc_id="d1", media_type="movie", media_id="m1"),
             DiscMediaLink(disc_id="d3", media_type="movie", media_id="m2")]
    files = [
        lib_file("f1", "Movies/A/A.mkv", role="main", movie_id="m1"),
        lib_file("e1", "TV Shows/S/Season 01/S S01E01.mkv", role="episode", series_id="s1"),
        lib_file("f3", "Movies/B/B.mkv", role="main", movie_id="m2", disc_id="d3"),
    ]
    inputs = inputs_for(files, [("movie", movie()), ("movie", movie("m2", "B")), ("series", series())],
                        discs=discs, disc_links=links)
    no_link = {i["subjectId"]: i for i in svc.build_no_disc_link(inputs)}
    assert set(no_link) == {"m1", "s1"}
    assert no_link["m1"]["discId"] == "d1" and no_link["m1"]["subjectType"] == "title"
    assert no_link["s1"]["mediaType"] == "series"
    unripped = {i["subjectId"]: i for i in svc.build_unripped_disc(inputs)}
    assert set(unripped) == {"d1", "d2", "d4"}
    assert unripped["d1"]["mediaId"] == "m1" and unripped["d4"]["mediaId"] is None


# ---------------------------------------------------------------------------
# Dismissals, summary
# ---------------------------------------------------------------------------

def _rename_item():
    rel = f"Movies/{INCEPTION}/bad.mkv"
    return svc.build_needs_rename(inputs_for([lib_file("f1", rel, role="main", movie_id="m1")], [("movie", movie())]))


def test_dismissal_by_fingerprint():
    items = _rename_item()
    same = AttentionDismissal(kind="needs_rename", subject_type="media_file", subject_id="f1",
                              fingerprint=items[0]["fingerprint"])
    assert svc.apply_dismissals(items, [same], T0) == []
    changed = AttentionDismissal(kind="needs_rename", subject_type="media_file", subject_id="f1",
                                 fingerprint="Movies/old/path.mkv")
    assert svc.apply_dismissals(items, [changed], T0) == items
    other_kind = AttentionDismissal(kind="unprobed", subject_type="media_file", subject_id="f1",
                                    fingerprint=items[0]["fingerprint"])
    assert svc.apply_dismissals(items, [other_kind], T0) == items


def test_dismissal_expiry():
    items = _rename_item()
    d = AttentionDismissal(kind="needs_rename", subject_type="media_file", subject_id="f1",
                           fingerprint=items[0]["fingerprint"], dismissed_until=T0 + timedelta(days=7))
    assert svc.apply_dismissals(items, [d], T0 + timedelta(days=6)) == []
    assert svc.apply_dismissals(items, [d], T0 + timedelta(days=7)) == items


def test_non_dismissible_items_ignore_dismissals():
    f = lib_file("f1", "Movies/A/A.mkv", needs_review=True)
    items = svc.build_needs_review(inputs_for([f]))
    d = AttentionDismissal(kind="needs_review", subject_type="media_file", subject_id="f1",
                           fingerprint=items[0]["fingerprint"])
    assert svc.apply_dismissals(items, [d], T0) == items


def test_summary_total_excludes_unripped_and_unprobed():
    items = [{"kind": k} for k in ("needs_rename", "needs_rename", "unprobed", "unripped_disc", "missing_file")]
    summary = svc.summarize(items, T0)
    assert summary["counts"] == {"needs_assignment": 0, "needs_rename": 2, "needs_review": 0, "missing_file": 1,
                                 "no_disc_link": 0, "unprobed": 1, "unripped_disc": 1}
    assert summary["total"] == 3 and summary["generatedAt"] == T0.isoformat()


async def test_summary_cache_ttl_and_invalidate():
    now = [0.0]
    cache = svc.SummaryCache(ttl_seconds=60, clock=lambda: now[0])
    calls = []

    async def build():
        calls.append(1)
        return {"n": len(calls)}

    assert (await cache.get(build))["n"] == 1
    now[0] = 59
    assert (await cache.get(build))["n"] == 1
    now[0] = 60
    assert (await cache.get(build))["n"] == 2
    cache.invalidate()
    assert (await cache.get(build))["n"] == 3


# ---------------------------------------------------------------------------
# Loader over the fake session
# ---------------------------------------------------------------------------

async def test_collect_items_reads_the_database_and_scopes_findings_to_the_latest_scan():
    old = ComplianceScan(id="old", library_path=ROOT, status="completed", started_at=T0)
    new = ComplianceScan(id="new", library_path=ROOT, status="completed", started_at=T0 + timedelta(days=1))
    running = ComplianceScan(id="run", library_path=ROOT, status="running", started_at=T0 + timedelta(days=2))
    findings = [
        ComplianceFinding(id="fo", scan_id="old", issue_type="naming_mismatch", file_path=f"{ROOT}/Movies/Q/q.mkv",
                          status="open", severity="low"),
        ComplianceFinding(id="fn", scan_id="new", issue_type="naming_mismatch", file_path=f"{ROOT}/Movies/R/r.mkv",
                          status="open", severity="low"),
        ComplianceFinding(id="fr", scan_id="new", issue_type="naming_mismatch", file_path=f"{ROOT}/Movies/S/s.mkv",
                          status="resolved", severity="low"),
    ]
    session = FakeSession([
        movie(), series(), old, new, running, *findings,
        lib_file("f1", f"Movies/{INCEPTION}/bad.mkv", role="main", movie_id="m1"),
        Episode(id="ep", series_id="s1", season_id="x", series_title="The Show", season_number=1, episode_number=1,
                title="Pilot"),
        lib_file("e1", f"TV Shows/{SHOW}/Season 01/x.mkv", role="episode", series_id="s1", season_number=1,
                 episode_number=1),
        IngressQueueItem(id="q1", file_path="/in/a.mkv", file_name="a.mkv", status="failed", parsed_info={},
                         best_match={}),
        AttentionDismissal(id="dd", kind="needs_assignment", subject_type="queue_item", subject_id="q1",
                           fingerprint="failed|/in/a.mkv"),
    ])
    items = await svc.collect_items(session)
    ids = {i["id"] for i in items}
    assert "needs_rename:finding:fn" in ids and "needs_rename:finding:fo" not in ids
    assert "needs_rename:finding:fr" not in ids
    assert "needs_rename:media_file:f1" in ids
    assert "needs_assignment:queue_item:q1" not in ids  # dismissed
    episode = next(i for i in items if i["id"] == "needs_rename:media_file:e1")
    assert episode["expected"] == f"TV Shows/{SHOW}/Season 01/{SHOW} S01E01 Pilot.mkv"
    await svc.attach_file_dtos(session, items)
    assert episode["file"]["id"] == "e1" and episode["file"]["needsReview"] is False
    assert set(svc.public(episode)) == set(svc.ITEM_KEYS)
