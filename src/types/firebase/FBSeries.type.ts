import { OmdbResponseFull } from '../OmdbResponse.type';
import { Director, ImageFile } from './FBCommon.type';
import { FBRelease } from './FBRelease.type';

export interface Extra {
  runtime: string;
  title: string;
  type: string;
}

export interface Season {
  id: string;
  title: string;
  number: number;
  episodes: Episode[];
}

export interface Episode {
  id: string;
  title: string;
  number: number;
  runtime: string;
}

export interface FBSeries {
  id: string;
  title: string;
  countryOfOrigin: string;
  directors: Director[];
  imageFiles: ImageFile[];
  letterboxdLink?: string; // Optional field for Letterboxd link
  plexLink?: string; // Optional field for Plex link
  omdbData: OmdbResponseFull;
  runningDates: string; // e.g., "2005-2010"
  releases: FBRelease[];
  runtime: string;
  topCast: string[];
  writers: string[];
  isPartOfCollection: boolean;
  collectionIds?: string[]; // Optional field for collection IDs
  seasons: Season[];
  // Additional suggested fields
  genres?: string[]; // Optional field for the genre
  language?: string; // Optional field for the language
  regionCode?: string; // Optional field for the region code
}