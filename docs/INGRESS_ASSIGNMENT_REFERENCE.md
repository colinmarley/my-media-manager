# Ingress Assignment Reference

This document covers two topics:

1. **Automated detection** — how the pipeline extracts movie and TV show metadata from filenames, folder names, and directory structure.
2. **Manual assignment and reassignment** — every surface where a user can assign or reassign files, and exactly what changes in the database when they do.

---

## Part 1 — Automated Metadata Detection

### Pipeline overview

```
File watcher / manual add
        │
        ▼
IngressQueueService.process_next_item()
        │
        ├─ FilenameParser.parse_filename()   ← pattern matching
        │
        ├─ _infer_source_media_type()        ← folder structure check
        │
        ├─ AutoMatcherService.search_and_match()
        │       ├─ Internal library search (Firestore / PostgreSQL)
        │       ├─ OMDB search (fallback)
        │       └─ TMDB search (last resort)
        │
        └─ AssignmentOrchestrator.auto_assign()
                └─ FileOrganizationService.organize_assignment()
```

---

### Step 1 — Filename parsing (`FilenameParser`)

`parse_filename(filename, folder_name=None, file_path=None)` runs the patterns below **in priority order**. The first match wins.

#### 1a. Quality tag extraction (all filenames)

Extracted before any other logic and stored separately. Not used in title matching.

| Pattern | Examples matched |
|---|---|
| `2160p`, `1080p`, `720p`, `480p` | Resolution tags |
| `4K`, `UHD`, `HDR`, `DV` | Format tags |
| `BluRay`, `WEB-DL`, `WEBRip` | Source tags |

#### 1b. Anime group-tag strip

If the filename starts with `[SubGroup]`, the bracket block is stripped before any further matching, e.g.:

```
[HorribleSubs] Demon Slayer - 19 [1080p].mkv
→ stripped_name = "Demon Slayer - 19 [1080p]"
```

#### 1c. Standard episode patterns → `media_type = episode`

Tried against the (stripped) filename stem. First match wins.

| Pattern | Regex | Examples |
|---|---|---|
| SxxExx | `S(\d{1,2})E(\d{1,2})(?!\d)` | `S01E04`, `S10E25` |
| NxNN | `(\d{1,2})x(\d{1,2})` | `1x04`, `10x25` |

After a match:
- **Title** = everything before the episode token, cleaned (dots/underscores → spaces, noise tokens removed).
- **`Part N` / `Pt N` stripped** from the title before API lookup so "The Stand Part 2" matches "The Stand".
- **Multi-episode suffix** checked immediately after the primary token: `E25E26`, `E25-E26`, `E25_E26` → `episode_end` is populated.
- **Season 0** automatically sets `classification_hint = "special_feature"`.

#### 1d. Season-pack pattern → `media_type = episode`, `episode = None`

| Pattern | Regex | Examples |
|---|---|---|
| Season word with number | `Season[\s._-]*(\d{1,2})` | `Show.Season.3.mkv`, `Breaking Bad Season 1` |

Title = everything before the "Season N" token. `episode` is `None`. The file is placed in the season folder but the exact episode must be identified manually.

#### 1e. Bare episode filename → `media_type = episode`

Catches files named only with an episode indicator and no show title.

| Pattern | Regex | Examples |
|---|---|---|
| Bare episode | `^[\s._-]*(?:episode\|ep\|e)[\s._-]*(\d{1,3})(?:[\s._-]\|$)` | `e01.mkv`, `ep09.mkv`, `episode 09.mkv`, `E02.mkv` |

When this matches, title and season are recovered from **parent path segments** via `_extract_path_context(file_path)`:

```
/ingress/Cheers/Season 02/e01.mkv
         ^^^^^^  ─────────
         title   season=2
```

Walk logic (up to 4 levels):
1. Check each parent folder name against `_season_folder_pattern` (`Season 02`, `S02`, `Season 2`).
2. The first folder *above* the season folder becomes the series title.
3. If no season folder is found, the **immediate parent** is used as the title with `season = None`.

#### 1f. Anime absolute episode → `media_type = episode`, `season = None`

Only tried when an anime bracket prefix was detected in step 1b.

| Pattern | Regex | Examples |
|---|---|---|
| Absolute episode after ` - ` | `-[\s._-](\d{2,4})(?:[\s._-]\|$)` | `Demon Slayer - 19`, `One Piece - 1042` |

`season = None` (absolute numbering). Path placed under `Season 00/` for Jellyfin.

#### 1g. Companion / special-feature detection (movie/unknown files)

Applied after episode patterns all fail. A file is flagged `is_companion = True` / `classification_hint = "special_feature"` when **any** of the following match:

| Check | Pattern / Rule | Example |
|---|---|---|
| Whole-name MakeMKV code | `^[A-Za-z]\d+[_-]t\d+$` | `B1_t00.mkv` |
| MakeMKV suffix | `[\s._-]+[A-Za-z]\d+[\s._-]t\d+$` | `13 GHOSTS-B4 t01.mkv` |
| Numbered-track prefix | `^\d{1,2}[.\s]\s*` | `01 One Crazy Summer.mkv` |
| Companion keyword suffix | `- <keyword>` at end of stem | `Inception (2010) - Making Of.mkv` |
| Generic companion title | exact match against label set | `Extras.mkv`, `Featurette.mkv` |

Companion keyword suffix matches: *making of, behind the scenes, deleted scene(s), featurette(s), interview(s), trailer(s), extra(s), bonus feature(s), special feature(s), bloopers, gag reel*.

Generic companion label set: *extra, extras, special feature, special features, bonus, bonus feature, bonus features, deleted scene, deleted scenes, featurette, featurettes, interview, interviews, trailer, trailers, sample, samples, behind the scenes, making of, bloopers, gag reel*.

When `is_companion = True` and a `folder_name` was passed, the **folder name is used as the title** (stripped of year and disc suffixes).

#### 1h. Year extraction and `media_type` resolution

For files that reached this point (no episode or companion pattern matched):
- Year is extracted with `(?<!\d)(19\d{2}|20\d{2})(?!\d)`.
- Title = everything before the year token, cleaned.
- `media_type = "movie"` if a year was found, otherwise `"unknown"`.

#### Noise token removal

These tokens are stripped from any title candidate during `_clean_title`:

`bluray, bdrip, brrip, webrip, webdl, web-dl, hdrip, dvdrip, x264, x265, h264, h265, hevc, aac, dts, proper, repack, extended, unrated, remux`

---

### Step 2 — Folder/path inference (`_infer_source_media_type`)

Run **after** filename parsing. Can override `parsed_info["media_type"]`.

| Condition | Result |
|---|---|
| File path contains `/Season N/` | `"episode"` — forces `media_type = episode` |
| Source root contains a `Season N` sub-directory | `"episode"` |
| Source root name ends in `Disc N`, `Disk N`, `CD N`, `DVD N`, `BD N` | `"disc_set"` — grandparent folder name (without disc suffix) is used as the movie title |

---

### Step 3 — External metadata matching (`AutoMatcherService`)

The extracted `title`, `year`, `season`, `episode` are submitted to one or more of:

#### Search mode (`metadata_source` config)

| Mode | Behaviour |
|---|---|
| `library_then_omdb` (default) | Internal library first; fall back to OMDB if no results or no IMDb IDs; fall back to TMDB if still nothing |
| `omdb_only` | OMDB only |
| `tmdb_only` | TMDB only |
| `library_only` | Internal library only |

#### Internal library search

- **Movies**: All `movies` collection documents are fetched and fuzzy-matched (≥ 0.6 similarity) against the parsed title.
- **Series**: All `series` collection documents are fuzzy-matched; episode-level assignment counts for the specific `season`/`episode` are also checked via `media_assignments`.

#### OMDB search

`?s=<title>&type=movie|series` — up to 10 results returned and scored.

#### TMDB search

`/search/movie` or `/search/tv?query=<title>` — up to 10 results returned and scored.

#### Confidence scoring (0–100)

| Factor | Points |
|---|---|
| Title fuzzy similarity × 50 | 0–50 |
| Exact year match | +20 |
| Year off by 1 | +10 |
| Year off by 2 | +5 |
| Parsed `season` present + candidate is series type | +15 |
| Parsed `episode` also present | +10 |
| Source = internal library with IMDb ID | +20 |
| Source = internal library without IMDb ID | +5 |
| Existing files associated with this library entry | +15 |
| Existing episode-level files for this season/episode | +10 |

---

### Step 4 — Auto-assignment decision

| Condition | Outcome |
|---|---|
| `confidence_score >= auto_assign_threshold` (default 80) AND a `best_match` exists | Status → `auto_assigned`; `AssignmentOrchestrator.auto_assign()` runs |
| Below threshold or no match | Status → `needs_review`; queued for manual review |

---

### Step 5 — Proposed-path / classification resolution (`_enrich_proposed_paths`)

Within each group of items sharing the same best-match title + year:

**Movies / Documentaries / Live Performances:**

| Condition | Classification |
|---|---|
| `main_feature` folder doesn't exist yet → longest-duration file | `main_feature` |
| `main_feature` already exists on disk, new file duration ≥ threshold × existing | `alternate_version N` |
| `main_feature` already exists on disk, new file shorter | `special_feature N` |
| `classification_override = "special_feature"` | Forces `special_feature` |
| `classification_override = "alternate_version"` | Forces `alternate_version` |
| `classification_override = "main_feature"` | Forces `main_feature` |

Companion files from the same source folder that don't have their own match inherit the anchor title's match and are classified as special features.

**TV Episodes:**

| Condition | Filename / path |
|---|---|
| Season + episode known | `Show S01E04.ext` |
| Multi-episode file | `Show S10E25E26.ext` |
| Anime absolute episode (no season) | `Show E019.ext` under `Season 00/` |
| Season-pack (no episode) | Original filename preserved in season folder |
| Season 0 (TV special) | `Specials/` folder (Jellyfin convention) |
| Episode unknown | `Show - Unknown Episode N.ext` |
| `classification_override = "special_feature"` | Placed in season folder with original filename |

---

### Step 6 — File organization (`FileOrganizationService`)

Target paths follow Jellyfin folder conventions:

| Media type | Path structure |
|---|---|
| Movie | `{library_root}/Movies/{Title (YYYY) [imdbid-ttXXXXXX]}/{Title (YYYY) [imdbid-...]}.ext` |
| Alternate version | `…/{Title}/  {Title} - Version N.ext` |
| Special feature | `…/{Title}/Special Feature N.ext` |
| TV episode | `{library_root}/Shows/{Series (YYYY)}/Season NN/{Series} SxxExx[ Episode Title].ext` |
| TV special (S00) | `{library_root}/Shows/{Series (YYYY)}/Specials/{Series} S00Exx.ext` |
| Documentary | `{library_root}/Documentaries/{Title}/…` |
| Live performance | `{library_root}/Live Performances/{Title}/…` |
| Unresolvable | `{library_root}/_NeedsReview/{stem} - NEEDS REVIEW.ext` |

An NFO sidecar file is written alongside each successfully moved file for Jellyfin metadata scraping. On success, `movies.jellyfin_info` / `series.jellyfin_info` is updated in PostgreSQL.

---

## Part 2 — Manual Assignment and Reassignment

### 2.1 — Ingress Queue: manual match (Ingress dashboard)

**Where:** Ingress queue item that landed in `needs_review`.

**How:** User selects a title from search results (OMDB / internal library) and optionally specifies season/episode/media type.

**Service call:** `IngressQueueService.manually_assign_item(item_id, match_payload, organize_now)`

**DB changes:**

| Table | Column(s) changed |
|---|---|
| `ingress_queue` | `status`, `parsed_info` (media_type, season, episode, unknown_episode), `best_match` (title, year, imdb_id, confidence_score=100, match_reason="manual_assignment"), `match_candidates`, `confidence_score=100`, `assignment_id`, `proposed_path`, `processed_at` |
| `media_assignments` | Row created: `media_type`, `media_id`, `season_number`, `episode_number`, `episode_end`, `organization_status`, `assigned_by="ingress_pipeline"`, `confidence=100`, `is_manual_assignment=true`, `match_data` |
| `ingress_processing_history` | Snapshot row: event = `"manual_assignment"` |
| `movies` or `series` | `jellyfin_info` updated if file is immediately organized (`organize_now=true`) |

---

### 2.2 — Ingress Queue: classification override (Ingress dashboard)

**Where:** An item in `needs_review` or `auto_assigned` state.

**How:** User picks `main_feature`, `special_feature`, or `alternate_version` from the classification dropdown before accepting a proposal.

**Service call:** `IngressQueueService.update_classification(item_id, classification)`

**DB changes:**

| Table | Column(s) changed |
|---|---|
| `ingress_queue` | `parsed_info["classification_override"]` |
| `ingress_processing_history` | Snapshot row: event = `"classification_updated"` |

The override is then respected by `_enrich_proposed_paths()` when calculating the final destination path.

---

### 2.3 — Ingress Queue: retry failed item

**Where:** Any item in `failed` status.

**Service call:** `IngressQueueService.retry_item(item_id)`

**DB changes:**

| Table | Column(s) changed |
|---|---|
| `ingress_queue` | `status = "pending"`, `last_error = null` |

---

### 2.4 — Ingress Queue: mark complete (accept proposal)

**Where:** Item in `needs_review` with a proposed path the user accepts.

**Service call:** `IngressQueueService.mark_complete(item_id)`

**DB changes:** Same as 2.1 (auto-assignment runs, then file organization). History event = `"manual_assignment"`.

---

### 2.5 — My Library: reassign disc records to a different title

**Where:** Movie or TV Show detail page → select one or more disc records → "Reassign Files" button → `ReassignFilesDialog`.

**How:** User searches for the target title (internal catalog or OMDB), selects it, chooses a **classification** (`main_feature`, `special_feature`, or `alternate_version`), and confirms.

**API call:** `POST /api/catalog/reassign-discs`

```json
{
  "discIds": ["disc-uuid-1", "disc-uuid-2"],
  "fromMediaId": "source-catalog-id",
  "toMediaId": "target-catalog-id",
  "toMediaType": "movie" | "series",
  "classification": "main_feature" | "special_feature" | "alternate_version"
}
```

**DB changes:**

| Table | Row | Column(s) changed |
|---|---|---|
| `movies` or `series` (source) | source entry | `raw_data.releases[*].discIds` — disc IDs removed from all release slots |
| `movies` or `series` (target) | target entry | `raw_data.releases` — a per-classification slot is created or updated (`edition = "_reassigned_<classification>"`), disc IDs appended |
| `discs` | each reassigned disc | `raw_data.mediaId`, `raw_data.mediaType`, `raw_data.classification` |

Classification determines the release `edition` key on the target:

| Classification | `edition` key | Display label |
|---|---|---|
| `main_feature` | `_reassigned_main_feature` | "Reassigned – Main Feature" |
| `special_feature` | `_reassigned_special_feature` | "Reassigned – Special Feature" |
| `alternate_version` | `_reassigned_alternate_version` | "Reassigned – Alternate Version" |

Multiple reassignments with different classifications to the same target create separate slots so they can be distinguished.

---

### 2.6 — My Library: reassign destination folder / file path

**Where:** Movie or TV Show detail page → file entry → "Reassign" (folder path or individual file).

**Component:** `DiskReassignDialog`

**How:** User browses the filesystem to select a new destination folder or moves a single file. This is a physical file-path reassignment, not a catalog link change.

**DB changes:** `jellyfin_folders` and/or the disc's `raw_data.folderPath` / `raw_data.filePath` are updated to reflect the new physical location.

---

### 2.7 — My Library: episode-level file assignment (TV Show detail)

**Where:** TV Show detail page → Files tab → select a file → "Assign to Episode" dialog.

**How:** User picks the correct season and episode from the show's metadata, or moves the file to the unknown-season folder.

**DB changes:**

| Table | Column(s) changed |
|---|---|
| `episodes` | `has_file = true`, `file_id`, `file_count`, `jellyfin_filename` |
| `seasons` | `episodes_with_files`, `total_files`, `total_file_size` |
| `discs` | `raw_data.seasonNumber`, `raw_data.episodeNumber` |
| `media_assignments` | Row created or updated for this episode linkage |

---

### Summary of DB tables touched by assignment/reassignment

| Table | Role |
|---|---|
| `ingress_queue` | Live/persisted queue item state, parsed info, match results, proposed path |
| `ingress_processing_history` | Append-only audit log; one snapshot row per pipeline event |
| `media_assignments` | Formal link between a file (via disc/ingress item) and a catalog entry; stores season/episode numbers, confidence, who assigned it |
| `movies` | Catalog entry; `raw_data.releases[].discIds` updated on reassignment; `jellyfin_info` updated after organization |
| `series` | Catalog entry; same as movies for reassignment; `series_summary` and `assignment_summary` reflect file counts |
| `discs` | Physical disc record; `raw_data.mediaId`, `raw_data.mediaType`, `raw_data.classification` updated on reassignment |
| `episodes` | Individual episode row; `has_file`, `file_id`, `file_count`, `jellyfin_filename` updated on episode assignment |
| `seasons` | Season aggregate; `episodes_with_files`, `total_files`, `total_file_size` updated |
| `jellyfin_folders` | Indexed Jellyfin library folders; updated when a file is physically moved to a new path |
