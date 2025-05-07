// This file contains common types used in Firebase-related operations
export interface DirectorEntry {
    directorId?: string;
    fullName: string;
    title: string;
}

export interface ImageFile {
  fileName: string;
  fileSize: number; // in bytes
  resolution: string; // e.g., "1920x1080"
  format: string; // e.g., "jpg", "png"
}

export interface VideoFile {
    fileName: string;
    fileSize: number; // in bytes
    duration: number; // in seconds
    resolution: string; // e.g., "1920x1080"
    format: string; // e.g., "mp4", "mkv"
  }
  