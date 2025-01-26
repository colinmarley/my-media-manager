export interface OmdbSearchResponse {
    Title: string;
    Year: string;
    imdbID: string;
    Type: string;
    Poster: string;
}
export interface OmdbResponseFull {
    Title: string;
    Year: string;
    Rated: string;
    Released: string;
    Runtime: string;
    Genre: string;
    Director: string;
    Writer: string;
    Actors: string;
    Plot: string;
    Language: string;
    Country: string;
    Awards: string;
    Poster: string;
    Ratings: Rating[];
    Metascore: string;
    imdbRating: string;
    imdbVotes: string;
    imdbID: string;
    Type: string;
    Dvd?: string; // Optional field for movies
    BoxOffice?: string; // Optional field for movies
    Production?: string; // Optional field for movies
    Website?: string; // Optional field for movies
    Response: string;
    TotalSeasons?: string; // Optional field for series
}

export interface Rating {
    Source: string;
    Value: string;
}