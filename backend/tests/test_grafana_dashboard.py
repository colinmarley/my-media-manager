"""
docs/grafana/media-manager.json and its import doc (issue #15).

The dashboard is only useful while its PromQL names metrics, labels and label
values that GET /metrics actually exposes, so every query is checked against the
live registry in services/metrics.py: renaming a metric breaks this test, not
the dashboard on the wall.

  AC1 dashboard JSON with catalog size, ingest backlog by status, request rate,
      5xx rate and p95 latency:
        test_dashboard_has_the_five_panels
        test_dashboard_queries_only_name_exposed_metrics_and_labels
        test_dashboard_is_importable
  AC2 import doc plus a proposed Home Dashboard tile (query + layout):
        test_import_doc_covers_import_and_home_dashboard_tile
"""

import json
import re
from pathlib import Path

from services.metrics import INGEST_QUEUE_STATUSES, REGISTRY

REPO_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_PATH = REPO_ROOT / "docs" / "grafana" / "media-manager.json"
DOC_PATH = REPO_ROOT / "docs" / "grafana" / "README.md"

PANEL_TITLES = {"Catalog size over time", "Ingest backlog by status", "Request rate",
                "5xx rate", "p95 latency"}

# Labels Prometheus adds at scrape time, plus the histogram bucket bound.
SCRAPE_LABELS = {"job", "instance", "le"}


def _dashboard() -> dict:
    return json.loads(DASHBOARD_PATH.read_text())


def _exprs(dashboard: dict) -> list:
    return [target["expr"] for panel in dashboard["panels"] for target in panel["targets"]]


def _exposed_series() -> dict:
    """Series name -> label names, histogram _bucket/_sum/_count included."""
    series = {}
    for metric in REGISTRY.families:
        labels = set(metric.labelnames) | SCRAPE_LABELS
        names = ([f"{metric.name}{suffix}" for suffix in ("_bucket", "_sum", "_count")]
                 if metric.kind == "histogram" else [metric.name])
        series.update({name: labels for name in names})
    return series


def test_dashboard_has_the_five_panels():
    panels = _dashboard()["panels"]
    assert {panel["title"] for panel in panels} == PANEL_TITLES
    by_title = {panel["title"]: " ".join(t["expr"] for t in panel["targets"]) for panel in panels}
    assert "mm_catalog_items" in by_title["Catalog size over time"]
    assert "by (status)" in by_title["Ingest backlog by status"]
    assert "rate(mm_http_requests_total" in by_title["Request rate"]
    assert 'status=~"5.."' in by_title["5xx rate"]
    assert "histogram_quantile(0.95" in by_title["p95 latency"]
    assert "mm_http_request_duration_seconds_bucket" in by_title["p95 latency"]


def test_dashboard_queries_only_name_exposed_metrics_and_labels():
    exposed = _exposed_series()
    for expr in _exprs(_dashboard()):
        names = re.findall(r"\bmm_\w+", expr)
        assert names, expr
        for name in names:
            assert name in exposed, f"{name} is not exposed by GET /metrics"
        for name, matchers in re.findall(r"\b(mm_\w+)\{([^}]*)\}", expr):
            for label, value in re.findall(r'(\w+)\s*(?:=~|!~|!=|=)\s*"([^"]*)"', matchers):
                assert label in exposed[name], f"{name} has no label {label}"
                if label == "status" and name == "mm_ingest_queue_items":
                    assert value in INGEST_QUEUE_STATUSES, value
        for grouping in re.findall(r"by \(([^)]*)\)", expr):
            for label in (part.strip() for part in grouping.split(",")):
                assert any(label in exposed[name] for name in names), f"no metric has label {label}"


def test_dashboard_is_importable():
    dashboard = _dashboard()
    assert dashboard["uid"] == "media-manager"
    assert [entry["name"] for entry in dashboard["__inputs"]] == ["DS_PROMETHEUS"]
    assert all(panel["datasource"]["uid"] == "${DS_PROMETHEUS}" for panel in dashboard["panels"])
    assert len({panel["id"] for panel in dashboard["panels"]}) == len(dashboard["panels"])
    job = next(var for var in dashboard["templating"]["list"] if var["name"] == "job")
    assert job["query"] == "media-manager"
    assert all('job="$job"' in expr for expr in _exprs(dashboard))


def test_import_doc_covers_import_and_home_dashboard_tile():
    doc = DOC_PATH.read_text()
    assert "media-manager.json" in doc
    assert "Import" in doc
    tile = doc.split("## Proposed Home Dashboard tile", 1)[1]
    for metric in ("mm_catalog_items", "mm_ingest_queue_items", "mm_http_requests_total",
                   "mm_http_request_duration_seconds_bucket"):
        assert metric in tile
    assert "┌" in tile  # the layout sketch
