# Database Tables Reference

This document describes the PostgreSQL tables currently defined in the codebase.

**Source of truth:** `backend/db/models.py`

**Database layer:** async SQLAlchemy models backed by PostgreSQL.

---

## 1. Auth and Application Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `app_config` | Simple key/value application settings store. | `key`, `value` |
| `sessions` | Tracks authenticated user sessions. | `session_id`, `created_at`, `expires_at`, `ip_address`, `user_agent` |

---

## 2. Media Catalog Tables

### `movies`
Stores movie-level catalog records and external metadata.

**Notable fields**
- `id`, `title`
- metadata such as `release_date`, `runtime`, `genres`, `languages`
- ratings and external IDs: `imdb_id`, `tmdb_id`, `rotten_tomatoes_id`, `metacritic_id`, `letterboxd_id`
- JSON payloads: `omdb_data`, `tmdb_data`, `assignment_summary`, `jellyfin_info`, `raw_data`

### `releases`
Represents a physical or published release entry for media.

**Notable fields**
- `title`, `year`, `media_type`, `edition`, `publisher`, `territory`
- `contains_extras`, `extras`, `contains_inserts`, `inserts`
- `image_files`

### `release_movies`
Join table linking releases to movies.

**Keys**
- `release_id` → `releases.id`
- `movie_id` → `movies.id`

### `discs`
Tracks disc-specific metadata for physical media.

**Notable fields**
- `title`, `release_id`, `format`, `disc_number`, `barcode`, `region_code`
- `subtitles`, `contains_special_features`
- `video_files`, `image_files`, `raw_data`

### `series`
Stores TV series catalog records.

**Notable fields**
- `id`, `title`, `status`, `network`
- `running_years`, `total_seasons`, `total_episodes`
- ratings and IDs: `imdb_id`, `tmdb_id`, `tvdb_id`, `tv_maze_id`
- JSON payloads: `omdb_data`, `tmdb_data`, `series_summary`, `assignment_summary`, `jellyfin_info`, `raw_data`

### `release_series`
Join table linking releases to TV series.

**Keys**
- `release_id` → `releases.id`
- `series_id` → `series.id`

### `seasons`
Season-level rows for a series.

**Notable fields**
- `series_id`, `series_title`, `season_number`
- `season_name`, `alternate_title`, `total_episodes`
- `episodes_with_files`, `total_files`, `total_file_size`
- unique constraint on `series_id + season_number`

### `episodes`
Episode-level metadata and file linkage.

**Notable fields**
- `series_id`, `season_id`, `season_number`, `episode_number`
- `title`, `overview`, `air_date`, `runtime`
- `imdb_id`, `tmdb_id`, `tvdb_id`
- file state: `has_file`, `file_id`, `file_count`, `jellyfin_filename`

---

## 3. People and Credits Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `actors` | Actor master records. | `id`, `full_name`, `birthplace`, `birthday`, `notes` |
| `directors` | Director master records. | `id`, `full_name`, `birthplace`, `birthday`, `notes` |
| `movie_actors` | Many-to-many movie ↔ actor links. | `movie_id`, `actor_id`, `characters` |
| `movie_directors` | Many-to-many movie ↔ director links. | `movie_id`, `director_id`, `title` |
| `series_actors` | Many-to-many series ↔ actor links. | `series_id`, `actor_id`, `characters` |
| `series_directors` | Many-to-many series ↔ director links. | `series_id`, `director_id`, `seasons`, `title` |

---

## 4. Library Scanning Tables

### `library_paths`
Configured library roots that the scanner should inspect.

**Notable fields**
- `name`, `root_path`, `media_type`, `is_active`
- `last_scanned`, `last_scan_id`, `last_scan_status`, `scan_progress`

### `scan_results`
One row per scan run.

**Notable fields**
- `library_path_id`, `library_path`
- `status`, `total_items`, `files_found`, `directories_found`
- `start_time`, `end_time`, `error_message`

### `scanned_files`
Raw discovery output for files seen during a scan.

**Notable fields**
- `scan_id`, `library_path_id`, `file_path`, `file_name`
- `extension`, `media_type`, `file_size`, `modified_time`
- `media_metadata`, `parsed_info`

### `scanned_directories`
Raw discovery output for directories seen during a scan.

**Notable fields**
- `scan_id`, `library_path_id`, `dir_path`, `dir_name`
- `media_type`, `status`, `metadata`

---

## 5. File Inventory and Organization Tables

### `media_files`
Canonical file inventory table for files discovered in the library.

**Notable fields**
- path identity: `file_path`, `file_name`, `folder_path`, `relative_path`
- file facts: `file_size`, `checksum`, `created_date`, `modified_date`
- metadata: `video_metadata`, `audio_tracks`, `subtitle_tracks`, `parsed_info`
- organization state: `assignment_status`, `assigned_to_type`, `assigned_to_id`, `needs_organization`, `target_path`, `organization_status`

### `media_assignments`
Links physical files to movies, series, seasons, or episodes and tracks organization status.

**Notable fields**
- `primary_file_id`, `media_type`, `media_id`
- episode linkage: `series_id`, `season_id`, `season_number`, `episode_number`
- organization: `target_folder_structure`, `organization_status`, `organization_date`, `organization_error`, `operations`
- assignment tracking: `assigned_by`, `assigned_date`, `confidence`, `is_manual_assignment`, `match_data`, `notes`

### `assignment_extra_files`
Join table for non-primary files attached to an assignment.

**Keys**
- `assignment_id` → `media_assignments.id`
- `media_file_id` → `media_files.id`

### `jellyfin_folders`
Tracks organized output folders and their contents in the Jellyfin destination structure.

**Notable fields**
- `folder_path`, `folder_name`, `folder_type`, `media_type`, `media_id`
- `season_number`, `media_title`, `year`, `imdb_id`, `jellyfin_name`
- `video_files`, `subtitle_files`, `audio_files`, `image_files`, `extra_folders`
- validation: `is_valid`, `validation_errors`, `last_verified`

### `media_matches`
Stores matching suggestions and confidence scores for discovered media files.

**Notable fields**
- `file_info`, `confidence`, `media_id`, `media_type`
- `suggestions`, `status`

---

## 6. Ingress Automation Tables

### `ingress_queue`
Main watcher/automation queue table for newly detected encoded files.

**Notable fields**
- source file info: `file_path`, `file_name`, `ingress_path`, `file_size`
- processing state: `status`, `priority`, `attempts`, `last_attempt`, `processed_at`, `last_error`
- matching data: `confidence_score`, `parsed_info`, `best_match`, `match_candidates`
- routing data: `assignment_id`, `media_duration_ms`, `proposed_path`

### `ingress_processing_history`
Durable audit log of watcher decisions and assignment outcomes.

**Notable fields**
- `queue_item_id`
- `snapshot` JSON containing the full event payload
- `created_at`

This is the main table to use later for training a local model from watcher decisions.

### `ingress_config`
Current watcher configuration snapshot.

**Notable fields**
- `id` (typically `current`)
- `config`
- `updated_at`

---

## 7. Generic Document Store

### `generic_data`
Flexible JSON document table used to replace miscellaneous Firestore collections.

**Notable fields**
- `id`
- `collection`
- `data`
- `created_at`, `updated_at`

This is useful for transitional or loosely structured app data that does not yet have a dedicated relational table.

---

## 8. Most Important Relationships

- `seasons.series_id` → `series.id`
- `episodes.series_id` → `series.id`
- `episodes.season_id` → `seasons.id`
- `media_assignments.primary_file_id` → `media_files.id`
- `ingress_queue.assignment_id` → `media_assignments.id`
- join tables connect releases, actors, directors, and extra files to their parent records

---

## 9. Best Tables for Future Auto-Assignment Training

If the goal is to train a local model for automatic assignment, these are the most valuable tables:

1. `ingress_processing_history`
   - historical proposed and accepted assignment snapshots
2. `ingress_queue`
   - latest state of each queued file and its best match/proposed path
3. `media_assignments`
   - final accepted mapping between files and media entities
4. `media_matches`
   - confidence scores and alternative candidate suggestions

---

## 10. Maintenance Note

The schema is created from SQLAlchemy models during backend startup, and production-style migrations are intended to be handled by Alembic when needed.
