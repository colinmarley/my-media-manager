/**
 * Jellyfin Folder Type Definitions
 * Based on DATA_STRUCTURE_REDESIGN.md
 */

export type JellyfinFolderType = 'movie' | 'series' | 'season' | 'extras';

export interface JellyfinFolder {
  id: string;
  
  // Folder Info
  folderPath: string;                  // Full path
  folderName: string;                  // Jellyfin-compliant name
  folderType: JellyfinFolderType;
  
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
