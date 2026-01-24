/**
 * Media Assignment Type Definitions
 * Based on DATA_STRUCTURE_REDESIGN.md
 */

export type AssignmentOrganizationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type OperationType = 'create_folder' | 'move_file' | 'rename_file' | 'copy_file';
export type OperationStatus = 'success' | 'failed';

export interface OrganizationOperation {
  timestamp: Date;
  operation: OperationType;
  sourcePath: string;
  destinationPath: string;
  status: OperationStatus;
  errorMessage?: string;
}

export interface TargetFolderStructure {
  libraryRoot: string;                 // Base Jellyfin library path
  mediaFolder: string;                 // Movie/Series specific folder
  fullPath: string;                    // Complete target path
  folderName: string;                  // Final folder name (Jellyfin format)
  fileName: string;                    // Target filename (Jellyfin format)
}

export interface MediaAssignment {
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
  targetFolderStructure: TargetFolderStructure;
  
  // Organization Status
  organizationStatus: AssignmentOrganizationStatus;
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
