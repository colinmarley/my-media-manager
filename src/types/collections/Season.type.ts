import { OmdbResponseFull } from "../OmdbResponse.type";
import { SeasonDirector, ImageFile, ReleasePreview, ActorPreview, EpisodeData } from "./Common.type";

export interface Season {
    id: string; // Unique identifier for the season
    
    // Series Reference
    seriesId: string; // ID of the series this season belongs to
    seriesTitle: string; // Title of the series
    
    // Season Info
    seasonNumber: number; // Season number as integer
    seasonName?: string; // "Season 1", "Season 01"
    title?: string; // @deprecated Use seasonName
    alternateTitle?: string; // "The Beginning"
    number?: string; // @deprecated Use seasonNumber
    
    // Episode Summary
    totalEpisodes: number;
    episodeIds: string[]; // References to episodes collection
    episodes?: EpisodeData[]; // @deprecated Use episodeIds and query episodes collection
    firstAired?: Date;
    lastAired?: Date;
    
    // Credits
    countries: string[]; // Countries where the season was filmed or released
    directors: SeasonDirector[]; // List of directors involved in the season
    cast: ActorPreview[]; // List of actors in the season
    writers: string[]; // Names of writers credited in the season
    languages: string[]; // Original languages of the season
    
    // Media
    imageFiles: ImageFile[]; // Images related to the season (e.g., posters, stills)
    posterImage?: ImageFile; // Main poster
    overview?: string; // Season description
    
    // Release Info
    releaseYear: string; // Year the season was first aired or released
    releases: ReleasePreview[]; // Known releases of the season on physical media
    plexLink?: string; // Optional URL to the Plex page
    
    // Jellyfin Integration
    jellyfinFolderId?: string; // Reference to jellyfin_folders
    jellyfinFolderName: string; // "Season 01"
    
    // Assignment Summary
    episodesWithFiles: number;
    totalFiles: number;
    totalFileSize: number;
    
    // Metadata
    omdbData: OmdbResponseFull; // OMDB data for the season
    createdAt: Date;
    updatedAt: Date;
}