/**
 * Connect/disconnect media files to/from a physical disc or tape.
 * Backs the "Connected Files" section on the physical-media detail page.
 */
import { api } from '../api/apiClient';

export interface LinkedMediaFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  detectedMediaType: string | null;
  assignmentStatus: string | null;
  targetPath: string | null;
  organizationStatus: string | null;
  createdAt: string | null;
}

export async function searchMediaFiles(params: { q?: string; unlinked?: boolean }): Promise<LinkedMediaFile[]> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.unlinked) query.set('unlinked', 'true');
  const qs = query.toString();
  return api.get<LinkedMediaFile[]>(`/api/catalog/media-files/search${qs ? `?${qs}` : ''}`);
}

export async function connectFileToDisc(fileId: string, discId: string): Promise<LinkedMediaFile> {
  return api.patch<LinkedMediaFile>(`/api/catalog/media-files/${fileId}/link`, { discId });
}

export async function connectFileToTape(fileId: string, tapeId: string): Promise<LinkedMediaFile> {
  return api.patch<LinkedMediaFile>(`/api/catalog/media-files/${fileId}/link`, { tapeId });
}

export async function disconnectFile(fileId: string, kind: 'disc' | 'tape'): Promise<LinkedMediaFile> {
  const body = kind === 'disc' ? { discId: null } : { tapeId: null };
  return api.patch<LinkedMediaFile>(`/api/catalog/media-files/${fileId}/link`, body);
}
