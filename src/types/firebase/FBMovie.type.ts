import { TopCastEntry } from '../inputs/MovieInputs';
import { OmdbResponseFull } from '../OmdbResponse.type';
import { FBRelease } from './FBRelease.type';
import { ImageFile, DirectorEntry } from './FBCommon.type';

export interface FBMovie {
  id: string;
  title: string;
  countryOfOrigin: string;
  directors: DirectorEntry[];
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