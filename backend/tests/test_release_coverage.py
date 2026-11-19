"""services/release_coverage.py: disc, release and file states, the coverage
counts and file suggestions. Pure functions over stand-in rows; no database."""

from types import SimpleNamespace as NS

import pytest

from services import release_coverage as rc
from services.release_coverage import CoverageIndex, Target


def disc(id, set_id, format="Blu-ray", rip_intent="rip", raw_data=None):
    return NS(id=id, set_id=set_id, format=format, rip_intent=rip_intent, raw_data=raw_data or {}, title=id)


def release(id, packaging=None, expected_disc_count=None, title=None):
    return NS(id=id, packaging=packaging, expected_disc_count=expected_disc_count, title=title or id)


def content(release_id, media_type, media_id, season=None, start=None, end=None):
    return NS(release_id=release_id, media_type=media_type, media_id=media_id,
              season_number=season, episode_start=start, episode_end=end)


def link(disc_id, media_type, media_id, season=None, start=None, end=None):
    return NS(disc_id=disc_id, media_type=media_type, media_id=media_id,
              season_number=season, episode_start=start, episode_end=end)


def movie_file(id, movie_id, role="main", width=1920, height=1080, **extra):
    fields = dict(id=id, file_name=f"{id}.mkv", movie_id=movie_id, series_id=None, role=role,
                  season_number=None, episode_number=None, disc_id=None, release_id=None, tape_id=None,
                  source_kind=None, is_available=True, width=width, height=height)
    fields.update(extra)
    return NS(**fields)


def episode_file(id, series_id, season, episode, width=720, height=480, **extra):
    fields = dict(id=id, file_name=f"{id}.mkv", movie_id=None, series_id=series_id, role="episode",
                  season_number=season, episode_number=episode, disc_id=None, release_id=None, tape_id=None,
                  source_kind=None, is_available=True, width=width, height=height)
    fields.update(extra)
    return NS(**fields)


def series(id, total=None, seasons=None):
    data = {"seasons": [{"season_number": n, "episode_count": c} for n, c in (seasons or {}).items()]}
    return NS(id=id, total_episodes=total, tmdb_data=data)


# ---------------------------------------------------------------------------
# Tiers and fit
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fmt,tier", [
    ("DVD", "sd"), ("dvd", "sd"), ("LaserDisc", "sd"),
    ("Blu-ray", "hd"), ("BLURAY", "hd"), ("HD DVD", "hd"), ("HD_DVD", "hd"),
    ("4K UHD", "uhd"), ("UHD_BLURAY", "uhd"),
    (None, None), ("", None), ("Betamax", None),
])
def test_format_tier(fmt, tier):
    assert rc.format_tier(fmt) == tier


@pytest.mark.parametrize("width,height,tier", [
    (720, 480, "sd"), (720, 576, "sd"), (853, 480, "sd"),
    (1920, 1080, "hd"), (1920, 800, "hd"), (1280, 720, "hd"),
    (3840, 2160, "uhd"), (3840, 1600, "uhd"),
    (None, None, None), (0, 0, None),
])
def test_file_tier(width, height, tier):
    assert rc.file_tier(NS(width=width, height=height)) == tier


def test_fit():
    hd = NS(width=1920, height=1080)
    assert rc.fit({"hd"}, hd) == "fits"
    assert rc.fit({"sd"}, hd) == "mismatch"
    assert rc.fit({"sd", "hd"}, hd) == "fits"
    assert rc.fit(set(), hd) == "unknown"            # the release has no disc format
    assert rc.fit({"hd"}, NS(width=None, height=None)) == "unknown"  # never probed


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

def test_target_holds_scopes():
    whole = Target("series", "s1")
    season = Target("series", "s1", 3)
    volume = Target("series", "s1", 3, 7, 12)
    assert whole.holds(episode_file("e", "s1", 9, 1))
    assert season.holds(episode_file("e", "s1", 3, 1)) and not season.holds(episode_file("e", "s1", 4, 1))
    assert volume.holds(episode_file("e", "s1", 3, 7)) and volume.holds(episode_file("e", "s1", 3, 12))
    assert not volume.holds(episode_file("e", "s1", 3, 6)) and not volume.holds(episode_file("e", "s1", 3, 13))
    assert not whole.holds(episode_file("e", "other", 1, 1))
    assert Target("movie", "m1").holds(movie_file("f", "m1")) and not Target("movie", "m1").holds(movie_file("f", "m2"))


def test_release_targets_fall_back_to_its_discs_links():
    """The phone app links titles to discs; a release without contents takes them."""
    index = CoverageIndex(
        discs=[disc("d1", "r1"), disc("d2", "r1"), disc("d3", "r2", raw_data={"mediaId": "m9", "mediaType": "movie"})],
        releases=[release("r1"), release("r2"), release("r3")],
        contents=[content("r3", "movie", "m3")],
        disc_links=[link("d1", "movie", "m1"), link("d2", "movie", "m1"), link("d2", "movie", "m2")],
    )
    assert index.release_targets["r1"] == [Target("movie", "m1"), Target("movie", "m2")]
    assert index.release_targets["r2"] == [Target("movie", "m9")]   # the legacy single title
    assert index.release_targets["r3"] == [Target("movie", "m3")]


# ---------------------------------------------------------------------------
# Disc states
# ---------------------------------------------------------------------------

def test_disc_states():
    index = CoverageIndex(
        discs=[
            disc("ripped", "r1"),
            disc("skipped", "r1", format="DVD", rip_intent="skip"),
            disc("covered", "r2"),
            disc("unripped", "r3"),
            disc("skipped-but-ripped", "r4", rip_intent="skip"),
        ],
        releases=[release("r1"), release("r2"), release("r3"), release("r4")],
        files=[
            movie_file("f1", "m1", disc_id="ripped", release_id="r1"),
            movie_file("f2", "m2", release_id="r2"),
            movie_file("f4", "m4", disc_id="skipped-but-ripped", release_id="r4"),
        ],
    )
    states = {d.id: index.disc_state(d) for d in index.discs}
    assert states == {
        "ripped": "ripped", "skipped": "skipped", "covered": "covered", "unripped": "unripped",
        "skipped-but-ripped": "ripped",
    }


def test_a_disc_that_says_what_it_holds_is_covered_only_by_those_titles():
    index = CoverageIndex(
        discs=[disc("feature", "r1"), disc("other-movie", "r1")],
        releases=[release("r1")],
        disc_links=[link("feature", "movie", "m1"), link("other-movie", "movie", "m2")],
        files=[movie_file("f1", "m1", release_id="r1")],
    )
    assert index.disc_state(index.discs[0]) == "covered"
    assert index.disc_state(index.discs[1]) == "unripped"


def test_a_missing_file_does_not_count():
    index = CoverageIndex(
        discs=[disc("d1", "r1")], releases=[release("r1")],
        files=[movie_file("f1", "m1", disc_id="d1", release_id="r1", is_available=False)],
    )
    assert index.disc_state(index.discs[0]) == "unripped"
    assert index.release_state(index.releases[0]) == "none"


# ---------------------------------------------------------------------------
# Release states
# ---------------------------------------------------------------------------

def test_movie_release_states():
    index = CoverageIndex(
        discs=[disc("d1", "double"), disc("d2", "bonus", rip_intent="skip")],
        releases=[release("double"), release("empty"), release("bonus"), release("untitled")],
        contents=[content("double", "movie", "m1"), content("double", "movie", "m2"),
                  content("empty", "movie", "m3")],
        files=[movie_file("f1", "m1", release_id="double"), movie_file("fx", "m7", release_id="untitled")],
    )
    states = {r.id: index.release_state(r) for r in index.releases}
    assert states == {"double": "partial", "empty": "none", "bonus": "skipped", "untitled": "complete"}

    index = CoverageIndex(
        releases=[release("double")],
        contents=[content("double", "movie", "m1"), content("double", "movie", "m2")],
        files=[movie_file("f1", "m1", release_id="double"), movie_file("f2", "m2", release_id="double")],
    )
    assert index.release_state(index.releases[0]) == "complete"


def test_an_extra_alone_does_not_satisfy_a_movie():
    index = CoverageIndex(
        releases=[release("r1")], contents=[content("r1", "movie", "m1")],
        files=[movie_file("x", "m1", role="extra", release_id="r1")],
    )
    assert index.release_state(index.releases[0]) == "partial"


def test_season_release_needs_every_episode_when_the_count_is_known():
    files = [episode_file(f"e{n}", "s1", 3, n, release_id="r1") for n in (1, 2, 3)]
    known = CoverageIndex(
        releases=[release("r1")], contents=[content("r1", "series", "s1", season=3)],
        files=files, series=[series("s1", seasons={3: 4})],
    )
    assert known.release_state(known.releases[0]) == "partial"
    assert known.target_progress("r1", known.release_targets["r1"][0]) == {"have": 3, "expected": 4, "satisfied": False}

    all_four = CoverageIndex(
        releases=[release("r1")], contents=[content("r1", "series", "s1", season=3)],
        files=files + [episode_file("e4", "s1", 3, 4, release_id="r1")], series=[series("s1", seasons={3: 4})],
    )
    assert all_four.release_state(all_four.releases[0]) == "complete"

    # No TMDB season list: one episode is enough to call it complete.
    unknown = CoverageIndex(
        releases=[release("r1")], contents=[content("r1", "series", "s1", season=3)], files=files[:1], series=[series("s1")],
    )
    assert unknown.release_state(unknown.releases[0]) == "complete"
    assert unknown.target_progress("r1", unknown.release_targets["r1"][0])["expected"] is None


def test_expected_episodes_for_volumes_and_whole_series():
    index = CoverageIndex(series=[series("s1", total=180, seasons={1: 5})])
    assert index.expected_episodes(Target("series", "s1", 1, 7, 12)) == 6
    assert index.expected_episodes(Target("series", "s1")) == 180
    assert index.expected_episodes(Target("series", "s1", 1)) == 5
    assert index.expected_episodes(Target("series", "s1", 2)) is None
    assert index.expected_episodes(Target("series", "s1", 1, 7, None)) is None
    assert index.expected_episodes(Target("series", "nope", 1)) is None


def test_a_two_part_file_counts_once_per_episode_slot():
    """Two files of the same episode (a version) are one episode, not two."""
    index = CoverageIndex(
        releases=[release("r1")], contents=[content("r1", "series", "s1", season=1)],
        files=[episode_file("a", "s1", 1, 1, release_id="r1"), episode_file("b", "s1", 1, 1, release_id="r1")],
        series=[series("s1", seasons={1: 2})],
    )
    assert index.target_progress("r1", index.release_targets["r1"][0])["have"] == 1


def test_incomplete_set():
    index = CoverageIndex(
        discs=[disc("d1", "r1"), disc("d2", "r2"), disc("d3", "r2")],
        releases=[release("r1", expected_disc_count=4), release("r2", expected_disc_count=2), release("r3")],
    )
    assert [index.is_incomplete_set(r) for r in index.releases] == [True, False, False]


# ---------------------------------------------------------------------------
# File states and counts
# ---------------------------------------------------------------------------

def _collection():
    return CoverageIndex(
        discs=[
            disc("alien-bd", "alien"), disc("alien-dvd", "alien", format="DVD", rip_intent="skip"),
            disc("aliens", "aliens-loose", format="DVD"),
            disc("s3d1", "seinfeld", format="DVD"), disc("s3d2", "seinfeld", format="DVD"),
        ],
        releases=[
            release("alien", packaging="combo_pack", expected_disc_count=2),
            release("aliens-loose", packaging="loose"),
            release("seinfeld", packaging="box_set", expected_disc_count=4),
        ],
        contents=[content("alien", "movie", "m-alien"), content("seinfeld", "series", "s1", season=3)],
        disc_links=[link("aliens", "movie", "m-aliens")],
        files=[
            movie_file("alien-main", "m-alien", disc_id="alien-bd", release_id="alien"),
            movie_file("alien-extra", "m-alien", role="extra"),
            movie_file("alien-cut", "m-alien", role="version"),
            movie_file("aliens-main", "m-aliens", width=720, height=480),            # suggested
            movie_file("download", "m-web", source_kind="digital"),                   # not physical
            movie_file("orphan", "m-none"),                                           # no source
            movie_file("gone", "m-alien", is_available=False),                        # ignored
            episode_file("s3e1", "s1", 3, 1, release_id="seinfeld"),                 # linked to release
            episode_file("s3e2", "s1", 3, 2),                                         # suggested
            episode_file("s4e1", "s1", 4, 1),                                         # no source (other season)
            NS(id="loose-file", file_name="x.mkv", movie_id=None, series_id=None, role=None, season_number=None,
               episode_number=None, disc_id=None, release_id=None, tape_id=None, source_kind=None,
               is_available=True, width=None, height=None),
        ],
        series=[series("s1", seasons={3: 22})],
    )


def test_file_states():
    index = _collection()
    by_id = {f.id: f for f in index.files}
    assert index.file_state(by_id["alien-main"]) == "linkedDisc"
    assert index.file_state(by_id["s3e1"]) == "linkedRelease"
    assert index.file_state(by_id["aliens-main"]) == "suggested"
    assert index.file_state(by_id["s3e2"]) == "suggested"
    assert index.file_state(by_id["s4e1"]) == "noSource"
    assert index.file_state(by_id["orphan"]) == "noSource"
    assert index.file_state(by_id["download"]) == "notPhysical"


def test_build_coverage():
    coverage = rc.build_coverage(_collection())
    assert coverage["discs"] == {
        # ripped: alien-bd. covered: both Seinfeld discs (the set has a file and they say nothing
        # about what they hold). skipped: the DVD copy. unripped: the loose Aliens DVD.
        "total": 5, "ripped": 1, "covered": 2, "unripped": 1, "skipped": 1, "done": 4,
    }
    assert coverage["releases"] == {
        "total": 3, "complete": 1, "partial": 1, "none": 1, "skipped": 0, "loose": 1, "incompleteSets": 1,
    }
    assert coverage["files"] == {
        "total": 7, "linkedDisc": 1, "linkedRelease": 1, "suggested": 2, "noSource": 2, "notPhysical": 1,
        "linked": 2, "unlinked": 4,
    }
    assert coverage["otherFiles"] == {"version": 1, "extra": 1, "other": 0, "unassigned": 1}
    # Titles with counted files: alien, aliens, web, none, s1. Titles a release holds: alien, aliens, s1.
    assert coverage["titles"] == {"withBoth": 3, "filesOnly": 2, "discsOnly": 0}


def test_every_file_and_disc_lands_in_exactly_one_state():
    coverage = rc.build_coverage(_collection())
    assert sum(coverage["discs"][s] for s in rc.DISC_STATES) == coverage["discs"]["total"]
    assert sum(coverage["releases"][s] for s in rc.RELEASE_STATES) == coverage["releases"]["total"]
    assert sum(coverage["files"][s] for s in rc.FILE_STATES) == coverage["files"]["total"]


def test_empty_collection():
    coverage = rc.build_coverage(CoverageIndex())
    assert coverage["discs"]["total"] == coverage["releases"]["total"] == coverage["files"]["total"] == 0
    assert coverage["titles"] == {"withBoth": 0, "filesOnly": 0, "discsOnly": 0}


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------

def test_suggestions_offer_unlinked_files_of_the_releases_titles():
    index = _collection()
    groups = rc.suggest_files(index, index.release_by_id["seinfeld"])
    assert len(groups) == 1
    group = groups[0]
    assert group["target"] == Target("series", "s1", 3)
    assert group["progress"] == {"have": 1, "expected": 22, "satisfied": False}
    # s3e1 is already linked; s4e1 is another season.
    assert [(e["row"].id, e["fit"], e["preselected"]) for e in group["files"]] == [("s3e2", "fits", True)]


def test_suggestions_flag_a_resolution_mismatch_and_skip_downloads_and_extras():
    index = CoverageIndex(
        discs=[disc("d1", "r1", format="DVD")],
        releases=[release("r1")], contents=[content("r1", "movie", "m1")],
        files=[
            movie_file("hd", "m1"),                                   # 1080p against a DVD
            movie_file("sd-cut", "m1", role="version", width=720, height=480),
            movie_file("extra", "m1", role="extra", width=720, height=480),
            movie_file("web", "m1", source_kind="digital", width=720, height=480),
            movie_file("taken", "m1", release_id="other", width=720, height=480),
            movie_file("unprobed", "m1", width=None, height=None),
        ],
    )
    files = rc.suggest_files(index, index.releases[0])[0]["files"]
    assert {e["row"].id: (e["fit"], e["preselected"]) for e in files} == {
        "hd": ("mismatch", False),
        "sd-cut": ("fits", True),
        "unprobed": ("unknown", False),   # something fits, so the unknown one is not ticked
    }


def test_unknown_resolution_is_preselected_when_nothing_is_known_to_fit():
    index = CoverageIndex(
        discs=[disc("d1", "r1", format=None)], releases=[release("r1")], contents=[content("r1", "movie", "m1")],
        files=[movie_file("only", "m1")],
    )
    entry = rc.suggest_files(index, index.releases[0])[0]["files"][0]
    assert (entry["fit"], entry["preselected"]) == ("unknown", True)


def test_combo_pack_uses_the_formats_of_the_discs_meant_to_be_ripped():
    index = CoverageIndex(
        discs=[disc("bd", "r1", format="Blu-ray"), disc("dvd", "r1", format="DVD", rip_intent="skip")],
        releases=[release("r1")], contents=[content("r1", "movie", "m1")],
        files=[movie_file("hd", "m1"), movie_file("sd", "m1", role="version", width=720, height=480)],
    )
    assert index.release_tiers("r1") == {"hd"}
    files = rc.suggest_files(index, index.releases[0])[0]["files"]
    assert {e["row"].id: e["fit"] for e in files} == {"hd": "fits", "sd": "mismatch"}


def test_a_file_is_offered_once_when_two_targets_overlap():
    index = CoverageIndex(
        releases=[release("r1")],
        contents=[content("r1", "series", "s1", season=1), content("r1", "series", "s1")],
        files=[episode_file("e1", "s1", 1, 1), episode_file("e2", "s1", 2, 1)],
    )
    groups = rc.suggest_files(index, index.releases[0])
    assert [[e["row"].id for e in g["files"]] for g in groups] == [["e1"], ["e2"]]
    assert rc.suggestion_counts(index, index.releases[0]) == {"candidates": 2, "preselected": 2}
