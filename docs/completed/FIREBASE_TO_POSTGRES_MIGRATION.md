# Firebase → PostgreSQL Migration Guide

**For self-hosted deployment on a local mini PC.**

This document covers the complete migration from Firebase (Firestore + Firebase Auth) to a self-hosted stack using PostgreSQL as the database and a simple passphrase-based session system replacing Firebase Auth.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [PostgreSQL Setup](#2-postgresql-setup)
3. [Database Schema](#3-database-schema)
4. [Backend Migration](#4-backend-migration)
5. [Auth Simplification](#5-auth-simplification)
6. [Frontend Migration](#6-frontend-migration)
7. [Environment Variable Changes](#7-environment-variable-changes)
8. [Migration Sequence](#8-migration-sequence)
9. [Data Export from Firestore](#9-data-export-from-firestore)

---

## 1. Architecture Overview

### Current Stack

```
Next.js Frontend
    ↓ Firebase SDK (firebaseConfig.js)
Firebase Auth  ←→  Firestore
    ↑
Python FastAPI Backend
    ↓ firebase-admin SDK
Firestore
```

### Target Stack

```
Next.js Frontend
    ↓ fetch() to local API
Python FastAPI Backend  ←─── Session cookie auth
    ↓ SQLAlchemy + asyncpg
PostgreSQL (local Docker container)
```

**Key simplifications for self-hosting:**
- No Firebase SDK in the frontend at all — all data access goes through the Python backend REST API
- No multi-user sign-up flow — the app is single-access (one passphrase protects everything)
- No Firestore real-time listeners — polling or SSE from your own backend
- No cloud dependencies at runtime (OMDB/TMDB APIs remain for metadata lookups only)

---

## 2. PostgreSQL Setup

### 2.1 Docker Compose (Recommended)

Create `docker-compose.yml` in the project root:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: media-manager-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: media_manager
      POSTGRES_USER: media_user
      POSTGRES_PASSWORD: changeme_strong_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/db/init:/docker-entrypoint-initdb.d   # optional: seed scripts
    ports:
      - "5432:5432"    # only expose to localhost; don't open this port externally

volumes:
  postgres_data:
```

Start with:

```bash
docker compose up -d
```

### 2.2 Install psycopg2 / asyncpg in Backend

Add to `backend/requirements.txt`:

```
sqlalchemy==2.0.36
asyncpg==0.30.0
alembic==1.14.0
psycopg2-binary==2.9.10     # for Alembic CLI sync operations
```

Remove:

```
firebase-admin==6.4.0
```

---

## 3. Database Schema

This schema replaces all Firestore collections. The design uses proper FK relationships for relational data and `JSONB` columns for metadata blobs that are always read as a whole and never filtered into row-by-row.

### 3.1 Auth

```sql
-- Single row: the app access password hash
-- No users table needed for self-hosted single-user access
CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Seed: INSERT INTO app_config VALUES ('password_hash', '<bcrypt hash>');

-- Active sessions (http-only cookie → session_id lookup)
CREATE TABLE sessions (
    session_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    ip_address  INET,
    user_agent  TEXT
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
```

### 3.2 Media Catalog

```sql
-- Movies
CREATE TABLE movies (
    id                    TEXT        PRIMARY KEY,  -- keep existing Firestore IDs during migration
    title                 TEXT        NOT NULL,
    title_lower           TEXT        GENERATED ALWAYS AS (lower(title)) STORED,
    release_date          TEXT,
    runtime               TEXT,       -- stored as HH:MM:SS string per existing convention
    countries             TEXT[]      DEFAULT '{}',
    genres                TEXT[]      DEFAULT '{}',
    languages             TEXT[]      DEFAULT '{}',
    awards                TEXT,
    notes                 TEXT,
    -- Embedded OMDB response blob (never queried field-by-field)
    omdb_data             JSONB       DEFAULT '{}',
    -- External IDs
    imdb_id               TEXT,
    tmdb_id               TEXT,
    rotten_tomatoes_id    TEXT,
    metacritic_id         TEXT,
    letterboxd_id         TEXT,
    -- Image metadata (array of {fileName, fileSize, format, resolution})
    image_files           JSONB       DEFAULT '[]',
    -- Content ratings array [{country, rating, ratingSystem}]
    content_ratings       JSONB       DEFAULT '[]',
    -- Collection membership
    collection_id         TEXT,
    collection_name       TEXT,
    collection_order      INT,
    -- Assignment summary (denormalized counts updated by triggers or service layer)
    assignment_summary    JSONB       DEFAULT '{}',
    -- Jellyfin info
    jellyfin_info         JSONB       DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movies_title_lower_idx  ON movies (title_lower);
CREATE INDEX movies_imdb_id_idx      ON movies (imdb_id);
CREATE INDEX movies_genres_idx       ON movies USING GIN (genres);
CREATE INDEX movies_countries_idx    ON movies USING GIN (countries);

-- Releases (physical media: Blu-ray sets, DVD, etc.)
CREATE TABLE releases (
    id               TEXT        PRIMARY KEY,
    title            TEXT        NOT NULL,
    year             INT,
    media_type       TEXT,       -- 'bluray', 'dvd', 'uhd', etc.
    edition          TEXT,
    publisher        TEXT,
    territory        TEXT,
    release_date     TEXT,
    spine_number     TEXT,
    out_of_print     BOOLEAN     DEFAULT false,
    upc              TEXT,
    contains_extras  BOOLEAN     DEFAULT false,
    extras           JSONB       DEFAULT '[]',   -- [{description, runtime, extraImage[]}]
    contains_inserts BOOLEAN     DEFAULT false,
    inserts          JSONB       DEFAULT '[]',   -- [{description, insertImage, dataString}]
    image_files      JSONB       DEFAULT '[]',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction: which movies are in which release
CREATE TABLE release_movies (
    release_id  TEXT REFERENCES releases(id) ON DELETE CASCADE,
    movie_id    TEXT REFERENCES movies(id)   ON DELETE CASCADE,
    PRIMARY KEY (release_id, movie_id)
);

-- Discs (individual physical discs in a release)
CREATE TABLE discs (
    id                      TEXT        PRIMARY KEY,
    title                   TEXT        NOT NULL,
    release_id              TEXT        REFERENCES releases(id) ON DELETE SET NULL,
    format                  TEXT,       -- 'DVD' | 'BLURAY' | 'UHD_BLURAY' | 'HD_DVD' | 'LASERDISC'
    disc_number             INT,
    barcode                 TEXT,
    region_code             TEXT,
    language                TEXT,
    subtitles               TEXT[]      DEFAULT '{}',
    is_part_of_set          BOOLEAN     DEFAULT false,
    is_rental_disc          BOOLEAN     DEFAULT false,
    contains_special_features BOOLEAN  DEFAULT false,
    purchase_date           TEXT,
    condition               TEXT,       -- 'Mint' | 'Good' | 'Fair' | 'Poor'
    release_date            TEXT,
    video_files             JSONB       DEFAULT '[]',
    image_files             JSONB       DEFAULT '[]',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Series
CREATE TABLE series (
    id                 TEXT        PRIMARY KEY,
    title              TEXT        NOT NULL,
    title_lower        TEXT        GENERATED ALWAYS AS (lower(title)) STORED,
    countries          TEXT[]      DEFAULT '{}',
    genres             TEXT[]      DEFAULT '{}',
    languages          TEXT[]      DEFAULT '{}',
    running_years      TEXT[]      DEFAULT '{}',
    awards             TEXT,
    notes              TEXT,
    status             TEXT,       -- 'Continuing' | 'Ended' | 'Cancelled' | 'Upcoming'
    network            TEXT,
    content_rating     TEXT,
    omdb_data          JSONB       DEFAULT '{}',
    imdb_id            TEXT,
    tmdb_id            TEXT,
    tvdb_id            TEXT,
    tv_maze_id         TEXT,
    image_files        JSONB       DEFAULT '[]',
    series_summary     JSONB       DEFAULT '{}', -- {totalSeasons, totalEpisodes, totalRuntime, firstAired, lastAired, status}
    assignment_summary JSONB       DEFAULT '{}',
    jellyfin_info      JSONB       DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX series_title_lower_idx ON series (title_lower);
CREATE INDEX series_imdb_id_idx     ON series (imdb_id);

-- Junction: releases ↔ series
CREATE TABLE release_series (
    release_id  TEXT REFERENCES releases(id) ON DELETE CASCADE,
    series_id   TEXT REFERENCES series(id)   ON DELETE CASCADE,
    PRIMARY KEY (release_id, series_id)
);

-- Seasons
CREATE TABLE seasons (
    id                TEXT        PRIMARY KEY,
    series_id         TEXT        NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    series_title      TEXT        NOT NULL,  -- denormalized for display
    season_number     INT         NOT NULL,
    season_name       TEXT,
    alternate_title   TEXT,
    total_episodes    INT,
    first_aired       TEXT,
    last_aired        TEXT,
    release_year      INT,
    countries         TEXT[]      DEFAULT '{}',
    languages         TEXT[]      DEFAULT '{}',
    overview          TEXT,
    image_files       JSONB       DEFAULT '[]',
    poster_image      TEXT,
    plex_link         TEXT,
    jellyfin_folder_id   TEXT,
    jellyfin_folder_name TEXT,
    episodes_with_files  INT      DEFAULT 0,
    total_files          INT      DEFAULT 0,
    total_file_size      BIGINT   DEFAULT 0,
    omdb_data         JSONB       DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (series_id, season_number)
);
CREATE INDEX seasons_series_id_idx ON seasons (series_id, season_number);

-- Episodes
CREATE TABLE episodes (
    id               TEXT        PRIMARY KEY,
    series_id        TEXT        NOT NULL REFERENCES series(id)  ON DELETE CASCADE,
    season_id        TEXT        NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    series_title     TEXT        NOT NULL,  -- denormalized
    season_number    INT         NOT NULL,
    episode_number   INT         NOT NULL,
    episode_numbers  INT[]       DEFAULT '{}',   -- multi-part episodes
    title            TEXT,
    overview         TEXT,
    air_date         TEXT,
    runtime          INT,        -- minutes
    runtime_formatted TEXT,
    countries        TEXT[]      DEFAULT '{}',
    languages        TEXT[]      DEFAULT '{}',
    image_files      JSONB       DEFAULT '[]',
    still_image      TEXT,
    plex_link        TEXT,
    imdb_id          TEXT,
    tmdb_id          TEXT,
    tvdb_id          TEXT,
    has_file         BOOLEAN     DEFAULT false,
    file_id          TEXT,       -- FK added below after media_files table
    file_count       INT         DEFAULT 0,
    jellyfin_filename TEXT,
    omdb_data        JSONB       DEFAULT '{}',
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX episodes_season_id_idx  ON episodes (season_id, episode_number);
CREATE INDEX episodes_series_id_idx  ON episodes (series_id);

-- People
CREATE TABLE actors (
    id          TEXT        PRIMARY KEY,
    full_name   TEXT        NOT NULL,
    birthplace  TEXT,
    birthday    TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE directors (
    id          TEXT        PRIMARY KEY,
    full_name   TEXT        NOT NULL,
    birthplace  TEXT,
    birthday    TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction tables (replace bidirectional array refs in Firestore)
CREATE TABLE movie_actors (
    movie_id    TEXT REFERENCES movies(id)   ON DELETE CASCADE,
    actor_id    TEXT REFERENCES actors(id)   ON DELETE CASCADE,
    characters  TEXT[]  DEFAULT '{}',
    PRIMARY KEY (movie_id, actor_id)
);

CREATE TABLE movie_directors (
    movie_id    TEXT REFERENCES movies(id)    ON DELETE CASCADE,
    director_id TEXT REFERENCES directors(id) ON DELETE CASCADE,
    title       TEXT,
    PRIMARY KEY (movie_id, director_id)
);

CREATE TABLE series_actors (
    series_id   TEXT REFERENCES series(id)   ON DELETE CASCADE,
    actor_id    TEXT REFERENCES actors(id)   ON DELETE CASCADE,
    characters  TEXT[]  DEFAULT '{}',
    PRIMARY KEY (series_id, actor_id)
);

CREATE TABLE series_directors (
    series_id   TEXT REFERENCES series(id)    ON DELETE CASCADE,
    director_id TEXT REFERENCES directors(id) ON DELETE CASCADE,
    seasons     TEXT[]  DEFAULT '{}',  -- which seasons this director worked on
    title       TEXT,
    PRIMARY KEY (series_id, director_id)
);
```

### 3.3 Library Scanning (v2 Architecture)

```sql
-- Library root paths configured by the user
CREATE TABLE library_paths (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name            TEXT        NOT NULL,
    root_path       TEXT        NOT NULL,
    media_type      TEXT        NOT NULL DEFAULT 'mixed',  -- 'mixed' | 'movies' | 'series'
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_scanned    TIMESTAMPTZ,
    last_scan_id    TEXT,
    last_scan_status TEXT,
    scan_progress   JSONB       DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scan run records
CREATE TABLE scan_results (
    id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    library_path_id     TEXT        REFERENCES library_paths(id) ON DELETE SET NULL,
    library_path        TEXT        NOT NULL,   -- snapshot of path at scan time
    status              TEXT        NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'error'
    total_items         INT         DEFAULT 0,
    files_found         INT         DEFAULT 0,
    directories_found   INT         DEFAULT 0,
    start_time          TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time            TIMESTAMPTZ,
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scan_results_library_path_id_idx ON scan_results (library_path_id, start_time DESC);

-- Discovered files from a scan
CREATE TABLE scanned_files (
    id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    scan_id          TEXT        REFERENCES scan_results(id) ON DELETE CASCADE,
    library_path_id  TEXT        REFERENCES library_paths(id) ON DELETE SET NULL,
    file_path        TEXT        NOT NULL,
    file_name        TEXT        NOT NULL,
    folder_path      TEXT,
    extension        TEXT,
    media_type       TEXT,       -- 'movie' | 'episode' | 'unknown'
    status           TEXT        DEFAULT 'found',
    file_size        BIGINT,
    modified_time    TIMESTAMPTZ,
    media_metadata   JSONB       DEFAULT '{}',
    parsed_info      JSONB       DEFAULT '{}',
    discovered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scanned_files_scan_id_idx        ON scanned_files (scan_id, discovered_at);
CREATE INDEX scanned_files_library_path_idx   ON scanned_files (library_path_id, discovered_at);
CREATE INDEX scanned_files_folder_path_idx    ON scanned_files (folder_path);

-- Discovered directories from a scan
CREATE TABLE scanned_directories (
    id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    scan_id          TEXT        REFERENCES scan_results(id) ON DELETE CASCADE,
    library_path_id  TEXT        REFERENCES library_paths(id) ON DELETE SET NULL,
    dir_path         TEXT        NOT NULL,
    dir_name         TEXT        NOT NULL,
    media_type       TEXT,
    status           TEXT        DEFAULT 'found',
    metadata         JSONB       DEFAULT '{}',
    discovered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Processed media files (v2, replaces scanned_files for organized library)
CREATE TABLE media_files (
    id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    scan_id               TEXT        REFERENCES scan_results(id) ON DELETE SET NULL,
    library_path_id       TEXT        REFERENCES library_paths(id) ON DELETE SET NULL,
    file_path             TEXT        NOT NULL UNIQUE,
    file_name             TEXT        NOT NULL,
    file_extension        TEXT,
    folder_path           TEXT,
    relative_path         TEXT,
    file_size             BIGINT,
    file_size_formatted   TEXT,
    checksum              TEXT,
    created_date          TIMESTAMPTZ,
    modified_date         TIMESTAMPTZ,
    last_scanned_date     TIMESTAMPTZ,
    is_available          BOOLEAN     DEFAULT true,
    detected_media_type   TEXT,       -- 'movie' | 'episode' | 'unknown'
    confidence            INT         DEFAULT 0,    -- 0–100
    -- Metadata blobs (always read together, never filtered field-by-field)
    video_metadata        JSONB       DEFAULT '{}',
    audio_tracks          JSONB       DEFAULT '[]',
    subtitle_tracks       JSONB       DEFAULT '[]',
    parsed_info           JSONB       DEFAULT '{}',
    -- Assignment
    assignment_status     TEXT        DEFAULT 'unassigned',  -- 'unassigned' | 'assigned' | 'conflict' | 'ignore'
    assigned_to_type      TEXT,
    assigned_to_id        TEXT,
    needs_organization    BOOLEAN     DEFAULT false,
    target_path           TEXT,
    organization_status   TEXT,       -- 'pending' | 'processing' | 'completed' | 'failed'
    tags                  TEXT[]      DEFAULT '{}',
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_files_assignment_status_idx ON media_files (assignment_status);
CREATE INDEX media_files_library_path_id_idx   ON media_files (library_path_id);

-- Links a media file to a movie or episode record
CREATE TABLE media_assignments (
    id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    primary_file_id         TEXT        REFERENCES media_files(id) ON DELETE SET NULL,
    media_type              TEXT        NOT NULL,   -- 'movie' | 'episode'
    media_id                TEXT        NOT NULL,   -- FK enforced at app layer (polymorphic)
    series_id               TEXT,
    season_id               TEXT,
    season_number           INT,
    episode_number          INT,
    version                 TEXT,
    is_preferred_version    BOOLEAN     DEFAULT false,
    -- Organization
    target_folder_structure JSONB       DEFAULT '{}',
    organization_status     TEXT        DEFAULT 'pending',
    organization_date       TIMESTAMPTZ,
    organization_error      TEXT,
    operations              JSONB       DEFAULT '[]',  -- history of file operations
    -- Metadata
    assigned_by             TEXT,       -- 'auto' | 'manual'
    assigned_date           TIMESTAMPTZ,
    confidence              INT         DEFAULT 0,
    is_manual_assignment    BOOLEAN     DEFAULT false,
    match_data              JSONB       DEFAULT '{}',  -- {imdbId, title, resolvedMedia, ...}
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_assignments_media_id_idx    ON media_assignments (media_type, media_id);
CREATE INDEX media_assignments_org_status_idx  ON media_assignments (organization_status);

-- Junction: assignment ↔ extra files
CREATE TABLE assignment_extra_files (
    assignment_id   TEXT REFERENCES media_assignments(id) ON DELETE CASCADE,
    media_file_id   TEXT REFERENCES media_files(id)       ON DELETE CASCADE,
    PRIMARY KEY (assignment_id, media_file_id)
);

-- Tracks Jellyfin folder structures on disk
CREATE TABLE jellyfin_folders (
    id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    folder_path      TEXT        NOT NULL UNIQUE,
    folder_name      TEXT        NOT NULL,
    folder_type      TEXT,       -- 'movie' | 'series' | 'season' | 'extras'
    media_type       TEXT,
    media_id         TEXT,
    season_number    INT,
    media_title      TEXT,
    year             INT,
    imdb_id          TEXT,
    jellyfin_name    TEXT,       -- e.g. "Movie Title (2020) [imdbid-tt1234567]"
    video_files      JSONB       DEFAULT '[]',
    subtitle_files   JSONB       DEFAULT '[]',
    audio_files      JSONB       DEFAULT '[]',
    image_files      JSONB       DEFAULT '[]',
    extra_folders    JSONB       DEFAULT '[]',
    created_date     TIMESTAMPTZ,
    last_verified    TIMESTAMPTZ,
    is_valid         BOOLEAN     DEFAULT true,
    validation_errors JSONB      DEFAULT '[]',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Media file matches pending manual review
CREATE TABLE media_matches (
    id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    file_info    JSONB       NOT NULL,
    confidence   INT         DEFAULT 0,
    media_id     TEXT,
    media_type   TEXT,
    suggestions  JSONB       DEFAULT '[]',  -- [{mediaId, title, year, confidence, reason}]
    status       TEXT        DEFAULT 'unmatched',  -- 'matched' | 'unmatched' | 'conflict' | 'manual_review'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX media_matches_status_idx ON media_matches (status);
```

### 3.4 Ingress Automation Pipeline

```sql
CREATE TABLE ingress_queue (
    id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    file_path         TEXT        NOT NULL,
    file_name         TEXT        NOT NULL,
    ingress_path      TEXT,
    file_size         BIGINT,
    detected_at       TIMESTAMPTZ,
    queued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status            TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'processing' | 'auto_assigned' | 'needs_review' | 'failed' | 'completed'
    priority          INT         DEFAULT 5,    -- 1 (highest) to 10
    attempts          INT         DEFAULT 0,
    last_attempt      TIMESTAMPTZ,
    processed_at      TIMESTAMPTZ,
    last_error        TEXT,
    confidence_score  INT,
    assignment_id     TEXT        REFERENCES media_assignments(id) ON DELETE SET NULL,
    parsed_info       JSONB       DEFAULT '{}',
    best_match        JSONB       DEFAULT '{}',
    match_candidates  JSONB       DEFAULT '[]',
    media_duration_ms BIGINT,
    proposed_path     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingress_queue_status_idx   ON ingress_queue (status, queued_at DESC);

-- Immutable audit log of each processing attempt
CREATE TABLE ingress_processing_history (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    queue_item_id   TEXT,       -- not FK, immutable snapshot
    snapshot        JSONB       NOT NULL,   -- full queue item state at processing time
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingress_history_queue_item_idx ON ingress_processing_history (queue_item_id, created_at DESC);

-- Runtime configuration (single row, key = 'current')
CREATE TABLE ingress_config (
    id          TEXT        PRIMARY KEY DEFAULT 'current',
    config      JSONB       NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.5 Full-Text Search Helper (Optional but Recommended)

```sql
-- Enables fast fuzzy title search to replace the titleLower workaround
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX movies_title_trgm_idx ON movies USING GIN (title gin_trgm_ops);
CREATE INDEX series_title_trgm_idx ON series USING GIN (title gin_trgm_ops);

-- Example query to replace the existing case-insensitive prefix search:
-- SELECT * FROM movies WHERE title % 'the godfather' ORDER BY similarity(title, 'the godfather') DESC LIMIT 10;
```

---

## 4. Backend Migration

### 4.1 New File: `backend/db/database.py`

This replaces `backend/services/firestore_service.py` as the data access layer.

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config.settings import settings

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

### 4.2 New File: `backend/db/models.py`

SQLAlchemy ORM models mirroring the schema above. Key example:

```python
from sqlalchemy import Column, Text, Integer, BigInteger, Boolean, DateTime, ARRAY, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from db.database import Base

class Movie(Base):
    __tablename__ = "movies"
    id                = Column(Text, primary_key=True)
    title             = Column(Text, nullable=False)
    release_date      = Column(Text)
    runtime           = Column(Text)
    countries         = Column(ARRAY(Text), default=[])
    genres            = Column(ARRAY(Text), default=[])
    languages         = Column(ARRAY(Text), default=[])
    omdb_data         = Column(JSONB, default={})
    imdb_id           = Column(Text)
    tmdb_id           = Column(Text)
    image_files       = Column(JSONB, default=[])
    content_ratings   = Column(JSONB, default=[])
    collection_id     = Column(Text)
    collection_name   = Column(Text)
    assignment_summary = Column(JSONB, default={})
    jellyfin_info     = Column(JSONB, default={})
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

# ... (define one class per table following the same pattern)
```

### 4.3 Update `backend/config/settings.py`

Remove:

```python
# Remove these lines:
firebase_project_id: str = "media-db-cc511"
firebase_credentials_path: str = ""
```

Add:

```python
# PostgreSQL
database_url: str = Field(
    default="postgresql+asyncpg://media_user:changeme_strong_password@localhost:5432/media_manager",
    validation_alias=AliasChoices("DATABASE_URL", "MEDIA_LIBRARY_DATABASE_URL"),
)

# Session auth
session_secret_key: str = Field(
    default="",  # MUST be set in .env
    validation_alias=AliasChoices("SESSION_SECRET_KEY", "MEDIA_LIBRARY_SESSION_SECRET_KEY"),
)
session_expiry_hours: int = 24 * 7   # 7 days by default
```

### 4.4 Update `backend/main.py`

In the `lifespan` function, replace Firestore initialization:

```python
# REMOVE:
firestore_service = FirestoreService(settings.firebase_project_id)
await firestore_service.initialize()

# REPLACE WITH:
from db.database import engine, Base
async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)  # or use Alembic in production
```

Replace all `app.state.firestore_service = firestore_service` references with your new database session dependency.

### 4.5 New File: `backend/api/auth.py`

```python
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import bcrypt
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from db.database import get_db
from db.models import AppConfig, Session as DBSession
from config.settings import settings

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    password: str

async def get_password_hash(db: AsyncSession) -> str | None:
    result = await db.execute(select(AppConfig).where(AppConfig.key == "password_hash"))
    row = result.scalar_one_or_none()
    return row.value if row else None

async def require_session(request: Request, db: AsyncSession = Depends(get_db)) -> DBSession:
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = await db.execute(
        select(DBSession).where(
            DBSession.session_id == session_id,
            DBSession.expires_at > datetime.now(timezone.utc)
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return session

@router.post("/login")
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    stored_hash = await get_password_hash(db)
    if not stored_hash:
        raise HTTPException(status_code=500, detail="App password not configured")
    if not bcrypt.checkpw(body.password.encode(), stored_hash.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password")

    session = DBSession(
        session_id=str(uuid.uuid4()),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.session_expiry_hours),
        ip_address=str(request.client.host),
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    await db.commit()

    response.set_cookie(
        key="session_id",
        value=session.session_id,
        httponly=True,       # not accessible from JS
        secure=False,        # set True when you add HTTPS/nginx
        samesite="lax",
        max_age=settings.session_expiry_hours * 3600,
    )
    return {"authenticated": True}

@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    session_id = request.cookies.get("session_id")
    if session_id:
        await db.execute(delete(DBSession).where(DBSession.session_id == session_id))
        await db.commit()
    response.delete_cookie("session_id")
    return {"authenticated": False}

@router.get("/me")
async def me(session: DBSession = Depends(require_session)):
    return {"authenticated": True, "expires_at": session.expires_at.isoformat()}
```

Protect all other routers by adding `Depends(require_session)` to sensitive endpoints, or apply it globally as a middleware.

### 4.6 Set the App Password (One-Time Setup)

```bash
# Run once in the backend venv to generate and store the password hash
python3 - <<'EOF'
import bcrypt, asyncio
from db.database import AsyncSessionLocal
from db.models import AppConfig

password = "your_chosen_passphrase_here"
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

async def seed():
    async with AsyncSessionLocal() as db:
        db.add(AppConfig(key="password_hash", value=hashed))
        await db.commit()
        print("Password hash stored.")

asyncio.run(seed())
EOF
```

### 4.7 Remove `backend/services/firestore_service.py`

Once all API routes have been migrated to use SQLAlchemy queries, delete `firestore_service.py`, `firestore_ingress_methods.py`, and the `media-db-service-account.json` credential file.

---

## 5. Auth Simplification

### Current System
- Firebase Auth (email + password)
- `signInWithEmailAndPassword` / `createUserWithEmailAndPassword`
- Firebase `onAuthStateChanged` listener keeps user state in Zustand
- Signup page at `/signup` is publicly accessible
- Firebase `User` object stored in auth store

### Target System
- Single app passphrase (no email, no multi-user)
- HTTP-only session cookie issued by the Python backend after verifying the passphrase
- A `GET /auth/me` call on app startup re-establishes auth state
- No signup flow — password is set once via a CLI script (see §4.6)
- Optional future enhancement: WebAuthn passkey via the browser's Credential Management API (supported natively in modern browsers, no dependencies needed)

### Why Remove the Signup Page?
You're self-hosting for personal use on your LAN. There's no concept of a new user registering. The `/signup` route should be deleted. If you ever need to change the password, run the seed script again with the new passphrase.

---

## 6. Frontend Migration

### 6.1 Remove Firebase SDK

```bash
npm uninstall firebase firebase-admin
```

Delete `firebaseConfig.js`.

### 6.2 New File: `src/service/api/apiClient.ts`

A thin wrapper over `fetch` that points to your local Python backend:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8082';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',   // sends the session cookie
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                   => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown)    => apiFetch<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)    => apiFetch<T>(path, { method: 'PUT',   body: JSON.stringify(body) }),
  delete: <T>(path: string)                   => apiFetch<T>(path, { method: 'DELETE' }),
};
```

### 6.3 Replace `src/store/useAuthenticationStore.ts`

```typescript
import { create } from 'zustand';
import { api } from '@/service/api/apiClient';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  checkSession: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const useAuthenticationStore = create<AuthState>((set) => ({
  authenticated: false,
  loading: false,
  error: null,

  checkSession: async () => {
    try {
      await api.get('/auth/me');
      set({ authenticated: true });
    } catch {
      set({ authenticated: false });
    }
  },

  login: async (password: string) => {
    set({ loading: true, error: null });
    try {
      await api.post('/auth/login', { password });
      set({ authenticated: true });
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    set({ loading: true });
    try {
      await api.post('/auth/logout', {});
    } finally {
      set({ authenticated: false, loading: false });
    }
  },
}));

export default useAuthenticationStore;
```

### 6.4 Replace `src/app/login/page.tsx`

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import useAuthenticationStore from '@/store/useAuthenticationStore';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const { login, loading, error } = useAuthenticationStore();
  const router = useRouter();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(password);
      router.push('/dashboard');
    } catch {
      // error is already in store
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <h1>Media Manager</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passphrase"
        autoFocus
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
      {error && <p>{error}</p>}
    </form>
  );
}
```

### 6.5 Update `src/app/layout.tsx`

Replace the `user` check from the auth store with `authenticated`:

```tsx
// Before
const { user } = useAuthenticationStore();
// ...
{user ? <ProfileAccess /> : <Link href="/signup">Login/Sign Up</Link>}

// After
const { authenticated, checkSession } = useAuthenticationStore();
// Call checkSession() in a useEffect on mount
{authenticated ? <ProfileAccess /> : <Link href="/login">Sign In</Link>}
```

### 6.6 Replace `src/service/firebase/FirestoreService.ts`

Each method that called Firestore should call your backend REST API instead:

```typescript
// Before
const querySnapshot = await getDocs(query(collection(db, 'movies'), where('genres', 'array-contains', genre)));

// After
const movies = await api.get<Movie[]>(`/movies?genre=${encodeURIComponent(genre)}`);
```

The backend already exposes REST endpoints — all Firestore reads/writes should be routed through those endpoints. Delete `FirebaseModelConstructor.ts` and `FirestoreService.ts` once all call sites are migrated.

### 6.7 Delete These Files

- `firebaseConfig.js`
- `src/app/signup/page.tsx` (no public registration for self-hosted)
- `src/service/firebase/FirestoreService.ts`
- `src/service/firebase/FirebaseModelConstructor.ts`

### 6.8 Update Middleware / Route Protection

Create `src/middleware.ts` to redirect unauthenticated requests to `/login`. Since auth is now session-cookie based with no Firebase client SDK, the middleware should call the backend `GET /auth/me` or check for the cookie presence:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const sessionCookie = request.cookies.get('session_id');
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

> **Note:** This middleware only checks for the cookie's *presence*. Full session validity is confirmed by the backend on every API call. This is sufficient for a self-hosted LAN app.

---

## 7. Environment Variable Changes

### Remove from `.env.local`

```bash
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
GOOGLE_APPLICATION_CREDENTIALS
```

### Add to `.env.local`

```bash
# Backend API (Next.js calls this)
NEXT_PUBLIC_API_URL=http://localhost:8082
```

### Add to `backend/.env`

```bash
# PostgreSQL
DATABASE_URL=postgresql+asyncpg://media_user:changeme_strong_password@localhost:5432/media_manager

# Session signing (generate with: python3 -c "import secrets; print(secrets.token_hex(32))")
SESSION_SECRET_KEY=<your_random_64_char_hex>

# Keep existing:
MEDIA_LIBRARY_OMDB_API_KEY=<your_omdb_api_key>
MEDIA_LIBRARY_TMDB_API_KEY=<your_tmdb_api_key>
MEDIA_LIBRARY_JELLYFIN_DEST_BASE=/ark/media/jellyfin
```

---

## 8. Migration Sequence

Work through these phases to avoid a big-bang rewrite. Each phase leaves the app in a working state.

### Phase 1: Postgres Infrastructure (No Code Changes)
1. Add `docker-compose.yml`, run `docker compose up -d`
2. Add `sqlalchemy`, `asyncpg`, `alembic`, `bcrypt` to `requirements.txt`
3. Create `backend/db/database.py` and `backend/db/models.py`
4. Run `alembic init` and generate the initial migration
5. Apply migrations: `alembic upgrade head`

### Phase 2: Backend Auth
1. Add `backend/api/auth.py`
2. Run the password seed script (§4.6)
3. Register the auth router in `main.py`
4. Test with `curl -X POST http://localhost:8082/auth/login -d '{"password":"..."}'`

### Phase 3: Backend Data Layer
1. Migrate `firestore_service.py` method by method to SQLAlchemy queries
   - Start with read-heavy collections: `movies`, `series`, `library_paths`
   - Migrate write paths: `media_assignments`, `ingress_queue`
2. Remove `firebase-admin` from `requirements.txt` when the last Firestore call is gone
3. Delete `media-db-service-account.json` and `GOOGLE_APPLICATION_CREDENTIALS` from env

### Phase 4: Frontend Auth
1. Remove Firebase SDK: `npm uninstall firebase`
2. Delete `firebaseConfig.js`
3. Replace `useAuthenticationStore.ts` with the new password-session version
4. Replace `src/app/login/page.tsx`
5. Delete `src/app/signup/`
6. Add `src/middleware.ts`
7. Update `layout.tsx` to use `authenticated` from the new store

### Phase 5: Frontend Data
1. Add `src/service/api/apiClient.ts`
2. Replace `FirestoreService.ts` call sites one hook at a time
3. Delete `FirestoreService.ts` and `FirebaseModelConstructor.ts`

### Phase 6: Data Migration (Firestore → Postgres)
1. Write a migration script using `firebase-admin` (Python) to read all Firestore documents
2. Insert into Postgres using SQLAlchemy or direct `psycopg2`
3. Validate row counts between old and new
4. Shut off Firestore access after validation

---

## 9. Data Export from Firestore

Before shutting down Firebase, export all data. Run this from the backend directory while `firebase-admin` is still installed:

```python
# backend/scripts/export_firestore.py
import asyncio, json, datetime
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("../media-db-service-account.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

COLLECTIONS = [
    "movies", "series", "seasons", "episodes",
    "actors", "directors", "releases", "discs",
    "media_files", "media_assignments", "jellyfin_folders",
    "library_paths", "scan_results", "scanned_files",
    "media_matches", "ingress_queue", "ingress_config",
]

def serialize(obj):
    if isinstance(obj, datetime.datetime):
        return obj.isoformat()
    raise TypeError(f"Cannot serialize {type(obj)}")

all_data = {}
for col in COLLECTIONS:
    docs = db.collection(col).stream()
    all_data[col] = [{**d.to_dict(), "_id": d.id} for d in docs]
    print(f"  {col}: {len(all_data[col])} documents")

with open("firestore_export.json", "w") as f:
    json.dump(all_data, f, default=serialize, indent=2)

print("Export complete → firestore_export.json")
```

Then write a corresponding import script that reads `firestore_export.json` and `INSERT`s rows into the Postgres tables defined in §3, mapping Firestore document fields to column names.
