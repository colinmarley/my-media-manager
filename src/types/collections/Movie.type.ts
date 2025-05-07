import { MovieDirector, ImageFile, Release, Actor, OmdbData } from "./Common.type";

export interface Movie {
    id: string;
    title: string;
    countries: string[];
    directors: MovieDirector[];
    genres: string[];
    imageFiles: ImageFile[];
    languages: string[];
    letterboxdLink?: string;
    plexLink?: string;
    releaseDate: string;
    releases: Release[];
    runtime: string;
    cast: Actor[];
    writers: string[];
    omdbData: OmdbData;
}