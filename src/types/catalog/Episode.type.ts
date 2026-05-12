import {
  AuditFields,
  CastEntry,
  DirectorReference,
  ExternalIds,
  ImageFile,
} from './Common.type';

export interface CatalogEpisode extends AuditFields {
  id: string;
  title: string;
  titleLower?: string;
  seasonId: string; // Reference to the season this episode belongs to
  seriesId: string; // Reference to the series this episode belongs to
  seasonNumber?: number;
  seriesTitle?: string;
  episodeNumber: number;
  notes: string;
  countryOfOrigin: string[];
  directors: DirectorReference[];
  imageFiles: ImageFile[];
  letterboxdLink?: string;
  plexLink?: string;
  airDate: string;
  releaseIds?: string[];
  runtime: string;
  topCast: CastEntry[];
  writers: string[];
  synopsis?: string;
  thumbnailUrl?: string | null;
  isPartOfCollection?: boolean;
  collectionIds?: string[];
  genres?: string[];
  languages?: string[];
  regionCode?: string;
  externalIds?: ExternalIds;
}