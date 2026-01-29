import { OmdbResponseFull } from "../OmdbResponse.type";
import { MovieDirector, ImageFile, ReleasePreview, ActorPreview } from "./Common.type";
import { MediaFileInfo, LibraryStatus } from "../library/LibraryTypes";

export interface MediaVersion {
  fileId: string;
  version: string;                     // "1080p", "4K", "Director's Cut"
  resolution: string;
  fileSize: number;
  codec: string;
  isPreferred: boolean;
}

export interface ContentRating {
  country: string;                     // "US", "UK", "JP"
  rating: string;                      // "PG-13", "15", "R"
  ratingSystem: string;                // "MPAA", "BBFC"
}

export interface AssignmentSummary {
  totalFiles: number;
  assignedFiles: number;
  unassignedFiles: number;
  versions: MediaVersion[];            // Different quality versions
  hasPhysicalCopy: boolean;
  totalFileSize: number;               // Combined size in bytes
  totalFileSizeFormatted: string;      // "45.2 GB"
}

export interface JellyfinInfo {
  folderId: string;                    // Reference to jellyfin_folders
  folderName: string;                  // Current Jellyfin folder name
  folderPath: string;                  // Full path
  isOrganized: boolean;                // Files in correct locations
  lastOrganized?: Date;
}

export interface ExternalIds {
  imdbId?: string;                     // tt1234567
  tmdbId?: number;
  rottenTomatoesId?: string;
  metacriticId?: string;
  letterboxdId?: string;
}

export interface TheatricalRelease {
  date: Date;
  runtime: number;                     // Minutes
  runtimeFormatted: string;            // "2h 15m"
}

export interface MovieCollection {
  collectionId: string;
  collectionName: string;              // "Star Wars Collection"
  orderInCollection: number;
}

export interface Movie {
    id: string; // Unique identifier for the movie
    title: string; // Original title of the movie
    titleLower: string; // Lowercase title for efficient case-insensitive search
    countries: string[]; // Countries where the movie originated
    directors: MovieDirector[]; // List of directors involved in the movie
    genres: string[]; // Genres of the movie, must match predefined enums
    imageFiles: ImageFile[]; // Images related to the movie (e.g., posters, stills)
    languages: string[]; // Original languages of the movie
    letterboxdLink?: string; // Optional URL to the Letterboxd page
    plexLink?: string; // Optional URL to the Plex page
    releaseDate: string; // Release date in the format "DayAsNumber-Month-Year"
    releases: ReleasePreview[]; // Known releases of the movie on physical media
    runtime: string; // Runtime in the format "{hours}:{minutes}:{seconds}"
    cast: ActorPreview[]; // List of actors in the movie
    writers: string[]; // Names of writers credited in the movie
    omdbData: OmdbResponseFull; // OMDB data for the movie
    
    // DEPRECATED - To be removed after migration
    libraryFiles?: MediaFileInfo[]; // @deprecated Use media_assignments collection
    folderPath?: string; // @deprecated Use jellyfinInfo.folderPath
    libraryStatus?: LibraryStatus; // @deprecated Use assignmentSummary
    lastVerified?: Date; // @deprecated Use jellyfinInfo.lastOrganized
    libraryNotes?: string; // @deprecated Use notes in media_assignments
    
    // NEW: Assignment Summary
    assignmentSummary?: AssignmentSummary;
    
    // NEW: Jellyfin Integration
    jellyfinInfo?: JellyfinInfo;
    
    // NEW: Enhanced IMDB/TMDB IDs
    externalIds: ExternalIds;
    
    // NEW: Enhanced Release Information
    theatricalRelease?: TheatricalRelease;
    
    // NEW: Content Ratings
    contentRatings: ContentRating[];
    
    // NEW: Collections/Franchises
    belongsToCollection?: MovieCollection;
}