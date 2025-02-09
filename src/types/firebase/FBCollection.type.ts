import { Director, ImageFile } from "./FBCommon.type";
import { EpisodeInfoSmall, MovieInfoSmall, SeasonInfoSmall, SeriesInfoSmall } from "./FBRelease.type";

export interface FBCollection {
    id: string;
    title: string;
    description: string;
    imageFiles: ImageFile[];
    movieIds?: MovieInfoSmall[];
    seriesIds?: SeriesInfoSmall[];
    seasonIds?: SeasonInfoSmall[];
    episodeIds?: EpisodeInfoSmall[];
    directors: Director[];
    genres: string[];
}
