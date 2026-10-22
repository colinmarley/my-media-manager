# Ingest triage API: DB-backed grouped queue listing and bulk actions

Part of epic **#17** (`[O1] Ingest review backlog: bulk triage UI`).
Depends on: nothing — this is the first slice; #2 and #3 build on it.

## Problem

The ingest review queue is unusable at backlog scale (the epic reports a backlog of
roughly 24.7k rows in `ingress_queue`; slice #4 re-counts it):

- `GET /api/ingress/queue/items` returns `IngressQueueService.get_queue_items()`, which
  iterates the **in-memory** `item_order` list. `backend/main.py` creates a fresh
  `IngressQueueService` at startup with no reload from Postgres, so after any restart the
  API — and therefore the UI — only sees files detected since that restart. The backlog
  itself is invisible.
- The endpoint is unpaginated and returns every row; the frontend client aborts requests
  after 15 s (`src/service/ingress/IngressAutomationService.ts`).
- There is no grouping. Reviewers see one flat list and triage it one file at a time,
  while the work actually arrives per source folder (a disc rip = one folder = one
  accept/reject decision).
- "Bulk" today is a client-side loop that replays single-item calls
  (`runQueueActionsSequentially`, `filterSelectableQueueItemIds`,
  `handleBulkQueueActionClick` in `src/app/admin/_components/IngressAutomationPanel.tsx`,
  where the only bulk button is "Retry Failed" for the current selection).
  It dies on page unload and gives no batch-level audit record.
- There is no **ignore** outcome. Terminal statuses are `completed` / `failed` /
  `needs_review`; nothing says "this file stays where it is, stop showing it".
- Every mutation (`retry_item`, `mark_complete`, `mark_failed`, `update_classification`,
  `manual_assign_item`) returns `None` when the id is not in `items_by_id`, so bulk
  actions against historical rows silently do nothing today.

## Scope

### In scope

1. **Grouped, paginated listing read from Postgres** (`ingress_queue`, joined with the
   newest `ingress_processing_history` snapshot where useful):
   - `GET /api/ingress/queue/groups?group_by=source_folder|parsed_title&status=&q=&limit=&offset=`
   - per group: `key`, `total`, per-status counts, oldest/newest `queued_at`,
     min/max/avg `confidence_score`, up to `preview_limit` sample items.
   - `source_folder` = path relative to the item's `ingress_path` (the disc/folder the
     rip landed in); `parsed_title` = `parsed_info->>'title'` with a `(unparsed)` bucket.
   - hard cap on page size (≤200 groups, ≤500 preview items) so the 15 s client timeout
     is never reachable.
2. **Bulk actions**: `POST /api/ingress/queue/bulk` with
   `{ action, item_ids }` **or** `{ action, group_key, group_by, status }` (whole-group
   selector so the caller does not have to post thousands of ids), where `action` is
   `accept | ignore | retry | classify` (+ `classification` for `classify`).
   Server-side chunking, per-item results, partial success allowed, HTTP 200 with
   `{ attempted, succeeded, failed: [{id, error}] }`.
3. **A real ignore outcome**: add `QUEUE_IGNORED = "ignored"` to the queue-status
   constants, set `processed_at`, and make ignored items excluded from the pending
   selection (`_get_next_pending_item`) and from auto-retry in `run_ingress_auto_processor`.
   Add the new value to `INGEST_QUEUE_STATUSES` in `backend/services/metrics.py` and to
   the `mm_ingest_queue_items` label list in `docs/api/endpoints.md`.
4. **Batch audit trail**: pass `{"batch_id": <uuid>, "action": <action>, "source": "bulk"}`
   into `_record_history_event` so each item still gets exactly one
   `ingress_processing_history` row, now attributable to a bulk decision. Add the missing
   event for `retry_item` (it currently re-persists with no history row).
5. **Make mutations work on DB-only rows**: load the `ingress_queue` row into the
   in-memory map first (a `hydrate_item(item_id)` helper) instead of returning `None`, so
   backlog items can be triaged after a restart.

### Out of scope (later slices)

- Any UI changes (#2), Jev/AI confidence (#3), and the "why did queueing stop"
  investigation (#4).
- Undo/revert of a bulk action (record enough to build it later; do not build it).
- Adding columns for `classification_override`, `is_alternate_version`, `version_number`,
  `special_feature_number`, `unknown_episode_label` (they exist on the dataclass but not
  on the table). If grouping/bulking needs them, read them from the latest history
  snapshot and note the gap in the PR; a migration is a separate decision.

## Acceptance criteria

- [ ] `GET /api/ingress/queue/groups` returns rows from Postgres, including items added
      before the current backend process started.
- [ ] Group counts and per-status counts are correct for a mixed fixture set
      (pending / needs_review / failed / completed).
- [ ] `q` filters on `file_name` and `parsed_info->>'title'`; `limit`/`offset` page groups
      and `limit` is capped server-side.
- [ ] `POST /api/ingress/queue/bulk` accepts both an explicit id list and a group
      selector, and returns per-item success/failure without aborting the batch on the
      first failure.
- [ ] Bulk accept organizes exactly like single-item accept (`mark_complete` path), bulk
      ignore sets `ignored`, bulk classify reuses `update_classification` validation.
- [ ] Exactly one `ingress_processing_history` row per mutated item, carrying
      `batch_id`, `action` and `source: "bulk"`.
- [ ] Ignored items are not picked up by the auto-processor or the failed-item auto-retry.
- [ ] New endpoints documented in `docs/api/endpoints.md`.
- [ ] `backend/.venv/bin/python -m pytest -q -m "not integration" --rootdir backend -c
      backend/pytest.ini backend/tests` passes, including new tests that **fail on
      `refactor`**.

## Suggested touch points

- `backend/services/ingress_queue_service.py` — status constant, `hydrate_item`, bulk
  helpers, history extras.
- new `backend/services/ingress_triage_service.py` if the queue service grows past
  ~100 added lines — keep grouping SQL out of the processing class.
- `backend/api/ingress_operations.py` — the two new routes (same envelope:
  `{"success": true, "data": ...}`).
- `docs/api/endpoints.md` — endpoint reference.
- Tests: `backend/tests/test_ingress_triage_service.py` (grouping SQL against the
  integration-marked DB if needed) plus a service-level unit test with
  `db_session_factory` stubbed, matching the style of
  `backend/tests/test_ingress_queue_service.py`.

## Constraints

- Keep the whole change under ~400 added lines; if it does not fit, split the bulk
  endpoint into a follow-up issue rather than growing this one.
- No destructive file operations: `accept` must go through the existing
  `AssignmentOrchestrator` path and never move files by itself.
- Never issue a bulk SQL `UPDATE` that skips `ingress_processing_history` — the audit
  trail is an acceptance criterion, not an optimization.
