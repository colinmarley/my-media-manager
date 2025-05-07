export interface MovieDirector {
    name: string;
    title: string;
    directorId: string;
}

export interface SeriesDirector {
    name: string;
    title: string;
    seasons?: string[];
    directorId: string;
}

export interface SeasonDirector {
    name: string;
    title: string;
    directorId: string;
}

export interface EpisodeDirector {
    name: string;
    title: string;
    directorId: string;
}

export interface Actor {
    name: string;
    actorId: string;
    characters: string[];
}

export interface ImageFile {
    fileName: string;
    fileSize: string;
    format: string;
    resolution: string;
}

export interface Release {
    releaseId: string;
    releaseType: string;
    year: string;
    releaseName: string;
}

export interface EpisodeNumber {
    number: string;
    variation?: string;
}

export interface EpisodeData {
    episodeId: string;
    episodeName: string;
    episodeNumber: string;
}

export interface Extra {
    description: string;
    extraImage: string[];
    runtime: string;
}

export interface Insert {
    description: string;
    insertImage: string;
    dataString: string;
}

export interface SeasonEntry {
    id: string;
    number: string;
}

export interface OmdbData {
    // Define fields based on the OmdbData structure
}