"""
Acceptance-criteria tests for issue #14: one test per criterion, named after it,
plus regression tests for the findings raised on the previous QA round.

  AC1  unauthenticated GET /metrics in Prometheus text format
       -> test_ac1_get_metrics_is_unauthenticated_prometheus_text
  AC2  HTTP request count and latency labelled by route and status
       -> test_ac2_request_count_and_latency_are_labelled_by_route_and_status
  AC3  gauges for catalog items, ingest queue depth, compliance findings, media
       assignments, poster cache files and active sessions, read from COUNT
       queries and cached for 60s
       -> test_ac3_six_domain_gauges_come_from_mocked_count_queries
  AC4  the PR description carries the scrape job for
       homelab-logging/prometheus/prometheus.yml (job `media-manager`, target
       192.168.0.227:8082)
       -> test_ac4_pr_summary_carries_the_prometheus_scrape_job, asserted
       against docs/api/endpoints.md, which is the block the summary quotes, so
       the shipped scrape config and the documented one cannot drift.

QA findings covered below: a route that raises must appear in the counts, a
queue status drained from the queue must return to zero, the Content-Type must
advertise the exposition version exactly once, and 405/404 traffic plus
concurrent scrapes must stay accounted for with a bounded series count.

The test doubles are the ones test_metrics.py drives the collector with; they
are imported rather than duplicated so both files prove the same behaviour.
"""

import asyncio
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Tuple

import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

import main
from api.metrics import METRICS_PATH, MetricsMiddleware, route_template
from api.metrics import router as metrics_router
from services.metrics import (
    CATALOG_ITEMS,
    DOMAIN_GAUGE_ERRORS_TOTAL,
    DURATION_BUCKETS_SECONDS,
    GAUGE_CACHE_TTL_SECONDS,
    HTTP_REQUEST_DURATION_SECONDS,
    HTTP_REQUESTS_TOTAL,
    INGEST_QUEUE_ITEMS,
    POSTER_CACHE_FILES,
    REGISTRY,
    DomainMetricsCollector,
)
from tests.test_metrics import (
    _FakeClock,
    _FakeSession,
    _FakeSessionFactory,
    _RecordingCollector,
    _collector,
    _scope,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PROMETHEUS_DOCS = REPO_ROOT / "docs" / "api" / "endpoints.md"

# The job block the PR summary has to hand the operator.
SCRAPE_JOB = "job_name: media-manager"
SCRAPE_TARGET = "192.168.0.227:8082"


@pytest.fixture(autouse=True)
def _fresh_metric_samples():
    """The registry is process-global; keep each test's samples its own."""
    REGISTRY.reset()
    yield
    REGISTRY.reset()


# --------------------------------------------------------------------------
# Test doubles specific to this file
# --------------------------------------------------------------------------


class _SlowSession(_FakeSession):
    """Holds each COUNT open long enough for concurrent scrapes to overlap."""

    async def scalar(self, statement):
        await asyncio.sleep(0.02)
        return await super().scalar(statement)


class _SlowSessionFactory(_FakeSessionFactory):
    def __call__(self):
        return _SlowSession(self)


def _probe_app() -> FastAPI:
    """The metrics slice wired as main.py wires it, plus routes to exercise.

    Not the production app: this one needs a 405, a 404 and a route that raises,
    and production routes must not change shape to keep these tests readable.
    """
    app = FastAPI()
    app.state.domain_metrics = _RecordingCollector()
    app.add_middleware(MetricsMiddleware)
    app.include_router(metrics_router)

    api = APIRouter(prefix="/api")

    @api.get("/health")
    async def health() -> Dict[str, bool]:
        return {"ok": True}

    @api.get("/posters/{media_type}/{media_id}")
    async def poster(media_type: str, media_id: str) -> Dict[str, str]:
        return {"media_type": media_type, "media_id": media_id}

    @api.get("/breaks")
    async def breaks() -> Dict[str, bool]:
        raise RuntimeError("route crashed")

    app.include_router(api)
    return app


@contextmanager
def _real_app_scraped():
    """The production app with a recording collector swapped into app.state."""
    previous = getattr(main.app.state, "domain_metrics", None)
    collector = _RecordingCollector()
    main.app.state.domain_metrics = collector
    try:
        yield collector
    finally:
        main.app.state.domain_metrics = previous


def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# --------------------------------------------------------------------------
# AC1 — unauthenticated GET /metrics, Prometheus text
# --------------------------------------------------------------------------


async def test_ac1_get_metrics_is_unauthenticated_prometheus_text():
    """AC1: no session cookie is sent, and the body parses as exposition text."""
    with _real_app_scraped():
        async with _client(main.app) as client:
            assert (await client.get("/")).status_code == 200  # unauthenticated too
            response = await client.get(METRICS_PATH)

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; version=0.0.4; charset=utf-8"
    body = response.text
    assert "# HELP mm_http_requests_total" in body
    assert "# TYPE mm_http_requests_total counter" in body
    assert "# TYPE mm_http_request_duration_seconds histogram" in body
    for gauge in (
        "mm_catalog_items",
        "mm_ingest_queue_items",
        "mm_compliance_findings_open",
        "mm_media_assignments_total",
        "mm_poster_cache_files",
        "mm_sessions_active",
    ):
        assert f"# TYPE {gauge} gauge" in body


async def test_ac1_repeated_scrapes_ask_the_collector_every_time():
    """The endpoint never caches on its own; the collector owns the 60s sample."""
    with _real_app_scraped() as collector:
        async with _client(main.app) as client:
            for _ in range(4):
                assert (await client.get(METRICS_PATH)).status_code == 200

    assert collector.calls == [False] * 4
    # A scrape must not instrument itself: that would be one series per poll.
    assert HTTP_REQUESTS_TOTAL.samples == {}
    assert HTTP_REQUEST_DURATION_SECONDS.samples == {}
    assert 'path="/metrics"' not in REGISTRY.render()


# --------------------------------------------------------------------------
# AC2 — request count and latency labelled by route and status
# --------------------------------------------------------------------------


async def test_ac2_request_count_and_latency_are_labelled_by_route_and_status():
    """AC2: per route template and status, one count and one histogram sample."""
    async with _client(_probe_app()) as client:
        for _ in range(2):
            assert (await client.get("/api/health")).status_code == 200
        assert (await client.get("/api/posters/movie/tt0111166")).status_code == 200
        assert (await client.get("/api/posters/series/tt0108778")).status_code == 200
        assert (await client.post("/api/health")).status_code == 405
        assert (await client.get("/api/posters/movie")).status_code == 404

    assert HTTP_REQUESTS_TOTAL.get(("GET", "/api/health", "200")) == 2
    # Two different catalog ids, one series — the label is the route template.
    posters = ("GET", "/api/posters/{media_type}/{media_id}", "200")
    assert HTTP_REQUESTS_TOTAL.get(posters) == 2
    # health, posters, and `unmatched` twice (405 and 404): four series.
    assert len(HTTP_REQUESTS_TOTAL.samples) == 4
    assert len(HTTP_REQUEST_DURATION_SECONDS.samples) == 4
    assert HTTP_REQUESTS_TOTAL.get(("POST", "unmatched", "405")) == 1
    assert HTTP_REQUESTS_TOTAL.get(("GET", "unmatched", "404")) == 1

    duration = HTTP_REQUEST_DURATION_SECONDS.samples[("GET", "/api/health", "200")]
    assert duration[-1] == 2 and duration[-2] >= 0.0
    buckets = duration[:-2]
    # Buckets are cumulative and +Inf comes last, so the last one is the count.
    assert len(buckets) == len(DURATION_BUCKETS_SECONDS) + 1
    assert buckets == sorted(buckets) and buckets[-1] == 2


async def test_ac2_unmatched_and_wrong_method_traffic_stays_one_series():
    """Path scanners and 405s must not mint one series per probe."""
    app = _probe_app()
    async with _client(app) as client:
        assert (await client.post("/api/posters/movie/tt0111166")).status_code == 405
        for path in ("/favicon.ico", "/wp-login.php", "/api/posters/movie"):
            assert (await client.get(path)).status_code == 404

    labels = {key[1] for key in HTTP_REQUESTS_TOTAL.samples}
    assert labels == {"/api/posters/{media_type}/{media_id}", "unmatched"}
    assert HTTP_REQUESTS_TOTAL.get(("POST", "/api/posters/{media_type}/{media_id}", "405")) == 1
    assert HTTP_REQUESTS_TOTAL.get(("GET", "unmatched", "404")) == 3
    # The template is resolved from the ASGI scope, with or without a response.
    assert route_template(_scope("GET", "/api/posters/movie/tt0111166")) == (
        "/api/posters/{media_type}/{media_id}"
    )


# --------------------------------------------------------------------------
# AC3 — the six domain gauges, from mocked COUNT queries, cached for 60s
# --------------------------------------------------------------------------


def test_ac3_six_domain_gauges_come_from_mocked_count_queries(tmp_path):
    """AC3: every gauge value is a COUNT result handed back by the fake session."""
    (tmp_path / "poster.jpg").write_bytes(b"x")
    (tmp_path / "poster.jpg.meta.json").write_bytes(b"{}")
    counts = {
        "movies": 118,
        "series": 28,
        "discs": 64,
        "tapes": 29,
        "sessions": 3,
        "compliance_findings": 7,
        "media_assignments": 9,
    }
    queue_rows: List[Tuple[str, int]] = [("pending", 2), ("completed", 5)]
    factory, collector, _clock = _collector(
        tmp_path, counts=counts, queue_rows=queue_rows
    )

    assert asyncio.run(collector.collect()) is True
    body = REGISTRY.render()
    for line in (
        'mm_catalog_items{type="movie"} 118',
        'mm_catalog_items{type="series"} 28',
        'mm_catalog_items{type="disc"} 64',
        'mm_catalog_items{type="tape"} 29',
        'mm_ingest_queue_items{status="pending"} 2',
        'mm_ingest_queue_items{status="completed"} 5',
        "mm_compliance_findings_open 7",
        "mm_media_assignments_total 9",
        "mm_poster_cache_files 2",
        "mm_sessions_active 3",
    ):
        assert line in body
    # Eight reads per refresh: four catalog counts, the queue GROUP BY, and one
    # each for compliance, assignments and sessions.
    assert len(factory.queries) == 8
    assert all("count(" in query.lower() for query in factory.queries)


def test_ac3_gauge_reads_are_cached_for_sixty_seconds(tmp_path):
    """The 60s TTL is the requirement; a scrape inside it reuses the sample."""
    factory, collector, clock = _collector(tmp_path, counts={"movies": 1})
    assert GAUGE_CACHE_TTL_SECONDS == 60

    asyncio.run(collector.collect())
    reads = len(factory.queries)
    for _ in range(4):
        assert asyncio.run(collector.collect()) is False
    clock.advance(GAUGE_CACHE_TTL_SECONDS - 1)
    assert asyncio.run(collector.collect()) is False
    clock.advance(1)
    assert asyncio.run(collector.collect()) is True
    assert len(factory.queries) == reads * 2


# --------------------------------------------------------------------------
# AC4 — the scrape job the PR description has to carry
# --------------------------------------------------------------------------


def test_ac4_pr_summary_carries_the_prometheus_scrape_job():
    """The summary quotes docs/api/endpoints.md, so assert the documented block."""
    documented = PROMETHEUS_DOCS.read_text(encoding="utf-8")

    assert SCRAPE_JOB in documented and SCRAPE_TARGET in documented
    assert "homelab-logging" in documented
    # It has to be a YAML job block with a static target, not prose.
    blocks = re.findall(r"```yaml\n(.*?)```", documented, re.DOTALL)
    job_blocks = [block for block in blocks if SCRAPE_JOB in block]
    assert len(job_blocks) == 1
    assert SCRAPE_TARGET in job_blocks[0] and "static_configs" in job_blocks[0]


# --------------------------------------------------------------------------
# QA findings on the previous round
# --------------------------------------------------------------------------


async def test_crashed_route_is_counted_and_still_propagates():
    """A route that raises has to show up in the counts, not vanish from them."""
    app = _probe_app()
    async with _client(app) as client:
        with pytest.raises(RuntimeError, match="route crashed"):
            await client.get("/api/breaks")

    assert HTTP_REQUESTS_TOTAL.get(("GET", "/api/breaks", "500")) == 1
    assert HTTP_REQUEST_DURATION_SECONDS.samples[("GET", "/api/breaks", "500")][-1] == 1


async def test_scrape_content_type_advertises_the_exposition_version_once():
    """A scraper sends `Accept: text/plain; version=0.0.4`; we answer the same."""
    async with _client(_probe_app()) as client:
        content_type = (await client.get(METRICS_PATH)).headers["content-type"]

    assert content_type == "text/plain; version=0.0.4; charset=utf-8"
    assert content_type.count("charset=") == 1
    assert content_type.count("version=") == 1


def test_queue_status_that_disappears_returns_to_zero(tmp_path):
    """Draining `failed` must zero the gauge, not strand the last value."""
    factory, collector, _clock = _collector(tmp_path, queue_rows=[("failed", 3)])
    asyncio.run(collector.collect())
    assert INGEST_QUEUE_ITEMS.get(("failed",)) == 3

    factory.queue_rows = [("pending", 2)]
    asyncio.run(collector.collect(force=True))
    assert INGEST_QUEUE_ITEMS.get(("failed",)) == 0
    assert INGEST_QUEUE_ITEMS.get(("pending",)) == 2
    # Known statuses keep their series across scrapes, so PromQL stays queryable.
    for status in ("processing", "auto_assigned", "needs_review", "completed"):
        assert INGEST_QUEUE_ITEMS.get((status,)) == 0


def test_concurrent_scrapes_share_one_gauge_refresh(tmp_path):
    """Prometheus plus a dashboard reloading must not multiply the COUNT reads."""
    factory = _SlowSessionFactory(counts={"movies": 1})
    collector = DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=_FakeClock())

    async def scrape_together() -> None:
        await asyncio.gather(*(collector.collect() for _ in range(6)))

    asyncio.run(scrape_together())
    # Six scrapes, one refresh: four catalog counts + queue + compliance +
    # assignments + sessions.
    assert len(factory.queries) == 8
    assert collector.is_stale() is False


def test_failed_refresh_keeps_gauges_and_counts_the_error(tmp_path):
    """A down database costs a fresh sample, never the endpoint."""
    factory, collector, clock = _collector(tmp_path, counts={"movies": 12})
    asyncio.run(collector.collect())
    assert CATALOG_ITEMS.get(("movie",)) == 12
    assert POSTER_CACHE_FILES.get() == 0

    clock.advance(GAUGE_CACHE_TTL_SECONDS + 1)
    factory.fail = True
    assert asyncio.run(collector.collect()) is True
    assert asyncio.run(collector.collect()) is False  # retried next TTL window
    assert CATALOG_ITEMS.get(("movie",)) == 12
    assert DOMAIN_GAUGE_ERRORS_TOTAL.get() == 1
