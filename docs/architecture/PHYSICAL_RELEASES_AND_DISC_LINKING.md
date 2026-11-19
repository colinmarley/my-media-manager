# Physical releases, multi-disc sets and disc-to-file linking

Status: phases 1 and 2 (backend) are built; phases 3 to 5 (phone, web, ripper) are not.
See "Phase 1 as built" and "Phase 2 as built" at the end for what differs from the proposal.
Covers `my-media-manager` (backend + web), `media-manager-mobile` and the disc-ripper link step.

## Goal

Catalogue the whole physical collection from the phone, link each item to the library
files that already exist, and at any time answer four questions:

1. How many discs have files, and how many do not?
2. How many files have a disc, and how many do not?
3. Which sets are only partly ripped?
4. Which of the "missing" ones are fine to leave (bonus discs, the DVD in a combo pack, downloads)?

## What exists today (checked against `origin/refactor` and the live DB)

| Area | State |
|---|---|
| Titles | `movies` (956), `series` (82). `seasons` and `episodes` tables are empty; season and episode numbers live on `media_files`. |
| Files | `media_files` (10,843). 10,232 library files carry `movie_id` or `series_id`, plus `role` (main / version / extra / episode / other). |
| Discs | `discs` (3 test rows). Barcode, edition, format, disc number, storage location are per disc. |
| Sets | `disc_sets` has `id` and `title` only. `discs.set_id` and `tapes.set_id` point at it. 0 rows. |
| Disc → title | `disc_media_links` (disc, `movie`/`series`, id). No season, volume or episode scope. |
| Disc → file | `media_files.disc_id`. Set by the ripper's `POST /catalog/link-source` (opt-in panel) or by hand on the web, one search at a time. 0 rows set. |
| Releases | The old `releases` tables were empty and unused and were dropped in migration `6f7a8b9c0d1e`. `discs.release_id` is a dead column. |
| Coverage | Web To-Do lists `unripped_disc` (disc with no file) and `no_disc_link` (title has a disc, none of its main files name one). Mobile Stats shows % of discs ripped. No count of files without a disc, no per-set completeness, no "leave it" flag. |
| Phone | Adds discs, sets and disc → title links. Cannot link files; rip status is read-only. |

Three gaps follow from this:

- **No release level.** The thing that was bought (one barcode, one case, N discs, M titles) has nowhere to live. The duplicate-barcode check is per disc (`_reject_duplicate_barcode`), so the barcode has to move up a level before a two-disc set can carry it.
- **No scope on title links.** "Seinfeld Season 3, Disc 2" can only say "Seinfeld".
- **Linking does not scale.** About 2,000 discs against about 10,000 existing files cannot be done by filename search.

## Proposed model

```
release (the thing you bought)          -- extends disc_sets
  ├─ release_contents  → movie | series [+ season] [+ episode range]
  └─ discs (1..N)                       -- discs.set_id, every disc has one
        ├─ disc_media_links → movie | series [+ season] [+ episode range]
        └─ media_files.disc_id          -- exact disc, when known
media_files.release_id                  -- release, when the disc is not known
```

### Release = `disc_sets`, extended

Extend the existing table instead of adding a parallel one, so `set_id` on discs and tapes
and the mobile app's `/disc-sets` calls keep working. The UI calls it a **release**.

New columns on `disc_sets`:

| Column | Notes |
|---|---|
| `barcode` | UPC/EAN. Not unique: owning two copies is allowed after a confirm. |
| `edition` | "Special Edition", "Steelbook", "Criterion". |
| `packaging` | `case`, `box_set`, `combo_pack`, `loose`. `loose` marks a release created automatically for a disc with no case. |
| `publisher`, `release_year`, `region_code` | Optional. |
| `expected_disc_count` | Lets a set be flagged incomplete when a disc was never scanned in. |
| `storage_type`, `storage_id` | Where the case is. Discs keep their own location, since most discs sit in binders. |
| `image_files`, `purchase_date`, `condition`, `notes`, `raw_data` | Same shape as discs. |

Every disc belongs to a release. A loose disc gets a one-disc `loose` release created for
it, so the phone flow stays one step. Two loose discs can later be merged into one release.

### `release_contents` (new)

What the release contains. One row per title, or per season of a series.

| Column | Notes |
|---|---|
| `id` | Surrogate key. |
| `release_id` | FK `disc_sets`, cascade. |
| `media_type`, `media_id` | `movie` or `series`, same ids as `disc_media_links`. |
| `season_number` | Null for a movie or a complete series. |
| `episode_start`, `episode_end` | Null unless the release is a volume ("Volume 2: episodes 7-12"). |

Examples:

- Double feature: two `movie` rows.
- "Season 3": one row, `season_number = 3`.
- "Complete Series": one row, no season.
- "Seasons 1-3": three rows.
- Two different releases of one movie: two releases, each with one row for that movie.

### Discs

- Backfill `set_id` for every disc (one `loose` release each).
- `content_role`: `feature`, `episodes`, `bonus`, `duplicate_format`, `other`.
- `rip_intent`: `rip` (default) or `skip`, with `rip_skip_reason`. A skipped disc never counts as missing. Default to `skip` for `duplicate_format`.
- `disc_media_links` gains `season_number`, `episode_start`, `episode_end`. The key becomes a surrogate id with a unique index on (disc, type, id, season). Optional per disc: it fills in as discs are ripped, because the TV track mapper (`disc_track_mapper.py`) already knows which episodes a disc holds.
- Format stays per disc, which is what makes a Blu-ray + DVD combo two discs in one release.

### Files

- `media_files.release_id` (FK `disc_sets`, set null). Rule: when `disc_id` is set, `release_id` is that disc's release.
- `media_files.source_kind`: `disc`, `tape`, `digital`, `unknown` (default). `digital` takes a download out of the "no disc" count for good.

**Existing files link to the release; new rips link to the exact disc.** For a file already
in the library there is usually no way to know which of four discs an episode came from,
and asking would stall the cataloguing session. The exact disc is filled in for free when a
disc goes through the ripper.

## Coverage

All derived, nothing stored. Counted over `main` and `episode` files by default, with
`version` and `extra` reported separately so 2,000 extras do not swamp the numbers.

**Disc**

| State | Rule |
|---|---|
| Ripped | At least one file has this `disc_id`. |
| Covered | No file names the disc, but its release has linked files for the titles this disc holds (or the disc's contents are unknown and the release has files). |
| Not ripped | Neither of the above, `rip_intent = rip`. |
| Skipped | `rip_intent = skip`. |

**Release**

| State | Rule |
|---|---|
| Complete | Every content row has files: the main file for a movie; for a season, as many episodes as TMDB lists (`series.tmdb_data`), or at least one when the count is unknown. |
| Partial | Some content rows have files, or a season is short. |
| None | No linked files. |
| Incomplete set | Fewer discs catalogued than `expected_disc_count`. |

**File**

| State | Rule |
|---|---|
| Linked to disc | `disc_id` set. |
| Linked to release | `release_id` set, `disc_id` null. |
| Suggested | Unlinked, and a release exists whose contents match the file's title and season. |
| No source catalogued | Unlinked, no matching release. |
| Not physical | `source_kind` is `digital` or `tape`. |

**Endpoint:** `GET /api/catalog/coverage` returns the counts for discs, releases, files and
titles (titles with both, files only, discs only). The same service feeds the mobile Stats
tiles, the web Home page and the To-Do builders:

- `unripped_disc` ignores skipped and covered discs.
- `no_disc_link` treats a `release_id` as a link.
- New `partial_release` and `incomplete_set` kinds.

## Linking at scale

**Suggestions.** `GET /api/catalog/releases/{id}/file-suggestions` returns, per content row,
the unlinked library files with the same `movie_id`, or `series_id` and season. Each carries
a fit flag from the technical columns the inventory scan already fills:

| Disc format | Fits when file height is |
|---|---|
| DVD | 576 or less |
| Blu-ray | 720 to 1080 |
| 4K UHD | 2160 |

A mismatch (a 1080p file against a DVD-only release) is shown but not pre-ticked.

**Apply.** `POST /api/catalog/releases/{id}/link-files` with `{ fileIds, discId? }` sets
`release_id` (and `disc_id` when given) in one transaction. Nothing is linked without a
person confirming it.

**Bulk review (web).** One page listing every release with fitting suggestions, so a batch
catalogued on the phone can be confirmed in one pass afterwards.

## Phone flow

1. **Identify.** Scan the barcode, scan the cover, or search a title (all exist). A barcode that matches an existing release offers "open it" or "add another copy".
2. **What is it.** Confirm the titles and pick a scope per title: Movie, Complete series, Seasons (number chips), or Volume.
3. **What is in the case.** Pick a template; the app creates the discs:
   - Single disc
   - Blu-ray + DVD (DVD pre-set to skip)
   - 4K + Blu-ray
   - N discs of one format (season sets), with an optional bonus disc
   - Loose disc: title, format and location only
4. **Files found.** The suggestions for this release, fitting ones pre-ticked. One tap confirms; "None of these" leaves it not ripped.
5. **Save & add another.** Keeps format, location and template for the next item.

`POST /api/catalog/releases` takes the release, its contents and its discs in one request,
so the save is atomic and the offline outbox has one step to replay instead of three. File
suggestions need the server, so an item added offline shows up in the bulk review later.

The Stats tab shows the coverage counts and a running "today: N added, N linked" line.
Each count opens the matching list.

## Ripper

- The link panel picks a release, then a disc, and defaults to the disc whose barcode was scanned.
- `link-source` also sets `release_id` and `source_kind = disc`.
- After a TV disc is mapped, write the episode range to that disc's `disc_media_links` row.

## Build order

| Phase | Work | Repo |
|---|---|---|
| 0 | Delete the 3 test discs. Build an installable Android APK and run the open real-phone test pass (barcode, cover scan, offline). | mobile |
| 1 | Migration (next id after `ad1e2f3a4b5c`; check `origin/refactor` first): `disc_sets` columns, `release_contents`, disc and file columns, backfill. Release CRUD with nested create. Keep `/disc-sets` working. | backend |
| 2 | Coverage service and endpoint, file suggestions, bulk link, To-Do builder changes. | backend |
| 3 | New add flow, Files found step, coverage on Stats, release on the detail screen. | mobile |
| 4 | Release page, bulk suggestion review, coverage tiles on Home. | web |
| 5 | Release-aware ripper linking, disc contents from the track mapper. | web + ripper |

Phases 1 to 3 are enough to start cataloguing. Things to watch:

- `PUT /discs/{id}` stores the request body as `raw_data`, so each new disc field needs a real column and an entry in `_apply_disc_fields`, and the phone must keep sending full records.
- Mobile types are hand-ported (`src/types/catalog.ts`); update them with the API.

## Open questions

1. **Name.** "Release" in the UI, table stays `disc_sets`? Or rename the table too (touches the mobile API).
2. **Extras.** Should extras count toward file coverage, or only main features and episodes (the proposal)?
3. **Second copies.** Allow the same barcode twice after a confirm (the proposal), or keep one release with a copy count?
4. **The 611 unattached files.** Assign or flag them first, or leave them out of coverage until they have a title?
5. **Tapes.** They already share `disc_sets`. Same release treatment now, or discs first?

## Phase 1 as built

Migration `ae2f3a4b5c6d` (after `ad1e2f3a4b5c`). Endpoints, all under `/api/catalog`:

| Endpoint | Notes |
|---|---|
| `GET /releases` | `title`, `barcode`, `include_loose` filters. Each row has `discCount` and `linkedFileCount`. |
| `GET /releases/{id}` | The release with `contents`, `discs` (each with `linkedFileCount`) and its own `linkedFileCount`. |
| `POST /releases` | Release, contents and discs in one transaction. `?check_duplicates=true` returns 409 `duplicate_barcode` unless the body has `allowDuplicateBarcode`. |
| `PUT /releases/{id}` | Changes only the keys sent. `contents`, when sent, replaces the list. |
| `DELETE /releases/{id}` | 409 `release_not_empty` while discs or tapes remain. |
| `PATCH /media-files/{id}/link` | Also takes `releaseId` and `sourceKind`. A `discId` always sets the disc's release. |
| `POST /discs/{id}/links` | Also takes `seasonNumber`, `episodeStart`, `episodeEnd`. |

Behaviour that existing clients see (pinned by `backend/tests/test_release_client_flows.py`):

- A loose release never appears as a set. A disc saved without `setId` gets a `loose` release in the
  `set_id` column only; its record still has no `setId`, so the phone app shows no "Boxed set" section
  and pre-selects no set. Every disc DTO has `releaseId` (always set) for clients that know about releases.
- Saving a loose disc again keeps its release, whatever the client sends for "no set" (key left out,
  `null` or `""`). The loose release mirrors the disc's title, barcode and edition.
- A replace that leaves `setId` out keeps a real set (the web edit dialog used to drop the disc from its
  set this way). An explicit `null` takes the disc out and gives it a new loose release.
- A loose release is deleted when its disc joins another release or is deleted. Its files follow the disc.
- `releaseId` and `linkedFileCount` echoed back in a disc body are ignored, not stored.
- `GET /disc-sets` leaves loose releases out. `packaging: "loose"` cannot be chosen through the API, and
  a loose release is edited through its disc (`PUT /releases/{id}` returns 409 unless it sends a packaging).
- `GET /discs/search?barcode=` also finds discs through their release's barcode.
- File DTOs gain `releaseId` and `sourceKind`; disc link DTOs gain the three scope keys.
- A single-disc release made through `POST /releases` does carry `setId`, so the current phone app
  shows it as a boxed set with no other discs until phase 3 teaches it about releases.

Differences from the proposal:

- `disc_media_links` keeps its (disc, type, id) key. The scope columns are plain nullable columns, so one disc cannot yet link the same series twice with two seasons. Change the key if a disc spanning seasons turns up.
- Tapes are untouched: no loose releases and no `releaseId` on tape links (open question 5).
- `discs.barcode` is kept. Discs created through `POST /releases` leave it empty; the barcode is on the release.

## Phase 2 as built

Everything is derived on request by `backend/services/release_coverage.py`; nothing is stored.
At 10,000 files and 2,000 discs each endpoint answers in about 0.3 s.

| Endpoint | Notes |
|---|---|
| `GET /coverage` | Counts for discs (ripped / covered / unripped / skipped, and `done`), releases (complete / partial / none / skipped, plus `loose` and `incompleteSets`), files (linkedDisc / linkedRelease / suggested / noSource / notPhysical), `otherFiles` and `titles`. |
| `GET /releases/{id}/file-suggestions` | Per title the release holds: the unlinked main files, versions and episodes, each with `fit` and `preselected`, plus `have` / `expected` / `satisfied`. |
| `POST /releases/{id}/link-files` | `{fileIds, discId?}` in one transaction. All ids must exist or nothing is linked. |
| `GET /release-suggestions` | Releases that have candidates, most pre-selected first: the list for the bulk review page. |

Rules worth knowing:

- **What a release holds** is its `release_contents`; when it has none, the title links of its discs. That is
  what makes suggestions work for discs added with the current phone app, which links titles to discs.
- **Counted files** are main files of movies and episodes of series that are still on disk. Versions,
  extras and unassigned files are in `otherFiles`.
- **Covered disc**: no file names it, but its release has linked files of the titles it holds (any linked
  file, when the disc says nothing about what it holds).
- **Complete season**: as many distinct episodes linked as TMDB lists for that season
  (`series.tmdb_data.seasons`), or the size of the episode range. When the count is not known, one episode
  is enough. Run a TMDB refresh on a series whose seasons show as complete too early.
- **Fit** compares resolution tiers, by width as well as height (a Blu-ray rip cropped to 1920x800 is HD):
  DVD and LaserDisc are SD, Blu-ray and HD DVD are HD, 4K is UHD. Only discs meant to be ripped count, so
  the DVD of a combo pack does not make an SD file fit. A file never probed has `fit: unknown` and is
  pre-selected only when nothing is known to fit.
- **Downloads and tapes** (`sourceKind` `digital` or `tape`) are never suggested and never ask for a disc.

To-Do list (`services/attention_service.py`):

- `unripped_disc` no longer lists skipped discs or discs covered by their release.
- `no_disc_link` treats a file linked to a release as linked, and ignores downloads.
- The proposed `partial_release` and `incomplete_set` kinds are not added yet: the web To-Do page has a
  fixed list of kinds, so they come with the web work (phase 4). Both are already in `GET /coverage`
  and in each release's `state`.
