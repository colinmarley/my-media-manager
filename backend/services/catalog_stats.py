"""
Catalog stats
=============
Pure aggregation behind `GET /api/catalog/stats` (see api/catalog.py) — the
numbers /dashboard/stats renders, which is the web counterpart of the
mobile app's stats screen.

Every catalog record is a JSONB `raw_data` document plus the handful of
columns mirrored out of it, and the two can disagree (a row written by a
flow that didn't round-trip a field). Where a column exists it wins, the
same rule the list endpoints already follow for storage_type/storage_id.

Release years are the messy part: movies/discs carry `release_date` text,
series carry `running_years`, tapes carry nothing at all. Tapes are left
out of the decade chart entirely; everything else without a parseable year
is reported as `undated` so the decade counts plus `undated` still add up
to the number of dated-able records.

"Lent out" has no column or table — loans are recorded inside a disc/tape's
`raw_data`: either a `loans` array or a bare `loanedTo`/`onLoan` field, so a
loan written by either client counts. An entry with no return marker is an
item that is currently out.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Sequence

RECENT_DAYS_DEFAULT = 30
ITEM_LIST_LIMIT = 12  # caps the "recently added" and "lent out" lists
UNKNOWN_LABEL = "Unspecified"

_YEAR_RE = re.compile(r"\d{4}")

# A loan is "back" if any of these carry a value, or if its status says so.
_RETURN_MARKERS = ("returnedAt", "returnedOn", "returnedDate", "returnedTo", "dateReturned", "returnDate")
_RETURNED_STATUSES = {"returned", "return", "complete", "completed", "ended", "closed", "back", "in"}

_BORROWER_KEYS = ("borrower", "borrowed_by", "borrowerName", "loanedTo", "lentTo", "person", "name", "title")


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _clean_text(value: Any) -> str | None:
    """Anything that isn't a plain scalar (JSONB sub-document, an unset
    column) carries no text — including a mock's auto-created attribute."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    text = str(value).strip()
    return text or None


def _year_in(value: Any) -> int | None:
    """First plausible four-digit run in a value — '1979', '1979-06-15',
    '1979–1983' and 1979 all read as 1979."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        year = int(value)
    elif isinstance(value, str):
        match = _YEAR_RE.search(value)
        if not match:
            return None
        year = int(match.group(0))
    else:
        return None
    return year if 1000 <= year <= 2999 else None


def _release_year(row: Any) -> int | None:
    raw = _as_dict(getattr(row, "raw_data", None))
    for key in ("year", "releaseYear", "releaseDate", "release_date", "premiered", "firstAired"):
        year = _year_in(raw.get(key))
        if year is not None:
            return year

    year = _year_in(getattr(row, "release_date", None))
    if year is not None:
        return year

    years = getattr(row, "running_years", None)
    if isinstance(years, (list, tuple)):
        for entry in years:
            year = _year_in(entry)
            if year is not None:
                return year
    return None


def _disc_format(row: Any) -> str:
    raw = _as_dict(getattr(row, "raw_data", None))
    return _clean_text(getattr(row, "format", None)) or _clean_text(raw.get("format")) or UNKNOWN_LABEL


def _title(row: Any) -> str:
    raw = _as_dict(getattr(row, "raw_data", None))
    return _clean_text(getattr(row, "title", None)) or _clean_text(raw.get("title")) or "Untitled"


def _count_by(rows: Iterable[Any], key: Callable[[Any], str]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for row in rows:
        label = key(row)
        counts[label] = counts.get(label, 0) + 1
    return [
        {"label": label, "count": count}
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _aware(value: Any) -> datetime | None:
    """created_at comes back tz-aware from Postgres but naive in SQLite and
    in mocks — assume UTC when no offset is attached."""
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _loans(row: Any) -> list[dict]:
    loans = _as_dict(getattr(row, "raw_data", None)).get("loans")
    if isinstance(loans, dict):
        loans = [loans]
    if not isinstance(loans, list):
        return []
    return [loan for loan in loans if isinstance(loan, dict)]


def _is_returned(loan: dict) -> bool:
    if any(loan.get(marker) not in (None, "", False) for marker in _RETURN_MARKERS):
        return True
    return str(loan.get("status") or "").strip().lower() in _RETURNED_STATUSES


def _borrower(loan: dict) -> str:
    for key in _BORROWER_KEYS:
        value = loan.get(key)
        if isinstance(value, dict):
            value = value.get("name") or value.get("title")
        text = _clean_text(value)
        if text:
            return text
    return UNKNOWN_LABEL


def _active_loan(row: Any) -> dict | None:
    """The loan a record is currently under, if any — the newest unreturned
    entry of its `loans` array, else a bare `loanedTo`/`onLoan` field left
    behind by an older write."""
    raw = _as_dict(getattr(row, "raw_data", None))
    open_loans = [loan for loan in _loans(row) if not _is_returned(loan)]
    if open_loans:
        def stamp(loan: dict) -> str:
            return _clean_text(loan.get("loanedAt") or loan.get("date") or loan.get("startedAt")) or ""
        return max(open_loans, key=stamp)
    for key in ("loanedTo", "lentTo", "onLoan"):
        value = raw.get(key)
        if isinstance(value, dict) and value:
            return value
        if value is True:
            return {}                      # a bare flag: out, borrower unknown
        if _clean_text(value):
            return {key: value}
    return None


def build_catalog_stats(
    *,
    movies: Sequence[Any] = (),
    series: Sequence[Any] = (),
    discs: Sequence[Any] = (),
    tapes: Sequence[Any] = (),
    now: datetime | None = None,
    recent_days: int = RECENT_DAYS_DEFAULT,
    item_limit: int = ITEM_LIST_LIMIT,
) -> dict[str, Any]:
    """Aggregate the whole catalog into the stats payload.

    Takes the already-fetched rows so the endpoint stays one query per
    table and this stays testable without a database.
    """
    moment = now or datetime.now(timezone.utc)
    cutoff = moment - timedelta(days=recent_days)

    by_type = {"movie": len(movies), "series": len(series), "disc": len(discs), "tape": len(tapes)}

    decades: dict[int, int] = {}
    undated = 0
    for rows in (movies, series, discs):
        for row in rows:
            year = _release_year(row)
            if year is None:
                undated += 1
                continue
            start = (year // 10) * 10
            decades[start] = decades.get(start, 0) + 1
    by_decade = [
        {"label": f"{start}s", "startYear": start, "count": count}
        for start, count in sorted(decades.items())
    ]

    recent: list[dict[str, Any]] = []
    for kind, rows in (("movie", movies), ("series", series), ("disc", discs), ("tape", tapes)):
        for row in rows:
            created_at = _aware(getattr(row, "created_at", None))
            if created_at is None or created_at < cutoff:
                continue
            recent.append({
                "id": _clean_text(getattr(row, "id", None)) or "",
                "title": _title(row),
                "type": kind,
                "createdAt": created_at.isoformat(),
            })
    recent.sort(key=lambda item: item["createdAt"], reverse=True)
    recently_added = {
        "days": recent_days,
        "count": len(recent),
        "items": recent[: max(item_limit, 0)],
    }

    with_location = without_location = 0
    location_types: dict[str, int] = {}
    for row in (*discs, *tapes):
        raw = _as_dict(getattr(row, "raw_data", None))
        storage_type = _clean_text(getattr(row, "storage_type", None)) or _clean_text(raw.get("storageType"))
        storage_id = _clean_text(getattr(row, "storage_id", None)) or _clean_text(raw.get("storageId"))
        if storage_type and storage_id:
            with_location += 1
            location_types[storage_type] = location_types.get(storage_type, 0) + 1
        else:
            without_location += 1
    storage = {
        "total": len(discs) + len(tapes),
        "withLocation": with_location,
        "withoutLocation": without_location,
        "byType": [
            {"label": label, "count": count}
            for label, count in sorted(location_types.items(), key=lambda item: (-item[1], item[0]))
        ],
    }

    lent_out: list[dict[str, Any]] = []
    for kind, rows in (("movie", movies), ("series", series), ("disc", discs), ("tape", tapes)):
        for row in rows:
            loan = _active_loan(row)
            if loan is None:
                continue
            lent_out.append({
                "id": _clean_text(getattr(row, "id", None)) or "",
                "title": _title(row),
                "type": kind,
                "borrower": _borrower(loan),
            })
    lent_out.sort(key=lambda item: item["title"].lower())

    return {
        "generatedAt": moment.isoformat(),
        "recentDays": recent_days,
        "totalItems": sum(by_type.values()),
        "byType": by_type,
        "byDiscFormat": _count_by(discs, _disc_format),
        "byDecade": by_decade,
        "undated": undated,
        "recentlyAdded": recently_added,
        "storage": storage,
        "lentOut": {"count": len(lent_out), "items": lent_out[: max(item_limit, 0)]},
    }
