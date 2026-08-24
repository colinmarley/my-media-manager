# Jellyfin Media Organization Rules

This project organizes accepted ingress files into Jellyfin-friendly folders and names.

Source references:
- Movies: https://jellyfin.org/docs/general/server/media/movies/
- Shows: https://jellyfin.org/docs/general/server/media/shows
- NFO metadata: https://jellyfin.org/docs/general/server/metadata/nfo

## Core Rules Implemented

### 1. Invalid characters are removed
The following path-invalid characters are stripped from generated names:

`< > : " / \ | ? *`

### 2. Movies
Jellyfin guidance says movie files should match the movie folder name.

Implemented behavior:
- Folder path: `.../movies/Movie Name (Year) [imdbid-ttXXXXXXX]`
- Filename: `Movie Name (Year) [imdbid-ttXXXXXXX].ext`

Notes:
- If year or provider ID is unavailable, only available parts are used.
- If destination filename already exists, a safe suffix is appended to avoid overwrite:
  - `Movie Name (Year) [imdbid-ttXXXXXXX] - Original Source Name.ext`

### 3. Shows
Jellyfin guidance says shows should be under series folder, then season folder (`Season 01`, `Season 02`, etc), and episode files should include `SxxExx`.

Implemented behavior:
- Series folder: `.../shows/Series Name (Year) [imdbid-ttXXXXXXX]/`
- Season folder: `Season 01` (zero-padded)
- Episode filename: `Series Name (Year) [imdbid-ttXXXXXXX] S01E01.ext`
- If episode title is available: `Series Name (Year) [imdbid-ttXXXXXXX] S01E01 Episode Title.ext`

Fallbacks:
- If season/episode numbers are missing or invalid, file keeps original source filename.
- If destination filename already exists, a safe suffix is appended with source name.

## Manual Accept Flow

When an item in `needs_review` is marked accepted/done:
1. Assignment is created.
2. File organization runs immediately.
3. If organization succeeds:
   - Queue item status becomes `completed`.
   - File is moved to Jellyfin destination path.
4. If organization fails:
   - Queue item status becomes `failed`.
   - `last_error` contains the failure reason.

## Local NFO Files (Auto-created)

Based on Jellyfin's NFO naming guidance, this project now writes local NFO files
as part of successful organization.

### Movie libraries

- File created: `movie.nfo`
- Location: movie folder (same folder as the movie video)
- XML root: `<movie>`
- Core fields written:
   - `title`
   - `year` (when available)
   - `id`, `imdbid`, `uniqueid type="imdb"` (when IMDb id available)

### Show libraries

- File created: `tvshow.nfo`
- Location: series folder (one level above season folders)
- XML root: `<tvshow>`
- Core fields written:
   - `title`
   - `year` (when available)
   - `imdb_id`, `uniqueid type="imdb"` (when IMDb id available)

### Episode sidecar NFO

- File created: `<episode filename>.nfo`
- Location: same folder as episode video
- XML root: `<episodedetails>`
- Core fields written:
   - `title`
   - `showtitle`
   - `season`
   - `episode`

### Safety behavior

- Existing `.nfo` files are not overwritten.
- If file move succeeds but NFO write fails, the move remains successful and the
   warning is logged.

## Custom Reassignment Mode

Destination reassignment now supports a custom-name mode for cases where metadata search
does not return a usable match.

Behavior:

- Custom title can be provided manually
- Optional year can be included in folder name
- IMDb id is optional in custom mode
- Destination category still applies (`movies`, `tv shows`, `documentaries`, `live performances`)
- Strict IMDb naming validation is skipped in custom mode
- NFO write/overwrite is skipped in custom mode

This mode is intended for manual correction and ingestion workflows where exact external
metadata is unavailable but files still need to be placed consistently for Jellyfin.

## Destination Root

Destination root is controlled by:
- `JELLYFIN_DEST_BASE`
- fallback: `MEDIA_LIBRARY_JELLYFIN_DEST_BASE`
- default: `/ark/media/jellyfin`

Example local setup:
- `JELLYFIN_DEST_BASE=/ark/media/jellyfin`

## Practical Examples

Movie input:
- Source: `/data/media/encoded/movies/Yes_man/Yes Man (2008) - WEBRip.mkv`
- Target folder: `/ark/media/jellyfin/movies/Yes Man (2008) [imdbid-tt1068680]`
- Output file: `/ark/media/jellyfin/movies/Yes Man (2008) [imdbid-tt1068680]/Yes Man (2008) [imdbid-tt1068680].mkv`

Show input:
- Source: `/data/media/encoded/shows/Some Show/some_show_s01e03.mkv`
- Target folder: `/ark/media/jellyfin/shows/Some Show (2024) [imdbid-tt1234567]/Season 01`
- Output file: `/ark/media/jellyfin/shows/Some Show (2024) [imdbid-tt1234567]/Season 01/Some Show (2024) [imdbid-tt1234567] S01E03.mkv`
