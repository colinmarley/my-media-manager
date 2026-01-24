/**
 * Central exports for new library types
 * Based on DATA_STRUCTURE_REDESIGN.md
 */

// Core media file types
export type {
  MediaFile,
  AudioTrack,
  SubtitleTrack,
  VideoMetadata,
  ParsedFileInfo,
  AssignmentStatus,
  MediaType,
  DetectedMediaType,
  OrganizationStatus
} from './MediaFile.type';

// Media assignment types
export type {
  MediaAssignment,
  TargetFolderStructure,
  OrganizationOperation,
  AssignmentOrganizationStatus,
  OperationType,
  OperationStatus
} from './MediaAssignment.type';

// Jellyfin folder types
export type {
  JellyfinFolder,
  JellyfinFolderType
} from './JellyfinFolder.type';

// Re-export existing library types
export type {
  LibraryPath,
  MediaFileInfo,
  FolderStructure,
  NamingConvention,
  ScanResult,
  ScanProgress,
  ScanError,
  MediaMatch,
  MatchSuggestion,
  VideoQuality,
  AudioTrack as LegacyAudioTrack,
  SubtitleTrack as LegacySubtitleTrack,
  LibraryStatus,
  ScanStatus
} from './LibraryTypes';
