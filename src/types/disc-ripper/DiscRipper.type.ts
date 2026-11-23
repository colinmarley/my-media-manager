export interface DiscTitle {
  index: number;
  name: string;
  duration_seconds: number;
  chapter_count: number;
  file_size_bytes: number;
  output_filename: string;
  width: number;
  height: number;
  codec: string;
  // Present from disc-ripper-service builds that keep the full scan.
  source_file?: string;
  segment_map?: string;
  streams?: DiscStream[];
}

export interface DiscStream {
  index: number;
  type: string;             // "video" | "audio" | "subtitles"
  codec: string;
  lang_code: string;
  lang_name: string;
  name: string;
  channels: number;
  channel_layout: string;
  default: boolean;
  forced: boolean;
}

/** What the disc and drive reported about themselves on a scan. */
export interface DiscScanInfo {
  scan_id: string;
  scanned_at: string | null;
  fingerprint: string | null;
  disc_type: string | null;      // as MakeMKV names it, e.g. "DVD disc"
  disc_name: string | null;
  volume_label: string | null;
  drive_model: string | null;
  makemkv_version: string | null;
  title_count: number;
  skipped_short?: number;
}

export interface DiscInfoResponse {
  titles: DiscTitle[];
  error: string | null;
  scan_id?: string;
  disc?: DiscScanInfo;
}

/** What one selected disc title is, as declared when the rip is set up. */
export interface TitleDeclaration {
  title_index: number;
  content_type?: string;     // "main_feature" | "episode" | "special_feature" | an extras category
  is_main_feature?: boolean;
  season?: number;
  episode?: number;
  episode_end?: number;
  tmdb_episode_id?: number;
  episode_name?: string;
  custom_name?: string;
}

export interface RipJob {
  id: string;
  created_at: string;
  updated_at: string;
  disc_type: 'dvd' | 'bluray';
  media_type: 'movie' | 'show';
  title: string;
  year: number;
  imdb_id: string | null;
  season: number | null;
  mkv_title_indices: number[];
  episode_map: Record<string, string> | null;
  status: 'queued' | 'ripping' | 'delivering' | 'done' | 'failed' | 'cancelled';
  progress: number;
  error: string | null;
  rip_dir: string | null;
  output_paths: string[];
  catalog_disc_id: string | null;
  title_content_types: Record<string, string> | null;
  tmdb_id?: number | null;
  scan_id?: string | null;
  fingerprint?: string | null;
  // Whether the rip record reached my-media-manager: synced | failed | pending.
  library_sync_state?: string | null;
  library_sync_error?: string | null;
}

/** One output file of a job (GET /jobs/{id}/titles). */
export interface RipTitleRecord {
  title_index: number;
  file_seq: number;
  status: string;            // ripped | delivered | failed
  error: string | null;
  makemkv_filename: string | null;
  dest_path: string | null;
  size_bytes: number | null;
  read_errors: number;
  messages: string[];
  duration_seconds: number | null;
}

/** A rip already stored in the library (GET /api/rips). */
export interface StoredRip {
  id: string;
  status: string;
  discId: string | null;
  title: string | null;
  year: number | null;
  season: number | null;
  volumeLabel: string | null;
  deliveredAt: string | null;
  ripStartedAt: string | null;
}

export interface JobAnalysis {
  id: string;
  job_id: string;
  created_at: string;
  error_type: string;
  error_summary: string;
  suggested_fix: string;
  claude_prompt: string;
  full_analysis: string;
  model_used: string;
  log_path: string;
}

export interface StartJobRequest {
  disc_type: 'dvd' | 'bluray';
  media_type: 'movie' | 'show';
  title: string;
  year: number;
  imdb_id?: string;
  season?: number;
  mkv_title_indices: number[];
  episode_map?: Record<string, string>;
  catalog_disc_id?: string;              // links this rip to a my-media-manager Disc record
  title_content_types?: Record<string, string>;  // {"0": "trailer", "2": "deleted_scene"}
  tmdb_id?: number;                      // TMDB movie id or series id
  scan_id?: string;                      // the scan this job was configured from
  titles?: TitleDeclaration[];           // structured form of episode_map / title_content_types
}

// ---------------------------------------------------------------------------
// TMDB search (ConfigureStep)
// ---------------------------------------------------------------------------

export interface TmdbResult {
  tmdbId: number;
  type: 'tv' | 'movie';
  name: string;
  year: number;
  posterPath: string | null;
}

export interface TmdbSeason {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TmdbEpisode {
  episodeNumber: number;
  name: string;
  runtime?: number;
  tmdbId?: number;
}

export type Assignment =
  // episodeEndNumber: the last episode when one title holds several (S01E11-E12).
  | { type: 'episode'; episodeNumber: number; episodeName: string; episodeEndNumber?: number }
  | { type: 'special' }
  | { type: 'custom'; name: string };

// ---------------------------------------------------------------------------
// Extras taxonomy (mirrors my-media-manager backend's services/extras_taxonomy.py
// and disc-ripper-service's CONTENT_TYPE_SUFFIX — keep these three in sync)
// ---------------------------------------------------------------------------

export const EXTRAS_CATEGORIES = [
  'behind_the_scenes',
  'deleted_scene',
  'interview',
  'featurette',
  'trailer',
  'scene',
  'sample',
  'short',
  'clip',
  'blooper',
  'other',
] as const;

export type ExtrasCategory = typeof EXTRAS_CATEGORIES[number];

export const EXTRAS_CATEGORY_LABELS: Record<ExtrasCategory, string> = {
  behind_the_scenes: 'Behind the Scenes',
  deleted_scene: 'Deleted Scene',
  interview: 'Interview',
  featurette: 'Featurette',
  trailer: 'Trailer',
  scene: 'Scene',
  sample: 'Sample',
  short: 'Short',
  clip: 'Clip',
  blooper: 'Blooper',
  other: 'Other',
};
