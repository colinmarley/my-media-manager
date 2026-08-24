export type TapeType = 'vhs' | 'vhs_c' | 'mini_dv';
export type TapeBrand =
  | 'TDK' | 'Maxell' | 'Sony' | 'BASF' | 'Fuji'
  | 'Scotch' | 'Memorex' | 'Ampex' | 'Generic' | 'Unknown';
export type TapeCondition = 'good' | 'fair' | 'poor' | 'unknown';
export type RecordingSpeed = 'sp' | 'lp' | 'ep' | 'unknown';

export type ContentType =
  | 'movie' | 'home_video' | 'tv_show'
  | 'trailer' | 'commercial' | 'unclassified' | 'skip';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
export type DateMode = 'exact' | 'year' | 'range';

export interface HomeVideoMetadata {
  title: string;
  dateMode: DateMode;
  date?: string;
  dateEnd?: string;
  dateApproximate: boolean;
  people: string[];
  location?: string;
  description?: string;
}

export interface MovieMetadata {
  imdbId: string;
  title: string;
  year: number;
  poster?: string;
}

export interface TvShowMetadata {
  seriesImdbId: string;
  seriesTitle: string;
  seriesYear?: number;
  seasonNumber: number;
  episodeNumber: number;
  episodeImdbId?: string;
  episodeTitle: string;
  poster?: string;
}

export type PromoTargetType = 'company' | 'movie' | 'show' | 'product' | 'other';

export interface PromoMetadata {
  title: string;
  targetType: PromoTargetType;
  targetName: string;
  year?: number;
  description?: string;
}

export interface TapePhysicalMetadata {
  brand: TapeBrand;
  condition: TapeCondition;
  recordingSpeed: RecordingSpeed;
  labelNotes: string;
}

export interface TapeIngestItem {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  durationSeconds?: number;
  durationFormatted?: string;
  videoCodec?: string;
  resolution?: string;
  contentType: ContentType;
  // Physical tape metadata (per-file)
  tapeId?: string;       // e.g. VHSC_0001
  tapeBrand?: TapeBrand;
  tapeCondition?: TapeCondition;
  recordingSpeed?: RecordingSpeed;
  labelNotes?: string;
  movieMetadata?: MovieMetadata;
  homeVideoMetadata?: HomeVideoMetadata;
  tvShowMetadata?: TvShowMetadata;
  promoMetadata?: PromoMetadata;
  processingStatus: ProcessingStatus;
  targetPath?: string;
  processingError?: string;
}

export interface TapeIngestItemStatus {
  filePath: string;
  fileName: string;
  status: ProcessingStatus;
  targetPath?: string;
  error?: string;
  progressPct: number;
}

export interface TapeIngestProcessStatus {
  taskId: string;
  overallStatus: 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  items: TapeIngestItemStatus[];
}

export interface TapeIngestProcessOptions {
  destinationBase: string;
  applyFfmpeg: boolean;
  tapeType: TapeType;
}

export interface TapeIngestSettings {
  ingress_folder: string;
  destination_base: string;
  ffmpeg_crf: number;
  ffmpeg_preset: string;
}

export interface TapeSessionFileCreate {
  file_path: string;
  file_name: string;
  content_type: string;
  duration_seconds?: number;
  resolution?: string;
  codec?: string;
  file_size_bytes?: number;
  destination_path?: string;
  processing_status: string;
  tape_id?: string;
  metadata_json?: Record<string, unknown> | null;
}

export interface TapeSessionCreateRequest {
  tape_type: TapeType;
  brand?: string;
  condition?: string;
  recording_speed?: string;
  label_notes?: string;
  source_path: string;
  destination_base: string;
  apply_ffmpeg: boolean;
  files: TapeSessionFileCreate[];
}
export interface TapeImageInfo {
  filename: string;
  size_bytes: number;
  url: string;
}
