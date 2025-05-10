import { OmdbResponseFull } from "../OmdbResponse.type";
import { MovieDirector, ImageFile, ReleasePreview, ActorPreview } from "./Common.type";

export interface Movie {
    id: string; // Unique identifier for the movie
    title: string; // Original title of the movie
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
}