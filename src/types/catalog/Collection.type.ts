import { AuditFields, CollectionType, ImageFile } from './Common.type';

export interface CatalogCollection extends AuditFields {
    id: string;
    title: string;
    description: string;
    imageFiles: ImageFile[];
    movieIds?: string[];
    seriesIds?: string[];
    seasonIds?: string[];
    episodeIds?: string[];
    directors: string[];
    genres: string[];
    type?: CollectionType;
    sortOrder?: Record<string, number>;
    startYear?: number | null;
    endYear?: number | null;
    entryCount?: number;
    coverMediaId?: string | null;
}
