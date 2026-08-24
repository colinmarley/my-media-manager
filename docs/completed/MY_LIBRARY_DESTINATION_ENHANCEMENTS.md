# My Library Destination Enhancements

This document captures the destination-folder and navigation enhancements added in the latest dashboard work.

## Summary

New capabilities:

- Responsive left navigation drawer (desktop persistent, mobile temporary)
- Destination folder video preview modal with keyboard controls
- Reassignment workflow improvements:
  - Explicit destination media designation: Movie, TV Show, Documentary, Live Performance
  - Custom-name save path when search results are missing or incorrect
  - Optional save without IMDb id in custom mode
  - Catalog sync with file-derived technical metadata in custom mode
- My Library card poster fallback now shows the folder name instead of a "No Poster" placeholder image

## UI Navigation Changes

Root layout now uses a left-side drawer for app navigation.

- Desktop: persistent drawer; content shifts right when open
- Mobile/tablet: temporary overlay drawer
- Header includes menu button to open drawer
- Closed desktop state shows a left-edge "Open Menu" tab

Primary file:

- `src/app/layout.tsx`

## Destination Folder Video Preview

Video files in Destination Folder browser can now be previewed in a popup modal.

### Behavior

- Click play icon on a video file row to open preview modal
- Uses native HTML5 controls (play/pause, seek, timeline)
- Closing modal stops playback and clears source

### Keyboard shortcuts

- `Space`: play/pause
- `Left Arrow`: seek backward 5 seconds
- `Right Arrow`: seek forward 5 seconds
- `Escape`: close modal

Primary files:

- `src/app/dashboard/my-library/_components/DestFolderBrowser.tsx`
- `backend/api/file_browser.py` (stream endpoint)

## Reassignment Enhancements

The destination reassignment dialog now separates metadata search mode from destination media designation.

### Save As destination type

Users can choose where the reassigned item should be stored:

- Movie
- TV Show
- Documentary
- Live Performance

This designation controls destination folder routing under Jellyfin base path.

### Custom-name mode

Users can toggle "Use Custom Name Instead" and provide:

- Custom title (required)
- Year (optional)

In custom mode:

- Selection from metadata search is not required
- IMDb id is optional
- Backend accepts reassignment with `allowCustomName: true`
- Strict IMDb naming validation and NFO write are skipped
- Catalog record is created from custom title and file-derived technical metadata

### File-derived metadata saved in custom mode

When custom-name save is used, the app extracts technical metadata from the moved file and stores fallback technical details such as:

- Runtime (from media duration when available)
- File extension/type
- File size
- Quality/resolution category
- Resolution
- Codec
- Bitrate

Primary files:

- `src/app/dashboard/my-library/_components/DiskReassignDialog.tsx`
- `src/service/library/MediaAssignmentSearchService.ts`
- `backend/api/file_browser.py`

## Poster Fallback Update

When poster load fails (or no poster is available), My Library cards now render a styled fallback tile that displays the folder name.

Fallback resolution order:

1. `folderPath` from catalog document
2. `jellyfinInfo.folderPath`
3. media title

Primary file:

- `src/app/dashboard/my-library/page.tsx`

## Testing Checklist

1. Open dashboard and verify left drawer behavior on desktop and mobile widths.
2. In My Library > Destination Folder, open a video preview and verify keyboard shortcuts.
3. Reassign folder/file using metadata selection with each Save As type.
4. Reassign folder/file using custom-name mode without selecting a search result.
5. Confirm custom-name save appears in catalog and has technical metadata populated.
6. Force poster miss/failure and verify folder name fallback tile renders.
