# Poster Cache

Poster images for movies and series are **downloaded once from their external source, stored on a persistent Docker volume, and served locally** on every subsequent request. The app never re-downloads a poster it already has unless the source image has changed.

---

## How It Works

### 1. First request (download)

When the My Library page or a detail page loads, the frontend requests:

```
GET /api/backend/posters/{media_type}/{media_id}?index=0
```

The backend (via the Next.js proxy) checks the volume for `poster_0.jpg`. If nothing exists yet it:

1. Looks up the item's stored source URL (from `imageFiles[0].fileName` or the legacy `omdbData.Poster` field in the `raw_data` JSONB column).
2. Downloads the image from that external URL (OMDB CDN, TMDB, etc.).
3. Computes a SHA-256 hash of the downloaded bytes.
4. Saves the image as `poster_0.{ext}` inside the per-item directory.
5. Writes a `meta.json` file recording the hash, source URL, and timestamps.
6. Returns the image with a `Cache-Control: public, max-age=604800, immutable` header (7-day browser cache).

All subsequent requests hit the local volume — no external network traffic.

### 2. Staleness check (background, once per 24 hours)

Every time the primary poster (index 0) is served, a **background task** is queued _after_ the response is sent, so it adds zero latency for the user.

The task (`refresh_if_stale`) only runs if 24 hours have elapsed since the source URL was last checked. It:

1. Re-downloads the image from the same source URL.
2. Computes the SHA-256 of the new bytes.
3. Compares against every hash stored in `meta.json`.
   - **Same hash** → updates `last_checked_at` and returns. No change.
   - **New hash** → saves the new image as `poster_1.jpg`, `poster_2.jpg`, etc. and appends a new entry to `meta.json`. The original is **not deleted** — both are kept.

### 3. Multiple poster versions

When the source image changes, the new version is stored alongside the old one rather than replacing it. Users can cycle through all available versions on the media detail page using the `‹` / `›` buttons.

The frontend fetches the list of available posters on page load:

```
GET /api/backend/posters/{media_type}/{media_id}/list
→ { "count": 2, "posters": [{ "index": 0, "downloaded_at": "...", "last_checked_at": "..." }, ...] }
```

Navigating the carousel changes the `?index=N` query parameter, which the backend uses to serve the correct file from disk.

### 4. Manual refresh (authenticated)

An immediate re-check can be triggered by an admin, bypassing the 24-hour cooldown:

```
POST /api/backend/posters/{media_type}/{media_id}/refresh
→ { "new_poster_added": true, "total_posters": 2 }
```

---

## Storage Layout

Posters are stored in the `poster_cache` Docker volume, mounted at `/data/media_manager/posters` inside the backend container.

```
/data/media_manager/posters/
├── movie/
│   └── tt0111161/              ← one directory per media item (uses the DB id)
│       ├── meta.json
│       ├── poster_0.jpg        ← first downloaded version
│       └── poster_1.jpg        ← newer version detected on a later check
└── series/
    └── tt0903747/
        ├── meta.json
        └── poster_0.jpg
```

### `meta.json` schema

```json
{
  "posters": [
    {
      "filename": "poster_0.jpg",
      "source_url": "https://m.media-amazon.com/images/...",
      "hash": "sha256hex...",
      "downloaded_at": "2026-04-07T12:00:00+00:00",
      "last_checked_at": "2026-04-08T12:00:00+00:00"
    }
  ]
}
```

---

## Volume Persistence

The Docker volume `poster_cache` is a **named volume** — it survives `docker compose down` and container rebuilds. Only `docker compose down -v` deletes it.

```yaml
# docker-compose.yml (excerpt)
volumes:
  postgres_data:
  poster_cache:       # ← named volume, survives restarts
```

To override the cache location (e.g. for a bind-mount to a specific host path), set the environment variable:

```bash
MEDIA_LIBRARY_POSTER_CACHE_DIR=/your/custom/path
```

---

## Fallback Chain

If the backend cannot serve a poster (item has no stored URL, external download fails, etc.) the frontend falls back gracefully without showing a broken image:

```
Local volume (index N)  →  stored external URL  →  placeholder image
```

The `onError` handler on the `<img>` element swaps the `src` to the stored external URL;
if that also fails a second `onError` swaps to the `placehold.co` placeholder.

---

## Relevant Files

| File | Purpose |
|---|---|
| `backend/services/poster_cache_service.py` | Download, hash-compare, store, stale-check logic |
| `backend/api/posters.py` | FastAPI endpoints (`GET /{type}/{id}`, `GET /{type}/{id}/list`, `POST /{type}/{id}/refresh`) |
| `backend/config/settings.py` | `poster_cache_dir` setting (env var `MEDIA_LIBRARY_POSTER_CACHE_DIR`) |
| `docker-compose.yml` | `poster_cache` named volume definition and mount |
| `src/app/dashboard/my-library/page.tsx` | Listing page — uses local poster URL with external fallback |
| `src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx` | Detail page — cycling UI and poster count badge |
