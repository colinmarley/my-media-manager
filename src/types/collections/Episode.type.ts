import { EpisodeNumber, EpisodeDirector, ImageFile, Actor, OmdbData } from "./Common.type";

export interface Episode {
    id: string;
    title: string;
    seasonId: string;
    seriesId: string;
    episodeNumber: EpisodeNumber;
    plot: string;
    countries: string[];
    directors: EpisodeDirector[];
    imageFiles: ImageFile[];
    plexLink?: string;
    releaseDate: string;
    runtime: string;
    cast: Actor[];
    writers: string[];
    languages: string[];
    omdbData: OmdbData;
    notes?: string;
}