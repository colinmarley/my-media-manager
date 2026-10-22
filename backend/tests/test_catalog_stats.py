"""
Tests for GET /api/catalog/stats (issue #16 — web stats page).

Uses the same mocked-AsyncSession pattern as test_catalog.py, so no real
database is required.

Issue #16 acceptance criteria -> the test that covers it:
  AC1 GET /api/catalog/stats returns collection counts:
        test_stats_returns_counts_by_type_and_totals
  AC2 by disc format / by release decade:
        test_stats_groups_disc_formats_and_release_decades
  AC3 recently added (last 30 days):
        test_stats_recently_added_covers_only_the_last_thirty_days
  AC4 with / without storage location:
        test_stats_counts_storage_location_coverage
  AC5 lent out items:
        test_stats_counts_lent_out_items_and_skips_returned_loans
        test_stats_reads_open_loans_from_the_mobile_loan_array
        test_stats_skips_a_returned_bare_field_loan

The row fixtures here are mocks standing in for `scalars().all()` results, so
the same figures are re-checked against real Movie/Series/Disc/Tape objects
in tests/test_catalog_stats_builder.py (builder level) and in
tests/test_catalog_stats_qa_probes.py.
"""

from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient

from db.database import get_db


# ---------------------------------------------------------------------------
# Helpers — rows stand in for Movie/Series/Disc/Tape ORM objects
# ---------------------------------------------------------------------------

def _row(id: str, title: str, *, created_at: datetime | None = None, **attrs) -> MagicMock:
    """A stand-in ORM row: the columns the aggregator reads, defaulted to
    unset so a MagicMock never answers with an auto-created attribute."""
    row = MagicMock()
    row.id = id
    row.title = title
    row.created_at = created_at if created_at is not None else datetime.now(timezone.utc)
    row.raw_data = {"title": title, **attrs.pop("raw_data", {})}
    for column in ("release_date", "running_years", "format", "storage_type", "storage_id"):
        setattr(row, column, None)
    for name, value in attrs.items():
        setattr(row, name, value)
    return row


def _make_sequential_db(*row_lists):
    """One execute() -> one result, in order (the stats endpoint runs one
    select per catalog table)."""
    session = AsyncMock()
    results = []
    for rows in row_lists:
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        results.append(result)
    session.execute = AsyncMock(side_effect=results)
    return session



async def _get_stats(app, db, url: str = "/api/catalog/stats") -> dict:
    async def override():
        yield db

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get(url)
        assert resp.status_code == 200, resp.text
        return resp.json()
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


# ===========================================================================

def _sample_rows():
    now = datetime.now(timezone.utc)
    movies = [
        _row("m1", "Alien", raw_data={"year": 1979}, created_at=now - timedelta(days=1)),
        _row("m2", "Mad Max: Fury Road", release_date="2015-05-15", created_at=now - timedelta(days=200)),
    ]
    series = [
        _row("s1", "Alien: Is It Worth It?", running_years=["1979", "1983"], created_at=now - timedelta(days=5)),
    ]
    discs = [
        _row("d1", "Alien 4K", format="Blu-ray", release_date="2018-10-02",
             storage_type="Box", storage_id="MED0001", created_at=now - timedelta(days=2)),
        _row("d2", "Alien LaserDisc", format="LaserDisc", release_date="1979",
             created_at=now - timedelta(days=900)),
        _row("d3", "Mad Max Blu-ray", format="Blu-ray", raw_data={"loanedTo": "Sam"},
             created_at=now - timedelta(days=3)),
    ]
    tapes = [
        _row("t1", "Mad Max VHS", storage_type="Binder", storage_id="BOX-B",
             raw_data={"loans": [{"loanedTo": "Alex", "loanedAt": "2026-01-02", "returnedAt": "2026-02-01"}]},
             created_at=now - timedelta(days=400)),
    ]
    return movies, series, discs, tapes


@pytest.mark.asyncio
async def test_stats_returns_counts_by_type_and_totals(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes))

    assert stats["byType"] == {"movie": 2, "series": 1, "disc": 3, "tape": 1}
    assert stats["totalItems"] == 7
    assert stats["recentDays"] == 30
    assert set(stats) >= {
        "generatedAt", "byDiscFormat", "byDecade",
        "recentlyAdded", "storage", "lentOut",
    }


@pytest.mark.asyncio
async def test_stats_groups_disc_formats_and_release_decades(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes))

    assert stats["byDiscFormat"] == [{"label": "Blu-ray", "count": 2}, {"label": "LaserDisc", "count": 1}]
    # 1979 (movie), 1979 (series first running year), 2018 + 1979 (discs)
    assert stats["byDecade"] == [
        {"label": "1970s", "startYear": 1970, "count": 3},
        {"label": "2010s", "startYear": 2010, "count": 2},
    ]
    assert stats["undated"] == 1  # d3 has no release year anywhere


@pytest.mark.asyncio
async def test_stats_recently_added_covers_only_the_last_thirty_days(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes))

    recent = stats["recentlyAdded"]
    assert recent["days"] == 30
    assert recent["count"] == 4  # m2 (200d), d2 (900d) and t1 (400d) are older
    assert [item["id"] for item in recent["items"]] == ["m1", "d1", "d3", "s1"]
    assert all(item["type"] in {"movie", "series", "disc", "tape"} for item in recent["items"])
    assert recent["items"][0]["title"] == "Alien"
    created = [item["createdAt"] for item in recent["items"]]
    assert created == sorted(created, reverse=True)


@pytest.mark.asyncio
async def test_stats_recent_window_is_configurable(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes),
                             url="/api/catalog/stats?recent_days=4")

    assert stats["recentlyAdded"]["days"] == 4
    assert [item["id"] for item in stats["recentlyAdded"]["items"]] == ["m1", "d1", "d3"]


@pytest.mark.asyncio
async def test_stats_counts_storage_location_coverage(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes))

    assert stats["storage"] == {
        "total": 4,                      # 3 discs + 1 tape; movies/series have no shelf
        "withLocation": 2,
        "withoutLocation": 2,
        "byType": [{"label": "Binder", "count": 1}, {"label": "Box", "count": 1}],
    }


@pytest.mark.asyncio
async def test_stats_counts_lent_out_items_and_skips_returned_loans(app):
    movies, series, discs, tapes = _sample_rows()
    stats = await _get_stats(app, _make_sequential_db(movies, series, discs, tapes))

    assert stats["lentOut"]["count"] == 1
    assert stats["lentOut"]["items"] == [
        {"id": "d3", "title": "Mad Max Blu-ray", "type": "disc", "borrower": "Sam"}
    ]


@pytest.mark.asyncio
async def test_stats_reads_open_loans_from_the_mobile_loan_array(app):
    """Loans have no column — they live in raw_data. The newest unreturned
    entry counts as out; a returned one (or `status: returned`) doesn't."""
    discs = [
        _row("d1", "Out For A Ride", raw_data={"loans": [
            {"loanedTo": "Ana", "loanedAt": "2026-01-05"},
            {"loanedTo": "Ben", "loanedAt": "2026-01-01", "returnedAt": "2026-01-04"},
        ]}),
        _row("d2", "Flagged As Out", raw_data={"onLoan": True}),
        _row("d3", "Kept At Home", raw_data={"loans": [{"loanedTo": "Jo", "status": "returned"}]}),
    ]
    stats = await _get_stats(app, _make_sequential_db([], [], discs, []))

    assert stats["lentOut"]["count"] == 2
    assert [(item["title"], item["borrower"]) for item in stats["lentOut"]["items"]] == [
        ("Flagged As Out", "Unspecified"),
        ("Out For A Ride", "Ana"),
    ]


@pytest.mark.asyncio
async def test_stats_skips_a_returned_bare_field_loan(app):
    """Loans are written into `raw_data` either as a `loans` array or as bare
    fields, and a bare loan closed by `returnedAt` (or `onLoan: false`) is
    home: mobile keeps the borrower name on the record after it is returned."""
    discs = [
        _row("d1", "Home Again", raw_data={"loanedTo": "Sam", "loanedAt": "2026-01-04", "returnedAt": "2026-02-04"}),
        _row("d2", "Flagged Back", raw_data={"onLoan": False, "loanedTo": "Ana"}),
        _row("d3", "Still Out", raw_data={"loanedTo": "Bo", "loanedAt": "2026-01-04"}),
    ]
    stats = await _get_stats(app, _make_sequential_db([], [], discs, []))

    assert stats["lentOut"] == {
        "count": 1,
        "items": [{"id": "d3", "title": "Still Out", "type": "disc", "borrower": "Bo"}],
    }


@pytest.mark.asyncio
async def test_stats_caps_its_item_lists_but_not_the_counts(app):
    """`recentlyAdded.items` / `lentOut.items` are capped at twelve, `count`
    stays the whole total, and no extra key carries the limit — the page
    derives "showing 12 of 23" from the two figures it already has."""
    discs = [_row(f"d{n}", f"Disc {n}", raw_data={"loanedTo": "Sam"}) for n in range(1, 24)]
    stats = await _get_stats(app, _make_sequential_db([], [], discs, []))

    assert stats["recentlyAdded"]["count"] == 23
    assert len(stats["recentlyAdded"]["items"]) == 12
    assert stats["lentOut"]["count"] == 23
    assert len(stats["lentOut"]["items"]) == 12


@pytest.mark.asyncio
async def test_stats_on_an_empty_catalog(app):
    stats = await _get_stats(app, _make_sequential_db([], [], [], []))

    assert stats["totalItems"] == 0
    assert stats["byType"] == {"movie": 0, "series": 0, "disc": 0, "tape": 0}
    assert stats["byDiscFormat"] == []
    assert stats["byDecade"] == []
    assert stats["recentlyAdded"] == {"days": 30, "count": 0, "items": []}
    assert stats["storage"] == {"total": 0, "withLocation": 0, "withoutLocation": 0, "byType": []}
    assert stats["lentOut"] == {"count": 0, "items": []}
