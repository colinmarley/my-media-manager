# Investigate: nothing has been queued into the ingest queue since 2026-06-07

Part of epic **#17**. Depends on: nothing. Read-only investigation — the deliverable is a
written report in the issue thread, not a code change (unless a defect is confirmed, in
which case file the fix as its own issue).

## Problem

The epic reports the newest `ingress_queue` row is from **2026-06-07** while the queue
holds ~24.7k items. Either the watcher stopped queueing, or rows are being written and the
UI cannot see them. Those are different bugs with different fixes; separate them first.

## Step 1 — is the data missing, or is the view blind?

Run inside the backend container (uses the container's own `DATABASE_URL`; never copy the
connection string into the issue):

```sql
SELECT status, count(*), min(queued_at), max(queued_at)
  FROM ingress_queue GROUP BY status ORDER BY 2 DESC;

SELECT date_trunc('day', queued_at) AS day, count(*)
  FROM ingress_queue
 WHERE queued_at >= '2026-06-01'
 GROUP BY 1 ORDER BY 1;

SELECT count(*) FROM ingress_processing_history WHERE created_at >= '2026-06-07';
```

- **Rows after 2026-06-07 exist** → this is a *listing* bug, and it is already explained by
  the code: `IngressQueueService.get_queue_items()` / `get_queue_status()` read only the
  in-memory `items_by_id` / `item_order`, and `backend/main.py` constructs a fresh
  `IngressQueueService` at startup with no reload from Postgres. Every restart wipes the
  visible queue while the table keeps growing. The fix is slice **#1** (DB-backed
  listing); add a one-line note here and no new issue.
- **No rows after that date** → continue.

## Step 2 — leads, in order of likelihood

1. **The watcher is not running.** `ingress_auto_start_watcher` defaults to **`False`**
   (`backend/config/settings.py`), and `backend/main.py` only starts the watcher at startup
   when it is enabled — otherwise it sets `app.state._watcher_should_run = False`, so the
   self-heal path in `run_ingress_auto_processor` (which checks that flag every 30 ticks)
   can never fire either. The watcher then stays stopped until someone presses Start in the
   Ingress Automation UI — `POST /api/ingress/watcher/start` is what sets
   `_watcher_should_run = True`. In the same loop, processing requires
   `watcher_service.is_running` and the failed-item auto-retry walks
   `queue_service.items_by_id`, so after a restart with no manual Start **nothing is
   queued, nothing is processed, and nothing is retried**. The backlog only got into the
   table because a start request had `processExistingFiles` checked
   (`_queue_existing_files_background`). Correlate the date with container/systemd
   restarts (`docker ps`, deployment log) — a restart on/just before 2026-06-07 with nobody
   pressing Start reproduces "nothing new, forever".
2. **The watched path is gone or stale.** At startup the app logs
   `Ingress path does not exist - watcher will fail to start` for each entry of
   `MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS` (default `/ark/media/ingest`) — and a few lines
   later `os.makedirs(ingress_path, exist_ok=True)` **creates it back as an empty local
   directory**. If the CIFS/NFS mount died or the export moved
   (`192.168.0.175:/ark/media`), the watcher then runs against an empty directory that is
   no longer the share: `GET /api/ingress/watcher/status` reports `is_running: true` with
   `watched_paths` that contain nothing. Compare `stat -c %d` for the ingress path against
   a known path on the share.
3. **Polling observer is starving.** `ingress_use_polling_watcher` defaults to `True`
   (required for SMB/NFS), and watchdog's `PollingObserver` re-walks the whole tree each
   cycle (`ingress_polling_observer_timeout_seconds = 5`). Deep trees over CIFS can drift
   far past the interval. Check `pending_count` / `processed_event_count` in watcher status
   and the backend log cadence.
4. **Files arrive in an unsupported format.** `add_from_watcher` skips anything whose
   extension is not in `supported_video_extensions` (`.mp4 .mkv .avi .mov .wmv .m4v .flv
   .webm`) and logs `Skipping non-video ingress file`. Rips that arrive as `.iso`, `.ts`
   or `.m2ts` are silently dropped — that produces *no queue row at all*, matching this
   symptom exactly. Count such log lines since 2026-06-07.
5. **Files never reach "stable".** The watcher waits
   `ingress_file_stability_wait_seconds` (10 s) for a file to stop changing before queueing
   it (see `PendingIngressFile` in `backend/services/file_watcher_service.py`); an
   always-growing copy, or a share whose mtime jitters under `PollingObserver`, can hold an
   item in the watcher's pending map indefinitely.
   `GET /api/ingress/watcher/status` → `pending_count` is the signal.
6. **Queue rows exist but every one failed instantly** — check
   `last_error` / `attempts` distribution and `processing_failed` history events; this
   looks like "nothing happened" if the UI list was cleared by a restart.

## Acceptance criteria

- [ ] Step 1 queries are run and the outcome (missing data vs blind view) is stated in the
      issue with the counts pasted (never the DSN).
- [ ] The report names one root cause with evidence, or explicitly lists the remaining
      candidates with what ruled each one in/out.
- [ ] The report says whether the cause is code, configuration, or environment.
- [ ] If it is a code defect: a fix issue is filed with a reproducing test, linked here.
      Lead 2 is the strongest code-level candidate: `os.makedirs(..., exist_ok=True)` turns
      "the mount is gone" into "the watcher started successfully", which is a defect worth
      its own issue.
      If it is configuration (most likely `ingress_auto_start_watcher`), a separate issue
      proposes the default change with its trade-off — restarting an unattended watcher
      starts moving files on the filesystem, which is why the default is `False` today.
- [ ] No product code is changed in this issue.

## Constraints

- Read-only: no schema changes, no queue mutations, no file moves while investigating.
- Do not print `DATABASE_URL`, API keys, or session secrets into the issue.
