# Ingest Review Backlog — Epic #17 slice plan

Date: 2026-10-22
Status: Proposed (not started)
Epic: #17 — `[O1] Ingest review backlog: bulk triage UI`
Owner: Media Manager

Epic #17 is explicitly an epic that has to be split into issues before anything is built,
and its only acceptance criterion is **"Slices filed as separate issues and linked
here."** This directory is that split. Each numbered file is written as a ready-to-file
GitHub issue body, so filing is copy/paste rather than new writing.

## Slices

| # | Issue title | Depends on | File | Rough size |
|---|---|---|---|---|
| 1 | Ingest triage API: DB-backed grouped queue listing and bulk actions | — | [01-triage-api.md](./01-triage-api.md) | ~350 lines backend |
| 2 | Ingest triage UI: grouped queue view with per-group accept/ignore | 1 | [02-triage-ui.md](./02-triage-ui.md) | ~350 lines frontend |
| 3 | Show Jev classifier suggestion/confidence in triage and bulk-accept above threshold | 1, 2, `feat/jev-ingest-decisions` | [03-jev-confidence-triage.md](./03-jev-confidence-triage.md) | ~150 lines |
| 4 | Investigate: nothing has been queued into the ingest queue since 2026-06-07 | — (read-only) | [04-queue-stall-investigation.md](./04-queue-stall-investigation.md) | report, no code |

Build order: **1 → 2 → 3**. Slice **4** is read-only and can run in parallel at any time.
Slice 3 is blocked until the Jev branch is merged into `refactor` (see below).

Every slice is scoped to stay under the project's 400-line per-issue limit.

## Filing these as issues

Filing needs GitHub write access, which the factory builder role does not have
(no `gh` in the builder shell, and the builder must not comment on or edit issues).
A maintainer (or the factory operator) files them with:

```bash
gh issue create --title "Ingest triage API: DB-backed grouped queue listing and bulk actions" \
  --body-file docs/plans/ingest-review-backlog/01-triage-api.md --label enhancement
```

…once per slice, then adds a checklist of the created issue numbers to epic #17's
body so the epic shows `Slices filed as separate issues and linked here` as done.
Update the "Depends on" lines in each issue with the real numbers.

## Findings that shaped the split (read before building)

These were verified against `refactor` at the time of writing; they change what the
slices have to do, so they are recorded once here instead of being re-derived per issue.

1. **The review queue the UI shows is in-memory only.** `IngressQueueService.get_queue_items()`
   / `get_queue_status()` iterate `self.item_order` / `self.items_by_id`
   (`backend/services/ingress_queue_service.py`), and `backend/main.py` builds a fresh
   `IngressQueueService` on startup with no reload from Postgres. Rows are written to
   `ingress_queue` (`_persist_queue_item`) and are the durable record, but after any
   backend restart the queue view only contains files detected since that restart. The
   backlog in the issue title lives in the table, not in memory — so slice 1 must be
   DB-backed, not a grouping layer over the existing endpoint. The Prometheus gauge
   `mm_ingest_queue_items` already counts `ingress_queue` straight from SQL
   (`backend/services/metrics.py`, grouped by `status`), which is why queue metrics and
   the UI's queue counts can disagree about the same installation.
2. **`GET /api/ingress/queue/items` is unpaginated** and returns the whole list; the
   frontend client aborts any request older than 15 s
   (`src/service/ingress/IngressAutomationService.ts`). At backlog scale this endpoint
   cannot be the triage source regardless of grouping.
3. **Bulk work is today a client-side loop.** `IngressAutomationPanel.tsx` keeps a
   selection and replays single-item calls sequentially via
   `runQueueActionsSequentially` / `filterSelectableQueueItemIds`. Each item already
   writes one `ingress_processing_history` row through `_record_history_event`, so the
   audit-trail half of "record actions in `ingress_processing_history`" exists — what is
   missing is a batch id to tie a bulk decision together, and a server-side bulk call
   that survives a page unload.
4. **There is no "ignore" outcome.** The terminal statuses are `completed`, `failed`,
   `needs_review`; "accept" is `mark_complete` and there is no way to say "leave this
   file where it is, stop showing it". Slice 1 introduces that status because the epic's
   accept/ignore workflow needs it.
5. **The Jev classifier is not on `refactor`.** Commit `0d06fef`
   ("Add optional Jev decision model for ingest main/version/special classification",
   branch `feat/jev-ingest-decisions`) adds `backend/services/ingest_ai_classifier.py`,
   `MEDIA_LIBRARY_INGEST_AI_MODE` (`off|shadow|assist`),
   `MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE`, answers stored at
   `parsed_info["ai_classification"]`, `POST /api/ingress/queue/ai-classify` and
   `GET /api/ingress/queue/ai-report`. Slice 3 builds on that; it must not invent a
   second classifier.
6. **`ingress_auto_start_watcher` defaults to `False`** (`backend/config/settings.py`), and
   `run_ingress_auto_processor` only pulls work while `watcher_service.is_running`. This
   is the strongest lead for slice 4 and is written up there rather than fixed here.
7. **Statuses are a fixed set today** (`pending`, `processing`, `auto_assigned`,
   `needs_review`, `failed`, `completed`) referenced in the queue service, in
   `backend/services/metrics.py` (`INGEST_QUEUE_STATUSES`) and in the Prometheus label
   list in `docs/api/endpoints.md`. Any new terminal status has to be added in all three.
