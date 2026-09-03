# Backend

Python FastAPI service that provides the REST API, database access, media file operations, and ingress processing pipeline.

## Stack

| Component | Technology |
|---|---|
| Framework | FastAPI (async) |
| ORM | SQLAlchemy (async, `asyncpg` driver) |
| Database | PostgreSQL 16 |
| Auth | HTTP-only session cookie, bcrypt passphrase |
| File watching | `watchdog` `PollingObserver` (SMB/NAS-compatible) |

## Running Locally

```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt

# Copy and fill in environment variables
cp .env.example .env

python start.py               # listens on :8082
# or with auto-reload:
uvicorn main:app --reload --host 0.0.0.0 --port 8082
```

Interactive API docs: <http://localhost:8082/docs>

For the end-to-end user workflow this API serves (catalogue from the mobile
app → rip here → track what's ripped → locate a disc physically), see
[docs/guides/COLLECTION_CATALOGUING_WORKFLOW.md](../docs/guides/COLLECTION_CATALOGUING_WORKFLOW.md).

## Project Structure

```
backend/
├── main.py                     # App factory, lifespan, router registration
├── start.py                    # Convenience entry-point (uvicorn wrapper)
├── api/
│   ├── auth.py                 # Login, logout, session dependency
│   ├── catalog.py              # CRUD + reassignment for movies/series/discs
│   ├── file_browser.py         # Directory listing and file browsing
│   ├── file_operations.py      # Move, rename, delete file operations
│   ├── generic_data.py         # Generic key-value config store
│   ├── ingress_operations.py   # Ingress queue management and health
│   ├── library_operations.py   # Library scan and path management
│   ├── library_paths.py        # Library path CRUD
│   ├── media_operations.py     # Media file inspection
│   ├── metadata_operations.py  # ffprobe metadata extraction
│   └── posters.py              # Poster cache serving
├── config/
│   └── settings.py             # Pydantic-settings config (env vars)
├── db/
│   ├── database.py             # Engine, session factory, Base
│   ├── models.py               # SQLAlchemy ORM models
│   └── init/                   # SQL files run by Docker on first start
│       └── 002_add_rating_columns.sql
├── services/
│   ├── assignment_orchestrator.py    # Coordinates match → organise pipeline
│   ├── auto_matcher_service.py       # Filename → catalog entry matching
│   ├── file_organization_service.py  # Builds Jellyfin folder structures
│   ├── file_watcher_service.py       # PollingObserver for SMB/NAS paths
│   ├── filename_parser.py            # Filename → title/year/S/E extraction
│   ├── filesystem_manager.py         # Safe path validation, file I/O
│   ├── ingress_queue_service.py      # In-memory ingress queue with enrichment
│   ├── library_scanner.py            # Recursive directory scanner
│   ├── media_metadata_extractor.py   # ffprobe wrapper
│   ├── metadata_extractor.py         # Higher-level metadata extraction
│   ├── poster_cache_service.py       # Download + serve poster images
│   └── task_manager.py               # Background task tracking
├── utils/
│   ├── exceptions.py           # Typed application exceptions
│   └── logging.py              # Structured logging setup
└── tests/
    ├── conftest.py             # Fixtures, test DB setup
    ├── test_auth.py
    ├── test_catalog.py
    ├── test_generic_data.py
    └── test_library_paths.py
```

## API Modules

### `catalog.py` — `/api/catalog`

CRUD for the three main domain types plus disc reassignment.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/catalog/movies` | List all movies |
| `GET` | `/api/catalog/movies/lookup` | Find by `imdbId` or `titleLower` |
| `GET` | `/api/catalog/movies/{id}` | Get one movie |
| `PUT` | `/api/catalog/movies/{id}` | Create or update a movie |
| `DELETE` | `/api/catalog/movies/{id}` | Delete a movie |
| `GET` | `/api/catalog/series` | List all series |
| `GET` | `/api/catalog/series/lookup` | Find by `imdbId` or `titleLower` |
| `GET` | `/api/catalog/series/{id}` | Get one series |
| `PUT` | `/api/catalog/series/{id}` | Create or update a series |
| `DELETE` | `/api/catalog/series/{id}` | Delete a series |
| `GET/PUT/DELETE` | `/api/catalog/discs/{id}` | Disc CRUD |
| `POST` | `/api/catalog/reassign-discs` | Move disc records between catalog entries |

#### Upsert behaviour (`PUT /movies/{id}` and `PUT /series/{id}`)

The upsert handler extracts every significant field from the request body into a dedicated column rather than relying solely on the `raw_data` JSONB blob. Extracted columns include:

- Core: `title`, `release_date`, `runtime`, `genres`, `languages`, `countries`
- OMDB: `awards`, `content_rating`, `imdb_rating`, `imdb_votes`, `metascore`, `box_office`
- TMDB: `tagline`, `tmdb_rating`, `tmdb_vote_count`, `tmdb_id`
- Series only: `status`, `network`, `total_seasons`, `total_episodes`
- Relations: `omdb_data` (full OMDB payload), `tmdb_data` (full TMDB payload), `id` fields

OMDB's `"N/A"` sentinel is coerced to `NULL` before storage.

#### Disc reassignment (`POST /api/catalog/reassign-discs`)

```json
{
  "discIds":     ["disc-uuid-1", "disc-uuid-2"],
  "fromMediaId": "source-catalog-id",
  "toMediaId":   "target-catalog-id",
  "toMediaType": "movie"
}
```

- Removes `discIds` entries from the source entry's `releases[].discIds`
- Adds them to a `_reassigned` release slot on the target entry
- Updates each `Disc` row's `raw_data.mediaId` / `raw_data.mediaType`

### `ingress_operations.py` — `/api/ingress`

Manages the in-memory ingress queue, health check (including NAS TCP connectivity), and manual assignment endpoint.

### `posters.py` — `/api/posters`

Serves cached poster images. On first request the image is downloaded from the OMDB/TMDB CDN and written to the `poster_cache` volume. Subsequent requests are served from disk. A daily re-check appends updated versions without deleting old ones.

## Database Schema

All tables live in the `public` schema. The ORM models are defined in `db/models.py`.

### Key tables

| Table | Purpose |
|---|---|
| `movies` | Movie catalog entries |
| `series` | TV series catalog entries |
| `seasons` | Season records linked to a series |
| `episodes` | Episode records linked to a season |
| `releases` | Physical release records (Blu-ray, DVD sets) |
| `discs` | Individual disc records linked to a release |
| `release_movies` | M2M — releases ↔ movies |
| `release_series` | M2M — releases ↔ series |

### Rating / metadata columns (added in migration `002`)

Both `movies` and `series` have these columns in addition to the base schema:

```
imdb_rating      TEXT        -- OMDB imdbRating
imdb_votes       TEXT        -- OMDB imdbVotes
metascore        TEXT        -- OMDB Metascore
content_rating   TEXT        -- OMDB Rated  (PG-13, TV-MA, …)
tagline          TEXT        -- TMDB tagline
tmdb_rating      TEXT        -- TMDB vote_average
tmdb_vote_count  INTEGER     -- TMDB vote_count
tmdb_data        JSONB       -- Full TMDB detail response
```

`movies` additionally has: `box_office`, `collection_id/name/order`

`series` additionally has: `total_seasons`, `total_episodes`, `status`, `network`

### Database migrations

Migrations are plain SQL files placed in `db/init/`. They use `IF NOT EXISTS` / `IF EXISTS` guards so they are safe to re-run. Docker applies them automatically on first container start (alphabetical order).

To apply a migration to an already-running instance:

```bash
docker compose exec -T postgres psql -U media_user -d media_manager \
  -f /dev/stdin < backend/db/init/002_add_rating_columns.sql
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/db` |
| `SESSION_SECRET_KEY` | Strong random string for cookie signing |
| `MEDIA_LIBRARY_OMDB_API_KEY` | From https://www.omdbapi.com |
| `MEDIA_LIBRARY_TMDB_API_KEY` | From https://www.themoviedb.org |
| `JELLYFIN_DEST_BASE` | Destination root for organized media (e.g. `/ark/media/jellyfin`) |
| `MEDIA_LIBRARY_INGRESS_DEFAULT_PATHS` | Watched ingress folders (e.g. `["/ark/media/ingest"]`) |
| `NAS_HOST` | NAS hostname or IP (optional) |
| `MEDIA_LIBRARY_NAS_MOUNT_CHECK_PATH` | NAS mount health-check path (e.g. `/ark/media`) |
| `MEDIA_LIBRARY_POSTER_CACHE_DIR` | Override poster cache directory |

## Tests

```bash
# Unit tests only (no database required)
cd backend
source venv/bin/activate
python -m pytest tests/ -v

# Integration tests (requires test DB on port 5433)
# See the root README Testing section
```

Tests use the database URL `postgresql+asyncpg://media_user:changeme@localhost:5433/media_manager_test` set by `conftest.py` before any application modules are imported, so the production database is never touched.

## Movie Folder Reorganization Utility

To normalize already-processed movie folders for Jellyfin extras detection:

```bash
cd backend
python scripts/organize_processed_movies.py --dry-run
python scripts/organize_processed_movies.py --apply
```

What it does:

- Keeps/normalizes main-feature naming to match the movie folder.
- Classifies extras by Jellyfin suffix rules (for example `-featurette`, `.trailer`, `-behindthescenes`).
- Moves extras into supported Jellyfin extras folders (for example `trailers`, `featurettes`, `behind the scenes`, `extras`).
- Renames alternate versions to use Jellyfin's required `Movie Name - Label.ext` pattern.
