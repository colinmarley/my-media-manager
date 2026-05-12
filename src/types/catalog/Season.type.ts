import {
  AuditFields,
  CastEntry,
  DirectorReference,
  ExternalIds,
  ImageFile,
  SeasonStatus,
} from './Common.type';

export interface Episode {
  id: string;
  title: string;
  number: number;
  runtime: string;
}

export interface CatalogSeason extends AuditFields {
  id: string;
  title: string;
  titleLower?: string;
  seriesId: string; // Reference to the series this season belongs to
  number: number;
  countryOfOrigin: string[];
  directors: DirectorReference[];
  imageFiles: ImageFile[];
  letterboxdLink?: string;
  plexLink?: string;
  releaseDate: string;
  releaseIds?: string[];
  runtime: string;
  topCast: CastEntry[];
  writers: string[];
  isPartOfCollection: boolean;
  collectionIds?: string[];
  episodes: Episode[];
  genres?: string[];
  languages?: string[];
  regionCode?: string;
  externalIds?: ExternalIds;
  plot?: string;
  status?: SeasonStatus;
  episodeCount?: number;
  posterUrl?: string;
}