import { OmdbResponseFull } from '../OmdbResponse.type';
import { Director, ImageFile } from './FBCommon.type';
import { FBRelease } from './FBRelease.type';

export interface Episode {
  id: string;
  title: string;
  number: number;
  runtime: string;
}

export interface FBSeason {
  id: string;
  title: string;
  seriesId: string; // Reference to the series this season belongs to
  number: number;
  countryOfOrigin: string;
  directors: Director[];    
  imageFiles: ImageFile[];
  letterboxdLink?: string; // Optional field for Letterboxd link
  plexLink?: string; // Optional field for Plex link
  omdbData: OmdbResponseFull;
  releaseDate: string;
  releases: FBRelease[];
  runtime: string;
  topCast: string[];
  writers: string[];
  isPartOfCollection: boolean;
  collectionIds?: string[]; // Optional field for collection IDs
  episodes: Episode[];
  // Additional suggested fields
  genres?: string[]; // Optional field for the genre
  language?: string; // Optional field for the language
  regionCode?: string; // Optional field for the region code
}