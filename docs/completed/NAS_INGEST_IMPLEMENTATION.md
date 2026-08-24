# NAS Ingest & Multi-Machine Implementation Plan

## Overview

This document details everything that must be implemented to support:

1. **TrueNAS as the media destination** at `192.168.0.175/ark/media`
2. **Separate typed media folders** (Movies, TV Shows, Documentaries, Live Performances)
3. **NAS ingest folder** at `192.168.0.175/ark/media/ingest` as the watched input source
4. **Cross-machine operation** from either the Linux AI Workstation or the Windows Beelink Mini PC

---

## Current State Assessment

### What Already Works

| Feature | Status |
|---|---|
| File watcher (local paths) | ✅ Implemented |
| Filename parsing | ✅ Implemented |
| Metadata matching (OMDB/TMDB/Firebase) | ✅ Implemented |
| Confidence scoring + auto-assign | ✅ Implemented |
| File movement + NFO sidecar creation | ✅ Implemented |
| Movie → `movies/` folder organization | ✅ Implemented |
| TV Episodes → `shows/` folder organization | ✅ Implemented |
| Cross-platform file operations (`shutil`) | ✅ Implemented |
| Polling watcher flag (for SMB/NFS) | ✅ Flag exists, disabled by default |

### What Is Missing / Blocking the Scenario

| # | Gap | Impact |
|---|---|---|
| 1 | No SMB/NAS mount management or health checks | Destination unreachable without manual mount |
| 2 | `ingress_default_paths` hardcoded to `/data/media/encoded` | Cannot watch NAS ingest folder by default |
| 3 | `jellyfin_dest_base` hardcoded to `/ark/media/jellyfin` | Destination points to wrong path |
| 4 | No `documentary` or `live_performance` media types | No separate Documentaries or Live Performances folders |
| 5 | `_calculate_jellyfin_path` only handles `movie` and `episode` | New types return `None` → organization fails |
| 6 | Auto-matcher cannot classify documentaries or live performances | Matched items default to `movie` type |
| 7 | `ingress_auto_start_watcher = False` | Watcher must be started manually via API on every restart |
| 8 | Queue is in-memory only — lost on restart | Partially-processed items disappear on crash/restart |
| 9 | `IngressQueueItem` PostgreSQL table exists but is never used | Persistence infrastructure ready but not wired |
| 10 | `ingress_use_polling_watcher = False` | Inotify does not work on SMB shares — files will not be detected |
| 11 | Windows path defaults not wired through to cross-platform settings | Windows machine requires manual env var overrides |
| 12 | `allowed_base_paths` does not include NAS paths | File browser rejects NAS paths |
| 13 | Auto-matcher only searches Firebase catalog, not PostgreSQL catalog | Titles migrated to SQL will not be found |
| 14 | Path security validation disabled with a TODO comment | Security gap when validating network file paths |

---

## Proposed NAS Folder Structure

```
\\192.168.0.175\ark\media\         (SMB share root)
├── ingest\                        ← Drop zone: all unprocessed media goes here
├── Movies\                        ← Processed movies
│   └── The Matrix (1999) [imdbid-tt0133093]\
│       └── The Matrix (1999) [imdbid-tt0133093].mkv
├── TV Shows\                      ← Processed TV series / episodes
│   └── Breaking Bad (2008) [imdbid-tt0903747]\
│       └── Season 01\
│           └── Breaking Bad S01E01 Pilot.mkv
├── Documentaries\                 ← Processed documentaries
│   └── Planet Earth (2006) [imdbid-tt0795176]\
│       └── Planet Earth (2006) [imdbid-tt0795176].mkv
└── Live Performances\             ← Concert films, stage recordings
    └── Led Zeppelin - The Song Remains the Same (1976)\
        └── Led Zeppelin - The Song Remains the Same (1976).mkv
```

---

## Implementation Tasks

### Task 1 — NAS Mount Configuration

**Scope**: Infrastructure + documentation (outside codebase)

Both machines must mount the TrueNAS SMB share before the service can access it.

#### Linux (AI Workstation)

Install and configure CIFS:

```bash
sudo apt install cifs-utils
sudo mkdir -p /ark/media
```

Create `/etc/samba/ark-credentials`:
```
username=<nas_user>
password=<nas_password>
domain=WORKGROUP
```
```bash
sudo chmod 600 /etc/samba/ark-credentials
```

Add to `/etc/fstab` for persistent mount on boot:
```
//192.168.0.175/media  /ark/media  cifs  credentials=/etc/samba/ark-credentials,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,vers=3.0,nofail,_netdev  0  0
```

```bash
sudo mount -a
```

#### Windows (Beelink Mini PC)

Map the network drive in Explorer or via PowerShell:
```powershell
New-PSDrive -Name "A" -PSProvider FileSystem -Root "\\192.168.0.175\ark\media" -Persist -Credential (Get-Credential)
```

Or via `net use`:
```cmd
net use A: \\192.168.0.175\ark\media /user:<nas_user> <nas_password> /persistent:yes
```

The service should then be configured with `MEDIA_LIBRARY_JELLYFIN_DEST_BASE=A:\` or the UNC path.

#### Docker Compose (Linux)

Bind-mount the NAS path into the container:
```yaml
volumes:
    - /ark:/ark:rw
```

---

### Task 2 — Settings: Add NAS Paths and New Defaults

**File**: `backend/config/settings.py`

Changes required:

1. **Rename `jellyfin_dest_base`** to a more generic `media_dest_base` (or add an alias) — the current name is Jellyfin-specific but the NAS destination is platform-neutral.

2. **Update `ingress_default_paths` default** to reference the NAS ingest path (via env variable).

3. **Enable polling watcher by default** — SMB shares do not support inotify.

4. **Add NAS-specific settings**:
   - `nas_host`: IP of TrueNAS (for health check pinging)
   - `nas_mount_check_path`: A known directory to test mount availability

5. **Update `allowed_base_paths`** to include NAS paths for both platforms:
    - Linux: `/ark/media`
   - Windows: `A:\` or `\\192.168.0.175\ark\media`

6. **Enable `ingress_auto_start_watcher`** — should be `True` in production (can still be overridden via env).

**Suggested additions to `LibrarySettings`**:

```python
# NAS / network destination
media_dest_base: str = Field(
    default="/ark/media/jellyfin",
    validation_alias=AliasChoices(
        "MEDIA_DEST_BASE",
        "JELLYFIN_DEST_BASE",              # backward-compat
        "MEDIA_LIBRARY_JELLYFIN_DEST_BASE",
        "MEDIA_LIBRARY_MEDIA_DEST_BASE",
    ),
)

# NAS health check
nas_host: str = Field(default="192.168.0.175", validation_alias="MEDIA_LIBRARY_NAS_HOST")
nas_mount_check_path: str = Field(
    default="/ark/media",
    validation_alias="MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH",
)

# Ingest (default to NAS ingest folder)
ingress_default_paths: List[str] = Field(
    default=["/ark/media/ingest"],
    validation_alias="MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS",
)

# Polling required for SMB
ingress_use_polling_watcher: bool = True
ingress_auto_start_watcher: bool = True

# Media type destination folder names (configurable)
folder_movies: str = "Movies"
folder_tv_shows: str = "TV Shows"
folder_documentaries: str = "Documentaries"
folder_live_performances: str = "Live Performances"
```

**Env file example** (`.env` at repo root):

```dotenv
# NAS destination
MEDIA_LIBRARY_MEDIA_DEST_BASE=/ark/media/jellyfin

# NAS ingest
MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=["/ark/media/ingest"]

# On Windows Beelink, override:
# MEDIA_LIBRARY_MEDIA_DEST_BASE=\\192.168.0.175\ark\media
# MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=["\\\\192.168.0.175\\ark\\media\\ingest"]
```

---

### Task 3 — Add New Media Types: Documentary and Live Performance

**Scope**: Database models, assignment orchestrator, auto-matcher

#### 3a. Media type constants

Create a shared constants module or extend existing type handling to recognize:

| Internal type key | Display name | Destination subfolder |
|---|---|---|
| `movie` | Movie | `Movies` |
| `episode` / `series` | TV Show | `TV Shows` |
| `documentary` | Documentary | `Documentaries` |
| `live_performance` | Live Performance | `Live Performances` |

#### 3b. `AssignmentOrchestrator` — extend type detection

**File**: `backend/services/assignment_orchestrator.py`

The current `auto_assign()` only resolves to `movie` or `episode`. Add detection for `documentary` and `live_performance` using:
- Explicit field from `best_match.get("media_type")`
- Genre-based heuristic: if primary genre is `"Documentary"` from OMDB/TMDB
- Explicit user override via `manual_assign` payload

```python
# Add to type resolution block:
elif parsed_media_type in ("documentary",) or matched_media_type == "documentary":
    media_type = "documentary"
elif parsed_media_type in ("live_performance", "concert",) or matched_media_type == "live_performance":
    media_type = "live_performance"
```

#### 3c. `AutoMatcherService` — propagate media type from metadata

**File**: `backend/services/auto_matcher_service.py`

When building candidates from OMDB/TMDB results:
- Check OMDB `Genre` field — if it includes `"Documentary"`, set `media_type = "documentary"`
- There is no standard TMDB/OMDB type for live performances; this will require a manual override or a genre heuristic (e.g., Genre=`"Music"` + keywords like `"concert"`, `"live"`)
- Expose `media_type` in the candidate's returned dict so it propagates through to the assignment

#### 3d. Manual assignment API — accept new types

**File**: `backend/api/ingress_operations.py`

The `manual-assign` endpoint should accept `documentary` and `live_performance` as valid `mediaType` values in the request body.

---

### Task 4 — Extend File Organization Path Logic

**File**: `backend/services/file_organization_service.py`

The `_calculate_jellyfin_path()` method currently returns `None` for any type other than `movie` or `episode`. Extend to handle new types:

```python
def _calculate_jellyfin_path(self, media, assignment, media_type, override=None):
    ...
    library_root = (override or ...).rstrip("/")

    folder_map = {
        "movie":            settings.folder_movies,            # "Movies"
        "episode":          settings.folder_tv_shows,          # "TV Shows"
        "documentary":      settings.folder_documentaries,     # "Documentaries"
        "live_performance": settings.folder_live_performances, # "Live Performances"
    }
    subfolder = folder_map.get(media_type)
    if not subfolder:
        logger.error("Unknown media type", media_type=media_type)
        return None

    if media_type in ("movie", "documentary", "live_performance"):
        # Flat: <dest>/<TypeFolder>/<Title (Year)> [imdbid-tt...]>/
        folder_name = f"{title_sanitized}{year_str}{imdb_info}"
        return f"{library_root}/{subfolder}/{folder_name}"

    elif media_type == "episode":
        # Nested: <dest>/TV Shows/<Series (Year)> [imdbid-tt...]>/Season NN/
        return f"{library_root}/{subfolder}/{folder_name}{imdb_info}/{season_str}"
```

The NFO sidecar creation (`_create_jellyfin_nfo_files`) should also be updated to write appropriate sidecar types for documentary and live performance (same structure as movie is acceptable).

---

### Task 5 — SMB-Safe File Watcher (Polling Mode)

**File**: `backend/services/file_watcher_service.py`

Current default: inotify via `watchdog.Observer`. This **does not work** on SMB/CIFS/NFS mounts.

Changes required:

1. **Auto-detect network paths and force polling**:

```python
def _is_network_path(self, path: str) -> bool:
    """Return True if path is a UNC or known network mount."""
    p = path.replace("\\", "/")
    # UNC path: //host/share or \\host\share
    if p.startswith("//"):
        return True
    # Windows drive that is a mapped network drive is harder to detect;
    # fall back to explicit flag or always use polling when on Windows
    return False

def _create_observer(self):
    use_polling = settings.ingress_use_polling_watcher
    if not use_polling:
        # Auto-detect: if any watch path is a network path, force polling
        for path in self.watch_paths:
            if self._is_network_path(path):
                use_polling = True
                logger.info("Network path detected — switching to polling watcher", path=path)
                break
    if use_polling:
        from watchdog.observers.polling import PollingObserver
        return PollingObserver(timeout=5)
    from watchdog.observers import Observer
    return Observer()
```

2. **File lock check on Windows/SMB**: The current `open(path, 'a')` check can raise `PermissionError` on Windows for valid readable files. Replace with a try/except that treats `PermissionError` as "file still locked" on Windows, "accessible" on non-Windows (SMB POSIX behaviour differs).

3. **Polling interval**: Default watchdog polling is 1s; SMB latency may benefit from a longer interval (5s). Expose `ingress_polling_observer_timeout_seconds` in settings.

---

### Task 6 — Queue Persistence (PostgreSQL)

**File**: `backend/services/ingress_queue_service.py`

The `IngressQueueItem` table already exists in `db/models.py`. The service currently holds all state in memory.

**What to implement**:

1. Accept a `db_session_factory` in `IngressQueueService.__init__()`.
2. On `add_item()` / `add_from_watcher()`: insert a row into `ingress_queue` table.
3. On `update_item_status()`: update the corresponding row.
4. On service startup, query `ingress_queue` for items with status `pending` or `processing` and reload them into memory (so in-flight items survive restart).
5. On `mark_complete()`: update row status to `completed`.
6. Keep the in-memory dict as the primary working state (for performance); DB is the durable backing store.

This ensures that if the service restarts mid-ingest, previously detected files are not re-queued as duplicates and in-progress items are recovered rather than lost.

---

### Task 7 — NAS Mount Health Check

**File**: `backend/api/ingress_operations.py` (extend `GET /api/ingress/health`)

The existing health check validates that the ingress path and destination base are accessible. Extend it to:

1. **Ping the NAS host** (`192.168.0.175`) before relying on the mount.
2. **Check that the ingest subfolder exists** and is writable.
3. **Check that each type destination subfolder exists** (`Movies/`, `TV Shows/`, etc.) and create them if missing.
4. **Return structured health status** per mount point:

```json
{
  "nas_reachable": true,
  "nas_host": "192.168.0.175",
  "ingest_path_accessible": true,
  "destination_paths": {
    "Movies": { "exists": true, "writable": true },
    "TV Shows": { "exists": true, "writable": true },
    "Documentaries": { "exists": false, "created": true },
    "Live Performances": { "exists": false, "created": true }
  }
}
```

Create a `NasMountService` (or helper functions in `file_organization_service.py`) to:
- Probe mount availability
- Bootstrap the expected folder structure on first run

---

### Task 8 — Auto-Create Destination Subfolders on Startup

**File**: `backend/main.py` (startup event)

On application startup, after DB init and before starting the watcher:

1. Resolve `media_dest_base`.
2. For each known media type folder (`Movies`, `TV Shows`, `Documentaries`, `Live Performances`):
   - `os.makedirs(os.path.join(media_dest_base, folder), exist_ok=True)`
3. Create the `ingest` folder if it does not exist:
   - `os.makedirs(os.path.join(media_dest_base, "ingest"), exist_ok=True)`
4. Log warnings (not errors) if the NAS is not reachable — the service should still start, just with the watcher disabled until the mount comes online.

---

### Task 9 — Cross-Platform Environment Configuration

**Files**: `.env.linux`, `.env.windows`, `docker-compose.yml`, `README.md`

#### Linux AI Workstation `.env`

```dotenv
MEDIA_LIBRARY_MEDIA_DEST_BASE=/ark/media/jellyfin
MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=["/ark/media/ingest"]
MEDIA_LIBRARY_POSTER_CACHE_DIR=/ark/media/.cache/posters
MEDIA_LIBRARY_NAS_HOST=192.168.0.175
MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH=/ark/media
# Set to true since SMB polling is needed
MEDIA_LIBRARY_INGRESS_USE_POLLING_WATCHER=true
MEDIA_LIBRARY_INGRESS_AUTO_START_WATCHER=true
```

#### Windows Beelink `.env`

```dotenv
MEDIA_LIBRARY_MEDIA_DEST_BASE=\\192.168.0.175\ark\media
MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=["\\\\192.168.0.175\\ark\\media\\ingest"]
MEDIA_LIBRARY_POSTER_CACHE_DIR=\\192.168.0.175\ark\media\.cache\posters
MEDIA_LIBRARY_NAS_HOST=192.168.0.175
MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH=\\192.168.0.175\ark\media
MEDIA_LIBRARY_INGRESS_USE_POLLING_WATCHER=true
MEDIA_LIBRARY_INGRESS_AUTO_START_WATCHER=true
# Point database to your Postgres instance
DATABASE_URL=postgresql+asyncpg://media_user:password@localhost:5432/media_manager
```

#### Docker Compose additions (Linux)

```yaml
services:
  backend:
    volumes:
            - /ark:/ark:rw
    environment:
            - MEDIA_LIBRARY_MEDIA_DEST_BASE=/ark/media/jellyfin
            - MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS=["/ark/media/ingest"]
      - MEDIA_LIBRARY_INGRESS_USE_POLLING_WATCHER=true
      - MEDIA_LIBRARY_INGRESS_AUTO_START_WATCHER=true
```

**Important**: On Windows, Docker Desktop does not relay SMB mounts from the host into Linux containers cleanly. For the Windows machine, running the Python backend natively (not in Docker) or under WSL2 with the SMB share mounted inside WSL is recommended.

---

### Task 10 — Auto-Matcher: Query PostgreSQL Catalog

**File**: `backend/services/auto_matcher_service.py`

The current matcher only searches Firebase/Firestore (the legacy catalog). The PostgreSQL `movies` and `series` tables are populated from the Firestore migration but are never queried during matching.

Changes required:
1. Accept a `db_session_factory` in `AutoMatcherService.__init__()`.
2. Before calling Firebase, query `movies` and `series` tables using a case-insensitive title LIKE or pg_trgm similarity search.
3. Assign the same scoring as Firebase results, with an `+20` bonus for internal catalog hits.
4. Propagate `media_type` from the catalog row to the candidate (this will allow documentary classification if the catalog records carry genre/type).

This also resolves the `limit(120)` Firebase scalability problem.

---

### Task 11 — Duplicate Movie Version Handling (Duration-Aware)

**File**: `backend/services/ingress_queue_service.py`

#### Current behaviour

`_enrich_proposed_paths()` reads the destination folder to check whether a main-feature file already exists. If it does, **all** new files for that title group are immediately labelled `Special Feature N` regardless of duration.

#### Required behaviour

When a second (or subsequent) copy of a movie is processed, compare the new file's duration against the existing main-feature file's duration:

- **If the new file's duration ≥ `movie_version_duration_threshold` × existing duration** (suggested default: `0.85`, i.e. within 15%) → treat it as an **alternate version** of the feature, not a special. Name it with a version suffix: `Movie Title (Year) - Version 2.mkv`, `... - Version 3.mkv`, etc.
- **If the new file is significantly shorter** (below the threshold) → treat it as a special feature and keep the current naming (`Special Feature N`).

#### Changes to `_movie_folder_state()`

Extend to also return the duration of the existing main-feature file:

```python
def _movie_folder_state(best_match) -> Tuple[bool, int, Optional[float]]:
    """Return (main_exists, next_special_number, main_duration_ms)."""
    ...
    main_duration_ms: Optional[float] = None
    if os.path.isdir(dest_dir):
        for name in os.listdir(dest_dir):
            full_path = os.path.join(dest_dir, name)
            if not os.path.isfile(full_path):
                continue
            stem, ext = os.path.splitext(name)
            if ext.lower() not in video_extensions:
                continue
            if stem.lower() == folder_lower:
                main_exists = True
                main_duration_ms = _get_file_duration(full_path)  # reads mediainfo
            ...
    return (main_exists, highest_special_number + 1, main_duration_ms)
```

#### Changes to `_enrich_proposed_paths()`

When `main_exists` is `True`, before assigning `Special Feature`, compare durations:

```python
main_exists, next_special_num, main_duration_ms = _movie_folder_state(sample_match)

if main_exists:
    threshold = settings.movie_version_duration_threshold  # default 0.85
    version_counter = _count_existing_versions(dest_dir, folder)  # see below
    special_offset = 0

    for idx in ordered:   # ordered by duration desc
        new_dur = items[idx].get("media_duration_ms") or 0
        is_version = (
            main_duration_ms is not None
            and new_dur > 0
            and (new_dur / main_duration_ms) >= threshold
        )
        if is_version:
            version_counter += 1
            items[idx]["proposed_path"] = _build_version_path(
                items[idx]["file_name"], items[idx]["best_match"], version_counter
            )
        else:
            items[idx]["proposed_path"] = _build_special_path(
                items[idx]["file_name"], items[idx]["best_match"],
                next_special_num + special_offset
            )
            special_offset += 1
```

Add a new `_build_version_path()` static method:

```python
@staticmethod
def _build_version_path(file_name: str, best_match: Dict[str, Any], version_number: int) -> str:
    ext = os.path.splitext(file_name)[1]
    folder = IngressQueueService._folder_title(best_match)
    return f"movies/{folder}/{folder} - Version {version_number}{ext}"
```

Add `_count_existing_versions()` that scans the existing destination folder for files matching `* - Version N` so that numbering continues from wherever it left off.

#### Settings addition (`backend/config/settings.py`)

```python
# Threshold for treating a second copy of a movie as an alternate version
# rather than a special feature. 0.85 = within 15% of the main feature's duration.
movie_version_duration_threshold: float = Field(
    default=0.85,
    validation_alias="MEDIA_LIBRARY_MOVIE_VERSION_DURATION_THRESHOLD",
)
```

#### Impact on `FileOrganizationService`

The `organize_assignment()` method uses the `proposed_path` from the queue item as a hint but ultimately recomputes the destination path using `_calculate_jellyfin_path()`. That method must also be updated to propagate the version suffix when `assignment.get("isAlternateVersion")` is truthy:

```python
if assignment.get("isAlternateVersion"):
    version_num = assignment.get("versionNumber", 2)
    return f"{library_root}/{subfolder}/{folder_name} - Version {version_num}{ext}"
```

The `AssignmentOrchestrator` must set `isAlternateVersion=True` and `versionNumber=N` in the assignment payload when the duration comparison triggers this code path.

---

### Task 12 — Unknown Episode Handling and Zero-Unprocessed Guarantee

**File**: `backend/services/ingress_queue_service.py`, `backend/services/file_organization_service.py`, `backend/services/assignment_orchestrator.py`

#### 12a. Unknown episode number for series files

**File**: `backend/services/ingress_queue_service.py`

Currently `_build_main_path()` for an episode falls through to the original filename when no season/episode can be parsed, which means the file lands in the season folder with an undescriptive name. Extend the path builder:

```python
@staticmethod
def _build_main_path(file_name: str, best_match: Dict[str, Any]) -> str:
    ext = os.path.splitext(file_name)[1]
    folder = IngressQueueService._folder_title(best_match)
    media_type = best_match.get("media_type", "movie")

    if media_type in ("episode", "series"):
        season = best_match.get("season")
        episode = best_match.get("episode")
        season_str = f"Season {int(season):02d}" if season is not None else "Season 00"

        if episode is not None:
            # Normal known episode
            ep_str = f"S{int(season or 0):02d}E{int(episode):02d}"
            ep_title = best_match.get("episode_title") or ""
            ep_label = f" {ep_title}" if ep_title else ""
            return f"shows/{folder}/{season_str}/{folder} {ep_str}{ep_label}{ext}"
        else:
            # Episode number unknown — use a numbered Unknown Episode suffix
            unknown_n = best_match.get("unknown_episode_number", 1)
            return f"shows/{folder}/{season_str}/{folder} - Unknown Episode {unknown_n}{ext}"

    return f"movies/{folder}/{folder}{ext}"
```

To correctly number unknown episodes, `_enrich_proposed_paths()` must:
1. Scan the destination season folder for existing `* - Unknown Episode N` files and find the highest N.
2. Assign incrementing numbers to each unknown-episode item in the current batch.

**File**: `backend/services/ingress_queue_service.py` — `_enrich_proposed_paths()`

```python
def _unknown_episode_state(best_match: Dict[str, Any]) -> int:
    """Return the next Unknown Episode number for a series/season folder."""
    folder = _folder_title(best_match)
    season = best_match.get("season")
    season_str = f"Season {int(season):02d}" if season is not None else "Season 00"
    season_dir = os.path.join(settings.jellyfin_dest_base, "shows", folder, season_str)
    highest = 0
    if os.path.isdir(season_dir):
        try:
            for name in os.listdir(season_dir):
                m = re.search(r"Unknown Episode\s+(\d+)", name, re.IGNORECASE)
                if m:
                    highest = max(highest, int(m.group(1)))
        except OSError:
            pass
    return highest + 1
```

When an episode item's `best_match` has no `episode` value, call `_unknown_episode_state()` and store the result in `best_match["unknown_episode_number"]` before building the path.

#### 12b. Zero-unprocessed-files guarantee

No file should remain with `proposed_path = None` after enrichment. Any item that still has no path after all grouping and fallback logic must receive a catch-all path in a `_NeedsReview` staging folder:

**File**: `backend/services/ingress_queue_service.py` — end of `_enrich_proposed_paths()`

```python
# Final pass: ensure every item has a proposed path
for idx, item in enumerate(items):
    if item.get("proposed_path"):
        continue   # already resolved

    file_name = item.get("file_name") or f"unknown_{idx}"
    stem, ext = os.path.splitext(file_name)
    # Sanitize for filesystem safety
    safe_stem = IngressQueueService._sanitize_title(stem) or f"file_{idx}"

    # Determine the best human-readable label from whatever we have
    parsed_info = item.get("parsed_info") or {}
    parsed_title = parsed_info.get("title") or ""
    parsed_label = IngressQueueService._sanitize_title(parsed_title) if parsed_title else ""

    if parsed_label:
        display_name = f"{parsed_label} - NEEDS REVIEW{ext}"
    else:
        display_name = f"{safe_stem} - NEEDS REVIEW{ext}"

    items[idx]["proposed_path"] = f"_NeedsReview/{display_name}"
    items[idx].setdefault("review_reason", "No metadata match found")
```

This means:
- Every file is assigned a proposed path.
- Files that cannot be matched land in a `_NeedsReview/` subfolder under the destination root with a clear `- NEEDS REVIEW` marker in the filename.
- The UI queue page immediately shows these as items requiring manual attention.
- When the user manually assigns the item, the `reset-to-encoded` or `manual-assign` flow moves it from `_NeedsReview/` to its correct final path.

#### 12c. `FileOrganizationService` — catch-all routing

**File**: `backend/services/file_organization_service.py`

When `_calculate_jellyfin_path()` is called with an unrecognised media type or returns `None`, fall back to the `_NeedsReview` folder instead of raising:

```python
target_path = self._calculate_jellyfin_path(...)
if not target_path:
    # Route to staging area rather than dropping the file
    safe_name = self._sanitize_path(
        assignment.get("sourceFile", {}).get("fileName", "unknown")
    )
    target_path = os.path.join(self.jellyfin_dest_base, "_NeedsReview")
    needs_review = True
else:
    needs_review = False
```

Include a `needsReview: true` flag in the organization result payload so the API and UI can highlight these items distinctly.

#### 12d. Settings: Auto-create `_NeedsReview` folder

**File**: `backend/main.py` (startup)

Add `_NeedsReview` to the list of folders bootstrapped on startup alongside the typed media folders (see Task 8).

---

### Task 13 — My Library UI: Show All Organized Files

**Scope**: Frontend (`src/app/dashboard/my-library/`) and backend catalog API

#### 13a. Root cause: `isInLibrary` depends on Firestore `jellyfinInfo`

The `isInLibrary()` helper in `libraryHelpers.ts` checks for `jellyfinInfo.folderPath` or `folderPath` on the media record. These fields are currently only written by the Firestore pipeline. The PostgreSQL-backed pipeline (`FileOrganizationService`) does **not** write the organized path back to the catalog record.

**File**: `backend/services/file_organization_service.py` — `organize_assignment()`

After a successful move, update the media catalog record (`movies` or `series` table) to record the organized path in the `jellyfin_info` JSONB column and the mirrored `raw_data` blob:

```python
if all_successful and self.db_session_factory:
    await self._update_catalog_jellyfin_info(
        media_type=media_type,
        media_id=assignment.get("mediaId"),
        folder_path=target_path,
        organized_at=datetime.utcnow().isoformat(),
    )
```

```python
async def _update_catalog_jellyfin_info(
    self,
    media_type: str,
    media_id: str,
    folder_path: str,
    organized_at: str,
) -> None:
    Model = Movie if media_type == "movie" else Series
    async with self.db_session_factory() as session:
        result = await session.execute(
            select(Model).where(Model.id == media_id)
        )
        row = result.scalar_one_or_none()
        if row:
            jellyfin_info = dict(row.jellyfin_info or {})
            jellyfin_info["folderPath"] = folder_path
            jellyfin_info["organizedAt"] = organized_at
            row.jellyfin_info = jellyfin_info
            # Mirror into raw_data so the frontend Firebase-shape response also carries it
            raw = dict(row.raw_data or {})
            raw["jellyfinInfo"] = jellyfin_info
            row.raw_data = raw
            await session.commit()
```

This ensures that after a file is organized, `GET /api/catalog/movies` returns the record with `jellyfinInfo.folderPath` set, and the frontend's `isInLibrary()` check will return `true`.

#### 13b. `FileOrganizationService.__init__()` — accept `db_session_factory`

**File**: `backend/services/file_organization_service.py`

```python
def __init__(
    self,
    filesystem_manager=None,
    firestore_service=None,
    jellyfin_dest_base=None,
    db_session_factory=None,     # ← add
):
    ...
    self.db_session_factory = db_session_factory
```

**File**: `backend/main.py` — pass the factory on construction:

```python
file_organization_service = FileOrganizationService(
    filesystem_manager=file_manager,
    firestore_service=None,
    db_session_factory=async_session_factory,
)
```

#### 13c. My Library UI — add tabs for new media types

**File**: `src/app/dashboard/my-library/page.tsx`

Currently the page only renders "movie" and "series" tabs. Once Documentaries and Live Performances are a reality, they should appear here.

Changes:

1. Add new `LibraryMediaType` values (`'documentary'` and `'live_performance'`) to the type union in `libraryHelpers.ts`.
2. Create filtered card arrays:
   ```ts
   const documentaryCards = computedMedia.filter((item) => item.mediaType === 'documentary');
   const livePerformanceCards = computedMedia.filter((item) => item.mediaType === 'live_performance');
   ```
3. Add new `<Tab>` entries and corresponding `visibleCards` branches in the tab switch.
4. Update the summary `<Chip>` row to show counts for all four types.

**Note**: The backend `GET /api/catalog/movies` endpoint currently returns all `Movie` rows regardless of type. Once `documentary` and `live_performance` catalog rows exist, either:
- Add `media_type` filtering support to the endpoint (e.g. `GET /api/catalog/movies?type=movie`), or
- Create separate endpoints (`/api/catalog/documentaries`, `/api/catalog/live-performances`) matching the pattern.

The simplest first step is to add a `type` query parameter to the existing movies endpoint and create corresponding React hooks.

#### 13d. `_NeedsReview` items visible in UI

**File**: `src/app/dashboard/my-library/page.tsx`

Add a fifth "Needs Review" tab that fetches from a new `GET /api/ingress/queue?status=needs_review` endpoint and displays items with `proposed_path` containing `_NeedsReview/`. This gives users a single place to see files that landed in the staging folder and take action (manual assign or delete).

---

## Ingest Flow: End-to-End With NAS (Updated)

Once all tasks are implemented, every file through the ingest pipeline reaches a final state with no silent drops:

```
User copies media file to \\192.168.0.175\ark\media\ingest\
        ↓
FileWatcherService (PollingObserver) detects + stabilises file
        ↓
IngressQueueService.add_from_watcher()
  reads mediainfo duration → stored as media_duration_ms
  persists to PostgreSQL ingress_queue table
        ↓
Auto-processor loop
  FilenameParser → title / year / season / episode
  AutoMatcherService → PostgreSQL catalog → OMDB → TMDB
  Confidence score (0–100)
        ↓
  Score ≥ 80 → auto_assigned
    AssignmentOrchestrator
      → media_type: movie / episode / documentary / live_performance
      → Duplicate movie? Compare durations:
            ≥ 85% of existing → Version 2/3/… (movie file, numbered)
            < 85%             → Special Feature N
      → Unknown episode? → "Series - Unknown Episode N"
      FileOrganizationService
        → Movies/             movie or alternate version
        → TV Shows/           known episode or Unknown Episode N
        → Documentaries/
        → Live Performances/
        → _NeedsReview/       fallback — nothing is dropped
        Writes jellyfinInfo.folderPath back to PostgreSQL catalog
        ↓
  Score < 80 → needs_review
    proposed_path = "_NeedsReview/<Title> - NEEDS REVIEW.ext"   (guaranteed set)
    User sees item in queue UI and in My Library → Needs Review tab
    Manual-assign → re-runs organization flow to correct destination
```

---

## Implementation Priority Order

| Priority | Task | Effort |
|---|---|---|
| 🔴 Critical | Task 1 — Mount NAS on both machines | Infra/config |
| 🔴 Critical | Task 2 — Update settings for NAS paths + polling | Small code change |
| 🔴 Critical | Task 4 — File organization: new media type folders | Medium code change |
| 🔴 Critical | Task 5 — Polling watcher for SMB | Small code change |
| 🔴 Critical | Task 12 — Unknown episode + zero-unprocessed guarantee | Medium code change |
| 🟡 High | Task 3 — New media types in orchestrator + matcher | Medium code change |
| 🟡 High | Task 7 — NAS health check + folder bootstrap | Medium code change |
| 🟡 High | Task 8 — Auto-create dest subfolders on startup | Small code change |
| 🟡 High | Task 9 — Per-machine .env files | Config only |
| 🟡 High | Task 11 — Duplicate movie version handling | Medium code change |
| 🟡 High | Task 13 — My Library UI: show all organized files | Medium frontend + backend |
| 🟠 Medium | Task 6 — Queue persistence to PostgreSQL | Larger refactor |
| 🟠 Medium | Task 10 — Auto-matcher: query PostgreSQL | Medium code change |

---

## Files That Require Code Changes

| File | Changes |
|---|---|
| `backend/config/settings.py` | Add NAS/dest settings, folder name constants, version threshold, fix defaults |
| `backend/services/file_organization_service.py` | New media types, version suffix, `_NeedsReview` fallback, write `jellyfinInfo` to catalog |
| `backend/services/assignment_orchestrator.py` | Detect new media types; set `isAlternateVersion` / `versionNumber` in payload |
| `backend/services/auto_matcher_service.py` | Propagate media_type from OMDB genre; query PostgreSQL |
| `backend/services/file_watcher_service.py` | Auto-detect network paths for polling; fix Windows lock check |
| `backend/services/ingress_queue_service.py` | Duration-aware duplicate logic; unknown episode numbering; zero-unprocessed guarantee; persist to PostgreSQL |
| `backend/api/ingress_operations.py` | Accept new media types in manual-assign; extend health check |
| `backend/api/catalog.py` | Optional `type` filter on `/api/catalog/movies`; new endpoints for documentaries / live performances |
| `backend/main.py` | Bootstrap dest subfolders + `_NeedsReview` on startup; wire db to queue and org services |
| `docker-compose.yml` | Add NAS volume bind mount |
| `src/app/dashboard/my-library/page.tsx` | Add Documentary / Live Performance / Needs Review tabs |
| `src/app/dashboard/my-library/_components/libraryHelpers.ts` | Add new `LibraryMediaType` values |
| `src/hooks/firebase/useMovies.ts` (or new hooks) | Add `type` param; new hooks for documentaries and live performances |
| `.env` (new, not committed) | Per-machine environment config |
