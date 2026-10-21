"""
GET /metrics plus the HTTP request instrumentation (issue #14).

Prometheus pulls metrics, so this endpoint is unauthenticated — same contract as
GET /health, and required for a scraper that has no media-manager credentials.

Two pieces:
  * route_template() + MetricsMiddleware: per-request count and latency, always
    labelled with the matched route *template* so parameterised URLs
    (/api/posters/movie/tt0111166) collapse into one series instead of one per
    catalog record.
  * the metrics router: renders the registry and refreshes the cached domain
    gauges when their TTL has expired.
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

# Requests to /metrics itself are not instrumented: a 15s scrape interval would
# otherwise add its own series (and latency samples) to the data it exports.
METRICS_PATH = "/metrics"

# Everything that matches no route (favicon, path scanners, deleted endpoints)
# shares one label. A raw path would blow up cardinality on every probe.
UNMATCHED_PATH_LABEL = "unmatched"


def route_template(scope: dict) -> str:
    """Route template for an ASGI scope: path_format() with its {param} back."""
    route = scope.get("route")
    if route is not None:
        template = getattr(route, "path", None) or getattr(route, "path_format", None)
        if template:
            return template

    app = scope.get("app")
    for candidate in getattr(app, "routes", []) if app is not None else []:
        match, child_scope = candidate.matches(scope)
        if match == Match.NONE:
            continue
        if match == Match.PARTIAL and not child_scope.get("path_params"):
            # A partial match with no parameters is a Mount prefix (no route of
            # ours served this path), not the 405-on-a-parameterised-route case.
            return UNMATCHED_PATH_LABEL
        # path_format keeps the {param} placeholders; path is the same for the
        # function-decorated routes that have no parameters.
        template = getattr(candidate, "path_format", None) or getattr(candidate, "path", None)
        return template or UNMATCHED_PATH_LABEL
    return UNMATCHED_PATH_LABEL


class MetricsMiddleware(BaseHTTPMiddleware):
    """Counts and times every request once the response is decided.

    The latency sample is taken when the response *starts*, which is the same as
    its completion for the JSON routes here and time-to-first-byte for any route
    that streams its body.
    """

    @staticmethod
    def _record(labels: tuple, started: float) -> None:
        HTTP_REQUESTS_TOTAL.inc(labels)
        HTTP_REQUEST_DURATION_SECONDS.observe(labels, time.perf_counter() - started)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.scope.get("path", "")
        if path == METRICS_PATH or path.startswith(METRICS_PATH + "/"):
            return await call_next(request)

        started = time.perf_counter()
        # Route template is resolved before dispatching: a route that raises
        # unwinds the scope without it, and that request still has to be counted.
        labels = [request.method, route_template(request.scope)]
        try:
            response = await call_next(request)
            labels.append(str(getattr(response, "status_code", 200)))
        except Exception:
            # Record it, then put the exception back on its way so the error
            # middleware still turns it into a 500 body — a crashing route must
            # show up in the counts instead of vanishing from them.
            labels.append("500")
            self._record(tuple(labels), started)
            raise

        self._record(tuple(labels), started)
        return response


router = APIRouter()


@router.get(METRICS_PATH, include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus text exposition of HTTP metrics and the domain gauges."""
    collector = getattr(request.app.state, "domain_metrics", None)
    if collector is not None:
        await collector.collect()
    return PlainTextResponse(REGISTRY.render(), media_type=PROMETHEUS_CONTENT_TYPE)
