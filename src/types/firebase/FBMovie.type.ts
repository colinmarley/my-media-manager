import { TopCastEntry } from '../inputs/MovieInputs';
import { OmdbResponseFull } from '../OmdbResponse.type';
import { FBRelease } from './FBRelease.type';

export interface Director {
  name: string;
  title: string;
}

export interface ImageFile {
  fileName: string;
  fileSize: number; // in bytes
  resolution: string; // e.g., "1920x1080"
  format: string; // e.g., "jpg", "png"
}

export interface FBMovie {
  id: string;
  title: string;
  countryOfOrigin: string;
  directors: Director[];
  imageFiles: ImageFile[];
  letterboxdLink?: string; // Optional field for Letterboxd link
  plexLink?: string; // Optional field for Plex link
  omdbData: OmdbResponseFull;
  releaseDate: string;
  releases: FBRelease[];
  runtime: string;
  topCast: TopCastEntry[];
  writers: string[];
  isPartOfCollection: boolean;
  // Additional suggested fields
  genres?: string[]; // Optional field for the genres
  language?: string; // Optional field for the language
}