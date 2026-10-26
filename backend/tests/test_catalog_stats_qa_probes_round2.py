"""
Round-2 QA probes for issue #16 (web Stats page parity).

Round 1 (test_catalog_stats_qa_probes.py) pinned route registration, the
recently-added boundary, recent_days validation and the loan shapes. What
was still open after the rework:

  * the HTTP endpoint was only ever driven with empty lists or MagicMocks —
    never with real ORM rows, so nothing proved the whole path (route ->
    one select per table -> aggregator -> FastAPI serialisation) on rows
    shaped like the ones Postgres returns;
  * lent-out coverage was disc/movie centred — a tape or a series on loan
    was never asserted;
  * rows with `raw_data` NULL (the column is nullable) or `created_at` NULL,
    and naive datetimes (what SQLite and hand-built rows give back), were
    never fed through anything;
  * the twelve-item cap was only checked at the builder level, never through
    the endpoint the page calls.

Note the endpoint takes no clock: `build_catalog_stats(now=...)` is only for
tests, and the route leaves it out — so these probes build their rows off
the real wall clock instead of a fixed date.

Issue #16 acceptance criteria -> the tests here (issue #16):

  AC1 "A backend endpoint `GET /api/catalog/stats`: counts by type, by disc
      format, by decade of release, recently added (last 30 days),
      with/without a storage location, lent out."
      the whole path — route, one select per catalog table, aggregator, FastAPI
      serialisation — over real ORM rows
        -> backend/tests/test_catalog_stats_qa_probes_round2.py::test_endpoint_aggregates_real_orm_rows_end_to_end
      recently added (last 30 days): the window reaches the aggregator, the
      boundary is inclusive, NULL created_at rows are counted but never recent,
      naive datetimes are read as UTC
        -> ::test_recent_days_window_reaches_the_aggregator,
           ::test_window_is_inclusive_exactly_at_the_boundary,
           ::test_null_created_at_rows_are_counted_but_never_recent,
           ::test_naive_created_at_is_treated_as_utc
      lent out on every catalog type, and a nested borrower with no name
        -> ::test_every_catalog_type_can_be_reported_as_lent_out,
           ::test_nested_borrower_without_a_name_is_unspecified
      item lists capped at twelve while the count stays the whole total
        -> ::test_endpoint_caps_both_lists_but_keeps_the_whole_count
      NULL raw_data (the column is nullable) breaks no figure
        -> ::test_null_raw_data_column_does_not_break_any_figure

  AC3 "Backend unit test for the endpoint (mocked DB) ..."
        -> every test here drives the route through an AsyncMock session
           injected with the `get_db` override; no database is contacted.

AC2 (the /dashboard/stats page and its nav link) is traced in the frontend:
tests/components/CatalogStatsPage.test.tsx, tests/components/CatalogStatsPageRound2.test.tsx,
tests/components/AppShellNav.test.tsx.
"""

from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient

from db.database import get_db
from db.models import Disc, Movie, Series, Tape
from services.catalog_stats import build_catalog_stats

REAL_NOW = datetime.now(timezone.utc)
NOW = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)  # builder-level probes only

TABLES = {"movie": "movies", "series": "series", "disc": "discs", "tape": "tapes"}


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _session(*row_lists):
    """One execute() -> one result, in the endpoint's select order."""
    session = AsyncMock()
    results = []
    for rows in row_lists:
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        results.append(result)
    session.execute = AsyncMock(side_effect=results)
    return session


async def _get(app, db, url="/api/catalog/stats"):
    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            return await ac.get(url)
    finally:
        app.dependency_overrides.clear()


def _ago(**kwargs):
    return REAL_NOW - timedelta(**kwargs)


# ---------------------------------------------------------------------------
# Probe 1 — the whole endpoint path on real ORM rows.
# ---------------------------------------------------------------------------

async def test_endpoint_aggregates_real_orm_rows_end_to_end(app):
    movies = [
        Movie(id="m1", title="Alien", release_date="1979-06-28", raw_data={},
              created_at=_ago(days=3)),
        Movie(id="m2", title="No JSONB at all", raw_data=None, created_at=_ago(days=1)),
    ]
    series = [
        # An ended show on loan: the record's own `status` must not read as a
        # loan return, and it must not open a loan either.
        Series(id="s1", title="Firefly", status="Ended", running_years=["2002", "2003"],
               raw_data={"loanedTo": "Zoe"}, created_at=_ago(days=200)),
    ]
    discs = [
        Disc(id="d1", title="Alien 4K", format="BLURAY", release_date="2018-10-02",
             storage_type="Box", storage_id="MED0001", raw_data={},
             created_at=_ago(hours=6)),
        Disc(id="d2", title="Blank shelf", format="  ", storage_type="  ", storage_id="",
             raw_data={}, created_at=_ago(days=2)),
    ]
    tapes = [
        Tape(id="t1", title="Home video", tape_type="VHS", raw_data={"onLoan": True},
             created_at=_ago(days=10)),
        # NULL created_at: it is in the catalog, it just cannot be "recent".
        Tape(id="t2", title="Undated tape", tape_type="vhs", raw_data={}, created_at=None),
    ]

    resp = await _get(app, _session(movies, series, discs, tapes))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["totalItems"] == 7
    assert body["byType"] == {"movie": 2, "series": 1, "disc": 2, "tape": 2}
    assert body["recentDays"] == 30

    # 1979 (movie column), 2002 (series running_years), 2018 (disc column).
    # Tapes have no release year at all, so they stay out of the chart.
    assert body["byDecade"] == [
        {"label": "1970s", "startYear": 1970, "count": 1},
        {"label": "2000s", "startYear": 2000, "count": 1},
        {"label": "2010s", "startYear": 2010, "count": 1},
    ]
    assert body["undated"] == 2
    assert body["undated"] + sum(b["count"] for b in body["byDecade"]) == 5  # movies+series+discs

    assert body["byDiscFormat"] == [{"label": "Blu-ray", "count": 1}, {"label": "Unspecified", "count": 1}]

    assert body["storage"] == {
        "total": 4, "withLocation": 1, "withoutLocation": 3,
        "byType": [{"label": "Box", "count": 1}],
    }

    # s1 (200 days) is outside the window, t2 has no timestamp at all.
    assert body["recentlyAdded"]["count"] == 5
    assert [item["id"] for item in body["recentlyAdded"]["items"]] == ["d1", "m2", "d2", "m1", "t1"]

    assert body["lentOut"]["count"] == 2
    assert {i["id"]: (i["type"], i["borrower"]) for i in body["lentOut"]["items"]} == {
        "s1": ("series", "Zoe"),
        "t1": ("tape", "Unspecified"),
    }


async def test_endpoint_caps_both_lists_but_keeps_the_whole_count(app):
    movies = [
        Movie(id=f"m{n}", title=f"Lent title {n}", raw_data={"loanedTo": "Sam"},
              created_at=_ago(minutes=n))
        for n in range(1, 26)
    ]
    body = (await _get(app, _session(movies, [], [], []))).json()

    assert body["totalItems"] == 25
    assert body["recentlyAdded"]["count"] == 25
    assert len(body["recentlyAdded"]["items"]) == 12
    assert body["lentOut"]["count"] == 25
    assert len(body["lentOut"]["items"]) == 12


async def test_recent_days_window_reaches_the_aggregator(app):
    """`?recent_days=7` has to move the boundary, not just echo back in `recentDays`."""
    rows = [
        Movie(id="week", title="New this week", raw_data={}, created_at=_ago(days=6, hours=12)),
        Movie(id="month", title="Three weeks old", raw_data={}, created_at=_ago(days=21)),
    ]

    seven = (await _get(app, _session(rows, [], [], []), "/api/catalog/stats?recent_days=7")).json()
    assert seven["recentDays"] == 7
    assert seven["recentlyAdded"]["count"] == 1
    assert seven["recentlyAdded"]["items"][0]["id"] == "week"

    thirty = (await _get(app, _session(rows, [], [], []))).json()
    assert thirty["recentDays"] == 30
    assert thirty["recentlyAdded"]["count"] == 2


# ---------------------------------------------------------------------------
# Probe 2 — every catalog type can be on loan.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("kind,raw,borrower", [
    ("movie", {"loanedTo": "Sam"}, "Sam"),
    ("series", {"loans": [{"borrower": "Kim"}]}, "Kim"),
    ("disc", {"onLoan": True}, "Unspecified"),
    ("tape", {"loanHistory": [{"loanedTo": "Bo", "dateBack": ""}]}, "Bo"),
])
def test_every_catalog_type_can_be_reported_as_lent_out(kind, raw, borrower):
    model = {"movie": Movie, "series": Series, "disc": Disc, "tape": Tape}[kind]
    stats = build_catalog_stats(now=NOW, **{TABLES[kind]: [model(id="x", title="X", raw_data=raw)]})

    assert stats["lentOut"] == {
        "count": 1,
        "items": [{"id": "x", "title": "X", "type": kind, "borrower": borrower}],
    }


def test_nested_borrower_without_a_name_is_unspecified():
    stats = build_catalog_stats(
        discs=[Disc(id="d1", title="D", raw_data={"loans": [{"loanedTo": {}}]})], now=NOW,
    )
    assert stats["lentOut"]["items"][0]["borrower"] == "Unspecified"


# ---------------------------------------------------------------------------
# Probe 3 — NULL / naive timestamps.
# ---------------------------------------------------------------------------

def test_null_created_at_rows_are_counted_but_never_recent():
    stats = build_catalog_stats(
        tapes=[Tape(id="t1", title="No timestamp", raw_data={}, created_at=None)],
        movies=[Movie(id="m1", title="Alien", raw_data={}, created_at=NOW)],
        now=NOW,
    )
    assert stats["totalItems"] == 2
    assert stats["recentlyAdded"]["count"] == 1
    assert stats["recentlyAdded"]["items"][0]["id"] == "m1"


def test_naive_created_at_is_treated_as_utc():
    """A naive datetime (SQLite, hand-built rows) has no offset; assuming the
    machine's local one would move records in and out of the 30-day window."""
    stats = build_catalog_stats(
        discs=[
            Disc(id="in", title="In", raw_data={}, created_at=datetime(2026, 2, 20, 12, 0)),
            Disc(id="out", title="Out", raw_data={}, created_at=datetime(2026, 1, 1, 12, 0)),
        ],
        now=NOW,
    )
    assert stats["recentlyAdded"]["count"] == 1
    assert stats["recentlyAdded"]["items"][0]["id"] == "in"


def test_window_is_inclusive_exactly_at_the_boundary():
    stats = build_catalog_stats(
        discs=[
            Disc(id="edge", title="Edge", raw_data={}, created_at=NOW - timedelta(days=30)),
            Disc(id="past", title="Past", raw_data={}, created_at=NOW - timedelta(days=30, seconds=1)),
        ],
        now=NOW,
    )
    assert stats["recentlyAdded"]["count"] == 1
    assert stats["recentlyAdded"]["items"][0]["id"] == "edge"


# ---------------------------------------------------------------------------
# Probe 4 — a NULL raw_data column must not crash the aggregator.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("kind", ["movie", "series", "disc", "tape"])
def test_null_raw_data_column_does_not_break_any_figure(kind):
    model = {"movie": Movie, "series": Series, "disc": Disc, "tape": Tape}[kind]
    stats = build_catalog_stats(now=NOW, **{TABLES[kind]: [model(id="x", title="X", raw_data=None, created_at=NOW)]})

    assert stats["totalItems"] == 1
    assert stats["byType"][kind] == 1
    assert stats["lentOut"] == {"count": 0, "items": []}
    assert stats["recentlyAdded"]["count"] == 1
