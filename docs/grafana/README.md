# Grafana dashboard

[`media-manager.json`](./media-manager.json) charts the metrics served by
`GET /metrics` (see [API Endpoints](../api/endpoints.md)). It needs Prometheus to
scrape job `media-manager` (target `192.168.0.227:8082`) first.

| Panel | Query (abridged) |
| --- | --- |
| Catalog size over time | `sum by (type) (mm_catalog_items)` |
| Ingest backlog by status | `sum by (status) (mm_ingest_queue_items{status!="completed"})` |
| Request rate | `sum by (path) (rate(mm_http_requests_total[…]))` |
| 5xx rate | `rate(mm_http_requests_total{status=~"5.."}[…])`, plus the share of all requests |
| p95 latency | `histogram_quantile(0.95, sum by (le) (rate(mm_http_request_duration_seconds_bucket[…])))` |

Every query is filtered on `job="$job"`, a hidden constant set to `media-manager`;
edit it under *Dashboard settings → Variables* if the scrape job is named differently.

## Importing

1. In Grafana, open *Dashboards → New → Import*.
2. Upload `docs/grafana/media-manager.json` (or paste its contents) and click *Load*.
3. Pick the Prometheus data source for the **Prometheus** input, then *Import*.

The dashboard uid is `media-manager`, so importing again overwrites it in place
(say *Import (Overwrite)* when asked) instead of creating a copy.

## Proposed Home Dashboard tile

For the human to apply in the home-dashboard repo, using the same Prometheus. One
tile, 2 columns wide × 1 row high, titled **Media Manager**, linking to the Grafana
dashboard (`/d/media-manager`):

```
┌──────────────────────────────────────────┐
│ Media Manager                       ● up │
│  1,234 items      7 in backlog    0.0% 5xx│
│  p95 180 ms                              │
└──────────────────────────────────────────┘
```

| Field | PromQL (instant query) | Format |
| --- | --- | --- |
| status dot | `up{job="media-manager"}` | green at 1, red at 0 or no data |
| items | `sum(mm_catalog_items{job="media-manager"})` | integer |
| in backlog | `sum(mm_ingest_queue_items{job="media-manager", status!="completed"})` | integer; red while `mm_ingest_queue_items{status="failed"}` > 0 |
| 5xx | `sum(rate(mm_http_requests_total{job="media-manager", status=~"5.."}[15m])) / clamp_min(sum(rate(mm_http_requests_total{job="media-manager"}[15m])), 1e-9)` | percent, 1 decimal; red above 1% |
| p95 | `histogram_quantile(0.95, sum by (le) (rate(mm_http_request_duration_seconds_bucket{job="media-manager"}[15m])))` | milliseconds; amber above 1 s |

The backlog is every queue status but `completed`, matching the dashboard panel. A
15-minute window keeps the 5xx and p95 figures steady on a quiet homelab, where a
5-minute window is often empty.
