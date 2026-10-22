"""
Prometheus primitives and the domain gauges behind GET /metrics (issue #14).

`prometheus_client` / `prometheus-fastapi-instrumentator` are not installable
here, so the slice of the Prometheus data model the app needs — counter, gauge
and histogram families in the 0.0.4 text exposition format — is implemented with
the standard library, closely enough to the spec that the real client can replace
it later without the scrape job, the endpoint or the dashboards changing. The six
domain gauges are COUNT queries refreshed at most once per GAUGE_CACHE_TTL_SECONDS;
MetricsMiddleware feeds the HTTP families.
"""

import asyncio
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, select

from config.settings import settings
from db.models import (
    ComplianceFinding, Disc, IngressQueueItem, MediaAssignment, Movie, Series, Session, Tape,
)
from services.ingress_queue_service import (
    QUEUE_AUTO_ASSIGNED, QUEUE_COMPLETED, QUEUE_FAILED, QUEUE_NEEDS_REVIEW, QUEUE_PENDING,
    QUEUE_PROCESSING,
)
from utils.logging import logger

# Starlette appends `; charset=utf-8` to any text/* media type, so the exposition
# media type is written without a charset rather than with two.
PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4"

# COUNT queries over whole tables, so issue #14 asks for a cached sample.
GAUGE_CACHE_TTL_SECONDS = 60

# HTTP latency buckets in seconds, from a cache-hit poster read to a large listing.
DURATION_BUCKETS_SECONDS = (0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)

# Catalog "items" the issue asks to count, in the order the gauges are exposed.
CATALOG_ITEM_MODELS: Dict[str, Any] = {"movie": Movie, "series": Series, "disc": Disc, "tape": Tape}

# services/ingress_queue_service.py owns the vocabulary; the known statuses are
# always emitted, 0 included, so a PromQL query never loses a series.
INGEST_QUEUE_STATUSES: Tuple[str, ...] = (QUEUE_PENDING, QUEUE_PROCESSING, QUEUE_AUTO_ASSIGNED,
                                          QUEUE_NEEDS_REVIEW, QUEUE_FAILED, QUEUE_COMPLETED)

COMPLIANCE_STATUS_OPEN = "open"

# `path` is the route *template*, never the concrete URL: one series per route
# instead of one per movie id.
HTTP_LABEL_NAMES = ("method", "path", "status")


def _number(value: float) -> str:
    """Render a sample value the way the text format expects (ints stay ints)."""
    number = float(value)
    if number != number:
        return "NaN"
    if number in (float("inf"), float("-inf")):
        return "+Inf" if number > 0 else "-Inf"
    return str(int(number)) if number.is_integer() else repr(number)


def _suffix(names: Sequence[str], values: Sequence[str],
            extra: Sequence[Tuple[str, str]] = ()) -> str:
    """`{a="1",b="2"}` for a sample, with label values escaped per the spec."""
    escaped = [(name, str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"'))
               for name, value in list(zip(names, values)) + list(extra)]
    return "{" + ",".join(f'{name}="{value}"' for name, value in escaped) + "}" if escaped else ""


class Metric:
    """One family (counter, gauge or histogram) keyed by label values; a histogram
    sample is its cumulative bucket counts (+Inf last) then sum and count.
    """

    def __init__(self, name: str, documentation: str, kind: str,
                 labelnames: Sequence[str] = (), buckets: Sequence[float] = ()):
        self.name, self.documentation, self.kind = name, documentation, kind
        self.labelnames: Tuple[str, ...] = tuple(labelnames)
        self.buckets: Tuple[float, ...] = tuple(float(b) for b in buckets)
        self.samples: Dict[Tuple[str, ...], Any] = {}

    def _key(self, label_values: Sequence[str] = ()) -> Tuple[str, ...]:
        key = tuple(str(value) for value in label_values)
        if len(key) != len(self.labelnames):
            raise ValueError(f"{self.name} expects {len(self.labelnames)} label value(s), got {len(key)}")
        return key

    def inc(self, label_values: Sequence[str] = (), amount: float = 1.0) -> float:
        key = self._key(label_values)
        self.samples[key] = self.samples.get(key, 0.0) + float(amount)
        return self.samples[key]

    def set(self, label_values: Sequence[str] = (), value: float = 0.0) -> float:
        key = self._key(label_values)
        self.samples[key] = float(value)
        return self.samples[key]

    def get(self, label_values: Sequence[str] = ()) -> float:
        return self.samples.get(self._key(label_values), 0.0)

    def observe(self, label_values: Sequence[str] = (), amount: float = 0.0) -> None:
        """Add one observation to a histogram: every bucket it falls into."""
        key = self._key(label_values)
        state = self.samples.setdefault(key, [0] * (len(self.buckets) + 1) + [0.0, 0])
        for index, bound in enumerate(self.buckets):
            if float(amount) <= bound:
                state[index] += 1
        state[len(self.buckets)] += 1  # the implicit le="+Inf" bucket
        state[-2] += float(amount)
        state[-1] += 1

    def reset(self) -> None:
        """Drop all samples. Only tests call this, to isolate the global registry."""
        self.samples.clear()

    def render(self) -> List[str]:
        lines = [f"# HELP {self.name} {self.documentation}", f"# TYPE {self.name} {self.kind}"]
        for key in sorted(self.samples):
            suffix, state = _suffix(self.labelnames, key), self.samples[key]
            if self.kind != "histogram":
                lines.append(f"{self.name}{suffix} {_number(state)}")
                continue
            # Cumulative buckets, +Inf last and never decreasing: that is what
            # PromQL histogram_quantile() reads.
            pairs = [(_number(bound), count) for bound, count in zip(self.buckets, state)]
            pairs.append(("+Inf", state[len(self.buckets)]))
            name = f"{self.name}_bucket"
            lines.extend(f'{name}{_suffix(self.labelnames, key, (("le", le),))} {count}'
                         for le, count in pairs)
            lines.append(f"{self.name}_sum{suffix} {_number(state[-2])}")
            lines.append(f"{self.name}_count{suffix} {state[-1]}")
        return lines


class Registry:
    """The families rendered on each scrape, in registration order."""

    def __init__(self, families: Iterable[Metric] = ()):
        self.families: List[Metric] = list(families)

    def register(self, metric: Metric) -> Metric:
        self.families.append(metric)
        return metric

    def render(self) -> str:
        return "".join("\n".join(metric.render()) + "\n" for metric in self.families)

    def reset(self) -> None:
        for metric in self.families:
            metric.reset()


REGISTRY = Registry()


def family(name: str, documentation: str, kind: str, labelnames: Sequence[str] = (),
           buckets: Sequence[float] = ()) -> Metric:
    """Register one metric family: name, HELP text, type, labels, buckets."""
    return REGISTRY.register(Metric(name, documentation, kind, labelnames, buckets))


# --- HTTP collection (MetricsMiddleware in api/metrics.py) ------------------
HTTP_REQUESTS_TOTAL = family(
    "mm_http_requests_total", "HTTP requests by method, route template and status.", "counter", HTTP_LABEL_NAMES)
HTTP_REQUEST_DURATION_SECONDS = family(
    "mm_http_request_duration_seconds",
    "HTTP request latency in seconds by method, route template and status.",
    "histogram", HTTP_LABEL_NAMES, DURATION_BUCKETS_SECONDS)

# --- Domain gauges (DomainMetricsCollector) ---------------------------------
CATALOG_ITEMS = family("mm_catalog_items", "Catalog records by media type.", "gauge", ("type",))
INGEST_QUEUE_ITEMS = family("mm_ingest_queue_items", "Ingest queue items by queue status.", "gauge", ("status",))
COMPLIANCE_FINDINGS_OPEN = family("mm_compliance_findings_open", "Library compliance findings still open.", "gauge")
MEDIA_ASSIGNMENTS_TOTAL = family("mm_media_assignments_total", "Media assignments to catalog records.", "gauge")
POSTER_CACHE_FILES = family("mm_poster_cache_files", "Files in the poster cache directory.", "gauge")
SESSIONS_ACTIVE = family("mm_sessions_active", "Login sessions that have not expired.", "gauge")
# A gauge that fails must not take GET /metrics down, but it must be visible.
DOMAIN_GAUGE_ERRORS_TOTAL = family("mm_metrics_domain_gauge_errors_total",
                                   "Gauge refreshes that failed; gauges keep their previous value.", "counter")


def count_poster_cache_files(directory: Optional[Path] = None) -> int:
    """Files under settings.poster_cache_dir, or 0 when it does not exist."""
    root = Path(directory if directory is not None else settings.poster_cache_dir)
    return 0 if not root.is_dir() else sum(len(files) for _path, _dirs, files in os.walk(root))


class DomainMetricsCollector:
    """Reads the domain gauges, reusing one sample for cache_ttl_seconds. A
    failed refresh never reaches the scrape: the gauges keep their previous value,
    DOMAIN_GAUGE_ERRORS_TOTAL goes up and a warning is logged.
    """

    def __init__(self, session_factory: Callable[[], Any], *, poster_cache_dir: Optional[Path] = None,
                 cache_ttl_seconds: int = GAUGE_CACHE_TTL_SECONDS, clock: Callable[[], float] = time.monotonic):
        self.session_factory, self.poster_cache_dir = session_factory, poster_cache_dir
        self.cache_ttl_seconds, self._clock = cache_ttl_seconds, clock
        self._lock = asyncio.Lock()
        self._sampled_at: Optional[float] = None

    def is_stale(self) -> bool:
        """True when the next scrape has to re-read the counts."""
        return self._sampled_at is None or (self._clock() - self._sampled_at) >= self.cache_ttl_seconds

    async def collect(self, *, force: bool = False) -> bool:
        """Refresh the gauges unless the cached sample is still fresh; True if read."""
        if not force and not self.is_stale():
            return False
        async with self._lock:
            # Re-check inside the lock: concurrent scrapes still read once.
            if not force and not self.is_stale():
                return False
            failed = False
            try:
                async with self.session_factory() as session:
                    await self._collect_counts(session)
            except Exception as exc:  # noqa: BLE001 - a gauge must not break the scrape
                failed = True
                logger.warning("Domain metric collection failed", error=str(exc))
            try:
                POSTER_CACHE_FILES.set(value=count_poster_cache_files(self.poster_cache_dir))
            except OSError as exc:
                failed = True
                logger.warning("Poster cache metric collection failed", error=str(exc))
            # sampled_at advances on failure too: retry next window, not every scrape.
            self._sampled_at = self._clock()
            if failed:
                DOMAIN_GAUGE_ERRORS_TOTAL.inc()
            return True

    @staticmethod
    async def _count(session, model, *conditions) -> int:
        """One SELECT count(*), never a table read."""
        statement = select(func.count()).select_from(model)
        for condition in conditions:
            statement = statement.where(condition)
        return int(await session.scalar(statement) or 0)

    async def _collect_counts(self, session) -> None:
        for media_type, model in CATALOG_ITEM_MODELS.items():
            CATALOG_ITEMS.set((media_type,), await self._count(session, model))

        rows = (await session.execute(select(IngressQueueItem.status, func.count())
                                      .group_by(IngressQueueItem.status))).all()
        # Start from last scrape's labels at zero, so a status that disappears
        # from ingress_queue goes back to 0 instead of keeping its old count.
        counts: Dict[str, int] = {key[0]: 0 for key in INGEST_QUEUE_ITEMS.samples}
        counts.update({str(status): int(count) for status, count in rows})
        for status in dict.fromkeys(INGEST_QUEUE_STATUSES + tuple(sorted(counts))):
            INGEST_QUEUE_ITEMS.set((status,), counts.get(status, 0))

        COMPLIANCE_FINDINGS_OPEN.set(value=await self._count(
            session, ComplianceFinding, ComplianceFinding.status == COMPLIANCE_STATUS_OPEN))
        MEDIA_ASSIGNMENTS_TOTAL.set(value=await self._count(session, MediaAssignment))
        # sessions.expires_at is timestamptz, so `now` stays timezone-aware.
        SESSIONS_ACTIVE.set(value=await self._count(
            session, Session, Session.expires_at > datetime.now(timezone.utc)))
