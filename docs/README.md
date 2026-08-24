# Documentation

Comprehensive documentation for the Media Library Management System.

Folder layout: `architecture/` — current-state technical references;
`api/` — endpoint reference; `guides/` — how-to docs for contributors;
`completed/` — implementation logs for finished work, kept for history.

## Table of Contents

### Architecture (current state)
- **[Database Tables Reference](./architecture/DATABASE_TABLES_REFERENCE.md)** — Full schema reference
- **[Naming Conventions](./architecture/NAMING_CONVENTIONS.md)** — Full rip→ingest→Jellyfin naming pipeline, including disc-ripper-service and the extras taxonomy
- **[Jellyfin Media Organization](./architecture/JELLYFIN_MEDIA_ORGANIZATION.md)** — Folder naming conventions and Jellyfin layout

### API Documentation
- **[API Endpoints Reference](./api/)** — All available backend endpoints

### Guides
- **[Testing](./guides/TESTING.md)** — Isolated test environments, how to run tests
- **[Poster Cache](./guides/POSTER_CACHE.md)** — How poster images are downloaded, cached, and served
- **[Ingress Assignment Reference](./guides/INGRESS_ASSIGNMENT_REFERENCE.md)** — Auto-matching and confidence scoring

### Completed Work (implementation logs, kept for history)
- **[Firebase → PostgreSQL Migration](./completed/FIREBASE_TO_POSTGRES_MIGRATION.md)** — How the data layer was migrated from Firestore to PostgreSQL
- **[Firebase Model Improvements](./completed/FIREBASE_MODEL_IMPROVEMENTS.md)**
- **[Admin Forms Revamp](./completed/ADMIN_FORMS_REVAMP_IMPLEMENTATION.md)**
- **[Automation Implementation Plan](./completed/AUTOMATION_IMPLEMENTATION_PLAN.md)**
- **[Automation Workflow Plan](./completed/AUTOMATION_WORKFLOW_PLAN.md)** — End-to-end automated ingress workflow
- **[NAS Ingest Implementation](./completed/NAS_INGEST_IMPLEMENTATION.md)** — Automated ingress from NAS / encoding pipeline
- **[UI Consolidation Plan](./completed/UI_CONSOLIDATION_PLAN.md)**
- **[My Library Destination Enhancements](./completed/MY_LIBRARY_DESTINATION_ENHANCEMENTS.md)** — Drawer navigation, destination preview, reassignment, and poster fallback updates
- **[Library Compliance Audit Plan](./completed/LIBRARY_COMPLIANCE_AUDIT_PLAN.md)**

---

## Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router, TypeScript, MUI) |
| Backend | Python FastAPI (async) + SQLAlchemy |
| Database | PostgreSQL 16 |
| Auth | HTTP-only session cookie + bcrypt |
| Container | Docker + Docker Compose |
| External APIs | OMDB, TMDB |

### Data Flow

```
User searches OMDB / TMDB
       │
       ▼
LibraryMetadataImportService (frontend)
  • fetchBestOmdbData()  — fetches full OMDB + TMDB detail records
  • buildMovieDocument() / buildSeriesDocument()
       │  maps all rating, content, and identity fields
       ▼
PUT /api/catalog/movies/{id}  or  /api/catalog/series/{id}
       │
       ▼
catalog.py upsert_movie() / upsert_series()
  • extracts ~20 discrete columns from request body
  • stores omdb_data + tmdb_data JSONB blobs in full
  • returns raw_data blob with id guaranteed
       │
       ▼
PostgreSQL  (movies / series tables)
```

### Key source locations

| Area | Path |
|---|---|
| Catalog API (backend) | `backend/api/catalog.py` |
| ORM models | `backend/db/models.py` |
| DB migrations | `backend/db/init/*.sql` |
| Metadata import service | `src/service/library/LibraryMetadataImportService.ts` |
| Catalog hooks (frontend) | `src/hooks/catalog/` |
| Catalog type definitions | `src/types/catalog/` |
| My Library page | `src/app/dashboard/my-library/page.tsx` |
| Media detail page | `src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx` |
| Conflict resolution dialog | `src/app/dashboard/my-library/_components/MetadataConflictDialog.tsx` |
| Destination browser | `src/app/dashboard/my-library/_components/DestFolderBrowser.tsx` |
| Disk reassignment dialog | `src/app/dashboard/my-library/_components/DiskReassignDialog.tsx` |

---

## Key Features

### Library Catalog

Movies and series are stored in PostgreSQL with dedicated queryable columns for ratings, scores, and identifiers in addition to full JSONB blobs of the raw OMDB and TMDB API responses. No data from external APIs is discarded.

For the full column list see [backend/README.md](../backend/README.md#rating--metadata-columns-added-in-migration-002).

### Metadata Import & Conflict Resolution

Search for a title from the **My Library** page using OMDB or TMDB as the source. When a result is saved:

- **New title** — creates a catalog entry immediately.
- **Existing title, no conflicts** — auto-fills any empty fields and updates the metadata blobs silently.
- **Existing title, conflicts** — opens the **Metadata Conflict Dialog** showing a side-by-side comparison of each differing field. Per-field toggles let you choose between the current stored value and the newly retrieved value. Bulk "Keep All Current" / "Use All Retrieved" shortcuts are provided.

### File Reassignment

From any media detail page (`/dashboard/my-library/{type}/{id}`), individual disc/file records can be moved to a different catalog entry:

1. Check one or more disc records in the *Associated Discs and Files* section.
2. Click **Reassign N selected**.
3. Search for the correct title (catalog first, OMDB fallback). If the target is not yet in the catalog it is created automatically.
4. Confirm — records are unlinked from the current entry and linked to the target.

### Poster Cache

Poster images are downloaded from OMDB/TMDB CDN on first request and stored in a persistent Docker volume. Daily re-checks append new versions if the upstream image changes. See [guides/POSTER_CACHE.md](./guides/POSTER_CACHE.md).

### Automated Ingress (NAS)

A file-watcher monitors configured NAS/local paths. New files are queued, matched against the catalog via `AutoMatcherService`, and organised into the correct Jellyfin folder structure. Manual assignment and override are available when auto-matching confidence is insufficient. See [completed/NAS_INGEST_IMPLEMENTATION.md](./completed/NAS_INGEST_IMPLEMENTATION.md) and [completed/AUTOMATION_WORKFLOW_PLAN.md](./completed/AUTOMATION_WORKFLOW_PLAN.md).

### Physical Media Tracking

Blu-ray and DVD releases are modelled as `Release` → `Disc` → `VideoFile` chains. Disc records carry format, region, barcode, condition, and linked video file metadata. Discs can be reassigned between catalog entries without deleting any data.

---

## Database Migrations

Schema changes are managed with Alembic (`backend/alembic/versions/`), not
hand-written SQL — `backend/db/init/*.sql` is seed data run by Postgres on
first container start, not the migration mechanism.

```bash
cd backend && source venv/bin/activate
export DATABASE_URL=postgresql+asyncpg://media_user:changeme_strong_password@localhost:5432/media_manager
alembic upgrade head                              # apply pending migrations
alembic check                                      # verify no schema drift
alembic revision --autogenerate -m "description"   # after changing db/models.py
```

---

## App URLs

| Page | URL |
|---|---|
| Home | http://localhost:3000 |
| My Library | http://localhost:3000/dashboard/my-library |
| Admin | http://localhost:3000/admin |
| Library Browser | http://localhost:3000/admin/libraryBrowser |
| API Docs (Swagger) | http://localhost:8082/docs |

---

## Quick Links

- [Root README](../README.md) — Getting started, stack, testing overview
- [Backend README](../backend/README.md) — API modules, DB schema, env vars
- [Testing](./guides/TESTING.md) — Isolated environments, how to run tests

