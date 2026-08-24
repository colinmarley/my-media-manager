import { api } from '@/service/api/apiClient';
import {
  TapeIngestItem,
  TapeIngestProcessOptions,
  TapeIngestProcessStatus,
  TapeIngestSettings,
  TapeSessionCreateRequest,
  TapeImageInfo,
} from '@/types/tape-ingest/TapeIngest.type';

const BASE = '/api/tape-ingest';
const SETTINGS_BASE = '/api/settings';

function snakeToCamelItem(raw: Record<string, unknown>): TapeIngestItem {
  return {
    filePath: raw.file_path as string,
    fileName: raw.file_name as string,
    fileSizeBytes: raw.file_size_bytes as number,
    fileSizeFormatted: raw.file_size_formatted as string,
    durationSeconds: raw.duration_seconds as number | undefined,
    durationFormatted: raw.duration_formatted as string | undefined,
    videoCodec: raw.video_codec as string | undefined,
    resolution: raw.resolution as string | undefined,
    contentType: ((raw.content_type as string) ?? 'unclassified') as TapeIngestItem['contentType'],
    processingStatus: 'pending',
  };
}

function snakeToCamelStatus(raw: Record<string, unknown>): TapeIngestProcessStatus {
  const items = (raw.items as Record<string, unknown>[]).map((i) => ({
    filePath: i.file_path as string,
    fileName: i.file_name as string,
    status: i.status as TapeIngestProcessStatus['items'][number]['status'],
    targetPath: i.target_path as string | undefined,
    error: i.error as string | undefined,
    progressPct: (i.progress_pct as number) ?? 0,
  }));
  return {
    taskId: raw.task_id as string,
    overallStatus: raw.overall_status as TapeIngestProcessStatus['overallStatus'],
    total: raw.total as number,
    completed: raw.completed as number,
    failed: raw.failed as number,
    skipped: raw.skipped as number,
    items,
  };
}

const TapeIngestService = {
  async listScanRoots(): Promise<string[]> {
    return api.get<string[]>(`${BASE}/scan-roots`);
  },

  async listDirectories(path: string): Promise<Array<{ name: string; path: string }>> {
    const data = await api.post<{ success: boolean; data: Array<{ name: string; path: string; isDirectory: boolean }> }>(
      '/api/files/browse',
      { path }
    );
    return (data.data ?? []).filter((e) => e.isDirectory);
  },

  async scan(sourcePath: string): Promise<TapeIngestItem[]> {
    const data = await api.post<Record<string, unknown>[]>(`${BASE}/scan`, {
      source_path: sourcePath,
    });
    return data.map(snakeToCamelItem);
  },

  getThumbnailUrl(filePath: string): string {
    return `/api/backend${BASE}/thumbnail?file_path=${encodeURIComponent(filePath)}`;
  },

  async processItems(items: TapeIngestItem[], options: TapeIngestProcessOptions): Promise<string> {
    const payload = {
      items: items.map((item) => ({
        file_path: item.filePath,
        file_name: item.fileName,
        file_size_bytes: item.fileSizeBytes,
        file_size_formatted: item.fileSizeFormatted,
        duration_seconds: item.durationSeconds,
        duration_formatted: item.durationFormatted,
        video_codec: item.videoCodec,
        resolution: item.resolution,
        content_type: item.contentType,
        movie_assignment: item.movieMetadata
          ? { imdb_id: item.movieMetadata.imdbId, title: item.movieMetadata.title, year: item.movieMetadata.year, poster: item.movieMetadata.poster }
          : null,
        home_video_metadata: item.homeVideoMetadata
          ? { title: item.homeVideoMetadata.title, date: item.homeVideoMetadata.date, date_end: item.homeVideoMetadata.dateEnd, date_approximate: item.homeVideoMetadata.dateApproximate, people: item.homeVideoMetadata.people, location: item.homeVideoMetadata.location, description: item.homeVideoMetadata.description }
          : null,
        tv_show_assignment: item.tvShowMetadata
          ? { series_imdb_id: item.tvShowMetadata.seriesImdbId, series_title: item.tvShowMetadata.seriesTitle, series_year: item.tvShowMetadata.seriesYear, season_number: item.tvShowMetadata.seasonNumber, episode_number: item.tvShowMetadata.episodeNumber, episode_imdb_id: item.tvShowMetadata.episodeImdbId, episode_title: item.tvShowMetadata.episodeTitle, poster: item.tvShowMetadata.poster }
          : null,
        promo_metadata: item.promoMetadata
          ? { title: item.promoMetadata.title, target_type: item.promoMetadata.targetType, target_name: item.promoMetadata.targetName, year: item.promoMetadata.year, description: item.promoMetadata.description }
          : null,
      })),
      destination_base: options.destinationBase,
      apply_ffmpeg: options.applyFfmpeg,
      tape_type: options.tapeType,
    };
    const data = await api.post<{ task_id: string }>(`${BASE}/process`, payload);
    return data.task_id;
  },

  async getProcessStatus(taskId: string): Promise<TapeIngestProcessStatus> {
    const data = await api.get<Record<string, unknown>>(`${BASE}/process/${taskId}`);
    return snakeToCamelStatus(data);
  },

  async getSettings(): Promise<TapeIngestSettings> {
    return api.get<TapeIngestSettings>(`${SETTINGS_BASE}/tape-ingest`);
  },

  async saveSettings(s: TapeIngestSettings): Promise<TapeIngestSettings> {
    return api.patch<TapeIngestSettings>(`${SETTINGS_BASE}/tape-ingest`, s);
  },

  async createSession(session: TapeSessionCreateRequest): Promise<{ id: string }> {
    return api.post<{ id: string }>(`${BASE}/sessions`, session);
  },


  async listTapeImages(tapeId: string): Promise<TapeImageInfo[]> {
    return api.get<TapeImageInfo[]>(`${BASE}/tape-images/${encodeURIComponent(tapeId)}`);
  },

  async uploadTapeImage(tapeId: string, file: File): Promise<TapeImageInfo> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/backend${BASE}/tape-images/${encodeURIComponent(tapeId)}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Upload failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<TapeImageInfo>;
  },

  async deleteTapeImage(tapeId: string, filename: string): Promise<void> {
    await api.delete(`${BASE}/tape-images/${encodeURIComponent(tapeId)}/${encodeURIComponent(filename)}`);
  },

  getTapeImageUrl(tapeId: string, filename: string): string {
    return `/api/backend${BASE}/tape-images/${encodeURIComponent(tapeId)}/${encodeURIComponent(filename)}/file`;
  },
  async getKnownPeople(): Promise<string[]> {
    return api.get<string[]>(`${BASE}/known-people`);
  },
};

export default TapeIngestService;
