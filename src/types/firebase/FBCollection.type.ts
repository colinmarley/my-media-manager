import { Director, DirectorEntry, ImageFile } from "./FBCommon.type";
import { EpisodeInfoSmall, MovieInfoSmall, SeasonInfoSmall, SeriesInfoSmall } from "./FBRelease.type";

export interface FBCollection {
    id: string;
    title: string;
    description: string;
    imageFiles: string[];
    movieIds?: string[];
    seriesIds?: string[];
    seasonIds?: string[];
    episodeIds?: string[];
    directors: string[];
    genres: string[];
}
