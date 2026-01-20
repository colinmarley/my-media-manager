/**
 * Media Assignment Types
 * 
 * Types for assigning scanned files to OMDB/TVDB media entries,
 * managing file renaming to match naming conventions, and organizing
 * files into appropriate folder structures.
 */

import { OmdbResponseFull, OmdbSearchResponse } from '../OmdbResponse.type';
import { ScannedFile } from '../../service/library/LibraryBrowserService';

/**
 * Assignment status for a file
 */
export type AssignmentStatus = 
  | 'unassigned'      // No media data assigned
  | 'searching'       // Currently searching for matches
  | 'matched'         // Matched to media data
  | 'assigned'        // Fully assigned and confirmed
  | 'renamed'         // File has been renamed
  | 'moved'           // File has been moved
  | 'completed';      // All operations completed

/**
 * Media type for assignment
 */
export type MediaAssignmentType = 'movie' | 'episode' | 'series';

/**
 * File with assignment data
 */
export interface FileAssignment {
  // Original file data
  file: ScannedFile;
  
  // Assignment status
  status: AssignmentStatus;
  assignmentType?: MediaAssignmentType;
  
  // Matched media data
  omdbData?: OmdbResponseFull;
  tmdbData?: any; // TMDB data if available
  
  // For episodes
  seriesData?: OmdbResponseFull;
  seasonNumber?: number;
  episodeNumber?: number;
  
  // Proposed changes
  proposedName?: string;      // New filename based on media data
  proposedPath?: string;      // New full path including directory
  proposedFolder?: string;    // New folder structure
  
  // Naming format preview
  namingFormat?: NamingFormat;
  
  // Confidence and suggestions
  confidence?: number;        // 0-100 match confidence
  suggestions?: MediaSuggestion[];
  
  // Notes and validation
  validationErrors?: string[];
  notes?: string;
}

/**
 * Media suggestion from OMDB/TVDB search
 */
export interface MediaSuggestion {
  source: 'omdb' | 'tmdb' | 'tvdb';
  data: OmdbSearchResponse | any;
  confidence: number;
  matchReason: string;        // Why this was suggested
  type: MediaAssignmentType;
}

/**
 * Naming format configuration
 */
export interface NamingFormat {
  type: MediaAssignmentType;
  template: string;           // Template with placeholders
  example: string;            // Example output
  description: string;
  
  // Placeholders available
  placeholders: {
    [key: string]: string;    // e.g., {title}, {year}, {season}, {episode}
  };
  
  // Options
  options: {
    includeYear: boolean;
    padSeasonNumber: boolean;
    padEpisodeNumber: boolean;
    separator: string;        // e.g., '-', '_', ' '
    caseStyle: 'original' | 'title' | 'lower' | 'upper';
  };
}

/**
 * Default naming formats for different media types
 */
export const DEFAULT_NAMING_FORMATS: Record<MediaAssignmentType, NamingFormat> = {
  movie: {
    type: 'movie',
    template: '{title} ({year})',
    example: 'Inception (2010).mp4',
    description: 'Movie Title (Year).extension',
    placeholders: {
      title: 'Movie title from OMDB',
      year: 'Release year',
    },
    options: {
      includeYear: true,
      padSeasonNumber: false,
      padEpisodeNumber: false,
      separator: ' ',
      caseStyle: 'title',
    },
  },
  episode: {
    type: 'episode',
    template: '{series} S{season}E{episode} - {title}',
    example: 'Breaking Bad S01E01 - Pilot.mp4',
    description: 'Series SNNENN - Episode Title.extension',
    placeholders: {
      series: 'Series title',
      season: 'Season number (padded)',
      episode: 'Episode number (padded)',
      title: 'Episode title',
    },
    options: {
      includeYear: false,
      padSeasonNumber: true,
      padEpisodeNumber: true,
      separator: ' ',
      caseStyle: 'title',
    },
  },
  series: {
    type: 'series',
    template: '{title} ({year})',
    example: 'Breaking Bad (2008)',
    description: 'Series Title (Year)',
    placeholders: {
      title: 'Series title',
      year: 'First air year',
    },
    options: {
      includeYear: true,
      padSeasonNumber: false,
      padEpisodeNumber: false,
      separator: ' ',
      caseStyle: 'title',
    },
  },
};

/**
 * Folder structure for organizing media
 */
export interface FolderStructureTemplate {
  type: MediaAssignmentType;
  template: string;           // Path template
  example: string;            // Example path
  description: string;
  
  // Auto-create folders
  autoCreate: boolean;
  
  // Folder naming
  folderNaming: {
    includeSeason: boolean;
    includeYear: boolean;
    separator: string;
  };
}

/**
 * Default folder structures
 */
export const DEFAULT_FOLDER_STRUCTURES: Record<MediaAssignmentType, FolderStructureTemplate> = {
  movie: {
    type: 'movie',
    template: '{libraryRoot}/Movies/{title} ({year})/',
    example: '/media/Movies/Inception (2010)/',
    description: 'Movies organized by title and year',
    autoCreate: true,
    folderNaming: {
      includeSeason: false,
      includeYear: true,
      separator: ' ',
    },
  },
  episode: {
    type: 'episode',
    template: '{libraryRoot}/TV Shows/{series} ({year})/Season {season}/',
    example: '/media/TV Shows/Breaking Bad (2008)/Season 01/',
    description: 'Episodes organized by series and season',
    autoCreate: true,
    folderNaming: {
      includeSeason: true,
      includeYear: true,
      separator: ' ',
    },
  },
  series: {
    type: 'series',
    template: '{libraryRoot}/TV Shows/{title} ({year})/',
    example: '/media/TV Shows/Breaking Bad (2008)/',
    description: 'Series folder structure',
    autoCreate: true,
    folderNaming: {
      includeSeason: false,
      includeYear: true,
      separator: ' ',
    },
  },
};

/**
 * Batch operation for multiple file assignments
 */
export interface BatchAssignmentOperation {
  files: FileAssignment[];
  operation: 'rename' | 'move' | 'assign' | 'complete';
  
  // Target configuration
  targetFolder?: string;
  namingFormat?: NamingFormat;
  folderStructure?: FolderStructureTemplate;
  
  // Execution options
  dryRun: boolean;            // Preview without executing
  continueOnError: boolean;   // Continue if some operations fail
  createFolders: boolean;     // Create missing folders
  
  // Results
  results?: BatchOperationResult[];
  summary?: BatchOperationSummary;
}

/**
 * Result of a batch operation item
 */
export interface BatchOperationResult {
  fileId: string;
  fileName: string;
  success: boolean;
  error?: string;
  originalPath: string;
  newPath?: string;
  operation: string;
}

/**
 * Summary of batch operation
 */
export interface BatchOperationSummary {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ fileId: string; error: string }>;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

/**
 * Search parameters for OMDB/TVDB
 */
export interface MediaSearchParams {
  query: string;
  type?: 'movie' | 'series' | 'episode';
  year?: number;
  season?: number;
  episode?: number;
  imdbId?: string;
}

/**
 * Search result with suggestions
 */
export interface MediaSearchResult {
  query: MediaSearchParams;
  results: MediaSuggestion[];
  timestamp: Date;
  source: 'omdb' | 'tmdb' | 'tvdb';
}

/**
 * File operation request
 */
export interface FileOperationRequest {
  fileId: string;
  operation: 'rename' | 'move' | 'copy' | 'delete';
  
  // Rename params
  newName?: string;
  
  // Move/copy params
  targetPath?: string;
  targetFolder?: string;
  createFolder?: boolean;
  
  // Options
  overwrite?: boolean;
  preserveTimestamps?: boolean;
}

/**
 * File operation response
 */
export interface FileOperationResponse {
  success: boolean;
  fileId: string;
  operation: string;
  originalPath: string;
  newPath?: string;
  error?: string;
  timestamp: Date;
}
