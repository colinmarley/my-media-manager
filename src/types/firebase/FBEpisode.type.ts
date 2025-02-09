import { OmdbResponseFull } from '../OmdbResponse.type';
import { Director, ImageFile } from './FBCommon.type';
import { FBRelease } from './FBRelease.type';

export interface FBEpisode {
  id: string;
  title: string;
  seasonId: string; // Reference to the season this episode belongs to
  seriesId: string; // Reference to the series this episode belongs to
  episodeNumber: string;
  notes: string;
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
  actors: string[];
  isPartOfCollection: boolean;
  collectionIds?: string[]; // Optional field for collection IDs
  // Additional suggested fields
  genres?: string[]; // Optional field for the genre
  language?: string; // Optional field for the language
  regionCode?: string; // Optional field for the region code
}