import {
  AuditFields,
  CastEntry,
  DirectorReference,
  ExternalIds,
  ImageFile,
  SeriesStatus,
} from './FBCommon.type';

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

export interface FBSeries extends AuditFields {
  id: string;
  title: string;
  titleLower?: string;
  countryOfOrigin: string[];
  directors: DirectorReference[];
  imageFiles: ImageFile[];
  letterboxdLink?: string;
  plexLink?: string;
  runningDates: string;
  releaseIds: string[];
  runtime: string;
  topCast: CastEntry[];
  writers: string[];
  isPartOfCollection: boolean;
  collectionIds?: string[];
  seasons: Season[];
  genres?: string[];
  languages?: string[];
  regionCode?: string;
  externalIds?: ExternalIds;
  plot?: string;
  totalSeasons?: number;
  status?: SeriesStatus;
  network?: string;
  contentRating?: string;
  awards?: string;
}