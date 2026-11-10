# Ingest Automation: Analysis and Redesign

Date: 2026-11-08
Scope: the automated ingest pipeline in `backend/` (watcher → queue → parser → matcher → orchestrator → organizer), the review UI that sits on top of it, and the data it has produced in the production database on ai-workstation.

Companion document: [CONTENT_IDENTIFICATION_RESEARCH.md](./CONTENT_IDENTIFICATION_RESEARCH.md) covers whether a file can be identified from its *content* (fingerprinting, OCR, speech) rather than its name.

---

## 1. Summary

The pipeline is well-intentioned and the Jellyfin naming rules it implements are sound, but as deployed it cannot auto-organize anything, loses its own state on every restart, and cannot explain the decisions it does make. The production data proves it:

| Measure | Value | What it means |
|---|---|---|
| `ingress_queue` rows | 26,687 | For only **9,577 distinct files** — 8,927 paths have duplicate rows (up to 9 per file) |
| Rows in `needs_review` | 25,403 | Effectively everything |
| Rows `completed` or `auto_assigned` | 0 | The automatic path has never finished a file |
| Rows scored ≥ 80 (the auto-assign threshold) | 6,354 | **All 6,354 have no match at all** — the score is a parse-quality score, not a match score |
| `media_assignments` rows | 8,767 | All organized through human "accept" clicks; `is_manual_assignment` is false on every one |
| `media_files` rows | 7 | The file-level table that discs, extras and assignments are supposed to hang off is essentially empty |
| `ingress_processing_history` rows | 1,008 | The audit log for 26K queue rows and 8.7K organizations |

Root causes, in order of impact:

1. **The auto-assign threshold is unreachable by construction.** A movie matched from OMDb/TMDB can score at most 70 (50 title + 20 year). An episode can score at most 75 because the parser never extracts a year for episodes. The only way to reach 80 is a bonus for `source == "postgres"` (the internal library), and that search path does not exist in the code (see §4.3). The documentation describes a library search; the code has a stub that returns nothing.
2. **The parser drops or ignores the strongest signals present in the files**: `[imdbid-tt…]` folder tags written by the disc ripper, the year in `Show (1990) - S04E18 - Title.mkv`, season folders for anything that is not a bare `e01.mkv`, track numbers on disc rips, and MakeMKV's `title_t00.mkv` default name.
3. **The queue is in-memory and write-only to Postgres.** Nothing reloads it on startup, so the review queue vanishes on restart, and every re-scan inserts new rows for the same files.
4. **Two different numbers are both called "confidence"** and shown in the same UI column: the matcher's candidate score and the queue's parse-quality fallback.
5. **The proposal the user accepts is not what gets executed.** Proposed paths are computed by one path builder in `IngressQueueService` and the move is performed by a different one in `FileOrganizationService`; they disagree on folder names, IMDb tags, and special-feature naming.
6. **Nothing records *why* a decision was made.** `match_reason` is always the empty string, candidates are persisted but never shown, history snapshots are partial and mostly lost.

Section 6 proposes a redesign around a persisted, evidence-based, replayable decision record. Section 7 lists changes that can ship immediately inside the current architecture.

---

## 2. How the current pipeline works

```
FileWatcherService (watchdog PollingObserver, 5 s poll, 10 s stability wait)
   │  queue_callback → IngressQueueService.add_from_watcher()
   ▼
IngressQueueService.process_next_item()          [main.py auto-processor loop, every 2 s]
   ├─ _get_file_duration()                       pymediainfo, General track duration
   ├─ FilenameParser.parse_filename()            regex cascade, first match wins
   ├─ _infer_source_media_type()                 "Season N" folder → episode; "Disc N" suffix → disc_set
   ├─ AutoMatcherService.search_and_match()      OMDb ?s= search; TMDB only if OMDb returned nothing
   │     └─ _calculate_confidence()              0–100 per candidate
   ├─ status = auto_assigned if best_match and score ≥ 80 else needs_review
   ├─ (auto_assigned only) AssignmentOrchestrator.auto_assign()
   │     ├─ MetadataEnrichmentService.enrich_payload()   full OMDb/TMDB hydrate
   │     ├─ INSERT media_files, media_assignments
   │     └─ FileOrganizationService.organize_assignment()  mkdir, move, NFO, upsert movies/series
   ├─ _finalize_source_folder()                  prune empties, or move leftovers to <dest>/Unprocessed
   ├─ _persist_queue_item()                      UPSERT ingress_queue (by in-memory UUID)
   └─ _record_history_event()                    INSERT ingress_processing_history snapshot
```

Proposed destination paths are **not** computed here. They are computed on every `GET /api/ingress/queue/items` call by `_enrich_proposed_paths()`, which groups the in-memory items by matched title, scans the destination folder on the NAS, probes the existing main feature's duration with MediaInfo, and assigns main/version/special roles. The same function is re-run at accept time to "prime" hints before `auto_assign()`.

Human actions available in the review UI: accept proposal (`mark_complete`), dismiss (`mark_failed`, reason "Manually dismissed"), retry, override classification (main/special/version), manual assign (search OMDb/library, pick title, optional S/E).

A separate, offline pass exists for already-organized folders: `JellyfinMovieOrganizer` / `JellyfinShowOrganizer` (preview/apply reorganization of a library folder) and `LibraryComplianceService` (audit scan). These share `extras_taxonomy.py` with the ingest path but otherwise have their own classification logic.

---

## 3. What the production data shows

Queries run against the `media_manager` database on 2026-11-08.

**Queue status.** 25,403 `needs_review`, 1,284 `failed` (all "Manually dismissed"), 0 `completed`, 0 `auto_assigned`, 0 `pending`.

**Confidence distribution of queue rows.**

| Score bucket | Rows | Note |
|---|---|---|
| 0–29 | 919 | |
| 30–39 | 3,036 | Parse-fallback: title only (35) |
| 40–59 | 2,209 | |
| 60–69 | 2,545 | |
| 70–79 | 11,624 | The ceiling for any real external match |
| 80–89 | 6,354 | **Every one has `best_match` = NULL** (parse-fallback 80/85) |

**Best-match source.** 12,981 OMDb, 1,444 TMDB, 12,262 none.

**Parsed media type.** 18,028 episode, 4,962 movie, 3,697 unknown.

**Assignments.** 8,767 rows (6,303 episodes across 69 series; 2,464 movies across 578 titles), created 2026-04-18 to 2026-06-07, all `assigned_by = ingress_pipeline`, 8,756 completed. Confidence on these: 5,726 at 70–79, 1,740 at 100, the rest lower. Since 70 is below the threshold, these were accepted by hand (or under an earlier, lower threshold); the 100s are manual assignments. The `is_manual_assignment` flag is false on all of them because the UI sends `source: "omdb"` rather than `"manual"`, so the audit trail cannot distinguish auto from human decisions.

**Ingest folder today** (`/ark/media/jellyfin/ingest`, 810 files). Representative shapes present right now:

```
George Carlin George on George (2003)/George Carlin George on George (2003).mkv       ← ripper, clean
Premium Rush (2012) [imdbid-tt1547234]/Premium Rush.m4v + Premium Rush_t00.mkv         ← ripper, IMDb tag, two versions
Big Hero 6 (2014) [imdbid-tt2245084] [3D Half-SBS]/Big.Hero.6.2014.1080p.3D.BluRay…   ← tag + scene name
Alfred Hitchcock-A Legacy of Suspense D2 (2011)/<main>.mkv + extras/A5_t02.mkv …       ← disc set, MakeMKV extras
Little House on the Prairie (1974) [imdbid-tt0071007]/Season 01/23_Founder's_Day.m4v  ← track-numbered episodes
Modern Family/Season 3/15 Aunt Mommy.avi                                              ← track-numbered episodes
Unsolved Mysteries (1987)/Season 6/Unsolved Mysteries - S06E16 - Episode #180.mkv      ← Sonarr-style
The Big Bang Theory (2007)/Season 03/The.Big.Bang.Theory.S03E09.720p.HDTV…mkv          ← scene episode
Peaky Blinders (2013) [imdbid-tt2442560]/Season 00/S00E09 - The Rise Of Tommy Shelby…  ← specials, no show in filename
Drake & Josh/Best of Seasons 1 & 2/Disc 1.mkv, Disc 2.mkv, title_t00.mkv               ← MakeMKV defaults
Mythbusters/Mega Movie Myths/title_t00.mkv                                             ← MakeMKV default
Looney Tunes Collectors Choice Volume 1/… (1945) - V01E10 - ….mkv                      ← volume numbering
Nightbitch.2024.1080p.WEB.h264-ETHEL/<no video yet>, Screens/*.png, *.nfo              ← scene release, sidecars
Anne_Frank/Anne_Frank.mkv                                                              ← no year, no type
```

`_NeedsReview` on the NAS holds ~100 entries such as `13 GHOSTS-B4 t01`, `Alita- Battle Angel-C1 t03`, `01 One Crazy Summer - First Day of Summer`: files whose parent-folder context was stripped when they were flattened into the review folder.

---

## 4. Findings by stage

### 4.1 Watcher and queue state

| # | Finding | Where | Effect |
|---|---|---|---|
| Q1 | Queue lives in memory; Postgres is written but never read back on startup | `ingress_queue_service.py` (no load path), `main.py` lifespan | Review queue disappears on every restart/deploy |
| Q2 | Re-scan (`/watcher/start` → `_queue_existing_files_background`) creates new UUIDs for paths already in the DB | `api/ingress_operations.py:162`, `add_manual_file` dedupes in memory only | 26,687 rows for 9,577 files |
| Q3 | Auto-start of the watcher does not queue existing files; only the UI "start" does | `main.py` vs `ingress_operations.py:240` | Files present at boot are ignored until someone clicks |
| Q4 | "Dismiss" is not durable: `mark_failed` sets `failed` but does not bump `attempts`; the auto-retry loop re-queues any `failed` item with `attempts < 3` after 5 min | `ingress_queue_service.py:557`, `main.py:112` | Dismissed items come back |
| Q5 | `supported_video_extensions` (watcher) excludes `.m2ts/.ts/.iso/.mpg`; organizer and compliance `VIDEO_EXTENSIONS` include them | `config/settings.py`, `file_organization_service.py:27` | Inconsistent handling of the same file across stages |
| Q6 | `GET /queue/items` runs `_enrich_proposed_paths` every call: `os.listdir` of destination folders and a MediaInfo parse of the existing main feature **over SMB**, per title group | `ingress_queue_service.py:1172` | Slow UI polls; results change between polls as the NAS changes |
| Q7 | Processing is strictly one file at a time with blocking `requests` calls inside an async loop | `auto_matcher_service.py` | Event loop stalls on slow OMDb responses |
| Q8 | Non-video sidecars (`.nfo` scene files, `Screens/*.png`) are "skipped" and later merged into the organized Jellyfin folder by `_merge_directory_contents` | `_finalize_source_folder` | Scene `.nfo` (plain text) lands next to Jellyfin's `movie.nfo` (XML) |

### 4.2 Filename parser

The parser was run against the real filenames above (`FilenameParser.parse_filename` with the real folder name and path). Results:

| Input | Parsed | Problem |
|---|---|---|
| `The Fresh Prince of Bel-Air (1990) - S04E18 - …` | episode, title **"The Fresh Prince of Bel-Air 1990"**, year None | Year is never extracted in the episode branch, so it pollutes the title and the OMDb search returns nothing. This is the Sonarr/TRaSH standard format. 6,354 rows in the DB are this shape. |
| `Premium Rush.m4v` in `Premium Rush (2012) [imdbid-tt1547234]/` | **unknown**, year None | Folder year is only consulted when the file is a companion; the IMDb tag is never read anywhere |
| `Premium Rush_t00.mkv` | unknown, title "Premium Rush t00" | `_tNN` suffix not recognized unless preceded by a letter+digit MakeMKV code |
| `title_t00.mkv` | unknown, title "title t00" | MakeMKV's default output name not recognized |
| `15 Aunt Mommy.avi` in `Modern Family/Season 3/` | unknown, companion, S/E None | Track prefix is treated as "extras" marker; the Season folder is ignored because only the bare-`e01` branch reads path context |
| `23_Founder's_Day.m4v` | unknown, title "23 Founders Day" | Underscore after the track number is not matched (`^\d{1,2}[.\s]`) |
| `s03e28.avi` in `Cheers/Season 3/` | episode, title **""** | SxxExx branch does not fall back to path context |
| `S00E09 - The Rise Of Tommy Shelby (…)` in `Peaky Blinders (2013) [imdbid-…]/Season 00/` | episode, title "" | Same; and the episode title is kept but the show is lost |
| `Looney Tunes Collector's Choice (1945) - V01E10 - …` | **movie**, 1945 | `VxxExx` volume numbering unknown |
| `Disc 1.mkv` in `Drake & Josh/Best of Seasons 1 & 2/` | unknown, title "Best of Seasons 1 2" | `&` dropped; grandparent "Drake & Josh" never considered; disc-set rule only fires on folder names ending in `Disc N` |
| `50-50.DvdRip.H264.720p.m4v` in `50-50 (2011)/` | unknown, title "50-50 720p" | Resolution token stripped into `quality` but left in the title; folder year unused |
| `Top Gun D2 (1986).mkv` | movie, title "Top Gun D2" | Disc suffix stripped from folder titles only |
| `A5_t02.mkv` in `…/extras/` | movie, companion, title from folder | Correct, but the `extras/` folder name itself is not used as a category signal |

Structural problems behind these:

- **First-match-wins regex cascade.** Each branch returns immediately with whatever it found, so a file either gets path context or year or companion detection, never all three.
- **Folder chain is under-used.** Only the immediate source-root name (or the "Season" parent for bare episodes) is consulted. The disc ripper writes `Title (Year) [imdbid-ttNNNNNNN]`, a definitive identifier, and it is thrown away.
- **No sibling awareness at parse time.** Whether a file is the only video in its folder, one of 22 numbered tracks, or the longest of five, changes what it is. That context is only used later for main/special ranking.
- **One test** covers the parser (`tests/test_filename_parser.py`, a single MakeMKV case).

### 4.3 Matcher and confidence

| # | Finding | Detail |
|---|---|---|
| M1 | **Internal library search does not exist.** | `search_and_match` only calls OMDb, then TMDB if OMDb was empty. `_find_existing_media` returns `None`; `_count_episode_level_assignments` returns 0; no candidate ever has `source == "postgres"`. The +20/+15/+15 library bonuses in `_calculate_confidence` are dead code. `INGRESS_ASSIGNMENT_REFERENCE.md` documents a library search with ≥0.6 fuzzy match that is not implemented. |
| M2 | **Threshold 80 is unreachable.** | Movie max = 50 + 20 = 70. Episode max = 50 + 15 + 10 = 75 (parser never sets year for episodes). The `World's End` row at exactly 70 is a perfect match that will sit in review forever. |
| M3 | **Two "confidence" numbers.** | If no candidate exists, `IngressQueueService._calculate_confidence()` scores the *parse* (35 title + 20 movie + 25 year + 5 quality = 85). That number is stored in the same column and shown in the same UI cell as the matcher score. 6,354 rows show 80–85% with no match. |
| M4 | **No margin or ambiguity check.** | The top candidate wins even if #2 has the same score. Remakes with the same title and no parsed year (`Arrival`, `Planet of the Apes`, `Death Race`) are coin flips. |
| M5 | **OMDb `s=` search is a poor first-pass matcher.** | It needs a near-exact title (`The Worlds End` → nothing; TMDB found it). TMDB search handles punctuation, articles and alternative titles far better, but is only consulted on OMDb miss. |
| M6 | **Episodes are never validated.** | Season/episode numbers from the filename are copied onto the candidate without checking the season exists or fetching the episode title/runtime (`/tv/{id}/season/{s}/episode/{e}`). |
| M7 | **Duration is measured but not used for identity.** | `media_duration_ms` is probed for every file and used only for main-vs-special ranking. Comparing it to OMDb/TMDB runtime (or TMDB per-episode runtime) is the single cheapest content-derived identity signal available and is unused. |
| M8 | `match_reason` is always `""`. | Nothing records which factors contributed. |
| M9 | Candidate list capped at 5 and persisted, but the UI never renders it. | `IngressAutomationPanel.tsx` has zero references to `match_candidates`. |
| M10 | Year-off-by-one gives +10, but TMDB/OMDb release years legitimately differ by one (festival vs. wide release) and disc folder years are often the disc release year, not the film's. | Systematic under-scoring of correct matches. |

### 4.4 Classification and proposed paths

| # | Finding | Detail |
|---|---|---|
| C1 | **Proposal and execution use different path builders.** | `IngressQueueService._build_main_path` produces `shows/{Title (Year)}/Season 01/…` (hard-coded "shows"/"Movies", no IMDb tag). `FileOrganizationService._calculate_jellyfin_path` produces `{settings.folder_tv_shows}/{Title (Year) [imdbid-…]}/Season 01/…`. The UI shows one; the disk gets the other. |
| C2 | **Special-feature numbering is lost on execution.** | `_apply_resolved_path_hints` sets `special_feature_number` on the item but `auto_assign` only forwards `is_alternate_version`/`version_number`. `_build_jellyfin_filename` therefore names a "Special Feature 2" exactly like the main feature, collides, and falls back to `Title (Year) [imdbid] - B1_t03.mkv`. |
| C3 | **Role assignment depends on what is on disk at view time.** | `_movie_folder_state` lists the destination folder; if the main feature was organized between two polls, the same queue item flips from "main" to "Version 2". The decision is not stored, so it cannot be reviewed. |
| C4 | **Longest-file-wins is the only main-feature heuristic.** | Fails for: TV discs (no main), "Play All" titles (longest = concatenation), director's cut + theatrical on one disc (both long), concert discs. No use of chapter count, audio-track count, or the ripper's own `title_content_types`. |
| C5 | **`_NeedsReview` flattening destroys context.** | A file that cannot be placed is moved to `<dest>/_NeedsReview/<stem> - NEEDS REVIEW.ext`, losing the parent folder that contained the title, year and IMDb tag. The ~100 entries there (`13 GHOSTS-B4 t01`, `Alita- Battle Angel-C1 t03`) are now harder to identify than when they arrived. |
| C6 | **A second limbo folder, `Unprocessed`.** | `_finalize_source_folder` moves leftover source trees to `<dest>/Unprocessed/<folder> (N)`, and `_repair_missing_source_path` later guesses where they went. Three locations (ingest, `_NeedsReview`, `Unprocessed`) can hold the same logical batch. |
| C7 | Specials folder naming differs: `FileOrganizationService` writes `Specials/`, `JellyfinShowOrganizer` writes `Season 00/`, the queue proposal writes `Specials` for S0 but `Season 00` for unknown season. | Compliance scans will flag the pipeline's own output. |
| C8 | Extras classification at ingest only recognizes the ripper's filename suffix tokens; `-trailer` etc. Files in an `extras/` sub-folder (as the ripper actually delivers them) get "Special Feature N". | Documented as a known gap in `NAMING_CONVENTIONS.md`; still open. |
| C9 | Season-pack files with no episode number are placed as `Show - Unknown Episode N` or with their original name in the season folder, which Jellyfin cannot match to an episode. | Permanent "unknown" items in the library with no follow-up workflow. |

### 4.5 Assignment and organization records

| # | Finding | Detail |
|---|---|---|
| A1 | `media_files` has 7 rows for 8,767 assignments. `_upsert_media_file` was added late; nothing backfilled. | Disc/tape linking, extras review (`assignment_extra_files`) and "which file is this" all depend on this table. |
| A2 | `_upsert_catalog_jellyfin_info` falls back to matching an existing catalog row **by title alone**. | `Salt`, `Traitor`, `Arrival` style collisions merge different films into one catalog entry. |
| A3 | `media_id` on an assignment is the IMDb id for external matches and a UUID for catalog rows. | Joins to `movies`/`series` are ambiguous. |
| A4 | `is_manual_assignment` is false for every row (UI sends the search source, not `"manual"`). | Human vs. machine decisions are indistinguishable after the fact. |
| A5 | Episode assignments do not create/update `episodes`/`seasons` rows; `_summarize_series_files` re-derives counts by scanning the folder. | The catalog cannot say which episodes are missing. |
| A6 | NFO files contain title/year/IMDb id only, and existing NFOs are never updated. | Fine for Jellyfin identification; but a wrong first write is permanent. |

### 4.6 Auditability (the "review every decision" requirement)

What is recorded today: one `ingress_processing_history` snapshot per event (`proposal_generated`, `item_processed`, `accepted_assignment`, `manual_assignment`, `classification_updated`, `marked_failed`, `processing_failed`), containing the item's state at that moment. What is **not** recorded:

- which parser branch fired and what each folder level contributed;
- which search calls were made, with what query, and what they returned (only the top 5 scored candidates survive);
- the per-factor score breakdown (`match_reason` is empty);
- why a file was classified main/version/special (the folder-state inputs are recomputed and discarded);
- what path was *proposed* vs what path was *executed* (only `operations` on the assignment has the final destination);
- who/what accepted (auto vs human) — see A4;
- the pre-move state needed to undo (source path is there; size/hash are not).

History is also kept in memory and lost on restart; 1,008 rows survive for ~27K queue rows.

### 4.7 Documentation drift

- `INGRESS_ASSIGNMENT_REFERENCE.md` §Step 3 describes an internal library search and scoring bonuses that are not implemented (M1).
- §Step 6 describes `Shows/` and `Specials/` paths; the queue proposal uses `shows/`, the organizer uses `settings.folder_tv_shows` ("TV Shows"), the show organizer uses `Season 00`.
- `backend/README.md` project tree omits `jellyfin_*_organizer.py`, `library_compliance_service.py`, `extras_taxonomy.py`, `metadata_enrichment_service.py`.

---

## 5. Catalog of input cases the pipeline must handle

Derived from the current ingest folder, the `_NeedsReview` folder, the duplicate-row top folders in the DB, and the disc-ripper's naming code. ✅ handled today, ⚠️ partially, ❌ not handled.

**Movies**
- ❌ `Title (Year) [imdbid-ttN]/anything.ext` — use the tag; this should be a certainty, not a search.
- ⚠️ `Title (Year)/Title (Year).ext` — works, but can only ever reach 70.
- ❌ `Title (Year)/Title.ext` (no year in file) — folder year ignored unless companion.
- ❌ Scene release `Title.Year.1080p.Source.Codec-GROUP/` with `.nfo` + `Screens/` — title OK, sidecars mishandled.
- ❌ `Title D1 (Year)` / `Title D2 (Year)` sibling folders (two-disc releases, ~60 in the DB) — treated as separate titles; "D2" kept in title when in filename.
- ❌ Two main-feature candidates in one folder (theatrical + extended; `Premium Rush.m4v` + `Premium Rush_t00.mkv`) — second becomes "Version 2" by size only, no edition label.
- ❌ Edition hints in folder names: `(Unrated)`, `(Screwhead Edition)`, `[3D Half-SBS]`, `[2160p]` — ignored or corrupt the title.
- ❌ Non-English or punctuation-heavy titles: `Men in Black³`, `Thir13en Ghosts`, `Kill Bill- Vol 1`, `La Cage aux Folles II` — hyphen-as-colon convention not normalized back.
- ❌ Stand-up / concerts / documentaries (`George Carlin …`, `Dave Matthews Band- Live at Piedmont Park`, `Putin's Way on Frontline`) — "live_performance"/"documentary" types exist but nothing sets them except genre strings after the fact.
- ❌ Home videos (`Christine Home Videos`) — no path; "Home Videos" folder is created at boot but unused by the pipeline.
- ⚠️ MakeMKV extras `B1_t03.mkv` next to a main feature — companion detection works; category never resolved; `extras/` sub-folder ignored.
- ❌ `title_t00.mkv` (MakeMKV default) and `Disc 1.mkv` (user-named).

**TV**
- ❌ `Show (Year) - SxxExx - Title.ext` (Sonarr/TRaSH default) — year left in title.
- ❌ `Show - SxxExx - Title.ext` — works but 75 max.
- ❌ `SxxExx - Title.ext` / `sxxexx.ext` under `Show/Season N/` — title empty.
- ❌ `NN Title.ext` / `NN_Title.ext` under `Show/Season N/` (track-numbered disc rips; Little House, Modern Family, One Crazy Summer) — the dominant real-world DVD case; treated as extras.
- ❌ `Show/Best of Seasons 1 & 2/Disc 1.mkv` — compilation discs.
- ❌ `Show/Specials or Season 00/…` — show lost.
- ❌ Volume numbering `V01E10`, absolute numbering outside anime brackets, `Episode #180` style.
- ❌ Multi-part `(Part 1)`/`(Part 2)` of one episode across two files.
- ❌ Double episodes on disc (one file = two episodes) without `E01E02` in the name — only detectable by duration.
- ❌ Season packs where files are in rip order, not air order.
- ⚠️ Anime `[Group] Show - 125 [tag]` — parsed, but placed in `Season 00` which Jellyfin treats as Specials.

**Cross-cutting**
- ❌ Same logical batch split across `ingest/`, `_NeedsReview/`, `Unprocessed/`.
- ❌ Files that are *already* in the library being re-ripped (dedupe against existing `media_files` by size/hash).
- ❌ Decide a folder as a unit (wait for all files to settle; the ripper writes several files over minutes).
- ❌ Learn from corrections (an alias table: "Spongebob Squarepants" → tt0206512; "LOTR - The Return of The King" → tt0167260).

---

## 6. Redesign

### 6.1 Principles

1. **Evidence, then candidates, then a decision, then a plan, then execution — each a persisted row.** Every stage reads the previous stage's rows and can be re-run independently. "Review every decision" falls out of this for free.
2. **Identity first, role second.** Decide *what title this is* (movie X / series Y) before deciding *what role the file plays* (main, version, extra category, S/E). They have different evidence and different confidence.
3. **The folder is the unit of decision, not the file.** A ripped disc arrives as a set. Roles are relative to siblings.
4. **One path builder.** The proposal shown to the user is the exact string that will be executed.
5. **Nothing is moved to a limbo folder.** Undecided files stay where they arrived; the decision record says why they are undecided.
6. **Every automatic decision has a score breakdown and a margin**, and auto-approval policy is explicit and per case type.
7. **Durable state in Postgres; memory is a cache.** The process can die at any point and resume.
8. **Corrections become rules.** A human fixing a match creates an alias that future files hit before any API call.

### 6.2 Pipeline

```
discover ─► extract evidence ─► generate candidates ─► score & decide identity
        ─► decide roles (per source set) ─► build plan ─► gate (auto / review)
        ─► execute (journaled, undoable) ─► reconcile catalog
```

Each arrow is a state transition on `ingest_items`, and each stage appends to its own table. Stages are idempotent functions of their inputs, keyed by a `pipeline_version`, so the whole history can be re-scored offline when the scorer changes.

### 6.3 Data model

New/replacement tables (names indicative):

| Table | One row per | Key columns |
|---|---|---|
| `ingest_items` | physical file, unique on `file_path` | `file_id` (stable: size + OpenSubtitles-style 64 KB head/tail hash), `source_set_id`, `state`, `first_seen`, `last_seen`, `duration_ms`, `container_meta` JSONB |
| `ingest_source_sets` | top-level folder under ingest (the "disc" / "batch") | `root_path`, `settled_at` (all files stable for N min), `kind` guess (disc_rip / scene_release / loose_files / season_folder) |
| `ingest_evidence` | one extracted fact | `item_id` or `set_id`, `kind` (`folder_imdbid`, `folder_year`, `filename_sxe`, `track_prefix`, `makemkv_marker`, `season_folder`, `container_title`, `ripper_manifest`, `scene_nfo_imdb`…), `value`, `extractor_version` |
| `ingest_candidates` | one (item-or-set, external title) pair | `provider` (tmdb/omdb/library/alias), `provider_id`, `imdb_id`, `title`, `year`, `media_kind`, `score`, `score_breakdown` JSONB `[{rule, points, note}]`, `rank`, `margin_to_next` |
| `ingest_decisions` | one decision (identity or role) | `subject` (item/set), `decision_type`, `chosen_candidate_id` or `role` payload, `decided_by` (`auto` / `user:<name>` / `rule:<alias_id>`), `policy_rule`, `confidence`, `superseded_by`, `created_at` |
| `ingest_plans` | the concrete target for an item | `item_id`, `decision_id`, `target_path`, `role`, `nfo_actions`, `plan_version`; **the only source of the string shown in the UI and used in execution** |
| `ingest_operations` | one filesystem/catalog operation | `plan_id`, `op` (move/mkdir/write_nfo/catalog_upsert), `src`, `dst`, `size_before`, `status`, `error`, `executed_at`, `undone_at` |
| `title_aliases` | learned mapping | `pattern` (normalized title or folder regex), `imdb_id`/`tmdb_id`, `media_kind`, `created_from_decision_id` |
| `episode_order_memory` | learned disc→episode order | `series_id`, `season`, `source_pattern`, `track_to_episode` JSONB |

Keep `media_files`, `media_assignments`, `assignment_extra_files` as the *catalog-side* result (what the library believes), written only by the reconcile stage. Backfill `media_files` from `media_assignments.match_data` + `operations` for the 8,767 existing rows.

### 6.4 Evidence extractors

Ordered by reliability; each produces typed evidence rows, never a single "title" string.

1. **Ripper manifest** (new, highest value): have `disc-ripper-service` write `_rip_manifest.json` into the delivery folder with `catalog_disc_id`, `imdb_id`, `tmdb_id`, `media_type`, `season`, per-file `title_idx`, `content_type`, `episode_map`, `duration`, `chapters`. This replaces the filename-as-the-only-channel constraint documented in `NAMING_CONVENTIONS.md`. The `[imdbid-…]` folder tag is the fallback when the manifest is absent.
2. **Folder chain tags**: `[imdbid-ttN]`, `[tmdbid-N]`, `[tvdbid-N]`, `(Year)`, `Season NN`/`S NN`/`Specials`, disc markers (`D2`, `Disc 2`, `CD1`), edition markers (`Unrated`, `Director's Cut`, `3D`, `2160p`), scene-group patterns. Walk every level up to the ingest root; record which level each fact came from.
3. **Filename tokens**: `SxxExx`/`xx`/`VxxExx`/`Exx`/absolute, episode title segment, year, quality/source/codec tokens (strip *all* of them from the title candidate), `Part N`, MakeMKV codes (`^[A-Z]\d+_t\d+$`, `_t\d+$`, `^title_t\d+$`), track prefixes (`^\d{1,2}[\s._-]`), companion keywords, the ripper's `-trailer` style suffixes, `&`/`and`, hyphen-as-colon.
4. **Scene sidecar**: scene `.nfo` files very often contain an `imdb.com/title/ttN` URL — grep it.
5. **Container metadata** (one MediaInfo/ffprobe pass, stored): duration, chapter count, video resolution/HDR/3D, audio track count and languages, subtitle tracks, the container `title` tag (MakeMKV writes the disc volume label into it, e.g. `PREMIUM_RUSH`).
6. **Sibling context**: number of videos in the set, size/duration rank, whether the item's duration ≈ sum of others (Play All), identical durations (duplicate titles/angles).
7. **Library context**: does the catalog already have this IMDb id? Does the destination folder exist? Does `media_files` have a file with the same `file_id` (re-rip of an organized file)?
8. **Content-derived** (from the research doc, later phases): OpenSubtitles hash lookup, embedded-subtitle text search, Whisper transcript → subtitle DB, OCR of title card.

### 6.5 Identity scoring

Replace the single additive score with ordered **gates** and an explainable **points list**:

- **Hard identity (skip search):** manifest or folder/nfo IMDb/TMDB id → fetch by id, score 100, breakdown `[{rule:"folder_imdbid", points:100}]`. Still fetch runtime and verify duration within tolerance; a mismatch does not change identity but flags the *role* (an extra in a tagged folder).
- **Alias hit:** normalized title (or folder pattern) found in `title_aliases` → score 95.
- **Search:** TMDB `search/multi` (or `search/movie` + `search/tv` when the kind is known) as the primary; OMDb `t=`/`i=` for enrichment only. Query with the *cleaned* title, then with year, then with the parent folder title; union results.
- **Points per candidate** (illustrative, to be calibrated — see 6.10):
  `title_similarity` (token-set ratio, 0–40) · `year_exact +20 / ±1 +12 / ±2 +4` · `runtime_within_5% +15` / `runtime_off_>25% −30` · `kind_agrees +10` (parsed episode ↔ series) · `season_exists +8` · `episode_exists +8` · `episode_runtime_within_10% +10` · `library_has_title +10` · `popularity_tiebreak +0–3`.
- **Decision rule:** accept if `score ≥ T_kind` **and** `margin_to_next ≥ M` **and** no hard-fail (`runtime_off_>25%`, `episode_missing`). Otherwise `needs_review` with the breakdown and the top 5 shown.
- **Separate numbers in the UI:** `parse_quality`, `identity_confidence`, `role_confidence`. Never store a parse score in the match score column.

### 6.6 Role resolution per source set

Run once the set is *settled* (no file changed for N minutes and the ripper manifest, if any, is present).

- **Movie set:** main = ripper-flagged main, else the file whose duration matches the title runtime within 5%, else longest. Other long files (≥85% of main) are versions and get an edition label from folder/edition evidence (`- Theatrical`, `- Extended`, `- 3D`) rather than `Version N`. Shorter files are extras; category from ripper `content_type`, suffix token, `extras/<category>/` folder, or `other` pending review. Play-All titles (duration ≈ sum of siblings ± 2%) are dropped as extras and flagged.
- **TV set with S/E in names:** validate against TMDB season; attach episode titles.
- **TV set with track numbers only** (the dominant DVD case): map tracks to episodes by (a) `episode_order_memory` for this series/season/disc, (b) contiguous-window duration matching against TMDB per-episode runtimes (choose the window of `n` consecutive episodes whose runtimes best fit the `n` tracks in order; handles disc N of a season), (c) the `Disc N` folder marker to pick the window start, (d) fall back to review with the best guess pre-filled. Double-length tracks → `E01E02`. Two tracks each ≈ half → `Part 1/2`.
- **Compilation / "Best of" discs:** identity = series, role = `special` with the file's own title unless episodes can be matched by duration.
- **Unknown kind** (no year, no S/E, single file): identity confidence will be low by design; route to review but pre-fill the TMDB multi-search top 5.

### 6.7 Planning and execution

- One `PathBuilder` used by both the proposal and the executor. Inputs are the decision rows only (never the live filesystem), so plans are deterministic and stable across UI polls. Collision handling is part of the plan (`target_path` already unique), not a surprise at move time.
- Plans are shown in the UI exactly as stored; accept = execute plan `id`, not "re-derive and hope".
- Execution writes `ingest_operations` before and after each move with size/hash; a failed step stops the plan and leaves earlier steps recorded. **Undo** replays operations in reverse while the recorded `dst` still matches.
- No `_NeedsReview` or `Unprocessed` moves. Leftover source folders are a reviewable "set complete?" decision (delete empties / keep sidecars / flag).
- Reconcile stage writes `media_files`, `media_assignments`, `assignment_extra_files`, `episodes` coverage, and `jellyfin_info`, keyed by catalog `id` (resolve IMDb → catalog row first; create if missing) — never by title string.

### 6.8 Review UI requirements

- Work by **source set**, not by file: one card per folder with the identity decision at the top (chosen title, confidence, margin, top alternatives with breakdowns) and a role table below (file → role/S/E → planned path).
- Every number is expandable to its breakdown; every evidence row shows where it came from (which folder level, which token, which provider call).
- Bulk actions that match real work: "this folder is series X", "these tracks are S03E01–E08 in order", "swap these two", "all `A*_t*` files are extras", "mark as home video".
- A **timeline** per set from `ingest_decisions` + `ingest_operations`: parsed → matched → decided (auto/user) → executed, with an Undo button on executed plans.
- A **policy** screen: thresholds per kind, which evidence kinds allow auto-approval, settle time, whether MakeMKV multi-title sets may auto-execute.
- Queue views: needs review (grouped by set, sorted by potential wins), auto-executed in the last 24 h (so auto decisions can be spot-checked), failed operations.

### 6.9 Watcher and runtime

- Keep `PollingObserver` for SMB but make it a *discovery* source only: it upserts `ingest_items` by path/`file_id`. A periodic full reconcile scan (every N minutes and at startup) catches anything the observer missed and marks vanished files.
- Workers pull from Postgres (`SELECT … FOR UPDATE SKIP LOCKED`), so restarts are safe and multiple stages can run concurrently; external calls via `httpx` async with a small rate limiter and a response cache keyed by query (OMDb's 1,000/day limit matters at 26K items).
- Dismiss, snooze and "never auto-touch this folder" are explicit states, not `failed`.

### 6.10 Calibration and evaluation before raising automation

The database already contains ground truth: 8,767 human-accepted assignments with the original filename and the chosen IMDb id in `match_data`. Build an offline harness that replays the new extractors + scorer over those filenames and reports precision/recall at each threshold and margin, per kind. Set `T_kind`/`M` from that curve (target: ≥ 99% precision on auto-approved movies, ≥ 98% on episodes), and re-run it in CI whenever the scorer changes. Add the real-filename table from §4.2 as parser regression tests.

### 6.11 Migration phases

1. **Stabilize (no behavior change):** unique index on `ingress_queue.file_path`, load queue from DB at startup, dedupe the 26K rows to 9.5K, make dismiss durable, stop NAS I/O in `GET /queue/items`, split the confidence column into `parse_quality` and `match_confidence`.
2. **Parser + evidence:** implement the extractor list (6.4 items 2–7) as `ingest_evidence`, keep the old `parsed_info` shape as a derived view for the current UI; ship the regression tests.
3. **Matcher:** TMDB-first search, id-first path for tagged folders, runtime/episode validation, score breakdown + margin, aliases table; calibrate with 6.10; raise auto-approval only for id-tagged and alias-hit cases first.
4. **Plan/execute:** single `PathBuilder`, `ingest_plans`/`ingest_operations`, undo, remove `_NeedsReview`/`Unprocessed` moves, backfill `media_files`.
5. **Set-level roles + TV track mapping** (6.6), ripper manifest (coordinate with `disc-ripper-service`).
6. **Review UI** rebuilt around sets, breakdowns and timelines.
7. **Content-derived evidence** per the research document.

---

## 7. Quick wins inside the current code

Ordered by value ÷ effort. File references are to `backend/`.

**Status (2026-11-09, branches `feat/ingest-quick-wins` and `feat/ingest-tmdb-first-manual-flag`):** all fourteen items are implemented. Specifically: parser rewrite with folder-chain context, `[imdbid-…]` tags, year extraction in the episode branch, track-number episodes, MakeMKV markers, `VxxExx`, disc numbers, edition hints and `parse_notes`; matcher with id-first lookup, rescaled weights (exact title + year = 80), `score_breakdown`/`match_reason` and an ambiguity margin; queue with a separate `parse_quality`, `review_reason`, `NULL` confidence when unmatched, durable dismiss, DB restore on startup and a unique `file_path` index (migration `7a8b9c0d1e2f`); proposal paths that use the configured folder names and the IMDb tag; `specialFeatureNumber` forwarded to the organizer; the review UI shows the reason an item is waiting and a tooltip with the score breakdown, alternative candidates and parse notes. Items 10 and 12 (2026-11-09): an unresolved file keeps `proposed_path = NULL` and is never moved or renamed, the organizer returns `needsReview` without touching the file, and the panel shows the source folder; proposals are stored on the queue row, refreshed for the affected group on process, classification change, accept, manual assign and reset, and once at startup, so `GET /queue/items` does no NAS I/O. Two bugs fixed on the way: leftover non-video files could be merged into a folder relative to the process working directory because the source-folder cleanup ran with a relative proposed path, and `mark_complete` without an orchestrator never completed the item. Item 11 (branch `feat/ingest-tmdb-first-manual-flag`): `search_and_match` searches TMDB first and searches OMDb only when TMDB is not configured or finds nothing (`omdb_only`/`library_only` still search OMDb only, `tmdb_only` never calls OMDb); the three best candidates then get TMDB details with `external_ids` (IMDb id, runtime) and an OMDb lookup *by IMDb id* for whatever TMDB lacks; episodes are checked against `/tv/{id}/season/{s}` (`season_exists +8`, `episode_exists +8`, `episode_missing −30`, `season_missing −30`; a multi-episode file needs every episode in its range); the file duration is compared with the movie runtime or the episode's own runtime (summed for multi-episode files): `runtime_within_5pct +15`, `episode_runtime_within_10pct +10` for episodes, `runtime_off_over_25pct −30`, otherwise a zero-point `runtime_differs` note. Every check is its own `score_breakdown` entry, so the tooltip lists it. On the id-first path the runtime comparison is shown with 0 points, since the tag settles identity and a mismatch only suggests an extra. Item 13: `is_manual_assignment` is set from the route that received the person's action (`POST /queue/mark-complete`, `POST /queue/manual-assign`, bulk `accept` in `POST /queue/bulk`) through a `manual_action` flag on `mark_complete`/`manual_assign_item`, and is false for automatic approvals whatever the match source says. Still open within 11: OMDb-sourced series candidates (the fallback path) get no season/episode check, the penalties lower the score but are not yet hard-fails in the decision rule of 6.5, and the weights are uncalibrated (6.10).

**Known limits of the stored proposals:** they do not see library changes made outside the queue until the next trigger (the accept step still resolves the role from disk); completed rows are not reloaded after a restart, so unmatched companion files still waiting in the folder of an organized movie lose their inherited proposal then and need a manual assign (while the backend keeps running, the organized movie still anchors them); special-feature numbers assigned by the title group and by the companion pass can collide within one refresh; a source folder that still holds videos after an accept and has no other active queue item is still moved to `Unprocessed`; tape ingest and catalog delete still use the `_NeedsReview` folder.

1. **Parser: extract the year in the episode branch and strip it from the title** (`services/filename_parser.py:162`). Unblocks the 6,354 Sonarr-style rows immediately.
2. **Parser: read `[imdbid-ttN]` from any ancestor folder** and put it on `ParsedMediaInfo.imdb_id`; have the matcher do an id lookup when present and score it 100. Covers every disc-ripper delivery.
3. **Parser: use `_extract_path_context` in *all* episode branches** when the title is empty or looks like a number/track, and read the folder year/title for movies even when the file is not a companion.
4. **Parser: treat `^\d{1,2}[\s._-]` under a `Season N` folder as an episode number, not a companion marker**; recognize `title_tNN`, `_tNN`, `VxxExx`; strip quality tokens and `Dn`/`Disc n` from filename titles.
5. **Make the threshold reachable and honest:** stop writing the parse-fallback score into `confidence_score` when there is no match (`services/ingress_queue_service.py:374`); add a margin check; either lower the threshold to 70 for exact title + exact year with margin ≥ 15, or add the folder-year/imdb points above.
6. **Record `match_reason`** as the list of factors in `_calculate_confidence` and **render `match_candidates`** in `IngressAutomationPanel.tsx` (the data is already in the API response).
7. **Load the queue from Postgres at startup and add a unique index on `file_path`** (`main.py` lifespan, `db/models.py`); dedupe existing rows keeping the newest.
8. **Make dismiss durable:** a `dismissed` status excluded from auto-retry, or set `attempts = 3` in `mark_failed`.
9. **Forward `special_feature_number` into the assignment** and have `_build_jellyfin_filename` honor it; switch `_build_main_path`/`_build_special_path` to the same folder names and IMDb tag as `_calculate_jellyfin_path` so proposals match execution.
10. **Stop flattening to `_NeedsReview`**; leave unresolved files in place and surface them in the UI by source folder.
11. **Query TMDB first, OMDb by id second** in `AutoMatcherService.search_and_match`; add `/tv/{id}/season/{s}` validation for episodes and compare `media_duration_ms` to the provider runtime.
12. **Persist proposed paths once** (at process time and on classification change) instead of recomputing with NAS I/O on every `GET`.
13. **Fix `is_manual_assignment`** to be set by the endpoint that received the human action, not by the search source string.
14. Add the §4.2 table as parametrized tests in `tests/test_filename_parser.py`.

Items 1–6 alone would move most of the current 25K-row backlog from "needs review with no explanation" to either auto-organized (id-tagged folders, exact title+year with margin) or "needs review with the right top candidate pre-selected".
