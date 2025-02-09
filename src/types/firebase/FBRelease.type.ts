export interface FBRelease {
  id: string;
  containsExtras: boolean; // whether the release contains extra features
  containsInserts: boolean; // e.g., posters, booklets
  discIds: string[]; // Array of disc references
  discTypes: string[]; // Array of disc types (e.g., "DVD", "BLURAY", "HDDVD")
  episodeIds?: EpisodeInfoSmall[]; // Array of episode references
  extras: Extra[]; // Array of extras
  mediaType: string; // e.g., "MOVIE", "SERIES", "DOUBLE_FEATURE"
  movieIds?: MovieInfoSmall[]; // Array of movie references
  seasonIds?: SeasonInfoSmall[]; // Array of season references
  seriesIds?: SeriesInfoSmall[]; // Array of searies references
  title: string; // Title of the release
  year: number; // Year of the release
  images: ImageFile[]; // Array of image files
}

export interface Extra {
  runtime: string;
  title: string;
  type: string;
}
  
export interface ImageFile {
    fileName: string;
    description: string;
    fileSize: number; // in bytes
    resolution: string; // e.g., "1920x1080"
    format: string; // e.g., "jpg", "png"
}

export interface MovieInfoSmall {
    id: string;
    title: string;
    releaseYear: number;
}

export interface SeasonInfoSmall {
    id: string;
    title: string;
    releaseYear: number;
}

export interface SeriesInfoSmall {
    id: string;
    title: string;
    releaseYear: number;
}

export interface EpisodeInfoSmall {
    id: string;
    title: string;
    releaseDate: number;
}
