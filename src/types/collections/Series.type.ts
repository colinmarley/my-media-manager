import { OmdbResponseFull } from "../OmdbResponse.type";
import { SeriesDirector, SeasonEntry, ImageFile, ActorPreview } from "./Common.type";
import { Release } from "./Release.type";
import { MediaFileInfo, LibraryStatus } from "../library/LibraryTypes";

export interface Series {
    id: string; // Unique identifier for the series
    title: string; // Original title of the series
    countries: string[]; // Countries where the series originated
    directors: SeriesDirector[]; // List of directors involved in the series
    imageFiles: ImageFile[]; // Images related to the series (e.g., posters, stills)
    plexLink?: string; // Optional URL to the Plex page
    runningYears: string[]; // Years the series aired, each entry is a single year
    releases: Release[]; // Known releases of the series on physical media
    cast: ActorPreview[]; // List of actors in the series
    writers: string[]; // Names of writers credited in the series
    seasons: SeasonEntry[]; // List of seasons in the series
    awards?: string; // Summary of awards received by the series
    genres: string[]; // Genres of the series, must match predefined enums
    languages: string[]; // Original languages of the series
    notes?: string; // Additional notes about the series
    omdbData: OmdbResponseFull; // OMDB data for the series
    
    // Library Management Fields
    libraryFiles?: MediaFileInfo[]; // Physical files associated with this series
    folderPath?: string; // Library folder location
    libraryStatus?: LibraryStatus; // Current status in library
    lastVerified?: Date; // Last time files were verified
    libraryNotes?: string; // Notes about library organization
}