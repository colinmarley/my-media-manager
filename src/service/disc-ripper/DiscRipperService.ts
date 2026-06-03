import axios from 'axios';

const BASE = process.env.NEXT_PUBLIC_DISC_RIPPER_URL ?? 'http://localhost:8083';
const api = axios.create({ baseURL: BASE });

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
  status: 'queued' | 'ripping' | 'encoding' | 'delivering' | 'done' | 'failed' | 'cancelled';
  progress: number;
  error: string | null;
  rip_dir: string | null;
  output_paths: string[];
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
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export const DiscRipperService = {
  async getDiscInfo(): Promise<DiscInfoResponse> {
    const { data } = await api.get<DiscInfoResponse>('/disc/info');
    return data;
  },

  async startJob(req: StartJobRequest): Promise<RipJob> {
    const { data } = await api.post<RipJob>('/jobs/start', req);
    return data;
  },

  async stopJob(jobId: string): Promise<void> {
    await api.post(`/jobs/${jobId}/stop`);
  },

  async listJobs(status?: string): Promise<RipJob[]> {
    const { data } = await api.get<RipJob[]>('/jobs', { params: status ? { status } : undefined });
    return data;
  },

  async getJob(jobId: string): Promise<RipJob> {
    const { data } = await api.get<RipJob>(`/jobs/${jobId}`);
    return data;
  },

  streamUrl(jobId: string, fileIndex: number): string {
    return `${BASE}/jobs/${jobId}/files/${fileIndex}/stream`;
  },

  async renameFile(jobId: string, fileIndex: number, newName: string): Promise<RipJob> {
    const { data } = await api.patch<RipJob>(`/jobs/${jobId}/files/${fileIndex}`, { name: newName });
    return data;
  },

  formatDuration,
  formatBytes,
};
