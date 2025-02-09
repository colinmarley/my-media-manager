import { MovieInfoSmall, SeriesInfoSmall } from "./FBRelease.type";

export interface Director {
    name: string;
    notes: string;
    portfolio: MovieInfoSmall[] | SeriesInfoSmall[];
    otherCollections: string[];
    awards: string[];
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
  