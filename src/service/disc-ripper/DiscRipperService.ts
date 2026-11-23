import axios from 'axios';
import { formatBytes as formatBytesShared } from '@/utils/format';
import type {
  DiscInfoResponse,
  JobAnalysis,
  RipJob,
  RipTitleRecord,
  StartJobRequest,
} from '@/types/disc-ripper/DiscRipper.type';

export type {
  DiscTitle,
  DiscInfoResponse,
  RipJob,
  JobAnalysis,
  StartJobRequest,
} from '@/types/disc-ripper/DiscRipper.type';

// Same-origin proxy (src/app/api/disc-ripper): it holds the ripper's address
// (DISC_RIPPER_URL) and sits behind the session check in middleware.ts.
export const DISC_RIPPER_PROXY_BASE = '/api/disc-ripper';
const api = axios.create({ baseURL: DISC_RIPPER_PROXY_BASE });

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  return formatBytesShared(bytes, { precision: 'video' });
}

export const DiscRipperService = {
  /**
   * Scan the disc in the drive. `minLengthSeconds` asks for titles down to
   * that length (0 for every title) instead of MakeMKV's own minimum, which
   * leaves out short titles. A ripper build that does not know the parameter
   * ignores it and scans as usual: its answer then has no
   * `disc.min_length_seconds`.
   */
  async getDiscInfo(options?: { minLengthSeconds?: number }): Promise<DiscInfoResponse> {
    const params = options?.minLengthSeconds != null ? { min_length: options.minLengthSeconds } : undefined;
    const { data } = await api.get<DiscInfoResponse>('/disc/info', { params });
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
    return `${DISC_RIPPER_PROXY_BASE}/jobs/${jobId}/files/${fileIndex}/stream`;
  },

  /** Server-Sent Events stream of a job's log lines (ends with a `[EOF]` message). */
  logStreamUrl(jobId: string): string {
    return `${DISC_RIPPER_PROXY_BASE}/jobs/${jobId}/log`;
  },

  async getFileDuration(jobId: string, fileIndex: number): Promise<number | null> {
    try {
      const res = await fetch(`${DISC_RIPPER_PROXY_BASE}/jobs/${jobId}/files/${fileIndex}/metadata`);
      if (!res.ok) return null;
      const data = await res.json() as { duration?: number };
      return data.duration ?? null;
    } catch {
      return null;
    }
  },

  /** Per-file records of a job; empty on a ripper build that does not keep them. */
  async getJobTitles(jobId: string): Promise<RipTitleRecord[]> {
    try {
      const { data } = await api.get<RipTitleRecord[]>(`/jobs/${jobId}/titles`);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async retryJob(jobId: string): Promise<RipJob> {
    const { data } = await api.post<RipJob>(`/jobs/${jobId}/retry`);
    return data;
  },

  async renameFile(jobId: string, fileIndex: number, newName: string): Promise<RipJob> {
    const { data } = await api.patch<RipJob>(`/jobs/${jobId}/files/${fileIndex}`, { name: newName });
    return data;
  },

  async analyzeJob(jobId: string): Promise<JobAnalysis> {
    const { data } = await api.post<JobAnalysis>(`/jobs/${jobId}/analyze`, {}, { timeout: 130_000 });
    return data;
  },

  async getJobAnalysis(jobId: string): Promise<JobAnalysis | null> {
    try {
      const { data } = await api.get<JobAnalysis>(`/jobs/${jobId}/analysis`);
      return data;
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
      throw e;
    }
  },

  formatDuration,
  formatBytes,
};
