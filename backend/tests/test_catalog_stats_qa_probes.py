"""
QA probes for GET /api/catalog/stats (issue #16 — web Stats page parity).

These complement builder/tests/test_catalog_stats.py rather than repeating
it. What that file does NOT do is exercise the real ORM classes: every row
in it is a MagicMock with the handful of columns the aggregator happens to
read pre-set to None, so a rename in db/models.py, a column the aggregator
never sets, or a real-instance default would pass there and be wrong in
production. Probe 2 pins that with actual Movie/Series/Disc/Tape objects.

The rest pin the things the mocked tests leave open: route registration and
ordering (a `/api/catalog/{id}`-style route placed earlier would swallow
/stats), the recently-added window boundary, recent_days validation, and
the loan shapes the "lent out" figure is inferred from.

Two probes are marked xfail(strict=True): they document a real defect found
during QA (a returned bare-field loan still counts as lent out). Strict so
that the moment the defect is fixed the suite fails until the marker comes
off — the fix must come with the marker's removal, not a silent XPASS.
"""

from datetime import datetime, timedelta, timezone

import pytest
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient

from db.database import get_db
from db.models import Disc, Movie, Series, Tape
from services.catalog_stats import RECENT_DAYS_DEFAULT, build_catalog_stats

NOW = datetime(2026, 3, 1, tzinfo=timezone.utc)


@pytest.fixture()
def app():
    from main import app as fastapi_app
    return fastapi_app


def _session(*row_lists):
    """One execute() -> one result, in select order (movie, series, disc, tape)."""
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


# ---------------------------------------------------------------------------
# Probe 1 — the route exists, and nothing declared earlier shadows it.
# ---------------------------------------------------------------------------

def test_stats_route_registered_and_not_shadowed(app):
    catalog_gets = [
        route.path for route in app.routes
        if getattr(route, "path", "").startswith("/api/catalog") and "GET" in (getattr(route, "methods", None) or set())
    ]
    assert "/api/catalog/stats" in catalog_gets

    stats_at = catalog_gets.index("/api/catalog/stats")
    shadowing = [
        path for path in catalog_gets[:stats_at]
        if "{" in path and path.count("/") == "/api/catalog/x".count("/")
    ]
    assert not shadowing, f"/stats is unreachable behind {shadowing}"


def test_stats_auth_posture_matches_sibling_catalog_gets(app):
    """The endpoint is deliberately unauthenticated ("read-only like every
    other GET in this router"). Pin that it is no *less* protected than the
    list endpoints it sits beside, so the stats page cannot become the one
    way to read the catalog anonymously if the router ever gets auth."""
    def guards(path):
        for route in app.routes:
            if getattr(route, "path", "") == path:
                return {d.call.__name__ for d in route.dependant.dependencies if d.call is not None}
        return None

    stats_guards = guards("/api/catalog/stats")
    assert stats_guards is not None
    siblings = [
        route.path for route in app.routes
        if getattr(route, "path", "").startswith("/api/catalog")
        and "GET" in (getattr(route, "methods", None) or set())
        and route.path != "/api/catalog/stats"
    ]
    assert siblings
    for path in siblings:
        assert guards(path) == stats_guards or "require_any_auth" not in (guards(path) or set()), path


async def test_stats_endpoint_is_reachable_through_http(app):
    """Route wiring end to end: query validation, one select per table, and
    every figure the acceptance criteria name is in the response body."""
    resp = await _get(app, _session([], [], [], []))
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {
        "generatedAt", "recentDays", "totalItems", "byType", "byDiscFormat",
        "byDecade", "undated", "recentlyAdded", "storage", "lentOut",
    }
    assert body["recentDays"] == RECENT_DAYS_DEFAULT


# ---------------------------------------------------------------------------
# Probe 2 — real ORM rows, not MagicMocks. The builder's tests would still
# pass if `Disc.format` were renamed, because nothing there touches models.py.
# ---------------------------------------------------------------------------

def test_aggregates_real_orm_rows():
    movies = [
        Movie(id="m1", title="Alien", release_date="1979-06-28", raw_data={},
              created_at=NOW - timedelta(days=5)),
        Movie(id="m2", title="Unrated", raw_data={}, created_at=NOW - timedelta(days=400)),
    ]
    series = [
        Series(id="s1", title="Twin Peaks", running_years=["1990", "1991"], raw_data={},
               created_at=NOW - timedelta(days=2)),
    ]
    discs = [
        Disc(id="d1", title="Alien 4K", format="Blu-ray", release_date="2018-10-02",
             storage_type="Box", storage_id="MED0001", raw_data={},
             created_at=NOW - timedelta(days=1)),
        Disc(id="d2", title="Out on loan", format="DVD", raw_data={"loanedTo": "Sam"},
             created_at=NOW - timedelta(days=60)),
    ]
    tapes = [
        Tape(id="t1", title="Home VHS", tape_type="VHS", raw_data={},
             created_at=NOW - timedelta(days=3)),
    ]

    stats = build_catalog_stats(movies=movies, series=series, discs=discs, tapes=tapes, now=NOW)

    assert stats["byType"] == {"movie": 2, "series": 1, "disc": 2, "tape": 1}
    assert stats["totalItems"] == 6
    assert stats["byDiscFormat"] == [{"label": "Blu-ray", "count": 1}, {"label": "DVD", "count": 1}]
    assert stats["byDecade"] == [
        {"label": "1970s", "startYear": 1970, "count": 1},
        {"label": "1990s", "startYear": 1990, "count": 1},
        {"label": "2010s", "startYear": 2010, "count": 1},
    ]
    # every movie/series/disc without a parseable year is still accounted for
    assert stats["undated"] + sum(b["count"] for b in stats["byDecade"]) == 5
    assert stats["storage"] == {
        "total": 3, "withLocation": 1, "withoutLocation": 2,
        "byType": [{"label": "Box", "count": 1}],
    }
    assert stats["recentlyAdded"]["count"] == 4  # m2 (400d) and d2 (60d) are older
    assert [(i["id"], i["type"]) for i in stats["recentlyAdded"]["items"]] == [
        ("d1", "disc"), ("s1", "series"), ("t1", "tape"), ("m1", "movie"),
    ]
    assert stats["lentOut"] == {
        "count": 1,
        "items": [{"id": "d2", "title": "Out on loan", "type": "disc", "borrower": "Sam"}],
    }


def test_real_rows_are_serialisable_as_json():
    """The endpoint returns the dict straight from FastAPI — a non-JSON type
    in the payload is a 500, not a bad number."""
    import json

    stats = build_catalog_stats(
        discs=[Disc(id="d1", title="Disc", format="DVD", raw_data={}, created_at=NOW)],
        now=NOW,
    )
    json.dumps(stats)


# ---------------------------------------------------------------------------
# Probe 3 — the "last 30 days" window boundary.
# ---------------------------------------------------------------------------

def test_recently_added_window_boundary():
    discs = [
        Disc(id="in", title="Just inside", raw_data={}, created_at=NOW - timedelta(days=29, hours=23)),
        Disc(id="out", title="Just outside", raw_data={}, created_at=NOW - timedelta(days=30, hours=1)),
    ]
    stats = build_catalog_stats(discs=discs, now=NOW)
    assert stats["recentlyAdded"]["count"] == 1
    assert stats["recentlyAdded"]["items"][0]["id"] == "in"

    wider = build_catalog_stats(discs=discs, now=NOW, recent_days=365)
    assert wider["recentlyAdded"]["days"] == 365
    assert wider["recentlyAdded"]["count"] == 2


async def test_recent_days_is_validated_at_the_endpoint(app):
    """recent_days is a user-facing number; an out-of-range value must be a
    422 rather than a whole-catalog scan with a nonsense window."""
    for url in ("/api/catalog/stats?recent_days=0", "/api/catalog/stats?recent_days=366",
                "/api/catalog/stats?recent_days=abc"):
        resp = await _get(app, _session([], [], [], []), url=url)
        assert resp.status_code == 422, url

    ok = await _get(app, _session([], [], [], []), url="/api/catalog/stats?recent_days=1")
    assert ok.status_code == 200 and ok.json()["recentDays"] == 1


# ---------------------------------------------------------------------------
# Probe 4 — loan shapes behind the "lent out" figure.
# ---------------------------------------------------------------------------

def _lent(raw):
    stats = build_catalog_stats(discs=[Disc(id="d1", title="Disc", raw_data=raw)], now=NOW)
    return stats["lentOut"]["count"], stats["lentOut"]["items"]


@pytest.mark.parametrize("raw, borrower", [
    ({"loans": [{"loanedTo": "Ana", "loanedAt": "2026-02-05"}]}, "Ana"),
    ({"loans": [{"borrower": "Bo", "status": "active"}]}, "Bo"),
    ({"loans": {"loanedTo": "Cy"}}, "Cy"),                      # single object, not a list
    ({"onLoan": True}, "Unspecified"),                          # bare flag
    ({"lentTo": "Di"}, "Di"),                                   # alternate key
    ({"loans": [
        {"loanedTo": "Returned", "loanedAt": "2026-01-01", "returnedAt": "2026-01-04"},
        {"loanedTo": "Still out", "loanedAt": "2026-02-01"},
    ]}, "Still out"),                                           # newest open loan wins
])
def test_open_loan_shapes_count_as_lent_out(raw, borrower):
    count, items = _lent(raw)
    assert count == 1, raw
    assert items[0]["borrower"] == borrower, raw


@pytest.mark.parametrize("raw", [
    {"loans": [{"loanedTo": "Ana", "returnedAt": "2026-02-04"}]},
    {"loans": [{"loanedTo": "Cy", "status": "returned"}]},
    {"loans": []},
    {"loans": ["not-a-dict"]},
    {"loans": "on loan"},                                       # wrong type entirely
    {},
])
def test_returned_or_malformed_loans_are_not_lent_out(raw):
    assert _lent(raw)[0] == 0, raw


@pytest.mark.xfail(
    strict=True,
    reason="QA #16 defect: the return markers _RETURN_MARKERS look at (returnedAt, returnDate, ...) "
           "miss a plain boolean `returned`, so a loan recorded as {loanedTo, returned: true} is "
           "still reported as 'Out on loan right now'. Fix the aggregator, then drop this marker.",
)
@pytest.mark.parametrize("raw", [
    {"loans": [{"loanedTo": "Bo", "returned": True}]},
    {"loans": [{"loanedTo": "Bo", "returned": "2026-02-04"}]},
])
def test_boolean_returned_loan_is_not_lent_out(raw):
    assert _lent(raw)[0] == 0, raw


@pytest.mark.xfail(
    strict=True,
    reason="QA #16 defect: _active_loan() applies return markers only inside the loans array, so a "
           "returned bare-field loan (loanedTo + returnedAt, or an explicit onLoan=False) is still "
           "reported as 'Out on loan right now'. Fix the aggregator, then drop this marker.",
)
@pytest.mark.parametrize("raw", [
    {"loanedTo": "Ana", "returnedAt": "2026-02-04"},
    {"onLoan": False, "loanedTo": "Ana"},
    {"onLoan": False, "loanedTo": "Ana", "returnedAt": "2026-02-04"},
])
def test_returned_bare_field_loan_is_not_lent_out(raw):
    assert _lent(raw)[0] == 0, raw
