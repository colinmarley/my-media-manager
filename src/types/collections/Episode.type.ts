import { OmdbResponseFull } from "../OmdbResponse.type";
import { EpisodeNumber, EpisodeDirector, ImageFile, ActorPreview } from "./Common.type";

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
    cast: ActorPreview[];
    writers: string[];
    languages: string[];
    omdbData: OmdbResponseFull;
    notes?: string;
}