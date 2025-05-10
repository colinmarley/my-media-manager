enum MediaGenre {
    Action = 'Action',
    Adventure = 'Adventure',
    Animation = 'Animation',
    Biography = 'Biography',
    Comedy = 'Comedy',
    Crime = 'Crime',
    Drama = 'Drama',
    Family = 'Family',
    Fantasy = 'Fantasy',
    FilmNoir = 'Film Noir',
    History = 'History',
    Horror = 'Horror',
    Music = 'Music',
    Musical = 'Musical',
    Mystery = 'Mystery',
    Romance = 'Romance',
    SciFi = 'Sci-Fi',
    Sport = 'Sport',
    Superhero = 'Superhero',
    Thriller = 'Thriller',
    War = 'War',
    Western = 'Western',
}

enum MediaType {
    Movie = 'Movie',
    Series = 'Series',
}

enum DiscType {
    DVD = 'DVD',
    BluRay = 'Blu-Ray',
    UHD = 'UHD',
}

enum ReleaseType {
    DVD = 'DVD',
    BluRay = 'Blu-Ray',
    UHD = 'UHD',
    Digital = 'Digital',
    Streaming = 'Streaming',
    VHS = 'VHS',
    PSP = 'PSP',
}

enum ExtraType {
    BehindTheScenes = 'Behind the Scenes',
    DeletedScenes = 'Deleted Scenes',
    Featurette = 'Featurette',
    Interview = 'Interview',
    Trailer = 'Trailer',
    MusicVideo = 'Music Video',
    ShortFilm = 'Short Film',
    Commentary = 'Commentary',
    EndOfCreditScene = 'End of Credit Scene',
    CutScene = 'Cut Scene',
}

enum MediaRating {
    G = 'G',
    PG = 'PG',
    PG13 = 'PG-13',
    R = 'R',
    NC17 = 'NC-17',
    NOT_RATED = 'Not Rated',
    UNRATED = 'Unrated',
    TV_Y = 'TV-Y',
    TV_Y7 = 'TV-Y7',
    TV_G = 'TV-G',
    TV_PG = 'TV-PG',
    TV_14 = 'TV-14',
    TV_MA = 'TV-MA',
    UNKNOWN = 'Unknown',
}

enum MediaCertification {
    G = 'G',
    PG = 'PG',
    PG13 = 'PG-13',
    R = 'R',
    NC17 = 'NC-17',
    NOT_RATED = 'Not Rated',
    UNRATED = 'Unrated',
    TV_Y = 'TV-Y',
    TV_Y7 = 'TV-Y7',
    TV_G = 'TV-G',
    TV_PG = 'TV-PG',
    TV_14 = 'TV-14',
    TV_MA = 'TV-MA',
}

export { MediaCertification, MediaGenre, MediaType, MediaRating, DiscType, ReleaseType, ExtraType };
