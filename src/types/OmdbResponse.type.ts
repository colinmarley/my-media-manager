export interface OmdbSearchResponse {
    Title: string;
    Year: string;
    imdbID: string;
    Type: string;
    Poster: string;
}
export interface OmdbResponseFull {
    title: string;
    year: string;
    rated: string;
    released: string;
    runtime: string;
    genre: string;
    director: string;
    writer: string;
    actors: string;
    plot: string;
    language: string;
    country: string;
    awards: string;
    poster: string;
    ratings: Rating[];
    metascore: string;
    imdbRating: string;
    imdbVotes: string;
    imdbID: string;
    type: string;
    dvd?: string; // Optional field for movies
    boxOffice?: string; // Optional field for movies
    production?: string; // Optional field for movies
    website?: string; // Optional field for movies
    response: string;
    totalSeasons?: string; // Optional field for series
}

export interface Rating {
    source: string;
    value: string;
}