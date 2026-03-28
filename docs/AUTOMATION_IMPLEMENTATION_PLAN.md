# Automation Implementation Plan

## Product Goal
Make this project operate as an automated media manager for your AI workstation ingest flow:

1. Backend listens for newly encoded files in ingress folders.
2. New files are parsed and auto-matched to movie/show metadata.
3. High-confidence matches are auto-assigned and auto-organized to destination folders.
4. Low-confidence items remain visible for manual assignment/editing in UI.
5. UI shows status for items at any stage of the flow.

## Completed In This Implementation Pass

### 1. UI Consolidation (Prerequisite)

Completed route consolidation to remove test/duplicate UI paths and keep a canonical admin entry point.

### 2. Backend Ingress Automation Wiring

Implemented in backend:

- `backend/config/settings.py`
  - Added ingress defaults and automation controls:
    - `ingress_default_paths`
    - `ingress_auto_process_enabled`
    - `ingress_auto_process_interval_seconds`
    - `ingress_auto_assign_threshold`
    - `ingress_auto_organize_enabled`
    - `ingress_auto_start_watcher`

- `backend/api/ingress_operations.py`
  - Start watcher now falls back to default ingress paths when none are supplied.
  - Added `POST /api/ingress/queue/process-pending` for batch queue processing.
  - Added `GET /api/ingress/config` for UI/runtime visibility of ingress settings.

- `backend/services/ingress_queue_service.py`
  - Added `process_pending_items(max_items)`.
  - Updated auto-assignment flow to mark items `completed` when organization succeeds.
  - Captures organization errors in queue item `last_error`.

- `backend/services/assignment_orchestrator.py`
  - Extended to accept file organization service and auto-organize setting.
  - Creates assignment records and optionally triggers organization immediately.
  - Returns structured assignment/organization result payload.

- `backend/main.py`
  - Wires orchestrator with `FileOrganizationService`.
  - Adds background auto-processor task that continuously processes pending queue items while watcher is running.
  - Supports optional watcher auto-start on backend startup.

### 3. Admin UI: Ingress Automation Panel

Implemented in frontend:

- New service: `src/service/ingress/IngressAutomationService.ts`
  - API client for watcher status/control, queue status/items, history, and config.

- New admin component: `src/app/admin/_components/IngressAutomationPanel.tsx`
  - Real-time watcher status and queue summary.
  - Start/stop watcher controls.
  - Manual “process pending now” trigger.
  - Queue item table and recent history panel.
  - Clear visibility into auto-assign threshold and auto-organize state.

- Admin integration:
  - Added admin tab value `Ingress` in `src/app/admin/layout.tsx`.
  - Added renderer case in `src/app/admin/page.tsx`.

## Current End-to-End Flow

1. Start backend.
2. Ingress watcher starts manually (or automatically if `ingress_auto_start_watcher=true`).
3. New encoded file appears in ingress path.
4. File watcher queues stable files.
5. Auto-processor loop processes queue items.
6. Filename parser + matcher derive candidate match and confidence.
7. If confidence >= threshold:
   - assignment record created
   - file organization attempted immediately
   - queue item marked completed when successful
8. If confidence < threshold:
   - queue item remains `needs_review`
   - visible in admin ingress panel and existing manual tools

## Remaining Work (Next Iteration)

All items from the previous iteration have been completed. See below for what was implemented.

## Second Implementation Pass — Completed

### 1. Persist ingress config to Firestore

- `FirestoreService.save_ingress_config()` / `get_ingress_config()` — stores/retrieves the `ingress_config/current` document.
- On backend startup the persisted config is loaded from Firestore and merged over settings defaults, so the last saved values survive restarts.
- `PUT /api/ingress/config` endpoint accepts partial updates (threshold, auto-organize, auto-process, default paths), applies them to the running service state (updates `IngressQueueService.auto_assign_threshold` live), and persists to Firestore.
- `GET /api/ingress/config` now reads from `app.state.ingress_runtime_config` instead of the static settings object.
- Admin Ingress panel has an **Automation Settings** card with editable fields and a **Save Config** button.

### 2. Review queue UI actions

- `IngressAutomationService.ts` gained `retryItem`, `markComplete`, `markFailed`, `updateConfig`, `getQueueStatusMap`, `getHealth` methods.
- Queue table in `IngressAutomationPanel` now shows per-row action buttons:
  - **Retry** (↺) — for `failed` or `needs_review` items — resets to `pending`.
  - **Mark done** (✓) — for `needs_review` or `auto_assigned` items — marks `completed`.
  - **Dismiss** (✕) — for `needs_review` items — marks `failed` with reason "Manually dismissed".
- Queue table also shows **Match title + year** from `best_match` and color-coded status chips.

### 3. TMDB fallback matching

- `tmdb_api_key: str = ""` added to `LibrarySettings` (env var `MEDIA_LIBRARY_TMDB_API_KEY`).
- `AutoMatcherService` now accepts `tmdb_api_key` and calls `search/movie` or `search/tv` on `api.themoviedb.org/3` when OMDB returns no candidates.
- Both OMDB and TMDB candidates are scored with the same `_calculate_confidence` logic; best overall candidate wins.

### 4. Status chips in Library Browser

- `LibraryBrowser.tsx` imports `IngressAutomationService` and fetches `GET /api/ingress/queue/status-map` on mount and every 8 seconds.
- A new **Ingress Status** column appears in the file table. Files whose path matches a queued item show a color-coded chip (info, warning, success, error) with a tooltip showing the matched title and confidence score.

### 5. Startup health checks

- `main.py` logs an `INFO` or `WARNING` for each configured ingress path and for the Jellyfin destination mount on backend startup.
- `GET /api/ingress/health` endpoint returns per-path existence/readability status and destination mount writability.
- `IngressAutomationPanel` fetches health on load and surfaces a warning banner if any path is inaccessible.

## Current End-to-End Flow

1. Start backend — config is loaded from Firestore (or falls back to settings).
2. Startup health checks log status of ingress and destination paths.
3. Ingress watcher starts manually (or automatically if `ingress_auto_start_watcher=true`).
4. New encoded file appears in ingress path.
5. File watcher queues stable files.
6. Auto-processor loop processes queue items:
   - Filename parser extracts title/year/season/episode.
   - OMDB search runs first; TMDB fallback runs if OMDB returns no candidates.
   - Confidence score calculated.
7. If confidence >= threshold:
   - Assignment record created in Firestore.
   - File moved to Jellyfin folder structure.
   - Queue item marked `completed`.
8. If confidence < threshold:
   - Queue item marked `needs_review`.
   - Visible in Admin > Ingress Automation with Retry / Mark Done / Dismiss actions.
   - Library Browser shows a colored status chip for the file's path.
9. Config (threshold, auto-organize toggle, paths) can be updated live from the Ingress panel and persists across restarts.

## Operating Notes

- Set `MEDIA_LIBRARY_OMDB_API_KEY` and optionally `MEDIA_LIBRARY_TMDB_API_KEY` in the backend `.env` for matching.
- Set `MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=/your/encoded/folder` to configure ingress paths.
- Set `MEDIA_LIBRARY_INGRESS_AUTO_START_WATCHER=true` to auto-start watching on boot.
- `JELLYFIN_DEST_BASE` env var overrides the `/mnt/beelink-media` destination root.
- Manual metadata editing still available through existing admin forms and assignment tools.
