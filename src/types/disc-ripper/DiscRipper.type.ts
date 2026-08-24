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
}

export interface DiscInfoResponse {
  titles: DiscTitle[];
  error: string | null;
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
}

export type Assignment =
  | { type: 'episode'; episodeNumber: number; episodeName: string }
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
