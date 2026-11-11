# Runbook: move the stack from ai-workstation to the beelink

Moves Postgres, backend and frontend from **ai-workstation** (192.168.0.227) to
the **beelink** (192.168.0.239), and the ingest root from
`/ark/media/jellyfin/ingest` to `/ark/media/ingest`. disc-ripper-service and
LocalAI stay on ai-workstation. Background and path rules:
[STORAGE_AND_HOSTS.md](../architecture/STORAGE_AND_HOSTS.md).

Conventions: `old$` = a shell on ai-workstation in the old checkout
(`docker compose ps` shows `media-manager-*`), `new$` = a shell on the beelink
in `/opt/my-media-manager`. Each step ends with a **Check** — do not continue
until it passes. Media files are never copied: both hosts mount the same NAS
share, so only the database and a folder rename move.

Plan for about an hour with no rips running. Rollback is clean until the first
new ingest on the beelink (see [Rollback](#rollback)).

---

## 0. Prerequisites on the beelink

**0.1 Docker with Compose ≥ 2.24** (needed for `env_file: required: false`).

```bash
new$ docker compose version
```
Check: prints `v2.24` or newer.

**0.2 NAS media share on `/ark/media` with automount.** The beelink already
mounts `//192.168.0.175/media` at `/ark/media` for Jellyfin. Change the fstab
entry so it is an automount that survives NAS/network blips (keep its existing
credentials file and modes):

```bash
new$ sudo cp /etc/fstab /etc/fstab.bak-$(date +%F)
new$ sudoedit /etc/fstab
# //192.168.0.175/media /ark/media cifs credentials=<existing creds file>,iocharset=utf8,file_mode=0777,dir_mode=0777,_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=30 0 0
new$ sudo systemctl daemon-reload && sudo systemctl restart remote-fs.target
new$ ls /ark/media >/dev/null && findmnt /ark/media
```
Check: `findmnt` lists an `autofs` entry and a `cifs` entry for `/ark/media`, and
`ls /ark/media/jellyfin` shows `Movies`, `TV Shows`, …. Restart Jellyfin
(`docker restart jellyfin`) and confirm a library still plays.

**0.3 Checkout and `.env`.**

```bash
new$ sudo mkdir -p /opt/my-media-manager && sudo chown "$USER" /opt/my-media-manager
new$ git clone <repo-url> /opt/my-media-manager && cd /opt/my-media-manager
new$ cp .env.example .env && chmod 600 .env && $EDITOR .env
```

Fill in (names only here — values come from the password manager or the old
host's `backend/.env`):

| Variable | Value |
|---|---|
| `HOST_ID` | `beelink` |
| `POSTGRES_PASSWORD` | **a new password** (`openssl rand -hex 24`). The restore below creates a fresh cluster, so this rotates the DB password as a side effect. |
| `POSTGRES_HOST_PORT` | `5432` unless `ss -ltn` shows it taken |
| `DISC_RIPPER_URL` | `http://192.168.0.227:8083` |
| `LOCALAI_URL` | `http://192.168.0.227:8080` |
| `MEDIA_LIBRARY_OMDB_API_KEY`, `MEDIA_LIBRARY_TMDB_API_KEY`, `MEDIA_LIBRARY_LOCALAI_API_KEY` | copy from the old host's `backend/.env` |
| `NEXT_PUBLIC_OMDB_API_KEY`, `NEXT_PUBLIC_TMDB_API_KEY` | copy from wherever the old frontend build read them (`.env.local` / `.env` in the old checkout); they are now build args |
| `APP_DEFAULT_PASSWORD` | leave empty (the restored DB already has a passphrase hash) |

```bash
new$ docker compose config >/dev/null && echo OK
new$ curl -fsS http://192.168.0.227:8083/jobs >/dev/null && echo ripper-reachable
new$ docker compose build
```
Check: `OK`, `ripper-reachable`, and the build finishes. (`config` names any
missing required variable.)

---

## 1. Freeze the old stack

**1.1 No rip in flight, and none started until step 9.1.**

```bash
old$ curl -fsS http://localhost:8083/jobs | jq '[.[] | select(.status=="queued" or .status=="ripping" or .status=="delivering")] | length'
```
Check: `0`. Tell anyone else who rips: no rips until this runbook is done.

**1.2 Record row counts** (the same query runs again in step 7):

```bash
old$ cat > /tmp/mm-counts.sql <<'SQL'
SELECT 'movies', count(*) FROM movies
UNION ALL SELECT 'series', count(*) FROM series
UNION ALL SELECT 'episodes', count(*) FROM episodes
UNION ALL SELECT 'discs', count(*) FROM discs
UNION ALL SELECT 'tapes', count(*) FROM tapes
UNION ALL SELECT 'media_files', count(*) FROM media_files
UNION ALL SELECT 'media_assignments', count(*) FROM media_assignments
UNION ALL SELECT 'ingest_operations', count(*) FROM ingest_operations
UNION ALL SELECT 'ingress_queue:' || status, count(*) FROM ingress_queue GROUP BY status
UNION ALL SELECT 'alembic:' || version_num, 1 FROM alembic_version;
SQL
old$ docker exec -i media-manager-db psql -U media_user -d media_manager -At -F' ' < /tmp/mm-counts.sql | sort > ~/mm-counts-old.txt
old$ cat ~/mm-counts-old.txt
```
Check: the file lists every table with plausible numbers.

**1.3 Stop the app (keeps the DB running for the dump).** Stopping the backend
stops the ingest watcher.

```bash
old$ docker compose stop frontend backend
```
Check: `docker compose ps` shows only `media-manager-db` running.

---

## 2. Dump the database on ai-workstation

```bash
old$ docker exec media-manager-db pg_dump -U media_user -d media_manager -Fc > ~/mm-premove-$(date +%F).dump
old$ docker exec -i media-manager-db pg_restore -l < ~/mm-premove-$(date +%F).dump | grep -c 'TABLE DATA'
old$ scp ~/mm-premove-$(date +%F).dump beelink-local:/tmp/mm-premove.dump
```
Check: the `TABLE DATA` count is non-zero and the file arrives on the beelink
(`new$ ls -lh /tmp/mm-premove.dump`, same size).

---

## 3. Restore on the beelink

Start **only** Postgres. (The backend would fail fast on an empty database: the
baseline Alembic revision alters an existing schema and cannot build one.)

```bash
new$ docker compose up -d postgres --wait
new$ docker exec -i media-manager-db pg_restore -U media_user -d media_manager --no-owner --role=media_user --exit-on-error < /tmp/mm-premove.dump
new$ docker exec -i media-manager-db psql -U media_user -d media_manager -At -F' ' < /tmp/mm-counts.sql | sort > ~/mm-counts-restored.txt
```
(Copy `/tmp/mm-counts.sql` from step 1.2 to the beelink first. Use the
`POSTGRES_USER` / `POSTGRES_DB` from `.env` if you changed them.)

Check: `pg_restore` exits 0 and `diff ~/mm-counts-old.txt ~/mm-counts-restored.txt`
(copy one file across) prints nothing.

---

## 4. Move the ingest root on the NAS

Both paths are on the same share, so this is a rename on the NAS, not a copy.

```bash
new$ test -e /ark/media/ingest && echo "STOP: /ark/media/ingest already exists" || mv /ark/media/jellyfin/ingest /ark/media/ingest
new$ ls -A /ark/media/ingest | head; test ! -e /ark/media/jellyfin/ingest && echo moved
```
Check: `moved`, and the ingest contents are listed under the new path. From
ai-workstation, `ls /ark/media/ingest` shows the same thing.

---

## 5. Migrate and rebase stored paths

**5.1 Apply migrations** (the entrypoint runs `alembic upgrade head`, then the command):

```bash
new$ docker compose run --rm backend alembic current
```
Check: output ends with `Migrations up to date.` and a revision marked `(head)`.

**5.2 Dry run the rebase, review, apply.**

```bash
new$ docker compose run --rm -e MIGRATE_ON_START=false backend \
       python scripts/rebase_paths.py --from /ark/media/jellyfin/ingest --to /ark/media/ingest
# read the per-table counts and sample rows; they should match the ingest queue size
new$ docker compose run --rm -e MIGRATE_ON_START=false backend \
       python scripts/rebase_paths.py --from /ark/media/jellyfin/ingest --to /ark/media/ingest --apply
```

**5.3 Look for stragglers** outside the tables the script covers (for example
`library_paths` or `app_config` rows):

```bash
new$ docker exec media-manager-db pg_dump -U media_user -d media_manager --data-only | grep -c '/ark/media/jellyfin/ingest'
new$ docker exec media-manager-db pg_dump -U media_user -d media_manager --data-only | grep -n '/ark/media/jellyfin/ingest' | cut -c1-200 | head
```
Check: the only remaining hits are history/audit rows
(`ingress_processing_history`), which may keep old paths. Fix any
configuration row (e.g. a watched path in `library_paths`) by hand or via the
Settings UI after step 6.

---

## 6. Start the stack

```bash
new$ docker compose up -d
new$ docker compose ps
new$ docker compose logs backend | grep entrypoint
new$ curl -fsS http://localhost:8082/health | jq .status
```
Check: all three services are `healthy`; the log shows `Migrations up to date.`;
`/health` returns `"healthy"`. Open `http://192.168.0.239:3010`, log in with the
current passphrase, and confirm Home and My Library load and the ingest queue is
populated. The watcher log line should name `/ark/media/ingest`.

---

## 7. Compare counts

```bash
new$ docker exec -i media-manager-db psql -U media_user -d media_manager -At -F' ' < /tmp/mm-counts.sql | sort > ~/mm-counts-new.txt
new$ diff ~/mm-counts-old.txt ~/mm-counts-new.txt
```
Check: only `alembic:` lines differ (if a new migration was applied). Any other
difference: stop and investigate before step 8.

---

## 8. First inventory scan

Run the library inventory scan once by hand (Settings, or its API endpoint —
see `docs/api/endpoints.md`, settings `MEDIA_LIBRARY_INVENTORY_*`) instead of
waiting for the schedule.

Check: the scan reports roughly the number of files in `media_files`, and the
number marked **missing** is small and explainable. A large missing count means
the mount is wrong — the guard should have refused to run on an unmounted
share; check `docker compose exec backend ls /ark/media/jellyfin` before
trusting the result.

---

## 9. Repoint everything else

**9.1 disc-ripper-service (ai-workstation).** In its `docker-compose.yml` and env:

```yaml
volumes:
  - /ark/media/ingest:/ark/media/ingest      # identical path on both sides
environment:
  INGEST_ROOT: /ark/media/ingest
  MEDIA_MANAGER_API_URL: http://192.168.0.239:8082
```
```bash
old$ cd <disc-ripper-service checkout> && docker compose up -d
old$ docker compose exec <ripper-service> sh -c 'printenv INGEST_ROOT MEDIA_MANAGER_API_URL; ls /ark/media/ingest | head -3'
old$ docker compose exec <ripper-service> python -c "import urllib.request; print(urllib.request.urlopen('http://192.168.0.239:8082/health').status)"
```
Check: the new values print, the ingest listing matches the beelink's, and the
backend answers `200`. Then rip one short disc (or copy a small test file into
`/ark/media/ingest`) and confirm it appears in the ingest queue.
**This is the point of no clean rollback.**

**9.2 Mobile app.** In media-manager-mobile's server settings set the host to
`192.168.0.239` (port 8082). Check: login works, the catalog loads, the rip
status screen shows jobs.

**9.3 Prometheus** (homelab-logging on the beelink): change the
`media-manager` job target to `192.168.0.239:8082` (already the value in
`docs/api/endpoints.md`) and reload Prometheus. Check: the target is `UP` on
Prometheus' Targets page and the Grafana "media-manager" dashboard has fresh
data. If it is `DOWN` with a timeout, ufw is dropping container→host traffic on
8082: allow it from the Prometheus network
(`sudo ufw allow from <prometheus-bridge-subnet> to any port 8082 proto tcp`).

**9.4 Nightly database dump.** Remove the media-manager `pg_dump` from
`aiws-backup.sh` on ai-workstation, and add the equivalent on the beelink
(user systemd timer or cron), writing to the NAS backups share:

```bash
docker exec media-manager-db pg_dump -U media_user -d media_manager -Fc \
  > <nas-backups-mount>/beelink/media-manager/db/media_manager-$(date +%F).dump
```
Keep the existing retention (7 daily + Sundays for 28 days). Check: run it once
by hand and `pg_restore -l` the file; the next morning a new dump exists.

**9.5 Tools.** Point the `postgres-media` MCP / any psql shortcuts at the
beelink. Postgres is now published on `127.0.0.1` only, so use a tunnel:
`ssh -N -L 127.0.0.1:5432:127.0.0.1:5432 beelink-local`. Update the homelab
notes (Services overview, IP tracker, backup policy).

---

## 10. Stop, and later remove, the old stack

```bash
old$ docker compose down          # no -v: keep the old volume for rollback
```
Check: `curl http://192.168.0.227:3010` and `:8082` no longer answer; the beelink
still does.

After two weeks without problems: `old$ docker compose down -v`, then delete the
old checkout and the pre-move dump.

---

## 11. Rotate secrets

The app passphrase and the old DB password were committed in
`docker-compose.yml` history (and the old default DB URL still appears in
`backend/alembic.ini` and `backend/config/settings.py`). Treat them as public.

- **DB password:** already new if step 0.3 used a fresh `POSTGRES_PASSWORD`.
  Confirm it differs from the old one. Changing it later on an existing volume
  needs `ALTER ROLE media_user PASSWORD '…'` in psql *and* the new value in
  `.env`, then `docker compose up -d`.
- **App passphrase:** change it in the app (Settings → account / change
  password, `POST /api/auth/change-password`) or with
  `docker compose exec backend python scripts/seed_password.py`. Update the
  mobile app login and `E2E_PASSWORD` wherever it is stored.
- Remove the old values from the old host's `backend/.env` and from any notes.

Check: logging in with the old passphrase fails; the new one works on web and
mobile.

---

## 12. Retire the limbo folders

`jellyfin/_NeedsReview`, `jellyfin/Unprocessed`, `jellyfin/Series` and
`jellyfin/Home Videos` go away once empty:

```bash
new$ for d in _NeedsReview Unprocessed Series "Home Videos"; do printf '%-14s ' "$d"; find "/ark/media/jellyfin/$d" -type f 2>/dev/null | wc -l; done
```

- Re-ingest `_NeedsReview` / `Unprocessed` contents by moving them into
  `/ark/media/ingest` (they come back as queue items).
- `Series` → `TV Shows` and `Home Videos` → `/ark/media/home-videos`: move on
  the NAS, then `rebase_paths.py --from <old> --to <new>` (dry run, then
  `--apply`), then re-run the inventory scan.
- Update the Jellyfin libraries (TV Shows no longer lists `/media/jellyfin/Series`;
  Home Videos points at `/media/home-videos`).
- `rmdir` each folder when the count is 0.

Check: the loop prints `0` for every folder, then the folders are gone and the
inventory scan reports no new missing files.

---

## Rollback

**Clean until the first new ingest on the beelink** (step 9.1's test rip, or any
organize/assign done in the new UI). Until then the old database on
ai-workstation is still authoritative and untouched:

1. `new$ docker compose stop`
2. `new$ mv /ark/media/ingest /ark/media/jellyfin/ingest`
3. Revert disc-ripper-service's bind, `INGEST_ROOT` and `MEDIA_MANAGER_API_URL`
   if already changed; recreate it.
4. `old$ docker compose up -d` in the old checkout (do **not** pull this branch
   there first — the old compose file still carries its own config).
5. Revert the mobile app host and the Prometheus target if changed.

Check: the old UI on `192.168.0.227:3010` shows the counts from step 1.2 and
the watcher is running on `/ark/media/jellyfin/ingest`.

**After the first new ingest**, rolling back means carrying the beelink's data
back: dump the beelink DB (step 2 on the beelink), restore it on ai-workstation
into a fresh volume, and run `rebase_paths.py --from /ark/media/ingest --to /ark/media/jellyfin/ingest --apply`
there, plus the NAS rename in reverse. Prefer fixing forward.
