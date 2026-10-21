"""
GET /metrics — Prometheus text output, HTTP instrumentation and the cached
domain gauges (issue #14).

The gauges have to be provably read from database counts, so the collector runs
against a fake session factory whose COUNT results are known and the rendered
exposition is asserted line by line. The endpoint tests use the real app: an
unauthenticated 200 is the contract (same as /health), because a Prometheus
scraper has no session cookie to send.

Issue #14 acceptance criteria -> the tests that pin them (16 tests, all in this
file):

  AC1 GET /metrics, unauthenticated, Prometheus text, request count and latency
      per route template and status:
        test_metrics_endpoint_is_unauthenticated_prometheus_text
        test_rendered_exposition_parses_as_prometheus_text
        test_scrape_of_a_dead_database_still_returns_parsable_metrics
        test_metrics_endpoint_asks_the_collector_on_every_scrape
        test_metrics_scrapes_are_not_instrumented
        test_metrics_middleware_records_crashed_requests_as_500
        test_route_template_collapses_parameterised_paths
        test_route_template_groups_unmatched_paths_into_one_series
        test_parameterised_routes_stay_one_series_through_the_middleware
        test_unmatched_requests_share_one_series
  AC2 the six domain gauges, from cheap COUNT queries cached for 60s:
        test_domain_gauges_read_counts_from_the_database
        test_gauge_reads_are_filtered_counts_not_table_scans
        test_gauge_counts_are_cached_for_sixty_seconds
        test_failed_gauge_collection_keeps_the_previous_values
        test_ingest_queue_gauge_always_emits_the_known_statuses
        test_poster_cache_gauge_counts_files_on_disk
  AC3 endpoint renders + gauges read from mocked counts:
      the whole file; the two named checks are
      test_metrics_endpoint_is_unauthenticated_prometheus_text (renders) and
      test_domain_gauges_read_counts_from_the_database (mocked counts).
"""

import asyncio
import re

import pytest
from httpx import ASGITransport, AsyncClient

from api.metrics import METRICS_PATH, MetricsMiddleware, route_template
from services.metrics import (
    DOMAIN_GAUGE_ERRORS_TOTAL,
    DURATION_BUCKETS_SECONDS,
    DomainMetricsCollector,
    REGISTRY,
    count_poster_cache_files,
)


@pytest.fixture(autouse=True)
def _fresh_metric_samples():
    """One process shares one registry; keep each test's samples its own."""
    REGISTRY.reset()
    yield
    REGISTRY.reset()


# --------------------------------------------------------------------------
# Test doubles
# --------------------------------------------------------------------------


class _FakeClock:
    """Controllable clock so the 60s gauge TTL is tested without sleeping."""

    def __init__(self, now: float = 1_000.0):
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


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
    """Stands in for AsyncSessionLocal; every COUNT comes back from `counts`."""

    def __init__(self, *, counts=None, queue_rows=None):
        self.counts = counts or {}
        self.queue_rows = queue_rows or []
        self.fail = False
        self.queries = []

    def __call__(self):
        if self.fail:
            raise RuntimeError("database unavailable")
        return _FakeSession(self)

    def scalar_result(self, query: str):
        if self.fail:
            raise RuntimeError("database unavailable")
        for table, value in self.counts.items():
            if f"FROM {table}" in query:
                return value
        return 0

    def rows_for(self, query: str):
        if self.fail:
            raise RuntimeError("database unavailable")
        return self.queue_rows if "GROUP BY" in query else []


class _RecordingCollector:
    """Replaces app.state.domain_metrics in endpoint tests — no DB involved."""

    def __init__(self):
        self.calls = []

    async def collect(self, *, force=False):
        self.calls.append(force)
        return True

    def is_stale(self):
        return True


def _collector(tmp_path, *, counts=None, queue_rows=None):
    """Collector over the fake session factory plus the clock driving its TTL."""
    factory = _FakeSessionFactory(counts=counts, queue_rows=queue_rows)
    clock = _FakeClock()
    collector = DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=clock)
    return factory, collector, clock


# --------------------------------------------------------------------------
# Domain gauges
# --------------------------------------------------------------------------


def test_domain_gauges_read_counts_from_the_database(tmp_path):
    for name in ("poster.jpg", "poster.jpg.meta.json", "sub/nested.jpg"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    factory, collector, _clock = _collector(
        tmp_path,
        counts={
            "movies": 118,
            "series": 28,
            "discs": 64,
            "tapes": 29,
            "sessions": 3,
            "compliance_findings": 7,
            "media_assignments": 9,
        },
        queue_rows=[("pending", 2), ("completed", 5)],
    )

    assert asyncio.run(collector.collect()) is True
    body = REGISTRY.render()

    assert 'mm_catalog_items{type="movie"} 118' in body
    assert 'mm_catalog_items{type="series"} 28' in body
    assert 'mm_catalog_items{type="disc"} 64' in body
    assert 'mm_catalog_items{type="tape"} 29' in body
    assert 'mm_ingest_queue_items{status="pending"} 2' in body
    assert 'mm_ingest_queue_items{status="completed"} 5' in body
    assert "mm_compliance_findings_open 7" in body
    assert "mm_media_assignments_total 9" in body
    assert "mm_poster_cache_files 3" in body
    assert "mm_sessions_active 3" in body

    # One COUNT per gauge family (4 catalog types + queue group-by + compliance
    # + assignments + sessions) — no table reads, no per-row work.
    assert all("count(" in query.lower() for query in factory.queries)
    assert len(factory.queries) == 8


def test_ingest_queue_gauge_always_emits_the_known_statuses(tmp_path):
    _factory, collector, _clock = _collector(tmp_path, queue_rows=[("quarantined", 4)])
    asyncio.run(collector.collect())
    body = REGISTRY.render()

    for status in ("pending", "processing", "auto_assigned", "needs_review", "failed", "completed"):
        assert f'mm_ingest_queue_items{{status="{status}"}} 0' in body
    # A status the code does not know about still gets reported.
    assert 'mm_ingest_queue_items{status="quarantined"} 4' in body


def test_poster_cache_gauge_counts_files_on_disk(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    assert count_poster_cache_files(empty) == 0
    assert count_poster_cache_files(tmp_path / "does-not-exist") == 0

    (empty / "a.jpg").write_bytes(b"x")
    (empty / "a.jpg.meta.json").write_bytes(b"{}")
    (empty / "nested").mkdir()
    (empty / "nested" / "b.jpg").write_bytes(b"x")
    assert count_poster_cache_files(empty) == 3

    _factory, collector, _clock = _collector(tmp_path, counts={})
    asyncio.run(collector.collect())
    # The walk is recursive: tmp_path itself has no loose files, but the
    # subdirectories written above hold three.
    assert "mm_poster_cache_files 3" in REGISTRY.render()


def test_gauge_counts_are_cached_for_sixty_seconds(tmp_path):
    factory, collector, clock = _collector(tmp_path, counts={"movies": 1})

    asyncio.run(collector.collect())
    first_read = len(factory.queries)
    assert first_read > 0

    # Repeated scrapes inside the TTL reuse the cached sample…
    asyncio.run(collector.collect())
    asyncio.run(collector.collect())
    assert len(factory.queries) == first_read
    clock.advance(59)
    asyncio.run(collector.collect())
    assert len(factory.queries) == first_read

    # …the expired window re-reads once, and force=True bypasses the cache.
    clock.advance(2)
    assert asyncio.run(collector.collect()) is True
    assert len(factory.queries) == first_read * 2
    asyncio.run(collector.collect())
    assert len(factory.queries) == first_read * 2
    asyncio.run(collector.collect(force=True))
    assert len(factory.queries) == first_read * 3


def test_failed_gauge_collection_keeps_the_previous_values(tmp_path):
    factory, collector, clock = _collector(tmp_path, counts={"movies": 12, "sessions": 1})
    asyncio.run(collector.collect())
    assert 'mm_catalog_items{type="movie"} 12' in REGISTRY.render()
    assert DOMAIN_GAUGE_ERRORS_TOTAL.get() == 0

    clock.advance(61)
    factory.fail = True
    assert asyncio.run(collector.collect()) is True

    body = REGISTRY.render()
    assert 'mm_catalog_items{type="movie"} 12' in body
    assert "mm_metrics_domain_gauge_errors_total 1" in body
    # A broken database is retried on the next TTL window, not every scrape.
    assert asyncio.run(collector.collect()) is False


# --------------------------------------------------------------------------
# GET /metrics
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_metrics_endpoint_is_unauthenticated_prometheus_text():
    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    collector = _RecordingCollector()
    main.app.state.domain_metrics = collector
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            # An unauthenticated normal request succeeds first, so the metrics
            # 200 below can't be mistaken for an auth redirect being counted.
            assert (await client.get("/")).status_code == 200
            response = await client.get(METRICS_PATH)
    finally:
        main.app.state.domain_metrics = previous

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert collector.calls == [False]

    body = response.text

    # Each family carries HELP/TYPE, which is what makes the text parseable.
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
        assert f"# HELP {gauge}" in body
        assert f"# TYPE {gauge} gauge" in body

    assert 'mm_http_requests_total{method="GET",path="/",status="200"} 1' in body
    # A histogram: one cumulative bucket line per bound (+Inf last), plus sum.
    buckets = 'mm_http_request_duration_seconds_bucket{method="GET",path="/",status="200",le="'
    assert body.count(buckets) == len(DURATION_BUCKETS_SECONDS) + 1
    assert f'{buckets}+Inf"}} 1' in body
    assert 'mm_http_request_duration_seconds_sum{method="GET",path="/",status="200"} ' in body
    assert 'mm_http_request_duration_seconds_count{method="GET",path="/",status="200"} 1' in body


@pytest.mark.asyncio
async def test_metrics_endpoint_asks_the_collector_on_every_scrape():
    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    collector = _RecordingCollector()
    main.app.state.domain_metrics = collector
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            assert (await client.get(METRICS_PATH)).status_code == 200
            assert (await client.get(METRICS_PATH)).status_code == 200
    finally:
        main.app.state.domain_metrics = previous

    # The collector owns the cache; the endpoint asks it on every scrape.
    assert collector.calls == [False, False]


@pytest.mark.asyncio
async def test_metrics_scrapes_are_not_instrumented():
    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    main.app.state.domain_metrics = _RecordingCollector()
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            for _ in range(3):
                assert (await client.get(METRICS_PATH)).status_code == 200
    finally:
        main.app.state.domain_metrics = previous

    body = REGISTRY.render()
    assert 'path="/metrics"' not in body


@pytest.mark.asyncio
async def test_unmatched_requests_share_one_series():
    """Path scanners must not add one series per probe."""
    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    main.app.state.domain_metrics = _RecordingCollector()
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            for path in ("/wp-login.php", "/api/nope", "/.env"):
                assert (await client.get(path)).status_code == 404
    finally:
        main.app.state.domain_metrics = previous

    body = REGISTRY.render()
    assert 'path="unmatched"' in body
    assert "/wp-login.php" not in body


@pytest.mark.asyncio
async def test_metrics_middleware_records_crashed_requests_as_500():
    """A crashing route is counted *and* still propagates to the error handler."""
    from fastapi import FastAPI

    from api.metrics import MetricsMiddleware

    crashing = FastAPI()
    crashing.add_middleware(MetricsMiddleware)

    @crashing.get("/api/crash")
    async def crash():
        raise RuntimeError("boom")

    async with AsyncClient(transport=ASGITransport(app=crashing), base_url="http://test") as client:
        with pytest.raises(RuntimeError):
            await client.get("/api/crash")

    body = REGISTRY.render()
    assert 'mm_http_requests_total{method="GET",path="/api/crash",status="500"} 1' in body
    assert 'mm_http_request_duration_seconds_count{method="GET",path="/api/crash",status="500"} 1' in body


# --------------------------------------------------------------------------
# Route-template labels
# --------------------------------------------------------------------------


def _scope(method: str, path: str):
    import main

    return {"type": "http", "method": method, "path": path, "app": main.app, "headers": []}


def test_route_template_collapses_parameterised_paths():
    assert route_template(_scope("GET", "/api/posters/movie/tt0111166")) == "/api/posters/{media_type}/{media_id}"
    assert route_template(_scope("GET", "/api/posters/series/tt0108778")) == "/api/posters/{media_type}/{media_id}"
    assert route_template(_scope("GET", "/")) == "/"
    assert route_template(_scope("GET", "/health")) == "/health"
    # A wrong-method request still belongs to the route it hit.
    assert route_template(_scope("POST", "/api/posters/movie/tt0111166")) == "/api/posters/{media_type}/{media_id}"


def test_route_template_groups_unmatched_paths_into_one_series():
    # A scanner probing arbitrary paths must not add a series per probe.
    for path in ("/favicon.ico", "/api/does-not-exist", "/api/posters/movie"):
        assert route_template(_scope("GET", path)) == "unmatched"


@pytest.mark.asyncio
async def test_parameterised_routes_stay_one_series_through_the_middleware():
    """End-to-end: two different ids must not mint two series."""
    from fastapi import FastAPI

    service = FastAPI()
    service.add_middleware(MetricsMiddleware)

    @service.get("/api/items/{item_id}")
    async def item(item_id: str):
        return {"id": item_id}

    async with AsyncClient(
        transport=ASGITransport(app=service), base_url="http://test"
    ) as client:
        assert (await client.get("/api/items/tt0111166")).status_code == 200
        assert (await client.get("/api/items/tt0108778")).status_code == 200

    body = REGISTRY.render()
    expected = 'mm_http_requests_total{method="GET",path="/api/items/{item_id}",status="200"}'
    assert f"{expected} 2" in body
    assert (
        'mm_http_request_duration_seconds_count{method="GET",'
        'path="/api/items/{item_id}",status="200"} 2' in body
    )
    # A concrete catalog id in a label would mean one series per record.
    assert "tt0111166" not in body
    assert "tt0108778" not in body


class _StatementCapturingSession(_FakeSession):
    async def scalar(self, statement):
        self.factory.statements.append(statement)
        return await super().scalar(statement)

    async def execute(self, statement):
        self.factory.statements.append(statement)
        return await super().execute(statement)


class _StatementCapturingSessionFactory(_FakeSessionFactory):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.statements = []

    def __call__(self):
        return _StatementCapturingSession(self)


def test_gauge_reads_are_filtered_counts_not_table_scans(tmp_path):
    factory = _StatementCapturingSessionFactory(
        counts={"compliance_findings": 7, "sessions": 4, "media_assignments": 9}
    )
    collector = DomainMetricsCollector(factory, poster_cache_dir=tmp_path, clock=_FakeClock())
    asyncio.run(collector.collect())

    flat = [" ".join(str(statement).split()) for statement in factory.statements]
    assert len(flat) == 8
    for statement in flat:
        assert "count(" in statement.lower(), statement
        assert " limit " not in statement.lower(), statement

    compliance = next(item for item in flat if "FROM compliance_findings" in item)
    assert "WHERE compliance_findings.status =" in compliance
    compliance_statement = next(
        statement
        for statement in factory.statements
        if "FROM compliance_findings" in " ".join(str(statement).split())
    )
    assert "'open'" in str(compliance_statement.compile(compile_kwargs={"literal_binds": True}))

    sessions = next(item for item in flat if "FROM sessions" in item)
    assert "WHERE sessions.expires_at >" in sessions
    session_statement = next(
        statement
        for statement in factory.statements
        if "FROM sessions" in " ".join(str(statement).split())
    )
    cutoff = list(session_statement.compile().params.values())[0]
    # sessions.expires_at is timestamptz: a naive datetime here would either
    # error in Postgres or count every expired session as active.
    assert cutoff.tzinfo is not None

    assignments = next(item for item in flat if "FROM media_assignments" in item)
    assert "WHERE" not in assignments


# --------------------------------------------------------------------------
# Exposition format conformance — a scrape has to parse
# --------------------------------------------------------------------------


_LABEL_PAIR = r'[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\\n]|\\[n"\\])*"'
_SAMPLE_LINE = re.compile(
    r"^[a-zA-Z_:][a-zA-Z0-9_:]*"
    r"(?:\{" + _LABEL_PAIR + r"(?:," + _LABEL_PAIR + r")*\})?"
    r" -?(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\+Inf|-Inf|NaN)$"
)
_HELP_LINE = re.compile(r"^# HELP [a-zA-Z_:][a-zA-Z0-9_:]*( .*)?$")
_TYPE_LINE = re.compile(r"^# TYPE [a-zA-Z_:][a-zA-Z0-9_:]* (counter|gauge|untyped|histogram|summary)$")


def _assert_prometheus_text(body: str) -> None:
    """Line-by-line check against the text exposition grammar."""
    families = {}
    for line in body.splitlines():
        if not line:
            continue
        if line.startswith("# TYPE "):
            match = _TYPE_LINE.match(line)
            assert match, line
            name = line.split()[2]
            assert name not in families, f"duplicate TYPE for {name}"
            families[name] = match.group(1)
            continue
        if line.startswith("# HELP "):
            assert _HELP_LINE.match(line), line
            continue
        assert not line.startswith("#"), line
        assert _SAMPLE_LINE.match(line), line
        sample = line.split("{")[0].split(" ")[0]
        assert any(
            sample == name or sample.startswith(f"{name}_") for name in families
        ), f"{sample} is exported without a TYPE line"

    # Histogram buckets: one cumulative run per series, +Inf last and never
    # decreasing, which is what PromQL histogram_quantile() depends on.
    buckets: dict[str, list[tuple[str, int]]] = {}
    for line in body.splitlines():
        if "_bucket{" not in line:
            continue
        series, _, rest = line.partition(',le="')
        bound, _quote, tail = rest.partition('"')
        buckets.setdefault(series, []).append((bound, int(tail.lstrip("} "))))
    for series, samples in buckets.items():
        assert samples[-1][0] == "+Inf", series
        previous = -1
        for bound, value in samples:
            assert value >= previous, f"buckets are not cumulative: {bound}"
            previous = value


def test_rendered_exposition_parses_as_prometheus_text():
    from services.metrics import (
        CATALOG_ITEMS,
        HTTP_REQUEST_DURATION_SECONDS,
        HTTP_REQUESTS_TOTAL,
        INGEST_QUEUE_ITEMS,
        POSTER_CACHE_FILES,
    )

    HTTP_REQUESTS_TOTAL.inc(("GET", "/api/items/{item_id}", "200"))
    HTTP_REQUESTS_TOTAL.inc(("GET", "/api/items/{item_id}", "200"), amount=3)
    HTTP_REQUEST_DURATION_SECONDS.observe(("GET", "/api/items/{item_id}", "200"), 0.0031)
    HTTP_REQUEST_DURATION_SECONDS.observe(("GET", "/api/items/{item_id}", "200"), 12.5)
    CATALOG_ITEMS.set(("movie",), 118)
    INGEST_QUEUE_ITEMS.set(("needs_review",), 0)
    POSTER_CACHE_FILES.set(value=41)

    body = REGISTRY.render()
    _assert_prometheus_text(body)
    assert body.endswith("\n")
    assert (
        'mm_http_requests_total{method="GET",path="/api/items/{item_id}",status="200"} 4' in body
    )
    inf_line = next(line for line in body.splitlines() if 'le="+Inf"' in line)
    assert inf_line.endswith(" 2")


@pytest.mark.asyncio
async def test_scrape_of_a_dead_database_still_returns_parsable_metrics():
    """The real collector against an unreachable DB: 200, never a 500."""
    from db.database import AsyncSessionLocal

    import main

    previous = getattr(main.app.state, "domain_metrics", None)
    main.app.state.domain_metrics = DomainMetricsCollector(AsyncSessionLocal)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            response = await client.get(METRICS_PATH)
    finally:
        main.app.state.domain_metrics = previous

    assert response.status_code == 200
    # Starlette appends its own charset to any text/* media type, so the header
    # carries a duplicated `charset=utf-8` parameter; the media type and the
    # version parameter are what the Prometheus scraper keys on.
    content_type = response.headers["content-type"]
    assert content_type.startswith("text/plain")
    assert "version=0.0.4" in content_type
    _assert_prometheus_text(response.text)
    for gauge in (
        "mm_catalog_items",
        "mm_ingest_queue_items",
        "mm_compliance_findings_open",
        "mm_media_assignments_total",
        "mm_poster_cache_files",
        "mm_sessions_active",
    ):
        assert f"# TYPE {gauge} gauge" in response.text
