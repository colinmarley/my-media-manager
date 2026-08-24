# Admin Forms Revamp Implementation Plan

## 1. Goals

Revamp all Admin forms so they are:

- Easier to complete quickly and correctly
- Structured into logical sections
- Using the best input type for each field
- Supporting parent-child data entry directly in parent forms
- Using robust, testable validation
- Fully covered by unit tests

Scope in this plan covers these current forms:

- [src/app/admin/_components/MovieForm.tsx](src/app/admin/_components/MovieForm.tsx)
- [src/app/admin/_components/SeriesForm.tsx](src/app/admin/_components/SeriesForm.tsx)
- [src/app/admin/_components/SeasonForm.tsx](src/app/admin/_components/SeasonForm.tsx)
- [src/app/admin/_components/EpisodeForm.tsx](src/app/admin/_components/EpisodeForm.tsx)
- [src/app/admin/_components/DiscForm.tsx](src/app/admin/_components/DiscForm.tsx)
- [src/app/admin/_components/ReleaseForm.tsx](src/app/admin/_components/ReleaseForm.tsx)
- [src/app/admin/_components/CollectionForm.tsx](src/app/admin/_components/CollectionForm.tsx)


## 2. Current State Findings

### 2.1 UX and structure

- Forms are mostly long single stacks of fields without clear section boundaries.
- Related fields are often split by implementation details, not user workflow.
- Several forms still rely on comma-separated text inputs for list fields where chips/autocomplete/repeaters are better.
- Parent-child entities (Series -> Seasons -> Episodes) are split across separate forms and cannot be authored inline in one pass.

### 2.2 Validation

Current hooks exist:

- [src/utils/useMovieValidation.ts](src/utils/useMovieValidation.ts)
- [src/utils/useSeriesValidation.ts](src/utils/useSeriesValidation.ts)
- [src/utils/useSeasonValidation.ts](src/utils/useSeasonValidation.ts)
- [src/utils/useEpisodeValidation.ts](src/utils/useEpisodeValidation.ts)
- [src/utils/useDiscValidation.ts](src/utils/useDiscValidation.ts)
- [src/utils/useReleaseValidation.ts](src/utils/useReleaseValidation.ts)
- [src/utils/useCollectionValidation.ts](src/utils/useCollectionValidation.ts)

Gaps:

- Validation return shape is inconsistent (string vs string array).
- Async checks in movie validation are not awaited deterministically.
- Type definitions and validation expectations are sometimes mismatched.
- Cross-field validation is minimal.

### 2.3 Test setup

- Existing tests are minimal and not form-focused:
  - [tests/components/MediaAssignment.test.ts](tests/components/MediaAssignment.test.ts)
  - [tests/utils/titleUtils.test.ts](tests/utils/titleUtils.test.ts)
- No test script currently in [package.json](package.json).


## 3. Revamp Principles

### 3.1 Form architecture

- Every form should be split into reusable section components.
- Use a consistent section order:
  1. Identity
  2. Metadata
  3. Credits
  4. Relationships
  5. Media Assets
  6. External Links
  7. Advanced/Optional

### 3.2 Input strategy

- Use the narrowest valid input type for each field.
- Avoid free-text IDs when a reference selector is possible.
- Replace comma-separated text with chips/autocomplete/repeaters.

### 3.3 Validation strategy

- Standardize on a shared result shape:
  - fieldErrors map
  - formErrors list
- Add schema-level validation for each form model.
- Keep field-level inline validations for immediate feedback.


## 4. Recommended Input Types By Domain

## 4.1 Identity and base metadata

- Title: text input, required, max length, trimmed
- Year: numeric input with min and max constraints
- Runtime:
  - Movie and episode: duration input with format helper
  - Use one canonical stored format and parse/format helpers
- Release date: date picker, not plain text
- Notes/description: multiline textarea with max length

## 4.2 Multi-value text fields

- Genres, languages, subtitles, writers, top cast:
  - Autocomplete with free-solo chips
  - Optional curated options list where enums exist

## 4.3 Boolean flags

- Keep checkboxes/switches for booleans such as:
  - Is part of collection
  - Contains extras/inserts
  - Is rental disc

## 4.4 Relationship fields

- Replace manual ID fields with entity selectors:
  - Single relation: searchable autocomplete
  - Multi relation: chips autocomplete
- Show both title and ID in selector options for clarity

## 4.5 File and image fields

- For uploaded local files, use explicit file upload controls.
- For image URL search/manual URL, use dedicated image picker section.
- Validate file type and size client side before submit.


## 5. Parent-Child Inline Authoring Design

### 5.1 Series form

Add nested season editor directly inside Series form:

- Section: Seasons
- Add Season button opens inline card/dialog editor
- Per-season fields:
  - Season number
  - Season title
  - Release year/date
  - Optional notes

Inside each Season editor, add Episode repeater:

- Add Episode button
- Per-episode fields:
  - Episode number
  - Title
  - Runtime
  - Release date

Save behavior options:

- Option A (recommended): transactional parent-first flow
  - Save series
  - Save seasons with seriesId
  - Save episodes with seasonId and seriesId
- Option B: staged draft object persisted as one document then expanded

### 5.2 Season form

Add inline Episodes section so a season can be fully authored here too.

- Parent link to series via selector
- Episode repeater as above

### 5.3 Episode form

Keep standalone form for direct edits and quick additions.

- Series selector -> filters season selector
- Episode number input with uniqueness validation in selected season


## 6. Section Layout Per Form

## 6.1 Movie

Sections:

1. Search and Import
- OMDB lookup and select
- Import preview and merge controls

2. Core Details
- Title, year, release date, runtime, country, certification

3. Credits
- Directors (entity selector + add new modal)
- Cast (data grid/repeater)
- Writers chips

4. Classification
- Genres chips
- Languages chips
- Ratings structured list

5. Links and Media
- Poster and image picker
- Plex and Letterboxd links

## 6.2 Series

Sections:

1. Search and Import
2. Core Details
3. Credits
4. Classification
5. Seasons and Episodes (nested editor)
6. Links and Media

## 6.3 Season

Sections:

1. Parent Selection (Series)
2. Core Details
3. Credits
4. Classification
5. Episodes (nested repeater)
6. Links and Media

## 6.4 Episode

Sections:

1. Parent Selection (Series and Season)
2. Core Details
3. Credits
4. Classification
5. Links and Media

## 6.5 Disc

Sections:

1. Identity
2. Physical and Flags
3. Video Files
4. Image Files
5. Optional Metadata

## 6.6 Release

Sections:

1. Identity and Type
2. Disc Associations
3. Media Associations (movie/series/season/episode selectors)
4. Extras repeater
5. Media Assets

## 6.7 Collection

Sections:

1. Identity
2. Description
3. Classification and Credits
4. Included Entries selectors
5. Media Assets


## 7. Validation Plan

## 7.1 Keep and adapt existing validation

Use current hooks as source logic, but standardize into shared validation utilities.

Required upgrades:

- Common validation result format
- Centralized parser/format validators (date, duration, ids, urls)
- Deterministic async validation with explicit await points

## 7.2 New validation coverage

Add validations not currently robustly covered:

- Cross-field consistency:
  - Episode number unique within season
  - Season number unique within series
  - Release year/date consistency checks
- Relationship existence checks for selected entities
- File input validation:
  - Allowed mime/extensions
  - Max size limits
- URL validation normalization


## 8. Testing Strategy For All Forms

## 8.1 Tooling

Add:

- Vitest
- @testing-library/react
- @testing-library/user-event
- @testing-library/jest-dom
- jsdom

Recommended scripts in [package.json](package.json):

- test
- test:watch
- test:coverage

## 8.2 Test levels

For each form component:

1. Render tests
- Form renders all primary sections

2. Field interaction tests
- Input updates state
- Add/remove repeater rows works

3. Validation tests
- Required errors shown when submitting empty form
- Invalid format shows specific error
- Valid input clears errors

4. Submission tests
- Calls Firestore service with normalized payload
- Parent-child save flow creates dependent entities correctly
- Error path surfaces user-friendly message

5. OMDB integration tests
- Search action calls service
- Select result hydrates mapped fields

## 8.3 Mocking approach

Mock:

- Firestore service modules
- OMDB service modules
- Auth/store hooks when needed

Prefer testing behavior via visible UI and submit payload assertions.


## 9. Suggested File Structure Refactor

Create reusable form primitives and section wrappers under:

- src/app/admin/_components/forms/common/
- src/app/admin/_components/forms/sections/
- src/app/admin/_components/forms/editors/

Examples:

- EntitySelector
- ChipsInput
- SectionCard
- NestedItemsEditor
- EpisodeRepeater
- SeasonRepeater


## 10. Execution Phases

## Phase A: Foundation

- Add test tooling and scripts
- Add shared validation utilities
- Add common form section components

Deliverable:

- Stable test runner with one passing smoke test per current form

## Phase B: Movie and Disc

- Revamp Movie form sections and inputs
- Revamp Disc form sections and file inputs
- Add unit tests for both

## Phase C: Series and Season with nesting

- Implement nested Season and Episode editors in Series form
- Add Episodes section to Season form
- Add cross-entity validation
- Add unit tests for nested flows

## Phase D: Episode, Release, Collection

- Revamp remaining forms with selectors and repeaters
- Add relationship selector patterns
- Add unit tests

## Phase E: Validation hardening and cleanup

- Remove duplicate/legacy validation pathways
- Normalize payload mappers
- Reach full test pass and baseline coverage target


## 11. Test Run Instructions (for implementation phase)

After test tooling is added, run:

1. Install dependencies
- npm install

2. Run all tests once
- npm run test

3. Run in watch mode
- npm run test:watch

4. Generate coverage
- npm run test:coverage


## 12. Acceptance Criteria

- All Admin forms are sectioned and visually consistent.
- Every field uses an appropriate input control for its data shape.
- Parent forms support inline creation and editing of child entities.
- Validation is consistent, deterministic, and testable.
- Unit tests exist for every Admin form and pass in CI/local runs.
- Legacy brittle inputs (free-text IDs and comma parsing where avoidable) are removed or minimized.


## 13. Risks and Mitigations

- Risk: Nested save flow complexity for Series/Season/Episode.
  - Mitigation: explicit save orchestration service and integration tests.

- Risk: Existing data shape inconsistencies between firebase and collection types.
  - Mitigation: introduce payload mappers and strict type guards before submit.

- Risk: Validation divergence across forms.
  - Mitigation: shared validation core and per-form adapters.


## 14. Immediate Next Step

Start Phase A by adding test tooling and creating baseline smoke tests for all seven forms before UI refactors begin.