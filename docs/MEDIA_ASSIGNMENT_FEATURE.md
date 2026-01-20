# Media Assignment Feature

## Overview

The Media Assignment feature allows you to assign scanned files to OMDB/TVDB media data, automatically rename files according to naming conventions, and organize them into proper folder structures.

## Features

### 1. **File Selection & Information**
- View detailed file information (name, path, size, extension, media type)
- Select single or multiple files for batch operations
- See parsed information from filenames (title, year, season, episode)
- Visual status indicators for assignment progress

### 2. **OMDB/TVDB Search & Assignment**
- Search OMDB database by title, year, and type
- Auto-suggest matches based on filename parsing
- View search results with confidence scores
- Assign media data (movies, series, episodes) to files
- Support for episode-specific information (season/episode numbers)

### 3. **Automatic File Naming**
- Generate properly formatted filenames based on media type
- **Movie format**: `Movie Title (Year).extension`
  - Example: `Inception (2010).mp4`
- **Episode format**: `Series SNNENN - Episode Title.extension`
  - Example: `Breaking Bad S01E01 - Pilot.mp4`
- **Series folder format**: `Series Title (Year)`
  - Example: `Breaking Bad (2008)`

### 4. **Folder Organization**
- Automatic folder structure generation
- **Movies**: `/Movies/Movie Title (Year)/`
- **TV Episodes**: `/TV Shows/Series Title (Year)/Season NN/`
- Create folders automatically during move operations
- Preview proposed paths before executing

### 5. **Batch Operations**
- Rename multiple files at once
- Move and organize multiple files
- Batch assignment with progress tracking
- Continue on error option for reliability

### 6. **Preview & Validation**
- Preview all changes before execution
- Validation of proposed filenames and paths
- Visual comparison of current vs. proposed names
- Error checking for illegal characters and conflicts

## Usage Guide

### Getting Started

1. **From Library Browser**:
   - Select files you want to assign media data to
   - Click the "Assign Media Data" button
   - The Media Assignment interface will open with your selected files

2. **Direct Access**:
   - Navigate to `/admin/libraryBrowser/assignment`
   - Files can be added from the Library Browser

### Workflow

#### For Movies:

1. **Select File**: Click on a file in the left panel
2. **Search**: 
   - Use the "Search & Assign" tab
   - Enter movie title
   - Select "Movie" as type
   - Click "Search OMDB"
3. **Assign**: Click on the matching result
4. **Preview**: Switch to "Preview" tab to see proposed changes
5. **Generate**: Click "Generate Names" to create the formatted filename
6. **Execute**: 
   - Click "Rename File" to rename in place
   - Click "Move & Rename" to move to organized folder structure

#### For TV Episodes:

1. **Select File**: Click on a file in the left panel
2. **Set Episode Info**:
   - Enter season number
   - Enter episode number
   - Click "Update Episode Info"
3. **Search Series**:
   - Search for the TV series (not individual episode)
   - Select "Series" as type
   - Assign the series data
4. **Generate & Execute**: Follow steps 4-6 from movie workflow

#### Batch Operations:

1. **Select Multiple Files**: Check the boxes next to files
2. **Auto-Suggest**: Click "Auto-Suggest All" for automatic matching
3. **Review**: Check each file's assignment in the list
4. **Generate Names**: Click "Generate Names" in batch toolbar
5. **Execute**: Choose "Batch Rename" or "Batch Move"
6. **Monitor Progress**: View success/failure counts in the progress alert

### Configuration

**Library Root Path**:
- Click the "Settings" button
- Set your library root path (e.g., `/media`, `D:\\Media`)
- This determines where organized files will be moved

**Naming Formats** (Default):
- Movies: `{title} ({year})`
- Episodes: `{series} S{season}E{episode} - {title}`
- Formats are automatically applied based on media type

**Folder Structures** (Default):
- Movies: `{libraryRoot}/Movies/{title} ({year})/`
- Episodes: `{libraryRoot}/TV Shows/{series} ({year})/Season {season}/`

## Technical Details

### File Name Parsing

The system automatically parses filenames to extract:
- **Title**: Cleaned up text before year or episode marker
- **Year**: Four-digit year in parentheses `(####)`
- **Season/Episode**: Pattern like `S01E01`, `S1E1`

Examples:
- `Inception.2010.1080p.mp4` → Title: "Inception", Year: 2010 (requires manual year format)
- `Breaking.Bad.S01E01.720p.mp4` → Title: "Breaking Bad", S01E01
- `Movie Name (2023).mkv` → Title: "Movie Name", Year: 2023 ✓

### Status Indicators

- **Unassigned** (Gray): No media data assigned yet
- **Searching** (Default): Auto-suggestions in progress
- **Matched** (Info Blue): Media data assigned, ready for naming
- **Assigned** (Primary Blue): Fully configured, ready for operations
- **Renamed** (Warning Orange): File has been renamed
- **Moved** (Success Green): File has been moved
- **Completed** (Success Green): All operations completed

### Confidence Scores

- **90-100%**: Exact match (IMDb ID or exact title+year)
- **80-89%**: Strong match (title and year match)
- **70-79%**: Good match (title matches, year different or missing)
- **Below 70%**: Weak match (title similarity only)

## API Integration

### OMDB API

The feature uses the OMDB API for fetching media metadata:
- `searchByText()`: Search by title
- `retrieveMediaDataById()`: Get full data by IMDb ID
- `retrieveShowDataByTitle()`: Get TV series data

### Backend API

File operations are handled by the backend:
- `/api/file-operations/rename`: Rename files
- `/api/file-operations/move`: Move files to new locations

## Best Practices

1. **Set Library Root First**: Configure your library root path in settings before starting
2. **Use Auto-Suggest**: Let the system suggest matches based on filenames
3. **Preview Before Executing**: Always check the preview tab before renaming/moving
4. **Batch Similar Types**: Process movies and TV shows separately for better results
5. **Verify Episode Numbers**: Double-check season/episode numbers for TV shows
6. **Start Small**: Test with a few files before batch operations on large sets

## Troubleshooting

### "No media data assigned" error
- Make sure you've searched and selected a media result
- Check that OMDB API is accessible

### "Invalid proposed filename" error
- Filename may contain illegal characters
- Try searching again or manually adjust the episode info

### Files not appearing in assignment
- Check that files are actually selected in Library Browser
- Verify files are supported video formats

### Batch operation partially failed
- Check the batch progress summary for specific errors
- Failed items can be retried individually
- Common issues: file permissions, invalid paths, missing folders

## Future Enhancements

- TVDB API integration for more episode metadata
- Custom naming format editor
- Metadata preservation during moves
- Undo/rollback functionality
- Mass auto-assignment with confidence threshold
- Integration with Plex/Jellyfin libraries

## Support

For issues or questions:
1. Check the console for error messages
2. Verify OMDB API key is configured
3. Ensure backend service is running
4. Check file permissions for rename/move operations
