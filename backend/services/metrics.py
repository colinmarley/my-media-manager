"""
Prometheus metrics: exposition primitives plus the domain gauges (issue #14).

`prometheus_client` / `prometheus-fastapi-instrumentator` are not available in
this environment, so the slice of the Prometheus data model the app needs is
implemented here directly: Counter / Gauge / Histogram families, the 0.0.4 text
exposition format, and the six domain gauges. Metric names, types and output
follow the official spec, so this module can be swapped for `prometheus_client`
later without the scrape job, the endpoint or the dashboards changing.

HTTP collection lives in api/metrics.py (the middleware) and api/metrics.py's
GET /metrics renders this registry. Gauges are refreshed by
DomainMetricsCollector, which caches one sample for GAUGE_CACHE_TTL_SECONDS so
a 15s scrape interval does not run a full set of COUNT scans every time.
"""

import asyncio
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, select

from config.settings import settings
from db.models import (
    ComplianceFinding,
    Disc,
    IngressQueueItem,
    MediaAssignment,
    Movie,
    Series,
    Session,
    Tape,
)
from services.ingress_queue_service import (
    QUEUE_AUTO_ASSIGNED,
    QUEUE_COMPLETED,
    QUEUE_FAILED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_PENDING,
    QUEUE_PROCESSING,
)
from utils.logging import logger

# Prometheus text exposition format 0.0.4 — what a scraper expects on
# Content-Type when it sends `Accept: ...;version=0.0.4`.
PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"

# The gauges are COUNT queries over the whole catalog; issue #14 asks for a
# cached sample rather than a scan per scrape.
GAUGE_CACHE_TTL_SECONDS = 60

# Latency buckets for HTTP request duration in seconds. Covers a cache-hit
# poster read (~10ms) through a catalog search or a large file listing.
DURATION_BUCKETS_SECONDS: Tuple[float, ...] = (
    0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
)

# Catalog "items" the issue asks to count, in the order the gauges are exposed.
CATALOG_ITEM_MODELS: Dict[str, Any] = {
    "movie": Movie,
    "series": Series,
    "disc": Disc,
    "tape": Tape,
}

# services/ingress_queue_service.py owns the status vocabulary; the known set is
# always emitted (0 when empty) so a PromQL query never sees a series vanish.
INGEST_QUEUE_STATUSES: Tuple[str, ...] = (
    QUEUE_PENDING,
    QUEUE_PROCESSING,
    QUEUE_AUTO_ASSIGNED,
    QUEUE_NEEDS_REVIEW,
    QUEUE_FAILED,
    QUEUE_COMPLETED,
)

COMPLIANCE_STATUS_OPEN = "open"

_METRIC_NAME_RE = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")
_LABEL_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _format_value(value: float) -> str:
    """Render a number the way the text format expects (ints stay ints)."""
    number = float(value)
    if number != number:
        return "NaN"
    if number == float("inf"):
        return "+Inf"
    if number == float("-inf"):
        return "-Inf"
    if number.is_integer():
        return str(int(number))
    return repr(number)


def _escape(text: str) -> str:
    """Escape a HELP string or label value per the exposition format."""
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace('"', '\\"')
    )


class _Family:
    """Common name/HELP/TYPE/label handling for every metric kind."""

    kind = "untyped"

    def __init__(self, name: str, documentation: str, labelnames: Sequence[str] = ()):
        if not _METRIC_NAME_RE.match(name):
            raise ValueError(f"invalid metric name: {name!r}")
        for label in labelnames:
            if not _LABEL_NAME_RE.match(label):
                raise ValueError(f"invalid label name: {label!r}")
        self.name = name
        self.documentation = documentation
        self.labelnames: Tuple[str, ...] = tuple(labelnames)
        # label-value tuple -> state (float for counter/gauge, dict for histogram)
        self.samples: Dict[Tuple[str, ...], Any] = {}

    def _key(self, label_values: Sequence[str] = ()) -> Tuple[str, ...]:
        key = tuple(str(value) for value in label_values)
        if len(key) != len(self.labelnames):
            raise ValueError(
                f"{self.name} expects {len(self.labelnames)} label value(s), got {len(key)}"
            )
        return key

    def _suffix(self, label_values: Tuple[str, ...], extra: Sequence[Tuple[str, str]] = ()) -> str:
        pairs = list(zip(self.labelnames, label_values)) + list(extra)
        if not pairs:
            return ""
        return "{" + ",".join(f'{name}="{_escape(value)}"' for name, value in pairs) + "}"

    def help_lines(self) -> List[str]:
        return [
            f"# HELP {self.name} {_escape(self.documentation)}",
            f"# TYPE {self.name} {self.kind}",
        ]

    def render(self) -> List[str]:
        lines = self.help_lines()
        for key in sorted(self.samples):
            lines.extend(self.render_sample(key))
        return lines

    def render_sample(self, key: Tuple[str, ...]) -> List[str]:
        raise NotImplementedError

    def reset(self) -> None:
        """Drop all collected samples (used by tests; a real process never calls it)."""
        self.samples.clear()


class Counter(_Family):
    kind = "counter"

    def inc(self, label_values: Sequence[str] = (), amount: float = 1.0) -> float:
        key = self._key(label_values)
        value = self.samples.get(key, 0.0) + float(amount)
        self.samples[key] = value
        return value

    def get(self, label_values: Sequence[str] = ()) -> float:
        return self.samples.get(self._key(label_values), 0.0)

    def render_sample(self, key: Tuple[str, ...]) -> List[str]:
        return [f"{self.name}{self._suffix(key)} {_format_value(self.samples[key])}"]


class Gauge(Counter):
    kind = "gauge"

    def set(self, label_values: Sequence[str] = (), value: float = 0.0) -> float:
        key = self._key(label_values)
        self.samples[key] = float(value)
        return self.samples[key]


class Histogram(_Family):
    """Cumulative buckets (+Inf is implicit and always emitted last)."""

    kind = "histogram"

    def __init__(
        self,
        name: str,
        documentation: str,
        labelnames: Sequence[str] = (),
        buckets: Sequence[float] = DURATION_BUCKETS_SECONDS,
    ):
        super().__init__(name, documentation, labelnames)
        self.buckets: Tuple[float, ...] = tuple(sorted(float(b) for b in buckets))

    def observe(self, label_values: Sequence[str] = (), amount: float = 0.0) -> None:
        key = self._key(label_values)
        state = self.samples.get(key)
        if state is None:
            state = {
                "buckets": [0] * (len(self.buckets) + 1),
                "sum": 0.0,
                "count": 0,
            }
            self.samples[key] = state
        observed = float(amount)
        for index, bound in enumerate(self.buckets):
            if observed <= bound:
                state["buckets"][index] += 1
        state["buckets"][-1] += 1  # le="+Inf"
        state["sum"] += observed
        state["count"] += 1

    def render_sample(self, key: Tuple[str, ...]) -> List[str]:
        state = self.samples[key]
        lines = [
            f'{self.name}_bucket{self._suffix(key, (("le", _format_value(bound)),))} {count}'
            for bound, count in zip(self.buckets, state["buckets"])
        ]
        lines.append(f'{self.name}_bucket{self._suffix(key, (("le", "+Inf"),))} {state["buckets"][-1]}')
        lines.append(f'{self.name}_sum{self._suffix(key)} {_format_value(state["sum"])}')
        lines.append(f'{self.name}_count{self._suffix(key)} {state["count"]}')
        return lines


class Registry:
    """Ordered collection of metric families rendered on scrape."""

    def __init__(self, families: Iterable[_Family] = ()):
        self.families: List[_Family] = list(families)

    def register(self, family: _Family) -> _Family:
        self.families.append(family)
        return family

    def render(self) -> str:
        lines: List[str] = []
        for family in self.families:
            lines.extend(family.render())
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        for family in self.families:
            family.reset()


REGISTRY = Registry()

# --- HTTP collection (api/metrics.py MetricsMiddleware) --------------------
# `path` is the route *template* (`/api/posters/{media_type}/{media_id}`), never
# the concrete URL — otherwise every movie id would add its own series.
HTTP_REQUESTS_TOTAL = REGISTRY.register(
    Counter(
        "mm_http_requests_total",
        "HTTP requests processed, labelled by method, route template and response status.",
        ("method", "path", "status"),
    )
)
HTTP_REQUEST_DURATION_SECONDS = REGISTRY.register(
    Histogram(
        "mm_http_request_duration_seconds",
        "HTTP request latency in seconds, labelled by method, route template and response status.",
        ("method", "path", "status"),
    )
)

# --- Domain gauges (DomainMetricsCollector) --------------------------------
CATALOG_ITEMS = REGISTRY.register(
    Gauge("mm_catalog_items", "Catalog records by media type.", ("type",))
)
INGEST_QUEUE_ITEMS = REGISTRY.register(
    Gauge("mm_ingest_queue_items", "Ingest queue items by queue status.", ("status",))
)
COMPLIANCE_FINDINGS_OPEN = REGISTRY.register(
    Gauge("mm_compliance_findings_open", "Library compliance findings that are still open.")
)
MEDIA_ASSIGNMENTS_TOTAL = REGISTRY.register(
    Gauge("mm_media_assignments_total", "Media assignments between files and catalog records.")
)
POSTER_CACHE_FILES = REGISTRY.register(
    Gauge("mm_poster_cache_files", "Files in the poster cache directory.")
)
SESSIONS_ACTIVE = REGISTRY.register(
    Gauge("mm_sessions_active", "Login sessions that have not expired.")
)
DOMAIN_GAUGE_ERRORS_TOTAL = REGISTRY.register(
    Counter(
        "mm_metrics_domain_gauge_errors_total",
        "Gauge refreshes that failed; the gauges keep their previous value.",
    )
)


def count_poster_cache_files(directory: Optional[Path] = None) -> int:
    """Number of files under settings.poster_cache_dir (0 if it doesn't exist).

    Cheap on purpose: the poster cache is one flat directory per media record,
    so this is a single walk of a few thousand entries at worst, cached for
    GAUGE_CACHE_TTL_SECONDS like everything else here.
    """
    root = Path(directory if directory is not None else settings.poster_cache_dir)
    if not root.is_dir():
        return 0
    total = 0
    for _dir_path, _dir_names, file_names in os.walk(root):
        total += len(file_names)
    return total


class DomainMetricsCollector:
    """Reads the domain gauges, reusing one sample for cache_ttl_seconds.

    Failures never propagate to the scrape: the gauges keep their previous
    value, DOMAIN_GAUGE_ERRORS_TOTAL goes up and a warning is logged, so a
    broken gauge cannot take GET /metrics down.
    """

    def __init__(
        self,
        db_session_factory: Callable[[], Any],
        *,
        poster_cache_dir: Optional[Path] = None,
        cache_ttl_seconds: int = GAUGE_CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.db_session_factory = db_session_factory
        self.poster_cache_dir = poster_cache_dir
        self.cache_ttl_seconds = cache_ttl_seconds
        self.refreshes = 0
        self._clock = clock
        self._lock = asyncio.Lock()
        self._sampled_at: Optional[float] = None

    def is_stale(self) -> bool:
        """True when the next scrape has to re-read the counts."""
        if self._sampled_at is None:
            return True
        return (self._clock() - self._sampled_at) >= self.cache_ttl_seconds

    async def collect(self, *, force: bool = False) -> bool:
        """Refresh the gauges unless the cached sample is still fresh.

        Returns True when new counts were actually read.
        """
        if not force and not self.is_stale():
            return False
        async with self._lock:
            # Re-check inside the lock: simultaneous scrapes (Prometheus plus a
            # dashboard reload) should still run the COUNT queries once.
            if not force and not self.is_stale():
                return False

            failed = False
            try:
                async with self.db_session_factory() as session:
                    await self._collect_catalog(session)
                    await self._collect_ingest_queue(session)
                    await self._collect_compliance(session)
                    await self._collect_assignments(session)
                    await self._collect_sessions(session)
            except Exception as exc:  # noqa: BLE001 - a gauge must not break the scrape
                failed = True
                logger.warning("Domain metric collection failed", error=str(exc))

            try:
                POSTER_CACHE_FILES.set(value=count_poster_cache_files(self.poster_cache_dir))
            except OSError as exc:
                failed = True
                logger.warning("Poster cache metric collection failed", error=str(exc))

            # Sampled_at advances even on failure so a down database is retried
            # on the next TTL window instead of on every scrape.
            self._sampled_at = self._clock()
            self.refreshes += 1
            if failed:
                DOMAIN_GAUGE_ERRORS_TOTAL.inc()
            return True

    async def _count(self, session, model, *conditions) -> int:
        statement = select(func.count()).select_from(model)
        for condition in conditions:
            statement = statement.where(condition)
        return int(await session.scalar(statement) or 0)

    async def _collect_catalog(self, session) -> None:
        for media_type, model in CATALOG_ITEM_MODELS.items():
            CATALOG_ITEMS.set((media_type,), await self._count(session, model))

    async def _collect_ingest_queue(self, session) -> None:
        rows = (
            await session.execute(
                select(IngressQueueItem.status, func.count())
                .group_by(IngressQueueItem.status)
            )
        ).all()
        counts = {str(status): int(count) for status, count in rows}
        for status in dict.fromkeys(INGEST_QUEUE_STATUSES + tuple(sorted(counts))):
            INGEST_QUEUE_ITEMS.set((status,), counts.get(status, 0))

    async def _collect_compliance(self, session) -> None:
        COMPLIANCE_FINDINGS_OPEN.set(
            value=await self._count(
                session, ComplianceFinding, ComplianceFinding.status == COMPLIANCE_STATUS_OPEN
            )
        )

    async def _collect_assignments(self, session) -> None:
        MEDIA_ASSIGNMENTS_TOTAL.set(value=await self._count(session, MediaAssignment))

    async def _collect_sessions(self, session) -> None:
        SESSIONS_ACTIVE.set(
            value=await self._count(
                session, Session, Session.expires_at > datetime.now(timezone.utc)
            )
        )
