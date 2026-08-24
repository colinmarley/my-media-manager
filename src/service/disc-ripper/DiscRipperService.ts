import axios from 'axios';
import type {
  DiscInfoResponse,
  JobAnalysis,
  RipJob,
  StartJobRequest,
} from '@/types/disc-ripper/DiscRipper.type';

export type {
  DiscTitle,
  DiscInfoResponse,
  RipJob,
  JobAnalysis,
  StartJobRequest,
} from '@/types/disc-ripper/DiscRipper.type';

const BASE = process.env.NEXT_PUBLIC_DISC_RIPPER_URL ?? 'http://localhost:8083';
const api = axios.create({ baseURL: BASE });

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
    return `/api/disc-ripper/jobs/${jobId}/files/${fileIndex}/stream`;
  },

  async getFileDuration(jobId: string, fileIndex: number): Promise<number | null> {
    try {
      const res = await fetch(`/api/disc-ripper/jobs/${jobId}/files/${fileIndex}/metadata`);
      if (!res.ok) return null;
      const data = await res.json() as { duration?: number };
      return data.duration ?? null;
    } catch {
      return null;
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
