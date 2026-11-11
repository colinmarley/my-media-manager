/**
 * The To-Do list (/api/attention). Everything goes through the shared `api` wrapper.
 *
 * An older backend has no /api/attention routes: callers check `isAttentionUnsupported`
 * (404 / 405) and hide the badge, the Home tiles and the title banner instead of failing.
 */
import { api } from '../api/apiClient';
import { isEndpointUnavailable, setFileReview } from '../library/MediaFilesService';
import {
  AttentionDismissal,
  AttentionItem,
  AttentionItemsQuery,
  AttentionItemsResponse,
  AttentionKind,
  AttentionSummary,
  DismissRequest,
} from '../../types/attention/Attention.type';
import { MediaFile } from '../../types/library/MediaFile.type';

export const ATTENTION_KIND_KEYS: AttentionKind[] = [
  'needs_assignment',
  'needs_rename',
  'needs_review',
  'missing_file',
  'no_disc_link',
  'unprobed',
  'unripped_disc',
];

/** True when the server has no To-Do list yet (the route answers 404 / 405). */
export const isAttentionUnsupported = (error: unknown): boolean => isEndpointUnavailable(error);

function normalizeSummary(raw: Partial<AttentionSummary> | null | undefined): AttentionSummary {
  const counts = {} as Record<AttentionKind, number>;
  for (const kind of ATTENTION_KIND_KEYS) {
    const value = Number(raw?.counts?.[kind] ?? 0);
    counts[kind] = Number.isFinite(value) ? value : 0;
  }
  const total = Number(raw?.total);
  return {
    counts,
    total: Number.isFinite(total) ? total : 0,
    generatedAt: raw?.generatedAt ?? null,
  };
}

function normalizeItem(raw: Partial<AttentionItem>): AttentionItem {
  return {
    id: String(raw.id ?? `${raw.kind}:${raw.subjectType}:${raw.subjectId}`),
    kind: raw.kind as AttentionKind,
    subjectType: raw.subjectType ?? 'media_file',
    subjectId: String(raw.subjectId ?? ''),
    title: raw.title ?? '',
    detail: raw.detail ?? '',
    severity: raw.severity ?? 'low',
    mediaType: raw.mediaType ?? null,
    mediaId: raw.mediaId ?? null,
    mediaTitle: raw.mediaTitle ?? null,
    catalogType: raw.catalogType ?? null,
    filePath: raw.filePath ?? null,
    relativePath: raw.relativePath ?? null,
    current: raw.current ?? null,
    expected: raw.expected ?? null,
    queueItemId: raw.queueItemId ?? null,
    discId: raw.discId ?? null,
    file: (raw.file as MediaFile | null | undefined) ?? null,
    createdAt: raw.createdAt ?? null,
    dismissible: raw.dismissible !== false,
    fingerprint: raw.fingerprint ?? null,
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    queue: raw.queue ?? null,
  };
}

export function buildItemsPath(query: AttentionItemsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.kind && (!Array.isArray(query.kind) || query.kind.length > 0)) {
    params.set('kind', Array.isArray(query.kind) ? query.kind.join(',') : query.kind);
  }
  if (query.mediaType && query.mediaId) {
    params.set('mediaType', query.mediaType);
    params.set('mediaId', query.mediaId);
  }
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return `/api/attention/items${qs ? `?${qs}` : ''}`;
}

export async function getAttentionSummary(): Promise<AttentionSummary> {
  return normalizeSummary(await api.get<Partial<AttentionSummary>>('/api/attention/summary'));
}

export async function getAttentionItems(query: AttentionItemsQuery = {}): Promise<AttentionItemsResponse> {
  const response = await api.get<Partial<AttentionItemsResponse> | null>(buildItemsPath(query));
  const items = Array.isArray(response?.items) ? response!.items.map(normalizeItem) : [];
  const total = Number(response?.total);
  return { items, total: Number.isFinite(total) ? total : items.length };
}

export async function dismissAttentionItem(request: DismissRequest): Promise<AttentionDismissal> {
  const body: DismissRequest = {
    kind: request.kind,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    days: request.days ?? null,
  };
  const note = request.note?.trim();
  if (note) body.note = note;
  return api.post<AttentionDismissal>('/api/attention/dismiss', body);
}

export async function undoDismissal(dismissalId: string): Promise<{ success: boolean; dismissal?: AttentionDismissal }> {
  return api.delete(`/api/attention/dismiss/${encodeURIComponent(dismissalId)}`);
}

export async function getDismissals(): Promise<AttentionDismissal[]> {
  const response = await api.get<{ dismissals?: AttentionDismissal[] } | null>('/api/attention/dismissals');
  return Array.isArray(response?.dismissals) ? response!.dismissals : [];
}

/** Clears a hand-set "second look" flag (PATCH /media-files/{id}/review). */
export async function clearReviewFlag(fileId: string): Promise<MediaFile> {
  return setFileReview(fileId, false);
}

const AttentionService = {
  getSummary: getAttentionSummary,
  getItems: getAttentionItems,
  dismiss: dismissAttentionItem,
  undoDismissal,
  getDismissals,
  clearReviewFlag,
  isUnsupported: isAttentionUnsupported,
};

export default AttentionService;
