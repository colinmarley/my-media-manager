# Media Manager Data Structure Redesign

## Executive Summary

This document proposes a comprehensive redesign of the Firebase Firestore data structures for the media management application, with enhanced file metadata, Jellyfin folder structure compliance, and automated media organization capabilities.

## Table of Contents

1. [Core Objectives](#core-objectives)
2. [Current Structure Analysis](#current-structure-analysis)
3. [Proposed Architecture](#proposed-architecture)
4. [New Collections](#new-collections)
5. [Enhanced Metadata Fields](#enhanced-metadata-fields)
6. [Media Assignment System](#media-assignment-system)
7. [Jellyfin Folder Structure](#jellyfin-folder-structure)
8. [Implementation Plan](#implementation-plan)
9. [Migration Strategy](#migration-strategy)

---

## Core Objectives

### 1. **Enhanced File Metadata**
- Track detailed file information (runtime, filesize, codec, creation date, resolution)
- Support multiple file formats and quality versions
- Maintain file integrity through checksums
- Track audio and subtitle tracks

### 2. **Media Assignment & Organization**
- Link scanned files to Movies/Series/Episodes
- Automatically create Jellyfin-compliant folder structures
- Move and organize files based on metadata
- Handle multiple versions and extras

### 3. **Jellyfin Compliance**
- Follow Jellyfin naming conventions
- Support proper folder hierarchy
- Handle special cases (3D, multi-part, extras)
- Metadata image organization

### 4. **Modular & Scalable Design**
- Break large collections into manageable sub-collections
- Reduce document size for better performance
- Improve query efficiency
- Enable future extensibility

---

## Current Structure Analysis

### Issues with Current Design

1. **Monolithic Documents**: Movie and Series documents contain nested arrays that can grow large
2. **Limited File Metadata**: Current `MediaFileInfo` lacks detailed technical specifications
3. **No Assignment System**: No formal linking between scanned files and media entries
4. **Inconsistent File Tracking**: File information embedded in media documents vs. separate scanning
5. **Missing Jellyfin Integration**: No automated folder structure management

---

## Proposed Architecture

### Collection Hierarchy

```
Root Collections:
├── movies (metadata only)
├── series (metadata only)
├── seasons (separate collection)
├── episodes (separate collection)
├── media_files (NEW - all physical files)
├── media_assignments (NEW - links files to media)
├── library_paths (existing)
├── scan_results (existing)
├── directors (existing)
├── actors (existing)
└── releases (existing)

Sub-collections:
├── movies/{movieId}/
│   ├── file_assignments (assigned files)
│   ├── images (poster, backdrop, etc.)
│   └── extras (trailers, behind the scenes)
│
└── series/{seriesId}/
    ├── file_assignments (series-level files)
    └── images (series posters, backdrops)
```

---

## New Collections

### 1. `media_files` Collection

**Purpose**: Central repository for all scanned physical files with comprehensive metadata.

```typescript
interface MediaFile {
  // Identity
  id: string;                          // Unique file ID
  scanId: string;                      // Scan batch identifier
  libraryPathId: string;               // Reference to library_paths
  
  // File System Info
  filePath: string;                    // Full absolute path
  fileName: string;                    // File name with extension
  fileExtension: string;               // .mkv, .mp4, .avi, etc.
  folderPath: string;                  // Parent directory path
  relativePath: string;                // Path relative to library root
  
  // File Metadata
  fileSize: number;                    // Size in bytes
  fileSizeFormatted: string;           // "4.5 GB"
  checksum: string;                    // MD5 or SHA256 hash
  createdDate: Date;                   // File creation timestamp
  modifiedDate: Date;                  // Last modified timestamp
  lastScannedDate: Date;               // Last scan verification
  isAvailable: boolean;                // File exists on disk
  
  // Media Type Detection
  detectedMediaType: 'movie' | 'episode' | 'unknown';
  confidence: number;                  // 0-100 detection confidence
  
  // Video Technical Specs
  videoMetadata?: {
    duration: number;                  // Runtime in seconds
    durationFormatted: string;         // "2:15:30"
    codec: string;                     // H.264, H.265, VP9, AV1
    containerFormat: string;           // MKV, MP4, AVI
    bitrate: number;                   // Video bitrate in kbps
    resolution: string;                // "1920x1080"
    resolutionLabel: string;           // "1080p", "4K", "720p"
    aspectRatio: string;               // "16:9", "21:9"
    frameRate: number;                 // 23.976, 24, 29.97, 60
    colorSpace: string;                // "BT.709", "BT.2020"
    hdr: boolean;                      // HDR content
    hdrFormat?: string;                // "HDR10", "Dolby Vision", "HDR10+"
    is3D: boolean;                     // 3D content
    format3D?: string;                 // "hsbs", "ftab", "mvc"
  };
  
  // Audio Tracks
  audioTracks: AudioTrack[];
  
  // Subtitle Tracks
  subtitleTracks: SubtitleTrack[];
  
  // Parsed Information (from filename)
  parsedInfo?: {
    title: string;
    year?: number;
    season?: number;
    episode?: number;
    episodeTitle?: string;
    quality?: string;                  // "1080p", "4K", "BluRay"
    releaseGroup?: string;             // Encoding group name
    edition?: string;                  // "Extended", "Director's Cut"
  };
  
  // Assignment Status
  assignmentStatus: 'unassigned' | 'assigned' | 'conflict' | 'ignore';
  assignedToType?: 'movie' | 'series' | 'episode';
  assignedToId?: string;               // Reference to movie/episode ID
  
  // Organization
  needsOrganization: boolean;          // File needs to be moved
  targetPath?: string;                 // Proposed destination path
  organizationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  
  // Metadata
  tags: string[];                      // User-defined tags
  notes: string;                       // User notes
  createdAt: Date;
  updatedAt: Date;
}

interface AudioTrack {
  index: number;
  language: string;                    // ISO 639-2 code (eng, jpn, spa)
  languageName: string;                // "English", "Japanese"
  codec: string;                       // AAC, DTS, TrueHD, FLAC
  channels: number;                    // 2, 5.1, 7.1, etc.
  channelsLayout: string;              // "Stereo", "5.1", "7.1 Surround"
  bitrate?: number;                    // Audio bitrate in kbps
  sampleRate?: number;                 // 48000, 96000
  isDefault: boolean;
  isForced: boolean;
  title?: string;                      // "English Commentary", "Japanese Original"
  isExternal: boolean;                 // External audio file
}

interface SubtitleTrack {
  index: number;
  language: string;                    // ISO 639-2 code
  languageName: string;
  format: string;                      // SRT, ASS, VTT, PGS
  isDefault: boolean;
  isForced: boolean;
  isSDH: boolean;                      // Hearing impaired
  title?: string;
  isExternal: boolean;                 // External subtitle file
}
```

### 2. `media_assignments` Collection

**Purpose**: Links media files to Movies/Episodes and tracks organization operations.

```typescript
interface MediaAssignment {
  id: string;
  
  // Source File(s)
  mediaFileIds: string[];              // Array of media_files IDs
  primaryFileId: string;               // Main video file
  extraFileIds?: string[];             // Additional files (subtitles, extras)
  
  // Target Media
  mediaType: 'movie' | 'episode';
  mediaId: string;                     // Movie or Episode ID
  
  // For Episodes
  seriesId?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  
  // Version/Quality Info
  version?: string;                    // "1080p", "4K", "Director's Cut"
  isPreferredVersion: boolean;
  
  // Jellyfin Organization
  targetFolderStructure: {
    libraryRoot: string;               // Base Jellyfin library path
    mediaFolder: string;               // Movie/Series specific folder
    fullPath: string;                  // Complete target path
    folderName: string;                // Final folder name (Jellyfin format)
    fileName: string;                  // Target filename (Jellyfin format)
  };
  
  // Organization Status
  organizationStatus: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  organizationDate?: Date;
  organizationError?: string;
  
  // Operations Log
  operations: OrganizationOperation[];
  
  // Metadata
  assignedBy: string;                  // User ID
  assignedDate: Date;
  confidence: number;                  // Assignment confidence 0-100
  isManualAssignment: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OrganizationOperation {
  timestamp: Date;
  operation: 'create_folder' | 'move_file' | 'rename_file' | 'copy_file';
  sourcePath: string;
  destinationPath: string;
  status: 'success' | 'failed';
  errorMessage?: string;
}
```

### 3. `jellyfin_folders` Collection

**Purpose**: Track created Jellyfin folder structures for validation and management.

```typescript
interface JellyfinFolder {
  id: string;
  
  // Folder Info
  folderPath: string;                  // Full path
  folderName: string;                  // Jellyfin-compliant name
  folderType: 'movie' | 'series' | 'season' | 'extras';
  
  // Media Reference
  mediaType: 'movie' | 'series';
  mediaId: string;
  seasonNumber?: number;               // For season folders
  
  // Jellyfin Naming
  mediaTitle: string;
  year?: number;
  imdbId?: string;
  jellyfinName: string;                // "Movie Title (2020) [imdbid-tt1234567]"
  
  // Contents
  videoFiles: string[];                // Filenames
  subtitleFiles: string[];
  audioFiles: string[];
  imageFiles: string[];                // poster.jpg, backdrop.jpg, etc.
  extraFolders: string[];              // trailers, behind the scenes, etc.
  
  // Status
  createdDate: Date;
  lastVerified: Date;
  isValid: boolean;                    // Passes Jellyfin validation
  validationErrors: string[];
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Enhanced Metadata Fields

### Movie Collection Updates

```typescript
interface Movie {
  // ... existing fields ...
  
  // Removed: libraryFiles (now in media_assignments)
  // Removed: folderPath (now in jellyfin_folders)
  // Removed: libraryStatus (now in media_assignments)
  
  // NEW: Assignment Summary
  assignmentSummary?: {
    totalFiles: number;
    assignedFiles: number;
    unassignedFiles: number;
    versions: MediaVersion[];          // Different quality versions
    hasPhysicalCopy: boolean;
    totalFileSize: number;             // Combined size in bytes
    totalFileSizeFormatted: string;    // "45.2 GB"
  };
  
  // NEW: Jellyfin Integration
  jellyfinInfo?: {
    folderId: string;                  // Reference to jellyfin_folders
    folderName: string;                // Current Jellyfin folder name
    folderPath: string;                // Full path
    isOrganized: boolean;              // Files in correct locations
    lastOrganized?: Date;
  };
  
  // NEW: Enhanced IMDB/TMDB IDs
  externalIds: {
    imdbId?: string;                   // tt1234567
    tmdbId?: number;
    rottenTomatoesId?: string;
    metacriticId?: string;
    letterboxdId?: string;
  };
  
  // Enhanced Release Information
  theatrical Release?: {
    date: Date;
    runtime: number;                   // Minutes
    runtimeFormatted: string;          // "2h 15m"
  };
  
  // Content Ratings
  contentRatings: ContentRating[];
  
  // Collections/Franchises
  belongsToCollection?: {
    collectionId: string;
    collectionName: string;            // "Star Wars Collection"
    orderInCollection: number;
  };
}

interface MediaVersion {
  fileId: string;
  version: string;                     // "1080p", "4K", "Director's Cut"
  resolution: string;
  fileSize: number;
  codec: string;
  isPreferred: boolean;
}

interface ContentRating {
  country: string;                     // "US", "UK", "JP"
  rating: string;                      // "PG-13", "15", "R"
  ratingSystem: string;                // "MPAA", "BBFC"
}
```

### Series Collection Updates

```typescript
interface Series {
  // ... existing fields ...
  
  // Removed nested seasons array (now separate collection)
  // Removed libraryFiles
  // Removed folderPath
  
  // NEW: Series Summary
  seriesSummary: {
    totalSeasons: number;
    totalEpisodes: number;
    totalRuntime: number;              // Total minutes across all episodes
    firstAired: Date;
    lastAired?: Date;
    status: 'returning' | 'ended' | 'cancelled' | 'hiatus';
  };
  
  // NEW: Assignment Summary
  assignmentSummary?: {
    seasonsWithFiles: number;
    episodesWithFiles: number;
    totalFiles: number;
    totalFileSize: number;
    totalFileSizeFormatted: string;
  };
  
  // NEW: Jellyfin Integration
  jellyfinInfo?: {
    folderId: string;
    folderName: string;
    folderPath: string;
    seasonFolders: SeasonFolderInfo[];
    isOrganized: boolean;
  };
  
  // External IDs
  externalIds: {
    imdbId?: string;
    tmdbId?: number;
    tvdbId?: number;
    tvMazeId?: number;
  };
}

interface SeasonFolderInfo {
  seasonNumber: number;
  folderId: string;
  folderName: string;                  // "Season 01"
  episodeCount: number;
  hasAllEpisodes: boolean;
}
```

### Season Collection (Now Standalone)

```typescript
interface Season {
  id: string;
  
  // Series Reference
  seriesId: string;
  seriesTitle: string;
  
  // Season Info
  seasonNumber: number;
  seasonName?: string;                 // "Season 1", "Season 01"
  alternateTitle?: string;             // "The Beginning"
  
  // Episode Summary
  totalEpisodes: number;
  episodeIds: string[];                // References to episodes collection
  firstAired?: Date;
  lastAired?: Date;
  
  // Media
  posterImage?: ImageFile;
  overview?: string;
  
  // Jellyfin
  jellyfinFolderId?: string;
  jellyfinFolderName: string;          // "Season 01"
  
  // Assignment Summary
  episodesWithFiles: number;
  totalFiles: number;
  totalFileSize: number;
  
  createdAt: Date;
  updatedAt: Date;
}
```

### Episode Collection (Enhanced)

```typescript
interface Episode {
  id: string;
  
  // Series/Season References
  seriesId: string;
  seasonId: string;
  seriesTitle: string;
  
  // Episode Info
  seasonNumber: number;
  episodeNumber: number;
  episodeNumbers?: number[];           // For multi-part episodes [1, 2]
  title: string;
  overview?: string;
  
  // Air Date & Runtime
  airDate?: Date;
  runtime?: number;                    // Minutes
  runtimeFormatted?: string;           // "45m"
  
  // Credits
  directors: EpisodeDirector[];
  writers: string[];
  guestStars?: ActorPreview[];
  
  // Media
  stillImage?: ImageFile;
  
  // External IDs
  externalIds: {
    imdbId?: string;
    tmdbId?: number;
    tvdbId?: number;
  };
  
  // File Assignment (simplified - detailed in media_assignments)
  hasFile: boolean;
  fileId?: string;                     // Primary video file
  fileCount: number;                   // Total related files
  
  // Jellyfin Filename
  jellyfinFilename?: string;           // "Series Name (2020) S01E01.mkv"
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Media Assignment System

### Workflow

```
1. SCAN
   ↓
   media_files created with metadata extraction
   ↓
2. DETECTION
   ↓
   Parse filename → Suggest assignments
   ↓
3. USER ASSIGNMENT
   ↓
   User links file(s) to Movie/Episode
   ↓
4. media_assignment created
   ↓
5. FOLDER GENERATION
   ↓
   Generate Jellyfin-compliant folder structure
   ↓
6. FILE ORGANIZATION
   ↓
   Create folders → Move files → Update jellyfin_folders
   ↓
7. VERIFICATION
   ↓
   Validate structure → Update assignment status
```

### Assignment Service Architecture

```typescript
class MediaAssignmentService {
  // Assign file(s) to media
  async assignToMovie(fileIds: string[], movieId: string, version?: string): Promise<MediaAssignment>
  
  async assignToEpisode(fileIds: string[], episodeId: string): Promise<MediaAssignment>
  
  // Generate Jellyfin structure
  async generateJellyfinStructure(assignmentId: string): Promise<JellyfinFolder>
  
  // Organize files
  async organizeFiles(assignmentId: string): Promise<OrganizationResult>
  
  // Batch operations
  async batchAssignSeries(fileIds: string[], seriesId: string): Promise<MediaAssignment[]>
  
  // Validation
  async validateJellyfinStructure(folderId: string): Promise<ValidationResult>
}

interface OrganizationResult {
  success: boolean;
  foldersCreated: string[];
  filesMoved: number;
  errors: string[];
  jellyfinFolderId?: string;
}
```

---

## Jellyfin Folder Structure

### Movie Folder Generation

```typescript
function generateMovieFolder(movie: Movie, version?: string): JellyfinStructure {
  // Base format: "Movie Title (Year) [imdbid-tt1234567]"
  let folderName = movie.title;
  
  // Add year if available
  if (movie.releaseDate) {
    const year = new Date(movie.releaseDate).getFullYear();
    folderName += ` (${year})`;
  }
  
  // Add IMDB ID if available
  if (movie.externalIds?.imdbId) {
    folderName += ` [imdbid-${movie.externalIds.imdbId}]`;
  }
  
  // Sanitize for filesystem
  folderName = sanitizeFilename(folderName);
  
  // Generate filename
  let filename = folderName;
  if (version) {
    filename += ` - ${version}`;
  }
  filename += getFileExtension(assignedFile);
  
  return {
    folderPath: `${libraryRoot}/${folderName}`,
    folderName: folderName,
    mainFile: filename,
    subfolder: [] // For extras, behind the scenes, etc.
  };
}

// Examples:
// "The Matrix (1999) [imdbid-tt0133093]/"
//   ├── "The Matrix (1999) [imdbid-tt0133093] - 1080p.mkv"
//   ├── "The Matrix (1999) [imdbid-tt0133093] - 4K.mkv"
//   ├── "poster.jpg"
//   ├── "backdrop.jpg"
//   └── "trailers/"
//       └── "trailer-1.mkv"
```

### Series Folder Generation

```typescript
function generateSeriesFolder(series: Series, season: Season, episode: Episode): JellyfinStructure {
  // Series folder: "Series Name (Year) [imdbid-tt1234567]"
  let seriesFolder = series.title;
  
  if (series.runningYears?.length > 0) {
    seriesFolder += ` (${series.runningYears[0]})`;
  }
  
  if (series.externalIds?.imdbId) {
    seriesFolder += ` [imdbid-${series.externalIds.imdbId}]`;
  }
  
  seriesFolder = sanitizeFilename(seriesFolder);
  
  // Season folder: "Season 01" (zero-padded)
  const seasonFolder = `Season ${season.seasonNumber.toString().padStart(2, '0')}`;
  
  // Episode filename: "Series Name (Year) S01E01.mkv"
  const episodeNum = episode.episodeNumber.toString().padStart(2, '0');
  const seasonNum = season.seasonNumber.toString().padStart(2, '0');
  let filename = `${seriesFolder} S${seasonNum}E${episodeNum}`;
  
  // Add episode title if available
  if (episode.title) {
    filename += ` ${episode.title}`;
  }
  
  filename = sanitizeFilename(filename);
  filename += getFileExtension(assignedFile);
  
  return {
    seriesFolderPath: `${libraryRoot}/${seriesFolder}`,
    seasonFolderPath: `${libraryRoot}/${seriesFolder}/${seasonFolder}`,
    filename: filename,
    fullPath: `${libraryRoot}/${seriesFolder}/${seasonFolder}/${filename}`
  };
}

// Examples:
// "Breaking Bad (2008) [imdbid-tt0903747]/"
//   ├── "Season 01/"
//   │   ├── "Breaking Bad (2008) S01E01 Pilot.mkv"
//   │   ├── "Breaking Bad (2008) S01E02 Cat's in the Bag....mkv"
//   │   └── "Breaking Bad (2008) S01E03 ...And the Bag's in the River.mkv"
//   ├── "Season 02/"
//   ├── "poster.jpg"
//   └── "backdrop.jpg"
```

### Special Cases

```typescript
// Multi-part episodes
// "Series Name S01E01-E02.mkv"

// 3D Movies
// "Movie Title (2020) - 3D.hsbs.mkv"

// Multiple versions
// "Movie Title (2020) - 1080p.mkv"
// "Movie Title (2020) - 4K.mkv"
// "Movie Title (2020) - Director's Cut.mkv"

// Extras folders
// "Movie Title (2020)/"
//   ├── "behind the scenes/"
//   ├── "deleted scenes/"
//   ├── "trailers/"
//   └── "interviews/"
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Weeks 1-2)

1. Create new TypeScript interfaces
2. Update Firebase security rules
3. Implement `media_files` collection
4. Build media file scanner with enhanced metadata extraction
5. Create indexes for efficient querying

### Phase 2: Assignment System (Weeks 3-4)

1. Implement `media_assignments` collection
2. Build assignment service
3. Create UI for file-to-media linking
4. Implement suggestion/matching algorithm
5. Add batch assignment features

### Phase 3: Jellyfin Integration (Weeks 5-6)

1. Implement `jellyfin_folders` collection
2. Build folder structure generator
3. Create file organization service
4. Implement validation system
5. Add error handling and rollback

### Phase 4: Enhanced Metadata (Weeks 7-8)

1. Update Movie/Series collections
2. Migrate Season to standalone collection
3. Enhance Episode collection
4. Build metadata sync services
5. Update all CRUD operations

### Phase 5: UI & Testing (Weeks 9-10)

1. Build media assignment interface
2. Create organization dashboard
3. Add progress tracking
4. Implement comprehensive testing
5. User acceptance testing

---

## Migration Strategy

### Data Migration Steps

```typescript
// 1. Migrate existing files to media_files collection
async function migrateToMediaFiles() {
  const movies = await getMoviesWithLibraryFiles();
  
  for (const movie of movies) {
    if (movie.libraryFiles) {
      for (const libFile of movie.libraryFiles) {
        // Create media_file document
        const mediaFile = {
          ...libFile,
          assignmentStatus: 'assigned',
          assignedToType: 'movie',
          assignedToId: movie.id,
          detectedMediaType: 'movie',
          confidence: 100
        };
        
        await createMediaFile(mediaFile);
        
        // Create assignment
        const assignment = {
          mediaFileIds: [mediaFile.id],
          mediaType: 'movie',
          mediaId: movie.id,
          isManualAssignment: false,
          confidence: 100,
          organizationStatus: 'completed'
        };
        
        await createAssignment(assignment);
      }
    }
    
    // Remove old libraryFiles field
    await updateMovie(movie.id, { libraryFiles: null });
  }
}

// 2. Extract seasons from series
async function migrateSeasonsToCollection() {
  const allSeries = await getAllSeries();
  
  for (const series of allSeries) {
    if (series.seasons) {
      for (const seasonEntry of series.seasons) {
        // Create standalone season document
        const season = {
          seriesId: series.id,
          seriesTitle: series.title,
          seasonNumber: seasonEntry.seasonNumber,
          totalEpisodes: seasonEntry.episodeIds?.length || 0,
          episodeIds: seasonEntry.episodeIds || []
        };
        
        await createSeason(season);
      }
    }
    
    // Update series with summary
    await updateSeries(series.id, {
      seasons: null,
      seriesSummary: {
        totalSeasons: series.seasons.length,
        totalEpisodes: calculateTotalEpisodes(series)
      }
    });
  }
}
```

### Backwards Compatibility

- Keep old fields during migration period
- Provide read-only access to deprecated fields
- Add deprecation warnings in code
- Set sunset date for old structure (3 months post-migration)

---

## Benefits Summary

### Performance
- Smaller document sizes → faster reads/writes
- Better indexing → faster queries
- Reduced data duplication

### Scalability
- Modular collections grow independently
- Sub-collections for related data
- Easier to add new features

### Functionality
- Comprehensive file metadata
- Automated Jellyfin organization
- Multiple version support
- Better file tracking

### Maintainability
- Clear separation of concerns
- Easier to understand and modify
- Better type safety
- Reduced technical debt

---

## Next Steps

1. **Review & Feedback**: Team reviews proposal
2. **Prototype**: Build proof-of-concept for core features
3. **Testing**: Test with sample data
4. **Approval**: Get stakeholder sign-off
5. **Implementation**: Execute phased rollout
6. **Migration**: Migrate existing data
7. **Monitoring**: Track performance and issues
8. **Optimization**: Refine based on real-world usage

---

## Appendix

### A. Jellyfin Naming Reference

See [Jellyfin Documentation](https://jellyfin.org/docs/general/server/media/) for complete specifications.

### B. File Extension Support

**Video**: .mkv, .mp4, .avi, .mov, .m4v, .ts, .webm
**Audio**: .aac, .mp3, .flac, .dts, .ac3, .opus
**Subtitles**: .srt, .ass, .ssa, .vtt, .sub, .idx

### C. Metadata Extraction Libraries

- **ffprobe**: Video/audio metadata
- **MediaInfo**: Comprehensive media analysis
- **ExifTool**: File metadata
- **Python libraries**: pymediainfo, ffmpeg-python

### D. Security Considerations

- Validate all file paths to prevent directory traversal
- Implement user permissions for organization operations
- Log all file operations for audit trail
- Implement rollback for failed operations
- Rate limit automated operations

---

*Document Version: 1.0*
*Last Updated: January 23, 2026*
*Author: System Architect*
