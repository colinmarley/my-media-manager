"""
Tests for services/catalog_stats.py — the aggregation behind
`GET /api/catalog/stats` (issue #16, web stats page), at the builder level.

`tests/test_catalog_stats.py` covers the same figures through the endpoint
with mocked rows; this file drives `build_catalog_stats()` directly with the
real SQLAlchemy models (`Movie`, `Series`, `Disc`, `Tape`), because the
service reads the mirrored columns first and only falls back to `raw_data`:
a `MagicMock` answers every attribute, so it stays green if the service
reads a column that does not exist, mis-orders the two sources, or invents a
key in the payload. No database is needed — the service only reads
attributes.

Issue #16 acceptance criteria -> the tests here.  These are the aggregator
half of AC1 and the "no database" half of AC3; the endpoint-level map lives in
tests/test_catalog_stats.py.

  AC1 "counts by type"            -> test_counts_by_type_totals_and_recent_window,
                                    test_empty_catalog_has_no_buckets
  AC1 "recently added (last 30 days)"
                                  -> test_recent_window_is_inclusive_of_the_requested_days,
                                    test_lists_are_capped_but_the_count_stays_the_whole_total
  AC1 "by disc format"            -> test_disc_format_reads_the_column_then_raw_data_and_ignores_series_and_tapes,
                                    test_disc_format_labels_are_normalised_not_verbatim,
                                    test_unknown_or_missing_disc_format_buckets_as_unspecified
  AC1 "by decade of release"      -> test_decades_prefer_running_years_then_carry_undated,
                                    test_decades_read_the_mirrored_columns_before_raw_data,
                                    test_invalid_year_text_never_opens_a_decade_bucket,
                                    test_the_raw_data_year_fallback_holds_the_same_bounds
  AC1 "with/without a storage location"
                                  -> test_storage_locations_column_and_bare_counts_as_without
  AC1 "lent out"                  -> test_unreturned_loans_count_as_lent_out_whatever_shape_they_are,
                                    test_lent_out_items_carry_the_person_and_the_record_id,
                                    test_returned_or_unreadable_loan_entries_are_not_lent_out,
                                    test_a_return_marker_on_the_record_closes_a_bare_loan,
                                    test_false_or_empty_return_markers_do_not_close_a_bare_loan,
                                    test_an_explicit_false_loan_flag_outranks_a_stale_borrower_name,
                                    test_a_loan_scoped_status_closes_the_loan,
                                    test_a_series_status_is_never_a_loan_marker,
                                    test_a_record_status_in_raw_data_is_not_a_loan_field,
                                    test_both_loan_shapes_are_read_together
  AC3 "backend unit test ... (mocked DB)"
                                  -> every test in this file: the rows are real
                                     Movie/Series/Disc/Tape instances built in
                                     memory and never flushed, so no engine,
                                     session or connection is involved.
"""

from datetime import datetime, timedelta, timezone

import pytest

from db.models import Disc, Movie, Series, Tape
from services.catalog_stats import RECENT_DAYS_DEFAULT, build_catalog_stats

NOW = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)


def _movie(*, id="m1", title="Alien", release_date=None, raw=None, created_at=NOW) -> Movie:
    row = Movie(
        id=id, title=title, release_date=release_date,
        raw_data=raw if raw is not None else {"title": title},
    )
    row.created_at = created_at
    return row


def _series(*, id="s1", title="Babylon 5", status=None, running_years=None, raw=None, created_at=NOW) -> Series:
    row = Series(
        id=id, title=title, status=status, running_years=running_years,
        raw_data=raw if raw is not None else {"title": title},
    )
    row.created_at = created_at
    return row


def _disc(
    *,
    id="d1",
    title="Alien Blu-ray",
    format=None,
    release_date=None,
    storage_id=None,
    storage_type=None,
    raw=None,
    created_at=NOW,
) -> Disc:
    row = Disc(
        id=id, title=title, format=format, release_date=release_date,
        storage_id=storage_id, storage_type=storage_type,
        raw_data=raw if raw is not None else {"title": title},
    )
    row.created_at = created_at
    return row


def _tape(*, id="t1", title="Betamax tape", storage_id=None, storage_type=None, raw=None, created_at=NOW) -> Tape:
    row = Tape(
        id=id, title=title, storage_id=storage_id, storage_type=storage_type,
        raw_data=raw if raw is not None else {"title": title},
    )
    row.created_at = created_at
    return row


# --- counts, windows, lists -------------------------------------------------

def test_counts_by_type_totals_and_recent_window():
    stats = build_catalog_stats(
        movies=[
            _movie(id="m1", title="Alien", created_at=NOW),
            _movie(id="m2", title="Aliens", created_at=NOW - timedelta(days=2)),
            _movie(id="m3", title="Old film", created_at=NOW - timedelta(days=45)),
        ],
        series=[_series(id="s1", title="Babylon 5", created_at=NOW - timedelta(hours=1))],
        discs=[_disc(id="d1", title="Alien 4K", format="BLURAY", created_at=NOW - timedelta(days=3))],
        tapes=[],
        now=NOW,
    )

    assert stats["totalItems"] == 5
    assert stats["byType"] == {"movie": 3, "series": 1, "disc": 1, "tape": 0}
    assert stats["recentDays"] == RECENT_DAYS_DEFAULT
    # 45 days old, so `Old film` is outside the window; newest first.
    assert stats["recentlyAdded"] == {
        "days": RECENT_DAYS_DEFAULT,
        "count": 4,
        "items": [
            {"id": "m1", "title": "Alien", "type": "movie", "createdAt": NOW.isoformat()},
            {"id": "s1", "title": "Babylon 5", "type": "series", "createdAt": (NOW - timedelta(hours=1)).isoformat()},
            {"id": "m2", "title": "Aliens", "type": "movie", "createdAt": (NOW - timedelta(days=2)).isoformat()},
            {"id": "d1", "title": "Alien 4K", "type": "disc", "createdAt": (NOW - timedelta(days=3)).isoformat()},
        ],
    }


def test_recent_window_is_inclusive_of_the_requested_days():
    row = _movie(id="m1", created_at=NOW - timedelta(days=7))
    stats = build_catalog_stats(movies=[row], now=NOW, recent_days=7)

    assert stats["recentlyAdded"] == {
        "days": 7,
        "count": 1,
        "items": [{"id": "m1", "title": "Alien", "type": "movie", "createdAt": (NOW - timedelta(days=7)).isoformat()}],
    }


def test_lists_are_capped_but_the_count_stays_the_whole_total():
    """A UI has to be able to say "showing 12 of 23": `count` is never reduced
    to the size of the list the payload publishes, and no extra key is
    invented to carry the limit."""
    many = [
        _movie(id=f"m{n}", title=f"Alien {n}", raw={"onLoan": True, "loanedTo": "Sam"}, created_at=NOW)
        for n in range(1, 24)
    ]
    stats = build_catalog_stats(movies=many, now=NOW)

    assert stats["recentlyAdded"]["count"] == 23
    assert len(stats["recentlyAdded"]["items"]) == 12
    assert stats["lentOut"]["count"] == 23
    assert len(stats["lentOut"]["items"]) == 12
    assert stats["recentlyAdded"].keys() == {"days", "count", "items"}
    assert stats["lentOut"].keys() == {"count", "items"}


def test_empty_catalog_has_no_buckets():
    stats = build_catalog_stats(now=NOW)

    assert stats["totalItems"] == 0
    assert stats["byType"] == {"movie": 0, "series": 0, "disc": 0, "tape": 0}
    assert stats["byDiscFormat"] == []
    assert stats["byDecade"] == []
    assert stats["recentlyAdded"] == {"days": RECENT_DAYS_DEFAULT, "count": 0, "items": []}
    assert stats["storage"] == {"total": 0, "withLocation": 0, "withoutLocation": 0, "byType": []}
    assert stats["lentOut"] == {"count": 0, "items": []}


# --- disc format ------------------------------------------------------------

def test_disc_format_reads_the_column_then_raw_data_and_ignores_series_and_tapes():
    stats = build_catalog_stats(
        discs=[
            _disc(id="d1", title="a", format="BLURAY"),
            _disc(id="d2", title="b", raw={"format": "Blu-ray"}),      # column unset, raw_data only
            _disc(id="d3", title="c", format="DVD"),
        ],
        series=[
            _series(id="s1", status="Continuing"),
            _series(id="s2", status="Ended"),
            _series(id="s3", raw={"status": "Continuing"}),
            _series(id="s4"),
        ],
        tapes=[_tape(id="t1"), _tape(id="t2")],
        now=NOW,
    )

    assert stats["byDiscFormat"] == [{"label": "Blu-ray", "count": 2}, {"label": "DVD", "count": 1}]
    assert stats["totalItems"] == 3 + 4 + 2


def test_disc_format_labels_are_normalised_not_verbatim():
    """The web form writes its own enum values ("BLURAY", "UHD_BLURAY") while
    imported JSONB says "Blu-ray" or "Blu Ray"; verbatim strings opened four
    bars for one format."""
    stats = build_catalog_stats(
        discs=[
            _disc(id="d1", format="BLURAY"),
            _disc(id="d2", format=" Blu-ray "),
            _disc(id="d3", format="Blu Ray"),
            _disc(id="d4", raw={"format": "bluray"}),
            _disc(id="d5", format="UHD_BLURAY"),
            _disc(id="d6", format="4K UHD Blu-ray"),
            _disc(id="d7", format=" dvd "),
            _disc(id="d8", format="LASERDISC"),
            _disc(id="d9", format="SACD  Stereo"),
        ],
        now=NOW,
    )

    assert {item["label"]: item["count"] for item in stats["byDiscFormat"]} == {
        "Blu-ray": 4,
        "4K UHD Blu-ray": 2,
        "DVD": 1,
        "LaserDisc": 1,
        "SACD Stereo": 1,      # unknown wording is kept, only whitespace collapsed
    }


def test_unknown_or_missing_disc_format_buckets_as_unspecified():
    stats = build_catalog_stats(
        discs=[_disc(id="d1"), _disc(id="d2", format="   "), _disc(id="d3", raw={"format": ""})],
        now=NOW,
    )

    assert stats["byDiscFormat"] == [{"label": "Unspecified", "count": 3}]


# --- release years ----------------------------------------------------------

def test_decades_prefer_running_years_then_carry_undated():
    stats = build_catalog_stats(
        movies=[
            _movie(id="m1", release_date="1979-05-25"),
            _movie(id="m2", release_date="1979"),
            _movie(id="m3", release_date="1982"),
            _movie(id="m4"),
            _movie(id="m5", release_date="not a date"),
        ],
        discs=[_disc(id="d1", release_date="2010-06-15T00:00:00.000Z")],
        series=[
            _series(id="s1", running_years="1993–1998"),
            _series(id="s2", running_years=1993),
            _series(id="s3", raw={"runningYears": [2002, 2008]}),
        ],
        now=NOW,
    )

    assert stats["byDecade"] == [
        {"label": "1970s", "startYear": 1970, "count": 2},
        {"label": "1980s", "startYear": 1980, "count": 1},
        {"label": "1990s", "startYear": 1990, "count": 2},
        {"label": "2000s", "startYear": 2000, "count": 1},
        {"label": "2010s", "startYear": 2010, "count": 1},
    ]
    assert stats["undated"] == 2


def test_decades_read_the_mirrored_columns_before_raw_data():
    """`release_date`/`running_years`/`format` are what the list and search
    endpoints filter on, so they win when the JSONB copy disagrees."""
    stats = build_catalog_stats(
        movies=[_movie(id="m1", release_date="1979-05-25", raw={"releaseDate": "2003-01-01"})],
        series=[_series(id="s1", running_years="1993–1998", raw={"runningYears": [1970]})],
        discs=[_disc(id="d1", format="BLURAY", release_date="2010-06-15", raw={"format": "VHS", "releaseDate": "1980"})],
        now=NOW,
    )

    assert stats["byDecade"] == [
        {"label": "1970s", "startYear": 1970, "count": 1},
        {"label": "1990s", "startYear": 1990, "count": 1},
        {"label": "2010s", "startYear": 2010, "count": 1},
    ]
    assert stats["byDiscFormat"] == [{"label": "Blu-ray", "count": 1}]


def test_invalid_year_text_never_opens_a_decade_bucket():
    """A loose four-digit *search* turned inventory codes and DD/MM dates into
    decades: "SP-1234" opened a "1230s" bar and stopped that record from being
    counted as undated."""
    stats = build_catalog_stats(
        movies=[
            _movie(id="m1", release_date="SP-1234"),
            _movie(id="m2", release_date="12/03/2026"),
            _movie(id="m3", release_date="Disk 1979"),
            _movie(id="m4", release_date="1262304000"),
            _movie(id="m5", release_date="19, 79"),
            _movie(id="m6", release_date="2030s"),
            _movie(id="m7", release_date="1889"),
        ],
        discs=[_disc(id="d1", release_date="2035-01-01")],
        now=NOW,
    )

    assert stats["byDecade"] == []
    assert stats["undated"] == 8


def test_the_raw_data_year_fallback_holds_the_same_bounds():
    """Free text in the JSONB document is scanned for a year rather than
    matched against it — "Berserk 1997" and "1979–1983" both count — but the
    plausibility bounds still apply, so an inventory code stays undated."""
    stats = build_catalog_stats(
        movies=[_movie(id="m1", raw={"releaseDate": "SP-1234"}), _movie(id="m2", raw={"year": "1262304000"})],
        series=[_series(id="s1", raw={"runningYears": "Berserk 1997"})],
        now=NOW,
    )

    assert stats["byDecade"] == [{"label": "1990s", "startYear": 1990, "count": 1}]
    assert stats["undated"] == 2


# --- storage locations ------------------------------------------------------

def test_storage_locations_column_and_bare_counts_as_without():
    stats = build_catalog_stats(
        discs=[
            _disc(id="d1", storage_type="Box", storage_id="box-1"),
            _disc(id="d2", raw={"storageType": "Binder", "storageId": "b-1"}),   # raw_data only
            _disc(id="d3", storage_type="Box"),                                  # no storage_id
            _disc(id="d4", storage_type="Box", storage_id="box-2"),
        ],
        tapes=[_tape(id="t1", storage_type="Cabinet", storage_id="c-1")],
        now=NOW,
    )

    assert stats["storage"] == {
        "total": 5,
        "withLocation": 4,
        "withoutLocation": 1,
        # most-used first, ties alphabetically
        "byType": [{"label": "Box", "count": 2}, {"label": "Binder", "count": 1}, {"label": "Cabinet", "count": 1}],
    }


# --- lent out ---------------------------------------------------------------
# Loans have no column and no table: mobile writes them into the record's own
# raw_data document, either as a `loans` array or as bare `loanedTo`/`onLoan`
# fields. services/catalog_stats.py states the contract next to the code.

@pytest.mark.parametrize(
    "raw",
    [
        {"loans": [{"loanedTo": "Sam"}]},
        {"loans": [{"loanedTo": "Sam", "loanedAt": "2026-01-04T00:00:00.000Z"}]},
        {"loans": [{"loanedTo": "Bo", "date": "2026-01-04T00:00:00.000Z"}]},
        {"loans": [{"loanedTo": "Bo", "dateOut": "2026-01-04", "due": "2026-03-01"}]},
        {"loans": [{"loanedTo": {"name": "Bo"}}]},                    # nested borrower
        {"loans": [{"loanedTo": "Bo", "status": "active"}]},
        {"loans": {"loanedTo": "Cy"}},                                # one object, not a list
        {"loanHistory": [{"borrower": "Dee"}]},                       # mobile's other key
        {"onLoanTo": "Dan"},
        {"loanedTo": "Sam"},
        {"lentTo": "Ana"},
        {"onLoan": True},
    ],
)
def test_unreturned_loans_count_as_lent_out_whatever_shape_they_are(raw):
    stats = build_catalog_stats(discs=[_disc(id="d1", title="Alien LaserDisc", raw=raw)], now=NOW)

    assert stats["lentOut"]["count"] == 1
    assert stats["lentOut"]["items"][0]["type"] == "disc"
    assert stats["lentOut"]["items"][0]["title"] == "Alien LaserDisc"


@pytest.mark.parametrize(
    "raw,borrower",
    [
        ({"loans": [{"borrower": "Bo"}]}, "Bo"),
        ({"loans": [{"loanedTo": "Sam", "loanedAt": "2026-01-04T00:00:00.000Z"}]}, "Sam"),
        ({"loans": [{"loanedTo": {"name": "Bo"}}]}, "Bo"),
        ({"loans": [{"who": {"name": "Ed"}}]}, "Ed"),
        ({"lentTo": "Ana"}, "Ana"),
        ({"onLoan": True}, "Unspecified"),        # a flag only: borrower unrecorded
    ],
)
def test_lent_out_items_carry_the_person_and_the_record_id(raw, borrower):
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {
        "count": 1,
        "items": [{"id": "d1", "title": "Alien Blu-ray", "type": "disc", "borrower": borrower}],
    }


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"loans": []},
        {"loans": ["not-a-dict"]},
        {"loans": "on loan"},                      # wrong type entirely
        {"loans": [{"loanedTo": "Sam", "returnedAt": "2026-02-04T00:00:00.000Z"}]},
        {"loans": [{"loanedTo": "Bo", "returned": "2026-02-04"}]},
        {"loans": [{"loanedTo": "Bo", "returned": True}]},
        {"loans": [{"loanedTo": "Bo", "isReturned": True}]},
        {"loans": [{"loanedTo": "Bo", "status": "returned"}]},
        {"loans": [{"loanedTo": "Bo", "status": "Back"}]},
        {"loans": [{"loanedTo": "Bo", "loanStatus": "returned"}]},
        {"loans": [{"loanedTo": "Bo", "dateBack": "2026-02-04"}]},
    ],
)
def test_returned_or_unreadable_loan_entries_are_not_lent_out(raw):
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {"count": 0, "items": []}


@pytest.mark.parametrize(
    "raw",
    [
        # The shape that used to read as "still out" for good: a bare field
        # plus a return marker, which is what mobile writes when someone taps
        # "returned" on a record that has no loans array.
        {"loanedTo": "Sam", "loanedAt": "2026-01-04", "returnedAt": "2026-02-04"},
        {"loanedTo": "Sam", "dateBack": "2026-02-04"},
        {"onLoanTo": "Dan", "returnDate": "2026-02-04"},
        {"lentTo": "Cy", "returnedOn": "2026-02-04"},
        {"borrower": "Dee", "dateReturned": "2026-02-04"},
        {"loanedTo": "Sam", "returned": True},     # a boolean, not a date
        {"loanedTo": "Sam", "isReturned": True},
        {"loanedTo": "Sam", "returnToOwner": True},
    ],
)
def test_a_return_marker_on_the_record_closes_a_bare_loan(raw):
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {"count": 0, "items": []}


@pytest.mark.parametrize(
    "raw,borrower",
    [
        ({"loanedTo": "Sam", "returned": False}, "Sam"),          # marker present but false
        ({"onLoanTo": "Dan", "dateBack": False}, "Dan"),
        ({"loanedTo": "Sam", "returnedAt": ""}, "Sam"),           # marker present but empty
        ({"loanedTo": "Sam", "returned": "false"}, "Sam"),
        ({"loanedTo": None, "returnedAt": None, "dateBack": False, "onLoanTo": "Dan"}, "Dan"),
    ],
)
def test_false_or_empty_return_markers_do_not_close_a_bare_loan(raw, borrower):
    """A return marker only closes a loan when it carries something: mobile
    leaves `returnedAt: None` / `dateBack: False` on records that are still
    out, and reading those as returns hid every bare-field loan."""
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {
        "count": 1,
        "items": [{"id": "d1", "title": "Alien Blu-ray", "type": "disc", "borrower": borrower}],
    }


@pytest.mark.parametrize(
    "raw",
    [
        {"onLoan": False, "loanedTo": "Ana"},         # explicit "it is home"
        {"loanOut": False, "borrower": "Bo"},
        {"onLoan": "false", "lentTo": "Cy"},
        {"isLent": 0, "loanedTo": "Dee"},
    ],
)
def test_an_explicit_false_loan_flag_outranks_a_stale_borrower_name(raw):
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {"count": 0, "items": []}


@pytest.mark.parametrize(
    "raw",
    [
        {"loanStatus": "returned", "loanedTo": "Sam"},
        {"loanState": "back", "onLoanTo": "Dan"},
        {"loans": [{"loanedTo": "Bo", "loanStatus": "returned"}]},
    ],
)
def test_a_loan_scoped_status_closes_the_loan(raw):
    stats = build_catalog_stats(discs=[_disc(id="d1", raw=raw)], now=NOW)

    assert stats["lentOut"] == {"count": 0, "items": []}


@pytest.mark.parametrize("status", ["Ended", "Cancelled", "Upcoming", "Continuing"])
def test_a_series_status_is_never_a_loan_marker(status):
    """A status is only ever read from loan keys. On a series the record's own
    `status` means the show stopped airing — it neither returns a loan nor
    opens one."""
    out = build_catalog_stats(series=[_series(id="s1", status=status, raw={"loanedTo": "Sam"})], now=NOW)

    assert out["lentOut"] == {
        "count": 1,
        "items": [{"id": "s1", "title": "Babylon 5", "type": "series", "borrower": "Sam"}],
    }

    home = build_catalog_stats(
        series=[_series(id="s1", status=status, raw={"loanedTo": "Sam", "returnedAt": "2026-02-04"})], now=NOW
    )
    assert home["lentOut"] == {"count": 0, "items": []}


def test_a_record_status_in_raw_data_is_not_a_loan_field():
    """`status: "returned"` in a movie document reads like a return but is not
    a loan key, so it must not close the bare loan beside it."""
    stats = build_catalog_stats(movies=[_movie(id="m1", raw={"status": "returned", "loanedTo": "Sam"})], now=NOW)

    assert stats["lentOut"]["count"] == 1
    assert stats["lentOut"]["items"][0]["borrower"] == "Sam"


def test_both_loan_shapes_are_read_together():
    """Newest open entry of the array wins; a closed array does not hide a
    bare field written afterwards, and a bare `returned: true` does not hide
    an array entry that is still open."""
    closed_then_open = _movie(id="m1", title="Alien 3", raw={
        "loans": [{"loanedTo": "Sam", "returnedAt": "2026-01-02"}, {"loanedTo": "Kim"}],
    })
    open_array_bare_return = _movie(id="m2", title="Alien Quadrilogy", raw={
        "loans": [{"loanedTo": "Bo"}], "returned": True,
    })
    closed_array_bare_field = _movie(id="m3", title="Alien Quadrilogy LaserDisc", raw={
        "loans": [{"loanedTo": "Bo", "returnedAt": "2026-01-02"}], "lentTo": "Ana",
    })

    stats = build_catalog_stats(movies=[closed_then_open, open_array_bare_return, closed_array_bare_field], now=NOW)

    assert stats["lentOut"]["count"] == 3
    assert {item["borrower"] for item in stats["lentOut"]["items"]} == {"Kim", "Bo", "Ana"}
