import { SeasonDirector, ImageFile, Release, Actor, EpisodeData, OmdbData } from "./Common.type";

export interface Season {
    id: string;
    title: string;
    seriesId: string;
    number: string;
    countries: string[];
    directors: SeasonDirector[];
    imageFiles: ImageFile[];
    plexLink?: string;
    releaseYear: string;
    releases: Release[];
    cast: Actor[];
    writers: string[];
    episodes: EpisodeData[];
    languages: string[];
    omdbData: OmdbData;
}