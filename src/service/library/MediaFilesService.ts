/**
 * The file inventory of one library title, and the actions the title detail page takes on
 * its files. Everything goes through the shared `api` wrapper (base /api/backend).
 *
 * The review flag and the canonical rename arrive with a later backend PR. Their callers
 * feature-detect with `isEndpointUnavailable`: a 404 / 405 means "this server has no such
 * route yet", and the UI hides or disables the action instead of failing.
 */
import { api, apiErrorStatus } from '../api/apiClient';
import {
  InventoryScanStatus,
  MediaDetailResponse,
  MediaFile,
  MediaFileGroups,
  MediaFileSummary,
  RenameCanonicalResult,
  SourceKind,
  SourceRef,
  SourceTitleLink,
} from '../../types/library/MediaFile.type';

const enc = encodeURIComponent;

/** True when an error means the route does not exist on this backend (404 / 405). */
export function isEndpointUnavailable(error: unknown): boolean {
  const status = apiErrorStatus(error);
  return status === 404 || status === 405;
}

export async function getMediaDetail(mediaType: string, mediaId: string): Promise<MediaDetailResponse> {
  return api.get<MediaDetailResponse>(`/api/catalog/media/${enc(mediaType)}/${enc(mediaId)}/detail`);
}

export type MediaFilesResponse = MediaFileGroups & {
  mediaId: string;
  mediaType: string;
  catalogType: string;
  summary: MediaFileSummary;
};

export async function getMediaFiles(mediaType: string, mediaId: string): Promise<MediaFilesResponse> {
  return api.get<MediaFilesResponse>(`/api/catalog/media/${enc(mediaType)}/${enc(mediaId)}/files`);
}

/** Connects a file to a disc or a tape (PATCH /media-files/{id}/link). */
export async function linkFile(fileId: string, source: SourceRef): Promise<MediaFile> {
  const body = source.kind === 'disc' ? { discId: source.id } : { tapeId: source.id };
  return api.patch<MediaFile>(`/api/catalog/media-files/${enc(fileId)}/link`, body);
}

export async function unlinkFile(fileId: string, kind: SourceKind): Promise<MediaFile> {
  const body = kind === 'disc' ? { discId: null } : { tapeId: null };
  return api.patch<MediaFile>(`/api/catalog/media-files/${enc(fileId)}/link`, body);
}

/** Runs `action` over every id, sequentially, and reports which ids failed. */
export async function forEachFile(
  fileIds: string[],
  action: (fileId: string) => Promise<unknown>,
): Promise<{ succeeded: string[]; failed: { id: string; error: unknown }[] }> {
  const succeeded: string[] = [];
  const failed: { id: string; error: unknown }[] = [];
  for (const id of fileIds) {
    try {
      await action(id);
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, error });
    }
  }
  return { succeeded, failed };
}

/** Flags (or clears) a file for a second look. Later backend PR. */
export async function setFileReview(fileId: string, needsReview: boolean, note?: string): Promise<MediaFile> {
  const body: { needsReview: boolean; note?: string } = { needsReview };
  if (note !== undefined && note !== '') body.note = note;
  return api.patch<MediaFile>(`/api/catalog/media-files/${enc(fileId)}/review`, body);
}

/** Previews (dryRun) or applies the rename of a file to its canonical library path. Later backend PR. */
export async function renameToCanonical(fileId: string, dryRun: boolean): Promise<RenameCanonicalResult> {
  return api.post<RenameCanonicalResult>(
    `/api/catalog/media-files/${enc(fileId)}/rename-canonical?dryRun=${dryRun ? 'true' : 'false'}`,
    {},
  );
}

export type ScanStartResult = 'started' | 'already-running';

/** Starts an inventory scan. A 409 means one is already running, which is fine for callers. */
export async function triggerInventoryScan(): Promise<ScanStartResult> {
  try {
    await api.post('/api/library/inventory/scan', {});
    return 'started';
  } catch (error) {
    if (apiErrorStatus(error) === 409) return 'already-running';
    throw error;
  }
}

export async function getInventoryStatus(): Promise<InventoryScanStatus> {
  const response = await api.get<{ success?: boolean; data?: Partial<InventoryScanStatus> }>(
    '/api/library/inventory/status',
  );
  const data = response?.data ?? {};
  return { running: Boolean(data.running), phase: data.phase ?? null, counts: data.counts ?? {} };
}

/** The titles a disc or tape is linked to. */
export async function getSourceTitles(kind: SourceKind, id: string): Promise<SourceTitleLink[]> {
  const collection = kind === 'disc' ? 'discs' : 'tapes';
  const links = await api.get<SourceTitleLink[]>(`/api/catalog/${collection}/${enc(id)}/links`);
  return Array.isArray(links) ? links : [];
}

/** Every file in a grouped payload, in display order. */
export function flattenFileGroups(groups: MediaFileGroups | null | undefined): MediaFile[] {
  if (!groups) return [];
  return [
    ...(groups.main ?? []),
    ...(groups.versions ?? []),
    ...(groups.extras ?? []),
    ...(groups.other ?? []),
    ...(groups.seasons ?? []).flatMap((season) => [
      ...(season.episodes ?? []),
      ...(season.extras ?? []),
      ...(season.other ?? []),
    ]),
  ];
}

export const EMPTY_FILE_GROUPS: MediaFileGroups = { main: [], versions: [], extras: [], other: [], seasons: [] };

export const EMPTY_FILE_SUMMARY: MediaFileSummary = { fileCount: 0, totalSize: 0, missingCount: 0, unprobedCount: 0 };

const MediaFilesService = {
  getMediaDetail,
  getMediaFiles,
  linkFile,
  unlinkFile,
  forEachFile,
  setFileReview,
  renameToCanonical,
  triggerInventoryScan,
  getInventoryStatus,
  getSourceTitles,
  flattenFileGroups,
  isEndpointUnavailable,
};

export default MediaFilesService;
