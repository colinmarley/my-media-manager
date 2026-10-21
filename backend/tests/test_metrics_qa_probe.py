"""
QA probes for issue #14 (Prometheus /metrics).

These are the edges the implementation suite in test_metrics.py leaves open:
  * does the 60s gauge cache apply end to end, through GET /metrics itself?
  * do simultaneous scrapes still run the COUNT queries once?
  * does the exposition carry the media type a Prometheus scraper negotiates?
  * does a wrong-method request stay on its route template / bounded label?
Plus one xfail recording a gauge correctness defect found while testing.
"""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from api.metrics import METRICS_PATH
from services.metrics import DomainMetricsCollector, REGISTRY


@pytest.fixture(autouse=True)
def _isolated_metric_samples():
    """REGISTRY is process-global; give every probe its own samples."""
    REGISTRY.reset()
    yield
    REGISTRY.reset()


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, factory):
        self.factory = factory

    async def scalar(self, statement):
        self.factory.queries.append(str(statement))
        return self.factory.scalar_result(str(statement))

    async def execute(self, statement):
        self.factory.queries.append(str(statement))
        return _FakeResult(self.factory.rows_for(str(statement)))

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeSessionFactory:
    """Answers every COUNT with a number and every GROUP BY with queue rows."""

    def __init__(self, counts=None, queue_rows=None):
        self.counts = counts or {}
        self.queue_rows = queue_rows or []
        self.queries = []

    def __call__(self):
        return _FakeSession(self)

    def scalar_result(self, query):
        for table, value in self.counts.items():
            if f"FROM {table}" in query:
                return value
        return 0

    def rows_for(self, query):
        return self.queue_rows if "GROUP BY" in query else []


class _Clock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def _collector(tmp_path, **kwargs):
    factory = _FakeSessionFactory(**kwargs)
    clock = _Clock()
    return factory, DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=clock), clock


def _install(collector):
    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    main.app.state.domain_metrics = collector
    return previous


def _restore(previous):
    import main

    main.app.state.domain_metrics = previous


async def _scrape():
    import main

    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as client:
        return await client.get(METRICS_PATH)


# --- AC2: the 60s cache is applied by the endpoint, end to end -------------


@pytest.mark.asyncio
async def test_endpoint_caches_the_gauge_sample_for_sixty_seconds(tmp_path):
    factory, collector, clock = _collector(tmp_path, counts={"movies": 1})
    previous = _install(collector)
    try:
        first = await _scrape()
        second = await _scrape()
        assert first.status_code == second.status_code == 200
        assert 'mm_catalog_items{type="movie"} 1' in first.text
        assert 'mm_catalog_items{type="movie"} 1' in second.text

        first_read = len(factory.queries)
        assert first_read == 8, "one scrape reads exactly the eight COUNT/GROUP BY queries"
        assert len(factory.queries) == first_read, "second scrape re-ran the COUNT queries"

        clock.advance(61)
        factory.counts["movies"] = 2
        third = await _scrape()
    finally:
        _restore(previous)

    assert len(factory.queries) == first_read * 2, "stale sample was not refreshed"
    assert 'mm_catalog_items{type="movie"} 2' in third.text


@pytest.mark.asyncio
async def test_concurrent_scrapes_run_the_count_queries_once(tmp_path):
    factory, collector, _clock = _collector(tmp_path, counts={"movies": 1})
    results = await asyncio.gather(*[collector.collect() for _ in range(3)])

    assert results.count(True) == 1, "three simultaneous scrapes should refresh once"
    assert len(factory.queries) == 8


# --- AC1: exposition the scraper negotiates on ----------------------------


@pytest.mark.asyncio
async def test_scrape_content_type_is_prometheus_text_version_004(tmp_path):
    collector = _collector(tmp_path)[1]
    previous = _install(collector)
    try:
        response = await _scrape()
    finally:
        _restore(previous)

    assert response.status_code == 200
    # Prometheus selects the classic text format from the media type and the
    # version parameter. (Starlette 0.27 appends its own `charset=utf-8` to any
    # text/* media type, so the header carries the parameter twice — harmless
    # to a scraper, noted as a finding.)
    content_type = response.headers["content-type"]
    assert content_type.startswith("text/plain"), content_type
    assert "version=0.0.4" in content_type, content_type


# --- AC1: label discipline for non-2xx traffic ----------------------------


@pytest.mark.asyncio
async def test_wrong_method_on_parameterised_route_keeps_template(tmp_path):
    import main

    collector = _collector(tmp_path)[1]
    previous = _install(collector)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            response = await client.patch("/api/catalog/movies/999")
            assert response.status_code == 405
            missing = await client.get("/api/nope/something/really")
            assert missing.status_code == 404
    finally:
        _restore(previous)

    body = REGISTRY.render()
    counter_lines = [
        line for line in body.splitlines() if line.startswith("mm_http_requests_total{")
    ]
    assert (
        'mm_http_requests_total{method="PATCH",path="/api/catalog/movies/{movie_id}",'
        'status="405"} 1'
    ) in body, counter_lines
    # Unknown paths must never leak their raw path into a label.
    assert 'path="unmatched",status="404"' in body, counter_lines
    assert len(counter_lines) == 2, counter_lines


# --- gauge correctness defect found while testing -------------------------


@pytest.mark.xfail(
    strict=True,
    reason="mm_ingest_queue_items keeps the previous value for a status that "
    "disappears from ingress_queue: services/metrics.py:_collect_ingest_queue "
    "zeroes only the six known statuses, so any other label set is never "
    "reset and the gauge reports a count that no longer exists.",
)
def test_vanished_queue_status_returns_to_zero(tmp_path):
    factory, collector, clock = _collector(tmp_path, queue_rows=[("quarantined", 4)])
    asyncio.run(collector.collect())
    assert 'mm_ingest_queue_items{status="quarantined"} 4' in REGISTRY.render()

    factory.queue_rows = []
    clock.advance(61)
    asyncio.run(collector.collect())

    body = REGISTRY.render()
    assert 'mm_ingest_queue_items{status="quarantined"} 0' in body, body
