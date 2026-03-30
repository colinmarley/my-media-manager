import { AuditFields, DiscFormat, ImageFile, MediaType } from './FBCommon.type';

export interface FBRelease extends AuditFields {
    id: string;
    containsExtras: boolean;
    containsInserts: boolean;
    discIds: string[];
    discTypes: DiscFormat[];
    episodeIds?: EpisodeInfoSmall[];
    extras: Extra[];
    mediaType: MediaType;
    movieIds?: MovieInfoSmall[];
    seasonIds?: SeasonInfoSmall[];
    seriesIds?: SeriesInfoSmall[];
    title: string;
    year: number;
    images: ImageFile[];
    edition?: string;
    publisher?: string;
    territory?: string;
    releaseDate?: string | null;
    spineNumber?: string | null;
    outOfPrint?: boolean;
    upc?: string | null;
}

export interface Extra {
  runtime: string;
  title: string;
  type: string;
}
  
export interface ImageFile {
    fileName: string;
    description: string;
    fileSize: number; // in bytes
    resolution: string; // e.g., "1920x1080"
    format: string; // e.g., "jpg", "png"
}

export interface MovieInfoSmall {
    id: string;
    title?: string;
    releaseYear?: number;
}

export interface SeasonInfoSmall {
    id: string;
    title?: string;
    releaseYear?: number;
}

export interface SeriesInfoSmall {
    id: string;
    title?: string;
    releaseYear?: number;
}

export interface EpisodeInfoSmall {
    id: string;
    title?: string;
    releaseDate?: number;
}
