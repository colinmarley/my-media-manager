import { Extra, ImageFile, Insert } from "./Common.type";

export interface Release {
    id: string;
    containsExtras: boolean;
    extras: Extra[];
    containsInserts: boolean;
    inserts: Insert[];
    discIds: string[];
    discTypes: string[];
    episodeIds: string[];
    mediaType: string;
    movieIds: string[];
    seasonIds: string[];
    seriesIds: string[];
    title: string;
    year: string;
    imageFiles: ImageFile[];
}