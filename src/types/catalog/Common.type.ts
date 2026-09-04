// This file contains common types used in media operations
export interface DirectorEntry {
  directorId?: string;
  fullName: string;
  title: string;
}

export interface DirectorReference {
  fullName: string;
  notes?: string;
  portfolio?: string[];
  otherCollections?: string[];
  awards?: Award[];
}

export interface ImageFile {
  fileName: string;
  fileSize: number; // in bytes
  resolution: string; // e.g., "1920x1080"
  format: string; // e.g., "jpg", "png"
}

export interface VideoFile {
  fileName: string;
  fileSize: number; // in bytes
  duration: number; // in seconds
  resolution: string; // e.g., "1920x1080"
  format: string; // e.g., "mp4", "mkv"
}

export interface CastEntry {
  actorName: string;
  characterName?: string;
  actorId?: string;
}

export interface Award {
  title: string;
  year: number;
  category: string;
  result: 'Won' | 'Nominated';
}

export interface ExternalIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface AuditFields {
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export type DiscFormat = 'DVD' | 'BLURAY' | 'HD_DVD' | 'UHD_BLURAY' | 'LASERDISC';

export type MediaType = 'MOVIE' | 'SERIES' | 'SEASON' | 'DOUBLE_FEATURE';

export type CatalogMediaType = Lowercase<MediaType>;

export type SeriesStatus = 'Continuing' | 'Ended' | 'Cancelled' | 'Upcoming';

export type SeasonStatus = 'Aired' | 'Upcoming' | 'Partial';

export type DiscCondition = 'Mint' | 'Good' | 'Fair' | 'Poor';

// Physical storage location for a loose disc/tape (a labeled box or binder
// on a shelf) — independent of DiscSet/set_id, which group discs/tapes by
// *content* (main feature + special features, etc.), not where they live.
export type StorageType = 'Box' | 'Binder';

export type CollectionType = 'Director' | 'Franchise' | 'Thematic' | 'Boxset' | 'Custom';
  