import { OmdbResponseFull } from "../OmdbResponse.type";
import { SeasonDirector, ImageFile, ReleasePreview, ActorPreview, EpisodeData } from "./Common.type";

export interface Season {
    id: string; // Unique identifier for the season
    title: string; // Title of the season or volume
    seriesId: string; // ID of the series this season belongs to
    number: string; // Season number, formatted as "Season X" or "Volume Y"
    countries: string[]; // Countries where the season was filmed or released
    directors: SeasonDirector[]; // List of directors involved in the season
    imageFiles: ImageFile[]; // Images related to the season (e.g., posters, stills)
    plexLink?: string; // Optional URL to the Plex page
    releaseYear: string; // Year the season was first aired or released
    releases: ReleasePreview[]; // Known releases of the season on physical media
    cast: ActorPreview[]; // List of actors in the season
    writers: string[]; // Names of writers credited in the season
    episodes: EpisodeData[]; // Preview data for episodes in the season
    languages: string[]; // Original languages of the season
    omdbData: OmdbResponseFull; // OMDB data for the season
}