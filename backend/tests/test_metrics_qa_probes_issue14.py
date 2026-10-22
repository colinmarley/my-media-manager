"""
Independent QA probes for issue #14 (GET /metrics).

These are written from the acceptance criteria rather than from the builder's
test plan, and they deliberately attack the gaps a metrics endpoint usually
has: an empty database (a gauge family that disappears is a gap in the graph,
not a zero), histogram bucket boundaries (le is inclusive), and a *production*
parameterised route minting one series per catalog record.

Nothing here changes product code.

Issue #14 acceptance criteria -> the probes this file adds (the one test per
criterion lives in test_metrics_qa_probe.py):

  AC1 unauthenticated GET /metrics in Prometheus text format:
        test_qa_empty_database_still_exposes_every_gauge_as_zero
        test_qa_counter_never_renders_a_float_for_whole_counts
        test_qa_concurrent_endpoint_scrapes_both_succeed
  AC2 request count and latency labelled by route template and status:
        test_qa_real_app_parameterised_routes_stay_one_series
        test_qa_status_labels_carry_the_real_statuses
        test_qa_histogram_buckets_are_inclusive_and_cumulative
  AC3 the six gauges, from cheap COUNT queries, cached for 60s:
        test_qa_empty_database_still_exposes_every_gauge_as_zero
        test_qa_second_scrape_of_an_empty_database_keeps_the_zeros
  AC4 the scrape job for homelab-logging/prometheus/prometheus.yml:
        test_ac4_pr_summary_carries_the_prometheus_scrape_job
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

import main
from api.metrics import METRICS_PATH
from services.metrics import (
    DURATION_BUCKETS_SECONDS,
    HTTP_REQUEST_DURATION_SECONDS,
    HTTP_REQUESTS_TOTAL,
    REGISTRY,
)
from tests.test_metrics import (
    _FakeClock,
    _FakeSessionFactory,
    _RecordingCollector,
    _assert_prometheus_text,
)

# The six gauges the issue names, plus the labels it names for two of them.
SIX_GAUGES = (
    "mm_catalog_items",
    "mm_ingest_queue_items",
    "mm_compliance_findings_open",
    "mm_media_assignments_total",
    "mm_poster_cache_files",
    "mm_sessions_active",
)
CATALOG_TYPES = ("movie", "series", "disc", "tape")
QUEUE_STATUSES = ("pending", "processing", "auto_assigned", "needs_review", "failed", "completed")


@pytest.fixture(autouse=True)
def _fresh_metric_samples():
    REGISTRY.reset()
    yield
    REGISTRY.reset()


# --------------------------------------------------------------------------
# Probe 1 — an empty database must read as zeros, never as a missing series.
# --------------------------------------------------------------------------


def test_qa_empty_database_still_exposes_every_gauge_as_zero(tmp_path):
    """SELECT count(*) returns 0 rows for the GROUP BY and 0 for every scalar."""
    factory = _FakeSessionFactory(counts={}, queue_rows=[])
    collector = _build_collector(factory, tmp_path)

    assert asyncio.run(collector.collect()) is True
    body = REGISTRY.render()

    for gauge in SIX_GAUGES:
        assert f"# TYPE {gauge} gauge" in body
    for media_type in CATALOG_TYPES:
        assert f'mm_catalog_items{{type="{media_type}"}} 0' in body
    for status in QUEUE_STATUSES:
        assert f'mm_ingest_queue_items{{status="{status}"}} 0' in body
    for gauge in (
        "mm_compliance_findings_open",
        "mm_media_assignments_total",
        "mm_poster_cache_files",
        "mm_sessions_active",
    ):
        assert f"{gauge} 0" in body
    assert _sample_names(body) >= set(SIX_GAUGES) - {"mm_catalog_items", "mm_ingest_queue_items"}


def test_qa_second_scrape_of_an_empty_database_keeps_the_zeros(tmp_path):
    """A drained table must not strand a stale non-zero value on any label."""
    factory = _FakeSessionFactory(counts={"movies": 5, "discs": 4}, queue_rows=[("failed", 2)])
    collector = _build_collector(factory, tmp_path)
    asyncio.run(collector.collect())
    assert 'mm_catalog_items{type="movie"} 5' in REGISTRY.render()

    factory.counts = {}
    factory.queue_rows = []
    assert asyncio.run(collector.collect(force=True)) is True
    body = REGISTRY.render()
    assert 'mm_catalog_items{type="movie"} 0' in body
    assert 'mm_catalog_items{type="disc"} 0' in body
    assert 'mm_ingest_queue_items{status="failed"} 0' in body


# --------------------------------------------------------------------------
# Probe 2 — histogram boundaries are inclusive (le=), and the buckets line up.
# --------------------------------------------------------------------------


def test_qa_histogram_buckets_are_inclusive_and_cumulative():
    key = ("GET", "/api/thing", "200")
    for amount in (0.0, DURATION_BUCKETS_SECONDS[0], DURATION_BUCKETS_SECONDS[-1], 9_999.0):
        HTTP_REQUEST_DURATION_SECONDS.observe(key, amount)

    body = REGISTRY.render()
    _assert_prometheus_text(body)

    lines = [
        line for line in body.splitlines()
        if 'mm_http_request_duration_seconds_bucket{' in line and 'path="/api/thing"' in line
    ]
    bounds = [line.split('le="')[1].split('"')[0] for line in lines]
    assert bounds == [str(bound) if bound != int(bound) else str(int(bound))
                      for bound in DURATION_BUCKETS_SECONDS] + ["+Inf"]
    counts = [int(line.rsplit(" ", 1)[1]) for line in lines]
    # An observation exactly on a bound belongs to that bucket (le = less *or
    # equal*): 0.0 and 0.01 land in le="0.01", 30.0 first counts in le="30",
    # and only the 9999s sample reaches +Inf.
    assert counts == [2] * 9 + [3, 4], counts
    assert counts[-1] == 4 == HTTP_REQUEST_DURATION_SECONDS.samples[key][-1]
    assert counts == sorted(counts)


def test_qa_counter_never_renders_a_float_for_whole_counts():
    HTTP_REQUESTS_TOTAL.inc(("GET", "/x", "200"))
    HTTP_REQUESTS_TOTAL.inc(("GET", "/x", "200"))
    assert 'mm_http_requests_total{method="GET",path="/x",status="200"} 2' in REGISTRY.render()


# --------------------------------------------------------------------------
# Probe 3 — the real app: production routes must stay one series each.
# --------------------------------------------------------------------------


async def test_qa_real_app_parameterised_routes_stay_one_series():
    """Two real catalog ids through the real app: one label, no ids leaked."""
    with _scraped_real_app():
        async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as client:
            for media_id in ("tt0111166", "tt0101210"):
                await client.get(f"/api/posters/movie/{media_id}")
            response = await client.get(METRICS_PATH)

    assert response.status_code == 200
    _assert_prometheus_text(response.text)
    for media_id in ("tt0111166", "tt0101210"):
        assert media_id not in response.text
    labels = {key[1] for key in HTTP_REQUESTS_TOTAL.samples}
    assert labels == {"/api/posters/{media_type}/{media_id}"}, labels


async def test_qa_status_labels_carry_the_real_statuses():
    """The status label is the response code the client actually got."""
    with _scraped_real_app():
        async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as client:
            assert (await client.get("/")).status_code == 200
            assert (await client.get("/no-such-route")).status_code == 404
            response = await client.get(METRICS_PATH)

    assert response.status_code == 200
    assert {key[2] for key in HTTP_REQUESTS_TOTAL.samples} == {"200", "404"}
    assert 'path="/",status="200"' in response.text
    assert 'path="unmatched",status="404"' in response.text


# --------------------------------------------------------------------------
# Probe 4 — two scrapes in flight must read the counts once, and both 200.
# --------------------------------------------------------------------------


async def test_qa_concurrent_endpoint_scrapes_both_succeed(tmp_path):
    from services.metrics import DomainMetricsCollector

    factory = _FakeSessionFactory(counts={"movies": 1})
    collector = DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=_FakeClock())
    previous = getattr(main.app.state, "domain_metrics", None)
    main.app.state.domain_metrics = collector
    try:
        async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as client:
            responses = await asyncio.gather(*(client.get(METRICS_PATH) for _ in range(5)))
    finally:
        main.app.state.domain_metrics = previous

    assert [response.status_code for response in responses] == [200] * 5
    assert {response.headers["content-type"] for response in responses} == {
        "text/plain; version=0.0.4; charset=utf-8"
    }
    # One refresh for five concurrent scrapes: 4 catalog + queue + compliance +
    # assignments + sessions.
    assert len(factory.queries) == 8


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _build_collector(factory, tmp_path):
    from services.metrics import DomainMetricsCollector

    return DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=_FakeClock())


class _RestoreCollector:
    def __init__(self):
        self.previous = None

    def __enter__(self):
        self.previous = getattr(main.app.state, "domain_metrics", None)
        main.app.state.domain_metrics = _RecordingCollector()
        return self

    def __exit__(self, exc_type, exc, tb):
        main.app.state.domain_metrics = self.previous
        return False


def _scraped_real_app():
    return _RestoreCollector()


def _sample_names(body: str) -> set:
    return {
        line.split("{")[0].split(" ")[0]
        for line in body.splitlines()
        if line and not line.startswith("#")
    }
