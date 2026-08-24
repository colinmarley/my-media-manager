/**
 * Media File Type Definitions
 * Based on DATA_STRUCTURE_REDESIGN.md
 */

export interface AudioTrack {
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

export interface SubtitleTrack {
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

export interface VideoMetadata {
  duration: number;                    // Runtime in seconds
  durationFormatted: string;           // "2:15:30"
  codec: string;                       // H.264, H.265, VP9, AV1
  containerFormat: string;             // MKV, MP4, AVI
  bitrate: number;                     // Video bitrate in kbps
  resolution: string;                  // "1920x1080"
  resolutionLabel: string;             // "1080p", "4K", "720p"
  aspectRatio: string;                 // "16:9", "21:9"
  frameRate: number;                   // 23.976, 24, 29.97, 60
  colorSpace: string;                  // "BT.709", "BT.2020"
  hdr: boolean;                        // HDR content
  hdrFormat?: string;                  // "HDR10", "Dolby Vision", "HDR10+"
  is3D: boolean;                       // 3D content
  format3D?: string;                   // "hsbs", "ftab", "mvc"
}

export interface ParsedFileInfo {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  quality?: string;                    // "1080p", "4K", "BluRay"
  releaseGroup?: string;               // Encoding group name
  edition?: string;                    // "Extended", "Director's Cut"
}

export type AssignmentStatus = 'unassigned' | 'assigned' | 'conflict' | 'ignore';
export type MediaType = 'movie' | 'series' | 'episode';
export type DetectedMediaType = 'movie' | 'episode' | 'unknown';
export type OrganizationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface MediaFile {
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
  detectedMediaType: DetectedMediaType;
  confidence: number;                  // 0-100 detection confidence
  
  // Video Technical Specs
  videoMetadata?: VideoMetadata;
  
  // Audio Tracks
  audioTracks: AudioTrack[];
  
  // Subtitle Tracks
  subtitleTracks: SubtitleTrack[];
  
  // Parsed Information (from filename)
  parsedInfo?: ParsedFileInfo;
  
  // Assignment Status
  assignmentStatus: AssignmentStatus;
  assignedToType?: MediaType;
  assignedToId?: string;               // Reference to movie/episode ID
  
  // Organization
  needsOrganization: boolean;          // File needs to be moved
  targetPath?: string;                 // Proposed destination path
  organizationStatus: OrganizationStatus;
  
  // Metadata
  tags: string[];                      // User-defined tags
  notes: string;                       // User notes
  createdAt: Date;
  updatedAt: Date;
}
