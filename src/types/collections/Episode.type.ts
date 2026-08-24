import { OmdbResponseFull } from "../OmdbResponse.type";
import { EpisodeNumber, EpisodeDirector, ImageFile, ActorPreview } from "./Common.type";

export interface EpisodeExternalIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface Episode {
    id: string;
    
    // Series/Season References
    seriesId: string;
    seasonId: string;
    seriesTitle: string;
    
    // Episode Info
    seasonNumber: number;
    episodeNumber: number;
    episodeNumbers?: number[]; // For multi-part episodes [1, 2]
    title: string;
    plot?: string; // @deprecated Use overview
    overview?: string; // Episode description
    
    // Air Date & Runtime
    airDate?: Date;
    releaseDate?: string; // @deprecated Use airDate
    runtime?: number; // Minutes
    runtimeFormatted?: string; // "45m"
    
    // Credits
    countries: string[];
    directors: EpisodeDirector[];
    writers: string[];
    languages: string[];
    cast: ActorPreview[];
    guestStars?: ActorPreview[]; // Guest stars for this episode
    
    // Media
    imageFiles: ImageFile[];
    stillImage?: ImageFile; // Episode still/thumbnail
    plexLink?: string;
    
    // External IDs
    externalIds: EpisodeExternalIds;
    
    // File Assignment (simplified - detailed in media_assignments)
    hasFile: boolean;
    fileId?: string; // Primary video file
    fileCount: number; // Total related files
    
    // Jellyfin Integration
    jellyfinFilename?: string; // "Series Name (2020) S01E01.mkv"
    
    // Metadata
    omdbData: OmdbResponseFull;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}