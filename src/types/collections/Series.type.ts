import { OmdbResponseFull } from "../OmdbResponse.type";
import { SeriesDirector, SeasonEntry, ImageFile, ActorPreview } from "./Common.type";
import { Release } from "./Release.type";
import { MediaFileInfo, LibraryStatus } from "../library/LibraryTypes";

export type SeriesStatus = 'returning' | 'ended' | 'cancelled' | 'hiatus';

export interface SeriesSummary {
  totalSeasons: number;
  totalEpisodes: number;
  totalRuntime: number;                // Total minutes across all episodes
  firstAired: Date;
  lastAired?: Date;
  status: SeriesStatus;
}

export interface SeriesAssignmentSummary {
  seasonsWithFiles: number;
  episodesWithFiles: number;
  totalFiles: number;
  totalFileSize: number;
  totalFileSizeFormatted: string;
}

export interface SeasonFolderInfo {
  seasonNumber: number;
  folderId: string;
  folderName: string;                  // "Season 01"
  episodeCount: number;
  hasAllEpisodes: boolean;
}

export interface SeriesJellyfinInfo {
  folderId: string;
  folderName: string;
  folderPath: string;
  seasonFolders: SeasonFolderInfo[];
  isOrganized: boolean;
}

export interface SeriesExternalIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  tvMazeId?: number;
}

export interface Series {
    id: string; // Unique identifier for the series
    title: string; // Original title of the series
    titleLower: string; // Lowercase title for efficient case-insensitive search
    countries: string[]; // Countries where the series originated
    directors: SeriesDirector[]; // List of directors involved in the series
    imageFiles: ImageFile[]; // Images related to the series (e.g., posters, stills)
    plexLink?: string; // Optional URL to the Plex page
    runningYears: string[]; // Years the series aired, each entry is a single year
    releases: Release[]; // Known releases of the series on physical media
    cast: ActorPreview[]; // List of actors in the series
    writers: string[]; // Names of writers credited in the series
    seasons: SeasonEntry[]; // @deprecated Use separate seasons collection
    awards?: string; // Summary of awards received by the series
    genres: string[]; // Genres of the series, must match predefined enums
    languages: string[]; // Original languages of the series
    notes?: string; // Additional notes about the series
    omdbData: OmdbResponseFull; // OMDB data for the series
    
    // DEPRECATED - To be removed after migration
    libraryFiles?: MediaFileInfo[]; // @deprecated Use media_assignments collection
    folderPath?: string; // @deprecated Use jellyfinInfo.folderPath
    libraryStatus?: LibraryStatus; // @deprecated Use assignmentSummary
    lastVerified?: Date; // @deprecated Use jellyfinInfo.lastOrganized
    libraryNotes?: string; // @deprecated Use notes in media_assignments
    
    // NEW: Series Summary
    seriesSummary: SeriesSummary;
    
    // NEW: Assignment Summary
    assignmentSummary?: SeriesAssignmentSummary;
    
    // NEW: Jellyfin Integration
    jellyfinInfo?: SeriesJellyfinInfo;
    
    // NEW: External IDs
    externalIds: SeriesExternalIds;
}