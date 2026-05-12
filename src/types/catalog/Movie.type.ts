import { AuditFields, CastEntry, DirectorEntry, ExternalIds, ImageFile } from './Common.type';

export interface CatalogMovie extends AuditFields {
  id: string;
  title: string;
  titleLower?: string;
  countryOfOrigin: string[];
  directors: DirectorEntry[];
  imageFiles: ImageFile[];
  letterboxdLink?: string;
  plexLink?: string;
  releaseDate: string;
  releaseIds: string[];
  runtime: string;
  topCast: CastEntry[];
  writers: string[];
  isPartOfCollection: boolean;
  genres?: string[];
  languages?: string[];
  externalIds?: ExternalIds;
  imdbId?: string;
  plot?: string;
  certification?: string;
  imdbRating?: string;
  rottenTomatoesScore?: string | null;
  awards?: string;
  boxOffice?: string | null;
}