# Firebase Model Improvements

This document tracks proposed improvements to the Firestore data models.
It covers fields to add, remove, rename, or retype across all collections,
plus cross-cutting structural recommendations.

Current model files live in `src/types/firebase/`.

---

## Status Key

- `[ ]` Not started
- `[x]` Done
- `[-]` Deferred / out of scope

---

## Cross-Cutting Changes

These apply to every top-level document and should be done first.

| # | Change | Status |
|---|--------|--------|
| 1 | Add `createdAt: Timestamp` and `updatedAt: Timestamp` to every top-level type | `[ ]` |
| 2 | Add `titleLower: string` to every title-bearing type (currently only Movie via `prepareTitleForStorage`) | `[ ]` |
| 3 | Replace raw `omdbData: OmdbResponseFull` blobs with `externalIds: { imdbId?: string; tmdbId?: number; tvdbId?: number }` on Movie, Series, Season, Episode — fetch raw data on demand, never persist it | `[ ]` |
| 4 | Normalise `language: string` → `languages: string[]` across all types that currently use a single string | `[ ]` |
| 5 | Normalise `countryOfOrigin: string` → `countries: string[]` across all types (films and series regularly have multiple co-producing countries) | `[ ]` |
| 6 | Convert free-text enum fields (`mediaType`, `discTypes`) to TypeScript union types to catch misspellings at compile time | `[ ]` |
| 7 | Ensure consistent cast shape across all types — replace bare `string[]` cast/actor fields with a shared `CastEntry` (actor name + character name) | `[ ]` |

---

## FBMovie

File: `src/types/firebase/FBMovie.type.ts`

### Remove

| Field | Reason |
|-------|--------|
| `omdbData: OmdbResponseFull` | Raw API blob creates sync debt; useful data is already mapped to first-class fields. Store only `externalIds.imdbId` instead. |
| `releases: FBRelease[]` | Embedding full release objects causes duplication and sync drift. Releases reference movies by `movieId`; the inverse should be `releaseIds: string[]`. |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `releaseIds` | `string[]` | Replaces embedded `releases` array |
| `imdbId` | `string` | Promote from `externalIds.imdbId` to a top-level field; keep `externalIds` for TMDB/TVDB extensibility |
| `plot` | `string` | Synopsis; available from OMDB, useful for in-app display without a re-fetch |
| `certification` | `string` | e.g. `"PG-13"`, `"R"` — already in the Movie collection type but missing from FBMovie |
| `imdbRating` | `string` | OMDB `imdbRating` value |
| `rottenTomatoesScore` | `string \| null` | Parsed from OMDB `Ratings` array |
| `awards` | `string` | OMDB `Awards` string; useful for display |
| `boxOffice` | `string \| null` | OMDB `BoxOffice`; interesting metadata for movie buffs |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `countryOfOrigin` | `string` | `string[]` | Co-productions; aligns with Movie collection type `countries` |
| `language` | `string` | `string[]` | Multiple audio languages |
| `topCast` | `TopCastEntry[]` | `CastEntry[]` (shared type) | Standardise across all media types |

---

## FBSeries

File: `src/types/firebase/FBSeries.type.ts`

### Remove

| Field | Reason |
|-------|--------|
| `omdbData: OmdbResponseFull` | Same raw blob issue as FBMovie |
| `releases: FBRelease[]` | Same embedding issue; replace with `releaseIds: string[]` |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `releaseIds` | `string[]` | Replaces embedded releases |
| `plot` | `string` | Series synopsis |
| `status` | `'Continuing' \| 'Ended' \| 'Cancelled' \| 'Upcoming'` | Whether the series is still running — critical display metadata |
| `totalSeasons` | `number` | From OMDB `TotalSeasons`; useful for progress display |
| `network` | `string` | Broadcast or streaming network (e.g. HBO, Netflix) |
| `contentRating` | `string` | TV-MA, TV-14, etc. |
| `awards` | `string` | OMDB Awards string |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `countryOfOrigin` | `string` | `string[]` | Co-productions |
| `language` | `string` | `string[]` | Multiple audio languages |
| `topCast` | `string[]` | `CastEntry[]` | Add character names; standardise with Movie |
| `imdbID` | `string` (top-level) | Move into `externalIds: { imdbId, tmdbId, tvdbId }` | Extensibility |

---

## FBSeason

File: `src/types/firebase/FBSeason.type.ts`

### Remove

| Field | Reason |
|-------|--------|
| `omdbData: OmdbResponseFull` | Seasons often have no OMDB entry; storing a null blob for every season is wasteful |
| `releases: string[]` | Always assigned `[]` in the submit code; never populated. Replace with `releaseIds?: string[]` if needed, or remove entirely |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `plot` | `string` | Season synopsis (available from OMDB series+season endpoint) |
| `status` | `'Aired' \| 'Upcoming' \| 'Partial'` | Airdate status for the season |
| `episodeCount` | `number` | Denormalised from `episodes.length`; enables queries and display without loading the episodes array |
| `posterUrl` | `string` | Quick-access season poster URL, distinct from scanning `imageFiles` |
| `collectionIds` | `string[]` | Present on Series and Episode but missing from Season — seasons can be in boxsets |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `language` | `string` | `string[]` | Multiple languages |
| `topCast` | `string[]` | `CastEntry[]` | Standardise |

### Note on nested episodes

`episodes: Episode[]` works for typical seasons (≤ 26 episodes), but for daily soaps or procedurals with 100+ episodes this will hit Firestore's 1 MB document limit. If any series in the library has very long seasons, migrate episodes to a subcollection.

---

## FBEpisode

File: `src/types/firebase/FBEpisode.type.ts`

### Remove

| Field | Reason |
|-------|--------|
| `omdbData: OmdbResponseFull` | Individual episode OMDB lookups are unreliable and often return no result; the blob should not be persisted |
| `releases: FBRelease[]` | Episodes almost never have standalone physical releases; if needed use `releaseIds?: string[]` |
| `actors: string[]` | Duplicates `topCast`; consolidate into one cast field |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `seasonNumber` | `number` | Denormalised for efficient queries ("all S3 episodes") without joining to the Season document |
| `seriesTitle` | `string` | Denormalised title reference for display without a join |
| `synopsis` | `string` | Episode plot summary |
| `thumbnailUrl` | `string \| null` | Episode thumbnail for list views |
| `airDate` | `string` | Rename `releaseDate` to `airDate` — conventional term for TV episodes |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `episodeNumber` | `string` | `number` | Numeric comparisons (next/prev episode) require a number |
| `language` | `string` | `string[]` | Consistency |
| `topCast` | `string[]` | `CastEntry[]` | Standardise |
| `isPartOfCollection` | `boolean` | `boolean` (optional `?`) | Edge case on individual episodes; should be optional |

---

## FBDisc

File: `src/types/firebase/FBDisc.type.ts`

### Remove

| Field | Reason |
|-------|--------|
| `genre?: string` | Genre belongs to the linked media (movie/series), not to the physical disc |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `format` | `'DVD' \| 'BLURAY' \| 'HD_DVD' \| 'UHD_BLURAY' \| 'LASERDISC'` | The disc format — currently only accessible via the individual `VideoFile` entries |
| `discNumber` | `number \| null` | Which disc in a set (Disc 1 of 3); complements `isPartOfSet` |
| `setId` | `string \| null` | Foreign key to a parent disc-set document so multi-disc sets can be queried together |
| `barcode` | `string \| null` | Physical barcode for library management |
| `purchaseDate` | `string \| null` | When the disc was acquired |
| `condition` | `'Mint' \| 'Good' \| 'Fair' \| 'Poor' \| null` | Physical condition for insurance and resale tracking |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `resourceId?: string` | `string \| undefined` | `mediaId: string; mediaType: 'movie' \| 'series' \| 'season'` | `resourceId` is too vague; split into typed reference |

---

## FBRelease

File: `src/types/firebase/FBRelease.type.ts`

### Remove / Optional

| Field | Reason |
|-------|--------|
| `episodeIds?: EpisodeInfoSmall[]` | Releases at the individual episode level are extremely rare; make this truly optional and document the use case |
| `year: number` | Can be derived from the linked media's release year; if kept, document what it represents (release year of this edition vs. original film year) |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `edition` | `string` | **Most important missing field** — e.g. `"Director's Cut"`, `"Theatrical"`, `"Criterion Collection"`, `"Limited Edition"`, `"Steelbook"` |
| `publisher` | `string` | The label that released this edition (Criterion, Arrow, Kino Lorber, etc.) |
| `territory` | `string` | Which country/region this release is from (distinct from disc region code) |
| `releaseDate` | `string \| null` | Street date of this specific release (vs. the film's original release year) |
| `spineNumber` | `string \| null` | Spine/catalogue number (critical for Criterion and similar curated labels) |
| `outOfPrint` | `boolean` | Whether this edition is still commercially available |
| `upc` | `string \| null` | UPC barcode for this release |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `mediaType` | `string` | `'MOVIE' \| 'SERIES' \| 'SEASON' \| 'DOUBLE_FEATURE'` | Catch typos at compile time |
| `discTypes` | `string[]` | `Array<'DVD' \| 'BLURAY' \| 'HD_DVD' \| 'UHD_BLURAY'>` | Same reason |

---

## FBCollection

File: `src/types/firebase/FBCollection.type.ts`

### Fix

| Field | Issue |
|-------|-------|
| `imageFiles: string[]` | Typed as bare `string[]` while every other type uses `ImageFile[]` objects with metadata — should be `ImageFile[]` for consistency |

### Add

| Field | Type | Notes |
|-------|------|-------|
| `type` | `'Director' \| 'Franchise' \| 'Thematic' \| 'Boxset' \| 'Custom'` | Distinguish a director filmography from a franchise (MCU) from a curated list |
| `sortOrder` | `Record<string, number>` | Map of media IDs → position; controls display order of entries in the collection |
| `startYear` | `number \| null` | Earliest year of content in the collection |
| `endYear` | `number \| null` | Latest year of content (null = ongoing) |
| `entryCount` | `number` | Denormalised total count for display without loading all ID arrays |
| `coverMediaId` | `string \| null` | Which item's artwork to use as the collection cover image |

---

## FBDirector

File: `src/types/firebase/FBDirector.type.ts`

### Add

| Field | Type | Notes |
|-------|------|-------|
| `nationality` | `string` | Distinct from birthplace; useful for browsing and filtering |
| `deathDate` | `string \| null` | For deceased directors |
| `biography` | `string` | Replace the free-form `notes` field with an explicit biography field |
| `externalIds` | `{ imdbId?: string; tmdbId?: number }` | Cross-reference with OMDB/TMDB for linking and enrichment |
| `episodeIds` | `string[]` | Directors direct individual episodes; currently only `movieIds` and `seriesIds` exist |
| `seasonIds` | `string[]` | Some directors are closely associated with specific seasons |

### Retype

| Field | From | To | Reason |
|-------|------|----|--------|
| `awards: string[]` | Loose array (currently typed as `[]`) | `Award[]` with `{ title: string; year: number; category: string }` | Structured award data is more queryable than a raw string |
| `notes` | `string` | Deprecate in favour of `biography: string` | More descriptive field name |

---

## Shared / New Types Needed

These new shared types should be added to `FBCommon.type.ts` or a new `FBShared.type.ts`.

```typescript
// Replaces bare string[] cast across all media types
export interface CastEntry {
  actorName: string;
  characterName?: string;
  actorId?: string; // Reference to a future FBActor document
}

// Structured award entry for Director and optionally Movie/Series
export interface Award {
  title: string;      // e.g. "Academy Award for Best Director"
  year: number;
  category: string;   // e.g. "Best Director"
  result: 'Won' | 'Nominated';
}

// Unified external IDs block for cross-referencing
export interface ExternalIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
}

// Audit timestamps — add to every top-level document
export interface AuditFields {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Disc/release format enum equivalents
export type DiscFormat = 'DVD' | 'BLURAY' | 'HD_DVD' | 'UHD_BLURAY' | 'LASERDISC';
export type MediaType = 'MOVIE' | 'SERIES' | 'SEASON' | 'DOUBLE_FEATURE';
```

---

## Field Tooltip Task

As part of the Admin Forms UX improvement, all field inputs should display a contextual help tooltip on hover/focus. This ensures users understand what each field expects without needing external documentation.

### Requirements

- Every `TextField`, `Checkbox`, `FileInput`, and repeater row in all Admin forms should have an `inputProps` tooltip or an adjacent `InfoIconButton` that shows a `Tooltip` with a short help string.
- Tooltip content should be defined close to the field (not in a separate config file) for maintainability.
- For required fields, the tooltip should note that the field is required and why it matters.
- For format-constrained fields (e.g. `runtime: h:mm:ss`, `releaseDate: DD-MMM-YYYY`), the tooltip should show the expected format with an example.
- For ID fields (e.g. `seriesId`, `seasonId`), the tooltip should explain where to find the ID.
- Checkboxes should have a tooltip on the label explaining the effect of checking the box.

### Implementation Approach

1. Create a shared `InfoTooltip` component in `src/app/admin/_components/forms/common/` that wraps MUI `Tooltip` + `InfoOutlined` icon.
2. Add `helperText` with a secondary description line to fields where format guidance is needed.
3. For complex fields (nested editors, file pickers), place the `InfoTooltip` next to the section heading in the `FormSection` title area.

### Forms to Update

| Form | Status |
|------|--------|
| MovieForm | `[ ]` |
| SeriesForm | `[ ]` |
| SeasonForm | `[ ]` |
| EpisodeForm | `[ ]` |
| DiscForm | `[ ]` |
| ReleaseForm | `[ ]` |
| CollectionForm | `[ ]` |

### Per-Form Field Tooltip Content Placeholders

These should be filled in before implementation begins.

#### MovieForm
| Field | Tooltip |
|-------|---------|
| Title | Required. The official release title of the movie. |
| Release Date | Format: DD-MMM-YYYY (e.g. 15-Mar-2001). Use the original theatrical release date. |
| Runtime | Format: h:mm:ss (e.g. 2:18:00). Include credits. |
| Country | The primary country or countries of production. |
| Certification | MPAA rating: G, PG, PG-13, R, NC-17. |
| Plot | A short synopsis (1–3 sentences). Imported automatically from OMDB on search. |
| Genres | Comma-separated list. Imported from OMDB, can be edited. |
| Languages | Audio languages available in this release. |
| Letterboxd Link | Optional. Paste the full URL from letterboxd.com/film/... |
| Plex Link | Optional. Your Plex server's URL for this movie. |
| IMDB ID | Auto-filled after OMDB search. Format: tt followed by 7 digits (e.g. tt0120338). |

#### SeriesForm
| Field | Tooltip |
|-------|---------|
| Title | Required. The official series title. Include year in parentheses if disambiguation is needed. |
| Running Dates | Format: YYYY–YYYY (e.g. 2011–2019). Use a single year if still running (e.g. 2019–). |
| Runtime | Average episode runtime in h:mm:ss format. |
| Status | Whether the series is currently airing, ended, or cancelled. |
| Country of Origin | Primary country or countries of production. |
| Region Code | Disc region for the primary release (e.g. A, B, 1, 2). |
| Seasons | Add each season with its episodes inline. Season numbers must be unique. |

#### SeasonForm
| Field | Tooltip |
|-------|---------|
| Series ID | Required. The Firestore document ID of the parent series. Find it in the Series list. |
| Season Number | Required. The season's broadcast order number. Must be unique within the series. |
| Release Date | The premiere date of this season. Format: DD-MMM-YYYY. |
| Episode Count | Auto-calculated from the episodes added below. |
| Episodes | Add each episode in broadcast order. Episode numbers must be unique within this season. |

#### EpisodeForm
| Field | Tooltip |
|-------|---------|
| Series ID | Required. The Firestore document ID of the parent series. |
| Season ID | Required. The Firestore document ID of the parent season. |
| Episode Number | Required. Must be a whole number unique within the season. |
| Air Date | The original broadcast or streaming release date. Format: DD-MMM-YYYY. |
| Runtime | This episode's specific runtime in h:mm:ss format. |
| Notes | Internal production or editorial notes. Not shown to end users. |
| Is Part of Collection | Check if this episode is included in a standalone compilation or boxset. |

#### DiscForm
| Field | Tooltip |
|-------|---------|
| Title | Required. Label the disc clearly, e.g. "The Lord of the Rings: The Fellowship of the Ring (Disc 1)". |
| Resource ID | Optional. Link this disc to a Movie or Series document by its Firestore ID. |
| Is Part of Set | Check if this disc is one in a multi-disc set (e.g. a trilogy box set). |
| Is Rental Disc | Check if this is a rental copy. Affects how it appears in your library. |
| Contains Special Features | Check if this disc includes bonus content or featurettes. |
| Video Files | Select video files stored on your local filesystem for this disc. |
| Image Files | Select cover art or scan images for this disc. |
| Region Code | Physical disc region code (e.g. 1 for North America, 2 for Europe). |

#### ReleaseForm
| Field | Tooltip |
|-------|---------|
| Title | Required. The name of this release edition, e.g. "Criterion Collection #42". |
| Year | The year this specific edition was released (may differ from the film's original release year). |
| Media Type | The type of media content: MOVIE, SERIES, SEASON, or DOUBLE_FEATURE. |
| Contains Extras | Check if this release includes bonus features or supplementary content. |
| Contains Inserts | Check if the physical release includes printed inserts, booklets, or posters. |
| Disc IDs | Add the Firestore IDs of every disc in this release. Find them in the Disc list. |
| Disc Types | The physical format of each disc in this release (DVD, BLURAY, etc.). |
| Movie IDs | Comma-separated Firestore IDs of movies included in this release. |
| Extras | Bonus features included on this release. Add title, runtime and type for each. |

#### CollectionForm
| Field | Tooltip |
|-------|---------|
| Title | Required. A descriptive name for the collection (e.g. "Christopher Nolan Filmography", "MCU Phase 1"). |
| Description | A brief explanation of what this collection represents and how items were curated. |
| Genres | Primary genres that describe the collection as a whole. |
| Directors | Directors whose work is featured in this collection. |
| Movie IDs | Firestore IDs of movies to include. Comma-separated. |
| Series IDs | Firestore IDs of series to include. Comma-separated. |
| Season IDs | Firestore IDs of seasons to include. Comma-separated. |
| Episode IDs | Firestore IDs of episodes to include. Comma-separated. |
