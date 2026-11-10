"""
GET /metrics plus the HTTP request instrumentation (issue #14).

Prometheus pulls metrics, so the endpoint is unauthenticated — same contract as
GET /health, and required for a scraper with no media-manager credentials.
route_template() and MetricsMiddleware label every request with the matched route
*template*, so /api/posters/movie/tt0111166 stays one series instead of one per
record; the router renders the registry and refreshes the cached domain gauges.
"""

import time

from fastapi import APIRouter, Request, Response
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.routing import Match

from services.metrics import (
    HTTP_REQUEST_DURATION_SECONDS,
    HTTP_REQUESTS_TOTAL,
    PROMETHEUS_CONTENT_TYPE,
    REGISTRY,
)

# Scrapes of /metrics are not instrumented: they would pollute their own data.
METRICS_PATH = "/metrics"

# Requests matching no route (favicon, path scanners, deleted endpoints) share one
# label; a raw path would mint one series per probe.
UNMATCHED_PATH_LABEL = "unmatched"


def route_template(scope: dict) -> str:
    """Route template for an ASGI scope, with its {param} placeholders kept."""
    template = getattr(scope.get("route"), "path", None)
    if template:
        return template

    match_template = None
    for route in getattr(scope.get("app"), "routes", ()):
        matched, child_scope = route.matches(scope)
        # A full match serves the request; a partial match *with* parameters is a
        # wrong-method hit on the same route. A partial match with no parameters
        # is a Mount prefix no route of ours answered, so it stays unmatched.
        if matched == Match.FULL or (matched != Match.NONE and child_scope.get("path_params")):
            match_template = match_template or getattr(route, "path_format", None) or route.path
    return match_template or UNMATCHED_PATH_LABEL


def _record(labels: list, started: float) -> None:
    key = tuple(labels)
    HTTP_REQUESTS_TOTAL.inc(key)
    HTTP_REQUEST_DURATION_SECONDS.observe(key, time.perf_counter() - started)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Counts and times every request once its response is decided.

    The latency sample is taken when the response *starts*: completion for the
    JSON routes here, time-to-first-byte for anything that streams.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.scope.get("path", "")
        if path == METRICS_PATH or path.startswith(METRICS_PATH + "/"):
            return await call_next(request)

        started = time.perf_counter()
        # Resolved before dispatching: a route that raises unwinds the scope
        # without it, and that request still has to be counted.
        labels = [request.method, route_template(request.scope)]
        try:
            response = await call_next(request)
            labels.append(str(getattr(response, "status_code", 200)))
        except Exception:
            # Record it, then put the exception back on its way so the error
            # middleware still turns it into a 500 body: a crashing route shows up
            # in the counts instead of vanishing from them.
            labels.append("500")
            _record(labels, started)
            raise

        _record(labels, started)
        return response


router = APIRouter()


@router.get(METRICS_PATH, include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus text exposition of the HTTP metrics and the domain gauges."""
    collector = getattr(request.app.state, "domain_metrics", None)
    if collector is not None:
        await collector.collect()
    return PlainTextResponse(REGISTRY.render(), media_type=PROMETHEUS_CONTENT_TYPE)
