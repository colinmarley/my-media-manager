# Media Pipeline & Folder Structure Documentation

## Purpose
This document describes how media files flow through the system, including:
- Folder structure
- Processing stages
- Scripts involved
- Expected file transformations

This is intended to give AI coding assistants context when integrating applications with the media ingestion pipeline.

---

# High-Level Pipeline

```
Blu-ray Disc
   ↓
MakeMKV
   ↓
/data/media/rips
   ↓
HandBrake Auto Encode Script
   ↓
/data/media/encoded
   ↓
Metadata Processing App (your project)
   ↓
Jellyfin Library (Beelink NAS)
```

---

# Folder Structure

## Root Media Directory

```
/data/media/
├── rips/
├── encoded/
```

---

## Rips Directory (MakeMKV Output)

```
/data/media/rips/
├── movies/
│   └── Movie Name/
│       ├── title_t00.mkv
│       ├── title_t01.mkv
│       └── title_t02.mkv
└── shows/
    └── Show Name - Disc 1/
        ├── title_t00.mkv
        ├── title_t01.mkv
        └── title_t02.mkv
```

### Notes:
- Created by MakeMKV
- Each disc gets its own folder
- Each title on the disc becomes an MKV file

---

## Encoded Directory (HandBrake Output)

```
/data/media/encoded/
├── movies/
│   └── Movie Name/
│       ├── title_t00.mkv
│       ├── title_t01.mkv
│       └── title_t02.mkv
└── shows/
    └── Show Name - Disc 1/
        ├── title_t00.mkv
        ├── title_t01.mkv
        └── title_t02.mkv
```

### Notes:
- Final processed media lives here
- This is the **INGRESS POINT for your metadata project**
- Files are either:
  - encoded (main content)
  - copied (short extras)

---

# Processing Script

## Location

```
/data/scripts/auto_encode.sh
```

---

## Responsibilities

The script:

1. Scans:
```
/data/media/rips
```

2. Processes all `.mkv` files recursively

3. For each file:
   - Determines duration using ffprobe
   - Decides:
     - encode (main content, episodes)
     - copy (short extras)

4. Outputs to:
```
/data/media/encoded
```

5. Deletes original file after success

6. Removes empty folders

---

## Encoding Rules

| Condition | Action |
|----------|--------|
Duration < 10 min | Copy |
Duration ≥ 10 min | Encode |

---

## Encoding Settings

```
Video: H.265 (NVENC)
Quality: 21
Audio: Copy
Subtitles: All
```

---

# Ingress Point for Your Project

## Path

```
/data/media/encoded
```

Your application should:

1. Watch this directory
2. Detect new files
3. Extract metadata
4. Query:
   - TMDB
   - OMDB
5. Store metadata in DB
6. Determine:
   - movie vs show
7. Move file to final library

---

# Backend Pipeline Status (Implemented)

## Phase 1: File Detection & Parsing ✅ Complete

Core ingress pipeline now fully implemented:

- `backend/services/file_watcher_service.py`
  - Watches `/data/media/encoded/` and subdirs
  - Debounces write events (waits 10 sec for file stability)
  - Queues stable files for processing
  - Supports both native file watching and polling mode
  
- `backend/services/filename_parser.py`
  - Parses common movie/episode naming patterns
  - Extracts title, year, season, episode, quality
  - Detects media type: `movie`, `episode`, `unknown`
  - Normalizes titles for lookups
  
- `backend/services/ingress_queue_service.py`
  - In-memory queue with state tracking
  - States: `pending`, `processing`, `auto_assigned`, `needs_review`, `failed`, `completed`
  - Priority-based processing (configurable 1-10)
  - Deduplication by file path
  - Processing history tracking

- `backend/services/auto_matcher_service.py` ✅ NEW
  - Searches OMDB API for matches
  - Fuzzy-matches titles using sequence matching
  - Calculates real confidence scores (0-100):
    - Title similarity: up to 50 points
    - Year match (exact/±1/±2): up to 20 points
    - Series/episode detection: up to 25 points
    - Quality tag: up to 5 points
  - Returns top 5 candidates with scores

- `backend/services/firestore_service.py` ✅ EXTENDED
  - New methods to persist ingress queue items
  - New methods to save/retrieve processing history
  - Collections: `ingress_queue`, `ingress_processing_history`

## Ingress API Endpoints

All routes are under `/api/ingress`:

**Watcher Control:**
- `POST /watcher/start` - Start monitoring ingress paths
- `POST /watcher/stop` - Stop monitoring
- `GET /watcher/status` - Get watcher state and queue sizes

**Queue Operations:**
- `GET /queue/status` - Get queue counts by status
- `GET /queue/items?status=pending` - List queue items (filterable)
- `POST /queue/process-next` - Process next pending item
- `POST /queue/retry` - Retry a failed item
- `POST /queue/mark-complete` - Mark as fully processed
- `POST /queue/mark-failed` - Mark as failed with reason

**History:**
- `GET /history?limit=100` - Get recent processing history

## Configuration

New settings in `backend/config/settings.py`:

```python
omdb_api_key: str = ""  # Set via MEDIA_LIBRARY_OMDB_API_KEY env var
```

## Example Workflow

1. File appears in `/data/media/encoded/movies/The.Matrix.1999.1080p.mkv`
2. File watcher detects and waits for stability (~10 sec)
3. Queue service adds to ingress_queue with status `pending`
4. `/api/ingress/queue/process-next` parses filename and runs auto-matcher
5. OMDB search returns matches, confidence calculated
6. Item marked `auto_assigned` if confidence >= 80, else `needs_review`
7. Results persisted to Firestore `ingress_queue` collection

## Remaining Work

- Integrate real OMDB API key from environment
- Add automatic Firestore persistence during queue processing
- Implement assignment + organization to Jellyfin paths
- Add frontend for reviewing low-confidence items
- Implement batch processing and retry logic at API level

---

# Expected Output (Jellyfin)

## Movies

```
/mnt/beelink-media/movies/
└── Movie Name (Year)/
    └── Movie Name (Year).mkv
```

## Shows

```
/mnt/beelink-media/shows/
└── Show Name/
    └── Season 01/
        └── Show Name - s01e01.mkv
```

---

# Summary

This system provides:

- automated ripping pipeline
- GPU-accelerated encoding
- structured processing flow
- consistent ingress point

Integration target:

```
/data/media/encoded
```
