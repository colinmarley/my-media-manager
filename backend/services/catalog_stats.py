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
to the number of dated-able records. The mirrored columns are read before
`raw_data`, and only a value that IS a year counts, so an inventory number
parked in a text field ("SP-1234") never opens a "1230s" bar.

LENT OUT — the loan contract
----------------------------
There is no loans table (see docs/architecture/DATABASE_TABLES_REFERENCE.md,
"Loans"): the mobile app records loans inside the record's `raw_data`, in
two shapes, and a record is out while its newest loan is unreturned.

  `loans` / `loanHistory` / `lendingHistory` — a list of loan objects (a
  single object is accepted too), oldest first. Inside one:
      who     `loanedTo`, `loaned_to`, `onLoanTo`, `lentTo`, `borrower`,
              `borrowerName`, `person`, `who`, `name` — a name, or nested
              as `{"loanedTo": {"name": "Sam"}}`
      out on  `loanedAt`, `date`, `dateOut`, `dateLent`, `loanDate`,
              `dateLoan`, `checkedOut`, `borrowedDate`, `startedAt`, `out`
      due     `due`, `dueDate`
      back    a return date (`returnedAt`, `dateBack`, `returnDate`,
              `dateReturned`, `returnedOn`, `dateIn`, ...) or a return flag
              (`returned`, `isReturned`, `returnToOwner`) that is not
              false/empty, or a `status`/`loanStatus` that reads as back
              ("returned", "back", "closed", ...)
  bare fields on the record itself — a name (`loanedTo`, `lentTo`,
  `onLoanTo`, `borrower`, ...) or a flag (`onLoan`, `loanOut`, `isLent`).
  `onLoan: false`, or a return marker on the record (`returnedAt`,
  `dateBack`, `returned`, ...), means the item is home again.

Both shapes are consulted, in that order: an older `loans[]` entry marked
returned does not cancel a `lentTo` written afterwards, and a bare
`returned: true` does not cancel a `loans[]` entry that is still open. A loan
status is read from loan keys only — inside `loans[]` that includes `status`,
at record level only `loanStatus`/`loanState` — because a record-level
`status` is not a loan field: on `series` it is the series status ("Ended" =
the show stopped airing).

`recentlyAdded.items` and `lentOut.items` are capped at `ITEM_LIST_LIMIT`
while `count` stays the whole total, which is the difference a UI has to
spell out (src/app/dashboard/stats/page.tsx renders "Showing 12 of N").
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Sequence

RECENT_DAYS_DEFAULT = 30
ITEM_LIST_LIMIT = 12  # caps the "recently added" and "lent out" lists
UNKNOWN_LABEL = "Unspecified"

# Any four-digit run, for values whose whole point is a span of years.
_YEAR_RUN_RE = re.compile(r"\d{4}")
# Anchored: the value has to *be* a year — "1979", "1979-06", "1979-06-15",
# "1979/6/15", "1979T00:00:00Z". Searching instead would read the 1234 in an
# inventory code "SP-1234" as a release year.
_YEAR_TEXT_RE = re.compile(r"^(1\d{3}|2\d{3})(?:[/-]\d{1,2}){0,2}([T ].*)?$")

# A release year below this is a bad value rather than a decade.
_MIN_YEAR = 1900

# Some clients send flags as strings; these all mean "no".
_FALSE_TEXT = frozenset({"", "false", "no", "n", "none", "null", "0", "f"})

# --- loan keys (see the loan contract in the module docstring) -------------

_LOAN_LIST_KEYS = ("loans", "loanHistory", "loan_history", "lendingHistory", "lending_history")

_BORROWER_KEYS = (
    "loanedTo", "loaned_to", "onLoanTo", "on_loan_to", "lentTo", "lent_to",
    "borrower", "borrowerName", "borrowed_by", "person", "who", "name",
)
# Record-level scan only: `name`/`who`/`person` are unambiguous inside a loan
# object but not on the record itself, where `name` is the title being lent.
_BARE_BORROWER_KEYS = (
    "loanedTo", "loaned_to", "onLoanTo", "on_loan_to", "lentTo", "lent_to",
    "borrower", "borrowerName", "borrowed_by",
)
# Nested borrower object: `{"loanedTo": {"name": "Sam"}}`.
_BORROWER_NAME_KEYS = ("name", "fullName", "full_name", "borrower", "person", "who", "label", "title")

_LOAN_FLAG_KEYS = ("onLoan", "on_loan", "isOnLoan", "is_on_loan", "loanOut", "loan_out", "isLent", "is_lent")
# `onLoan: false` is an explicit "it is on the shelf" and outranks a stale name.
_LOAN_BARE_KEYS = _BARE_BORROWER_KEYS + _LOAN_FLAG_KEYS

# When it left (`loanedAt`/`date`/`dateOut`/...) and when it is due back
# (`due`/`dueDate`) are recorded too, but neither is a return marker — see
# _RETURN_MARKERS below.

# A loan is back once one of these carries anything other than a false value.
# `dateOut`/`date`/`due` are deliberately absent: they say when an item left,
# not that it came back, so counting them as returns hid every `loans[]` entry
# that uses that shape.
_RETURN_MARKERS = (
    "returned", "isReturned", "is_returned", "returnToOwner", "return_to_owner",
    "returnedAt", "returned_at", "returnedOn", "returned_on",
    "returnedDate", "returned_date", "dateReturned", "date_returned",
    "returnDate", "return_date", "dateBack", "date_back", "dateIn", "date_in",
)

# A loan's own state. Inside a `loans[]` entry `status`/`state` describe the
# loan; on the record itself only the explicitly loan-scoped keys may be read,
# because a record-level `status` on a series is the series status.
_LOAN_STATUS_KEYS = ("loanStatus", "loan_status", "loanState", "loan_state", "status", "state")
_RECORD_LOAN_STATUS_KEYS = ("loanStatus", "loan_status", "loanState", "loan_state")
_RETURNED_STATUSES = frozenset({
    "returned", "return", "back", "home", "in", "given back", "gave back", "lended back",
    "complete", "completed", "ended", "closed", "done",
})

# `format` is free text in the JSONB documents, and the web form writes its own
# enum values through, so "dvd ", "BLURAY" and "Blu Ray" would each open their
# own bar. Keyed on the case/separator-normalised text; anything unknown keeps
# its own wording (whitespace collapsed) rather than being dropped.
_DISC_FORMAT_LABELS = {
    "dvd": "DVD", "dvd r": "DVD-R", "dvd r dl": "DVD-R DL", "dvd 9": "DVD-9", "dvd9": "DVD-9",
    "blu ray": "Blu-ray", "bluray": "Blu-ray", "blu ray disc": "Blu-ray", "bd": "Blu-ray",
    "uhd blu ray": "4K UHD Blu-ray", "uhd bluray": "4K UHD Blu-ray", "uhd": "4K UHD Blu-ray",
    "4k uhd": "4K UHD Blu-ray", "4k uhd blu ray": "4K UHD Blu-ray", "4k blu ray": "4K UHD Blu-ray",
    "4k bluray": "4K UHD Blu-ray",
    "hd dvd": "HD DVD", "hddvd": "HD DVD",
    "laserdisc": "LaserDisc", "laser disc": "LaserDisc",
    "cd": "CD", "sacd": "SACD", "super audio cd": "SACD", "umd": "UMD",
    "vhs": "VHS", "s vhs": "S-VHS", "vhs dvd": "VHS/DVD Combo", "vhs dvd combo": "VHS/DVD Combo",
    "betamax": "Betamax", "betamax deck": "Betamax",
    "unspecified": UNKNOWN_LABEL, "unknown": UNKNOWN_LABEL, "none": UNKNOWN_LABEL, "n a": UNKNOWN_LABEL,
}
_FORMAT_SEPARATORS_RE = re.compile(r"[\s_/\-]+")


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _clean_text(value: Any) -> str | None:
    """Anything that isn't a plain scalar (JSONB sub-document, an unset
    column) carries no text — including a mock's auto-created attribute."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    text = str(value).strip()
    return text or None


def _plausible(year: int | None) -> bool:
    """A release year has to be in the range a catalog could contain; anything
    else (an inventory code, an epoch, a typo) is no year at all."""
    return year is not None and _MIN_YEAR <= year <= datetime.now(timezone.utc).year + 1


def _year_in(value: Any) -> int | None:
    """A value that *is* a year — 1979, '1979', '1979-06-15',
    '1979T00:00:00.000Z'. Anchored on purpose: searching for four digits
    instead would turn an inventory code like 'SP-1234' (or 'Disk 1979')
    into an invented '1230s' decade bucket."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (datetime, date)):
        year: int | None = value.year
    elif isinstance(value, int):
        year = value
    elif isinstance(value, float):
        year = int(value) if float(value).is_integer() else None
    elif isinstance(value, str):
        match = _YEAR_TEXT_RE.match(value.strip())
        year = int(match.group(1)) if match else None
    else:
        year = None                     # a JSONB sub-document, a mock's attribute
    return year if _plausible(year) else None


def _first_year_in(value: Any) -> int | None:
    """For values that hold a span rather than a date — '1979–1983',
    ['1979', '1983'] — the first plausible year in them. Scanning rather than
    anchoring suits these fields; the JSONB fallback uses it on free text too
    (a pre-columns document can read "Berserk 1997"), where _plausible is
    what keeps an inventory code such as 'SP-1234' out of a decade."""
    entries = value if isinstance(value, (list, tuple, set)) else [value]
    for entry in entries:
        year = _year_in(entry)
        if year is not None:
            return year
        if isinstance(entry, str):
            for run in _YEAR_RUN_RE.findall(entry):
                if _plausible(int(run)):
                    return int(run)
    return None


def _release_year(row: Any) -> int | None:
    """Release year of a record: the mirrored columns first, then `raw_data`.

    `release_date`/`running_years` are what the list and search endpoints
    filter on, and a JSONB document written by an older flow can hold a
    different (or unparseable) copy of the same field — so the column wins,
    and only when it reads as a year by _year_in's rules.
    """
    for column in ("release_date", "release_year", "releaseDate", "year", "premiered", "firstAired"):
        year = _year_in(getattr(row, column, None))
        if year is not None:
            return year
    for column in ("running_years", "runningYears"):
        year = _first_year_in(getattr(row, column, None))
        if year is not None:
            return year

    raw = _as_dict(getattr(row, "raw_data", None))
    for key in ("releaseDate", "release_date", "releaseYear", "release_year", "year"):
        year = _year_in(raw.get(key)) or _first_year_in(raw.get(key))
        if year is not None:
            return year
    for key in ("runningYears", "running_years", "premiered", "firstAired", "originalAirDate", "started"):
        year = _year_in(raw.get(key)) or _first_year_in(raw.get(key))
        if year is not None:
            return year
    return None


def _format_key(value: str) -> str:
    """Comparison form of a format name: case folded, with runs of spaces,
    hyphens and underscores collapsed — so '4K Ultra HD Blu-Ray',
    '4k ultra hd bluray' and 'UHD_BLURAY' all land on the same disc."""
    return _FORMAT_SEPARATORS_RE.sub(" ", value).strip().lower()


def _disc_format(row: Any) -> str:
    """Format label for the disc-format chart.

    The mobile picker writes 'BLURAY' or 'UHD_BLURAY' while older records hold
    plain text, so buckets are keyed on a normalised label rather than the
    verbatim string: left alone, 'blu-ray', 'Blu Ray' and 'Blu-ray ' each got
    their own bar. Formats the app never uses are kept as written (trimmed,
    inner whitespace collapsed) rather than dropped into 'Unspecified'.
    """
    raw = _as_dict(getattr(row, "raw_data", None))
    value = _clean_text(getattr(row, "format", None)) or _clean_text(raw.get("format"))
    if not value:
        return UNKNOWN_LABEL
    return _DISC_FORMAT_LABELS.get(_format_key(value), " ".join(value.split()))


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


def _loans(raw: dict) -> list[dict]:
    """The loan objects on a record, oldest first. A single object under
    `loans` (rather than a list) is one loan, not none."""
    for key in _LOAN_LIST_KEYS:
        value = raw.get(key)
        if isinstance(value, dict):
            return [value]
        if isinstance(value, list):
            return [loan for loan in value if isinstance(loan, dict)]
    return []


def _has_return_marker(record: dict) -> bool:
    """True when any return key carries a real value. `returned: false` and
    `dateBack: ""` say it is still out; a date, a `true` or even a text date
    under `returned` says it came back."""
    for key in _RETURN_MARKERS:
        if key not in record:
            continue
        value = record[key]
        if isinstance(value, bool):
            if value:
                return True
        elif isinstance(value, str):
            if value.strip().lower() not in _FALSE_TEXT:
                return True
        elif value is not None:
            return True
    return False


def _status_is_returned(record: dict, keys: Sequence[str] = _LOAN_STATUS_KEYS) -> bool:
    """A `status`/`loanStatus` reading as back — from loan keys only: a
    record-level `status` on a series is the series status."""
    for key in keys:
        status = _clean_text(record.get(key))
        if status:
            return status.lower() in _RETURNED_STATUSES
    return False


def _is_returned(loan: dict) -> bool:
    return _has_return_marker(loan) or _status_is_returned(loan)


def _flag_on(value: Any) -> bool:
    """`onLoan: true`, `onLoan: "yes"` — but not `false`, `"false"`, `""` or None."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in _FALSE_TEXT
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return True                       # a sub-document naming someone is a loan


def _borrower_name(record: dict) -> str | None:
    for key in _BORROWER_NAME_KEYS:
        text = _clean_text(record.get(key))
        if text:
            return text
    return None


def _borrower(loan: dict) -> str:
    for key in _BORROWER_KEYS:
        value = loan.get(key)
        if isinstance(value, dict):
            value = _borrower_name(value)
        text = _clean_text(value)
        if text and text.lower() not in _FALSE_TEXT:
            return text
    return UNKNOWN_LABEL


def _bare_loan(raw: dict) -> dict | None:
    """Bare fields on the record itself describe one loan: a borrower name,
    or just an `onLoan: true` flag with the borrower left unrecorded. An
    explicit `onLoan: false` closes it — that is the shape the mobile app
    writes when someone taps "returned" — and so does a return marker on the
    record (`loanedTo: "Sam", returnedAt: "2026-02-04"`).
    """
    if any(key in raw and not _flag_on(raw[key]) for key in _LOAN_FLAG_KEYS):
        return None
    for key in _LOAN_BARE_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if isinstance(value, dict):
            return value if _borrower_name(value) else {key: value}
        if isinstance(value, bool):
            if value:
                return {}             # out, borrower unknown
            continue
        if isinstance(value, (int, float)):
            continue
        text = _clean_text(value)
        if not text or text.lower() in _FALSE_TEXT or text.lower() in _RETURNED_STATUSES:
            continue
        return {key: text}
    return None


def _active_loan(row: Any) -> dict | None:
    """The loan a record is currently under, if any.

    The newest entry of its `loans` array that is not returned wins; if every
    entry is closed (or there is no array) the bare `loanedTo`/`onLoan` fields
    an older write left behind are the loan, and a return marker on the record
    closes those too.
    """
    raw = _as_dict(getattr(row, "raw_data", None))
    for loan in reversed(_loans(raw)):
        if not _is_returned(loan):
            return loan
    loan = _bare_loan(raw)
    if loan is None or _has_return_marker(raw) or _status_is_returned(raw, _RECORD_LOAN_STATUS_KEYS):
        return None
    return loan


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
