export interface LibraryPath {
  id: string;
  name: string;
  rootPath: string;
  mediaType: 'mixed' | 'movies' | 'series';
  isActive: boolean;
  lastScanned?: Date;
  createdAt: Date;
  scanProgress?: ScanProgress;
}

export interface MediaFileInfo {
  filePath: string;          // Full file system path
  fileName: string;          // File name with extension
  fileSize: number;          // Size in bytes
  fileExtension: string;     // File extension (.mp4, .mkv, etc.)
  checksum?: string;         // MD5/SHA256 for integrity
  lastScanned: Date;         // Last scan timestamp
  dateAdded: Date;           // When file was first detected
  isAvailable: boolean;      // File still exists on disk
  quality?: VideoQuality;    // Video quality information
  duration?: number;         // Duration in seconds
  resolution?: string;       // e.g., "1920x1080", "3840x2160"
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

export interface FolderStructure {
  rootPath: string;          // Base library path
  relativePath: string;      // Path relative to root
  folderName: string;        // Folder name
  mediaType: 'movie' | 'series' | 'season' | 'unknown';
  parentFolder?: string;     // Parent folder path
  subFolders: string[];      // Child folder names
  files: MediaFileInfo[];    // Files in this folder
}

export interface NamingConvention {
  type: 'movie' | 'series' | 'season' | 'episode';
  pattern: string;           // Regex pattern
  example: string;           // Example filename
  description: string;       // Human readable description
}

export interface ScanResult {
  libraryPath: LibraryPath;
  totalFolders: number;
  totalFiles: number;
  newFiles: number;
  missingFiles: number;
  matchedFiles: number;
  unmatchedFiles: number;
  errors: ScanError[];
  startTime: Date;
  endTime?: Date;
  status: ScanStatus;
}

export interface ScanProgress {
  currentPath: string;
  foldersProcessed: number;
  totalFolders: number;
  filesProcessed: number;
  totalFiles: number;
  percentage: number;
  status: ScanStatus;
}

export interface ScanError {
  type: 'file_access' | 'parse_error' | 'metadata_extraction' | 'database_error';
  message: string;
  path: string;
  timestamp: Date;
}

export interface MediaMatch {
  fileInfo: MediaFileInfo;
  confidence: number;        // 0-100 match confidence
  mediaId?: string;         // Matched database entry ID
  mediaType?: 'movie' | 'series' | 'episode';
  suggestions: MatchSuggestion[];
  status: 'matched' | 'unmatched' | 'conflict' | 'manual_review';
}

export interface MatchSuggestion {
  mediaId: string;
  title: string;
  year?: number;
  confidence: number;
  reason: string;           // Why this match was suggested
}

export interface VideoQuality {
  resolution: string;       // e.g., "1080p", "4K"
  codec: string;           // e.g., "H.264", "H.265"
  bitrate?: number;        // Video bitrate in kbps
  frameRate?: number;      // FPS
  hdr?: boolean;          // HDR content
}

export interface AudioTrack {
  language: string;
  codec: string;           // e.g., "AAC", "DTS"
  channels: string;        // e.g., "5.1", "7.1", "Stereo"
  bitrate?: number;
}

export interface SubtitleTrack {
  language: string;
  format: string;          // e.g., "SRT", "VTT", "PGS"
  isForced?: boolean;
  isDefault?: boolean;
}

export interface LibrarySettings {
  defaultNamingConventions: NamingConvention[];
  autoScanInterval?: number;    // Hours between auto scans
  autoMatchThreshold: number;   // Minimum confidence for auto-matching
  fileExtensions: string[];     // Supported video file extensions
  excludePatterns: string[];    // Folder/file patterns to ignore
  extractMetadata: boolean;     // Whether to extract technical metadata
  validateFiles: boolean;       // Whether to verify file integrity
}

export type ScanStatus = 'idle' | 'scanning' | 'matching' | 'completed' | 'error' | 'cancelled';
export type LibraryStatus = 'available' | 'missing' | 'partial' | 'scanning' | 'error';

// Default naming conventions
export const DEFAULT_NAMING_CONVENTIONS: NamingConvention[] = [
  {
    type: 'movie',
    pattern: '^(.+?)\s*\((\d{4})\).*\.(mp4|mkv|avi|mov)$',
    example: 'Movie Title (2023).mp4',
    description: 'Movie Title (Year).extension'
  },
  {
    type: 'series',
    pattern: '^(.+?)\s*\((\d{4})\)$',
    example: 'TV Show (2023)',
    description: 'TV Show (Year) folder'
  },
  {
    type: 'season',
    pattern: '^Season\s*(\d+)$',
    example: 'Season 01',
    description: 'Season NN folder'
  },
  {
    type: 'episode',
    pattern: '^(.+?)\s*S(\d+)E(\d+).*\.(mp4|mkv|avi|mov)$',
    example: 'Show Title S01E01.mp4',
    description: 'Show Title SNNENN.extension'
  }
];

export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.flv', '.webm'];
export const SUPPORTED_SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx'];
export const DEFAULT_EXCLUDE_PATTERNS = ['@eaDir', 'Thumbs.db', '.DS_Store', '*.tmp', '*.part'];