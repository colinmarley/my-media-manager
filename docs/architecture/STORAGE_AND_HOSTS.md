# Storage and Hosts

Where each part of my-media-manager runs, where its data lives, and the path
rules that keep the database, the NAS and the other services in agreement.
For the move itself, see [MIGRATION_BEELINK_RUNBOOK.md](../guides/MIGRATION_BEELINK_RUNBOOK.md).

## The rule

**Media lives only on the NAS. The app only tracks it.** Every video, photo and
cover image is a file on the NAS `media` share. Postgres holds the catalog, the
ingest queue and *pointers* to those files. Nothing in a container volume is the
only copy of a media file, and the app never needs a local disk for media.

## Hosts

| Host | Address | Runs | Why there |
|---|---|---|---|
| **beelink** (Ubuntu 24.04 mini PC) | 192.168.0.239 | `docker-compose.yml`: `media-manager-db` (Postgres 16), `media-manager-backend` (:8082), `media-manager-frontend` (:3010). Also Jellyfin (:8096) and the homelab-logging stack (Prometheus, Grafana, Loki). | Always-on host next to Jellyfin; already mounts the NAS media share. |
| **ai-workstation** | 192.168.0.227 | `disc-ripper-service` (:8083), LocalAI (:8080) | The ripper needs the optical drive; LocalAI needs the GPU. Both are reached over the LAN. |
| **NAS** (TrueNAS) | 192.168.0.175 | SMB share `media` (dataset `ark/media`), backups share | Single home of all media and of the nightly DB dumps. |

Who talks to whom:

```
browser ──► frontend :3010 ──► /api/backend/*     ──► backend :8082 ──► Postgres (compose network)
                          └──► /api/disc-ripper/* ──► ripper  ai-workstation:8083
mobile app ─────────────────────────────────────────► backend :8082 ──► ripper (read-only status)
                                                                    └──► LocalAI ai-workstation:8080
disc-ripper-service ── delivers files to /ark/media/ingest, calls ──► backend :8082 (catalog links)
Prometheus (beelink) ── scrapes ──► backend :8082/metrics
```

The browser never talks to the ripper directly: the frontend's
`/api/disc-ripper` proxy holds its address (`DISC_RIPPER_URL`), requires a
session cookie, transcodes previews with ffmpeg and relays the job-log SSE
stream. Addresses of the other hosts are configuration only (`DISC_RIPPER_URL`,
`LOCALAI_URL` in the root `.env`); nothing in the code assumes the stack and the
ripper share a host.

## NAS layout

The share `//192.168.0.175/media` is mounted at **`/ark/media`** on every host
that touches media, and bind-mounted at the same `/ark/media` path in every
container that exchanges paths with the database.

| Path | Contents | Written by |
|---|---|---|
| `/ark/media/jellyfin/Movies` | Movie library | backend (organizer) |
| `/ark/media/jellyfin/TV Shows` | Series library | backend |
| `/ark/media/jellyfin/Documentaries` | Documentary library | backend |
| `/ark/media/jellyfin/Live Performances` | Concert / live library | backend |
| `/ark/media/ingest` | **Single ingest root** — rips land here, the watcher picks them up | disc-ripper-service, manual copies |
| `/ark/media/home-videos` | Home videos (digitized tapes, phone video) | backend (tape ingest) |
| `/ark/media/tape-archive` | Tape label / cover photos | backend |
| `/ark/media/catalog-images` | Cover photos for catalog items | backend |

`/ark/media/ingest` is a *sibling* of the library, not inside it, so Jellyfin
never scans half-processed rips. (Before the beelink move it was
`/ark/media/jellyfin/ingest`.)

**Retired folders** — to be emptied and removed, never recreated:
`jellyfin/_NeedsReview`, `jellyfin/Unprocessed`, `jellyfin/Series`
(merged into `TV Shows`), `jellyfin/Home Videos` (moved to `/ark/media/home-videos`).
Files that need a human decision stay in the ingest queue (`needs_review`), not
in a limbo folder.

The single path resolver for these roots is `backend/services/storage_paths.py`
(settings `MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS`, `JELLYFIN_DEST_BASE`,
`home_videos_path`).

## What state lives where

| State | Location | Backed up | If lost |
|---|---|---|---|
| Media files | NAS `ark/media` | NAS snapshots / replication | Real loss — this is the data. |
| Catalog, ingest queue, file pointers, settings, sessions | Postgres volume `postgres_data` on the beelink | Nightly `pg_dump -Fc` to the NAS backups share | Restore the latest dump; the inventory scan re-syncs file rows with the NAS. |
| Poster cache | Volume `poster_cache` (`/data/media_manager/posters`) | No | Re-downloaded on demand from the original poster URLs. |
| Secrets and host config | Root `.env` beside `docker-compose.yml` (mode 600, gitignored) | Host config backup | Recreate from `.env.example` + password manager. |
| Ripper scratch / work dirs | ai-workstation, owned by disc-ripper-service | No | In-flight rips only. |

## Path rules

1. **Stored paths are absolute container paths under `/ark/media`.**
   `ingress_queue.file_path`, `media_files.file_path`,
   `ingest_operations.src` and similar columns hold e.g.
   `/ark/media/jellyfin/Movies/Heat (1995)/Heat (1995).mkv` — never a host-only
   path, a UNC path or a Jellyfin `/media/...` path.
2. **`relative_path` is relative to the library root** (`JELLYFIN_DEST_BASE`,
   i.e. `/ark/media/jellyfin`), e.g. `Movies/Heat (1995)/Heat (1995).mkv`. It
   survives a change of mount point; absolute paths do not.
3. **The mount point is identical in every container that exchanges paths.**
   The backend, and disc-ripper-service on ai-workstation, both see the share at
   `/ark/media`, and the ripper delivers to exactly `/ark/media/ingest`. A path the
   ripper reports (or a file the watcher finds) must be the same string the
   backend would use to open it. If one side mounts the share elsewhere, paths
   silently stop matching.
4. **Changing a prefix is a data migration.** Moving a folder on the NAS means
   rewriting the stored paths too: `backend/scripts/rebase_paths.py --from <old> --to <new>`
   (dry run by default, `--apply` to write) rewrites `ingress_queue`,
   `media_files` and `ingest_operations.src`.

### Mounting

On the host, `/ark/media` is an fstab CIFS entry with `x-systemd.automount`
(mounted on first access, retried after NAS or network outages). The backend
binds it with `rslave` propagation:

```yaml
- type: bind
  source: ${MEDIA_ROOT:-/ark/media}
  target: /ark/media
  bind: { propagation: rslave, create_host_path: false }
```

`rslave` lets the container see the host's remounts; without it a container
started before (or across) a remount keeps a stale, empty or dead mount — the
"stale mount" failure seen on ai-workstation. `create_host_path: false` makes
`docker compose up` fail instead of silently creating an empty directory when
the host path is missing. If a container still shows an empty `/ark/media`
after a remount, restart it (`docker compose restart backend`) and check
`findmnt /ark/media` on the host.

## Keeping the database in sync with the NAS

The backend's scheduled **library inventory scan** (settings prefix
`MEDIA_LIBRARY_INVENTORY_*`) walks the library, records every file it finds,
probes codec and resolution, and marks rows whose file has disappeared as
missing. It is the mechanism that keeps the DB honest after manual moves on the
NAS, restores from an older dump, or a host move.

**Mount guard:** the scan only runs when the NAS share is actually mounted at
`MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH` (default `/ark/media`). An unmounted share
looks like an empty directory; scanning it would mark the whole library
missing. When the guard fails the scan is skipped and logged, nothing is marked.

## Jellyfin's view

Jellyfin runs on the beelink with the host's `/ark/media` bind-mounted
read-only at **`/media`**. The two views differ only by that prefix:

| my-media-manager (DB, backend) | Jellyfin |
|---|---|
| `/ark/media/jellyfin/Movies/...` | `/media/jellyfin/Movies/...` |
| `/ark/media/jellyfin/TV Shows/...` | `/media/jellyfin/TV Shows/...` |
| `/ark/media/home-videos/...` | `/media/home-videos/...` |

To translate: replace the leading `/ark/media` with `/media`. Never store a
Jellyfin path in the database. When folders are retired (e.g. `Series`,
`Home Videos`), update the Jellyfin library definitions to the new folders too.
