/**
 * The file inventory as the backend reports it (backend/api/media_files.py,
 * `_media_file_to_dict` in backend/api/catalog.py). Every technical field is
 * nullable: a file that has not been probed yet, or whose probe failed
 * (`probeError`), has none of them.
 */
import { CatalogDisc } from '../catalog/Disc.type';
import { CatalogTape } from '../catalog/Tape.type';

export type MediaFileRole = 'main' | 'version' | 'extra' | 'episode' | 'other';
export type MediaFileLocation = 'ingest' | 'library' | 'other';

export type DetailMediaType =
  | 'movie'
  | 'series'
  | 'documentary'
  | 'live_performance'
  | 'home_video'
  | 'needs_review';

export type CatalogKind = 'movie' | 'series';

export interface MediaFileSourceSummary {
  id: string;
  title: string | null;
  format: string | null;
}

export interface MediaFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  detectedMediaType: string | null;
  assignmentStatus: string | null;
  targetPath: string | null;
  organizationStatus: string | null;
  createdAt: string | null;

  relativePath?: string | null;
  role?: MediaFileRole | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeEndNumber?: number | null;
  location?: MediaFileLocation | null;

  container?: string | null;
  videoCodec?: string | null;
  /** '480p' … '1080p', '4K', '8K'. */
  resolutionCategory?: string | null;
  width?: number | null;
  height?: number | null;
  hdrFormat?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  durationMs?: number | null;
  bitrate?: number | null;
  probedAt?: string | null;
  probeError?: string | null;
  isAvailable?: boolean | null;
  missingSince?: string | null;

  discId?: string | null;
  tapeId?: string | null;
  movieId?: string | null;
  seriesId?: string | null;
  disc?: MediaFileSourceSummary | null;
  tape?: MediaFileSourceSummary | null;

  // Arrive with a later backend PR.
  needsReview?: boolean;
  reviewNote?: string | null;
  reviewedAt?: string | null;
}

export interface MediaFileSeasonGroup {
  seasonNumber: number | null;
  episodes: MediaFile[];
  extras: MediaFile[];
  other: MediaFile[];
}

export interface MediaFileGroups {
  main: MediaFile[];
  versions: MediaFile[];
  extras: MediaFile[];
  other: MediaFile[];
  seasons: MediaFileSeasonGroup[];
}

export interface MediaFileSummary {
  fileCount: number;
  totalSize: number;
  missingCount: number;
  unprobedCount: number;
}

export type DetailDisc = CatalogDisc & { storageType?: string | null; storageId?: string | null; linkedFileCount?: number };
export type DetailTape = CatalogTape & { linkedFileCount?: number };

/** GET /api/catalog/media/{mediaType}/{mediaId}/detail */
export interface MediaDetailResponse {
  record: Record<string, unknown> & { id: string };
  mediaType: DetailMediaType;
  catalogType: CatalogKind;
  discs: DetailDisc[];
  tapes: DetailTape[];
  files: MediaFileGroups;
  summary: MediaFileSummary;
}

/** POST /api/catalog/media-files/{id}/rename-canonical */
export interface RenameCanonicalResult {
  fileId: string;
  currentPath: string;
  canonicalPath: string;
  currentRelativePath: string | null;
  canonicalRelativePath: string | null;
  changed: boolean;
  applied: boolean;
  conflict: boolean;
  file: MediaFile | null;
}

/** GET /api/library/inventory/status */
export interface InventoryScanStatus {
  running: boolean;
  phase: string | null;
  counts: Record<string, number>;
}

/** One title a disc or tape holds: GET /api/catalog/discs|tapes/{id}/links */
export interface SourceTitleLink {
  mediaType: CatalogKind;
  mediaId: string;
  title: string | null;
}

export type SourceKind = 'disc' | 'tape';

export interface SourceRef {
  kind: SourceKind;
  id: string;
}
