import { SeriesDirector, SeasonEntry, ImageFile, Actor, OmdbData } from "./Common.type";
import { Release } from "./Release.type";

export interface Series {
    id: string;
    title: string;
    countries: string[];
    directors: SeriesDirector[];
    imageFiles: ImageFile[];
    plexLink?: string;
    runningYears: string[];
    releases: Release[];
    cast: Actor[];
    writers: string[];
    seasons: SeasonEntry[];
    awards?: string;
    genres: string[];
    languages: string[];
    notes?: string;
    omdbData: OmdbData;
}