import type { SearchResult } from '@/service/library/MediaAssignmentSearchService';
import type {
  IngressQueueItem,
  IngressQueueStatus,
  QueueClassificationOverride,
  QueueManualAssignPayload,
} from './IngressAutomationService';

export type QueueChipColor = 'default' | 'info' | 'warning' | 'error' | 'success' | 'primary' | 'secondary';
export type QueueChipVariant = 'filled' | 'outlined';
export interface QueueBadge {
  label: string;
  color: QueueChipColor;
  variant?: QueueChipVariant;
}

export const STATUS_COLORS: Record<string, QueueChipColor> = {
  pending: 'info',
  processing: 'info',
  auto_assigned: 'success',
  needs_review: 'warning',
  failed: 'error',
  completed: 'success',
};

export const BULK_SELECTABLE_STATUSES = new Set(['needs_review', 'auto_assigned']);

export const ACTIVE_QUEUE_STATUSES = new Set(['pending', 'processing', 'needs_review', 'auto_assigned']);

export const ASSIGN_RESULTS_BATCH_SIZE = 10;

export const CLASSIFICATION_OPTIONS: Array<{ value: QueueClassificationOverride; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'main_feature', label: 'Main Feature' },
  { value: 'special_feature', label: 'Special Feature' },
  { value: 'alternate_version', label: 'Alternate Version' },
];

export const QUEUE_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function isQueueItemSelectable(item: IngressQueueItem): boolean {
  return ACTIVE_QUEUE_STATUSES.has(item.status) && BULK_SELECTABLE_STATUSES.has(item.status);
}

export function filterSelectableQueueItemIds(
  selectedIds: string[],
  items: IngressQueueItem[]
): string[] {
  const selectableIds = new Set(
    items
      .filter((item) => isQueueItemSelectable(item))
      .map((item) => item.id)
  );

  return selectedIds.filter((id) => selectableIds.has(id));
}

export async function runQueueActionsSequentially<T>(
  items: T[],
  action: (item: T) => Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];

  for (const item of items) {
    try {
      const value = await action(item);
      results.push({ status: 'fulfilled', value });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }

  return results;
}

export type EpisodeAssignmentMapping = {
  season?: number;
  episode?: number;
  unknown?: boolean;
};

export function isEpisodeMappingValid(mapping?: EpisodeAssignmentMapping): boolean {
  if (mapping?.unknown) {
    return true;
  }

  return Number.isInteger(mapping?.season) && Number.isInteger(mapping?.episode);
}

export function getQueueClassificationBadges(item: IngressQueueItem): QueueBadge[] {
  const badges: QueueBadge[] = [];

  const proposedPath = item.proposed_path || '';
  const filePath = item.file_path || '';
  const fileStem = (item.file_name || '').replace(/\.[^.]+$/, '');
  const parsedType = item.parsed_info?.media_type;
  const matchedType = item.best_match?.media_type;
  const mediaType = (parsedType && parsedType !== 'unknown' ? parsedType : matchedType) || 'unknown';
  const override = item.classification_override;
  const isCompanionHint = item.parsed_info?.classification_hint === 'special_feature' || Boolean(item.parsed_info?.is_companion);
  const isExtrasFolder = /(?:^|\/)(extras?|special features?|bonus|featurettes?|deleted scenes?)(?:\/|$)/i.test(filePath);
  const isMakemkvExtra = /^[A-Za-z]\d+[_-]t\d+$/i.test(fileStem);
  const season = item.parsed_info?.season ?? item.best_match?.season;
  const episode = item.parsed_info?.episode ?? item.best_match?.episode;
  const inferredMatch = Boolean(
    (item.best_match as Record<string, unknown> | undefined)?.inferred_from_source_root ||
    (item.best_match as Record<string, unknown> | undefined)?.inferred_from_ingress_folder
  );

  if (override === 'special_feature' || /special feature/i.test(proposedPath) || (!override && (isCompanionHint || isExtrasFolder || isMakemkvExtra))) {
    badges.push({ label: 'Special Feature', color: 'warning' });
  } else if (override === 'alternate_version' || /\s-\sVersion\s\d+/i.test(proposedPath)) {
    badges.push({ label: 'Alternate Version', color: 'info' });
  } else if (mediaType === 'episode' || mediaType === 'series') {
    if (typeof season === 'number' && typeof episode === 'number') {
      badges.push({ label: 'TV Episode', color: 'secondary' });
      badges.push({ label: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`, color: 'secondary', variant: 'outlined' });
    } else {
      badges.push({ label: 'Unknown Episode', color: 'warning' });
    }
  } else if (mediaType === 'documentary') {
    badges.push({ label: 'Documentary', color: 'info' });
  } else if (mediaType === 'live_performance') {
    badges.push({ label: 'Live Performance', color: 'info' });
  } else if (override === 'main_feature' || mediaType === 'movie') {
    badges.push({ label: 'Main Feature', color: 'primary' });
  } else {
    badges.push({ label: 'Unclassified', color: 'default' });
  }

  if (item.parsed_info?.quality) {
    badges.push({ label: String(item.parsed_info.quality).toUpperCase(), color: 'default', variant: 'outlined' });
  }

  if (inferredMatch) {
    badges.push({ label: 'Parent Match', color: 'success', variant: 'outlined' });
  }

  if (override && override !== 'auto') {
    badges.push({ label: 'Override', color: 'primary', variant: 'outlined' });
  }

  return badges;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

const QUEUE_STATUS_PRIORITY: Record<string, number> = {
  needs_review: 0,
  pending: 1,
  processing: 2,
  auto_assigned: 3,
};

export function sortActiveQueueItems(items: IngressQueueItem[]): IngressQueueItem[] {
  return items
    .filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status))
    .sort((a, b) => {
      const priorityDiff = (QUEUE_STATUS_PRIORITY[a.status] ?? 99) - (QUEUE_STATUS_PRIORITY[b.status] ?? 99);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.queued_at - b.queued_at;
    });
}

export function getSelectableQueueItemIds(items: IngressQueueItem[]): string[] {
  return items.filter((item) => isQueueItemSelectable(item)).map((item) => item.id);
}

export function isClassificationEditable(item: IngressQueueItem): boolean {
  return item.status === 'needs_review' || item.status === 'auto_assigned' || item.status === 'failed';
}

export function isQueueItemAssignable(item: IngressQueueItem): boolean {
  return item.status === 'needs_review' || item.status === 'auto_assigned' || item.status === 'failed';
}

export function isEpisodeLikeQueueItem(item: IngressQueueItem): boolean {
  const mediaType = item.parsed_info?.media_type || item.best_match?.media_type;
  return mediaType === 'episode' || mediaType === 'series';
}

export function getQueueActionCounts(selectedItems: IngressQueueItem[]): {
  acceptCount: number;
  rejectCount: number;
  retryCount: number;
} {
  return {
    acceptCount: selectedItems.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned').length,
    rejectCount: selectedItems.filter((item) => item.status === 'needs_review').length,
    retryCount: selectedItems.filter((item) => item.status === 'needs_review' || item.status === 'failed').length,
  };
}

export function getAcceptEligibleItems(items: IngressQueueItem[]): IngressQueueItem[] {
  return items.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned');
}

export function getRejectEligibleItems(items: IngressQueueItem[]): IngressQueueItem[] {
  return items.filter((item) => item.status === 'needs_review');
}

export function getRetryEligibleItems(items: IngressQueueItem[]): IngressQueueItem[] {
  return items.filter((item) => item.status === 'needs_review' || item.status === 'failed');
}

export function getRecentHistoryEntries(history: Array<Record<string, any>>): Array<Record<string, any>> {
  return history.slice().reverse().slice(0, 10);
}

export function getIngressHealthFlags(health: Record<string, any> | null): {
  ingressPathsHealthy: boolean | undefined;
  destHealthy: boolean | undefined;
} {
  const ingressPathsHealthy = !health || health.ingress_paths?.every((p: any) => p.exists && p.readable);
  const destHealthy = !health || health.destination?.exists;

  return { ingressPathsHealthy, destHealthy };
}

export function getIngressBacklog(queueStatus: IngressQueueStatus | null): {
  pending: number;
  needsReview: number;
  backlog: number;
} {
  const pending = queueStatus?.counts?.pending || 0;
  const needsReview = queueStatus?.counts?.needs_review || 0;
  return { pending, needsReview, backlog: pending + needsReview };
}

export function resolveIngressPaths(pathsInput: string, defaultPaths: string[]): string[] {
  const rows = pathsInput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return rows.length > 0 ? rows : defaultPaths;
}

export function appendIngressPath(pathsInput: string, nextPath: string): string {
  const trimmed = nextPath.trim();
  if (!trimmed) {
    return pathsInput;
  }

  const existing = pathsInput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (existing.includes(trimmed)) {
    return pathsInput;
  }

  return existing.length > 0 ? `${pathsInput.trim()}\n${trimmed}` : trimmed;
}

export function buildDefaultEpisodeAssignments(
  items: IngressQueueItem[]
): { shouldUseEpisode: boolean; episodeMap: Record<string, EpisodeAssignmentMapping> } {
  const shouldUseEpisode = items.some((item) => isEpisodeLikeQueueItem(item));
  const episodeMap: Record<string, EpisodeAssignmentMapping> = {};

  items.forEach((item) => {
    const season = item.parsed_info?.season ?? item.best_match?.season;
    const episode = item.parsed_info?.episode ?? item.best_match?.episode;
    episodeMap[item.id] = {
      season,
      episode,
      unknown: shouldUseEpisode && (!Number.isInteger(season) || !Number.isInteger(episode)),
    };
  });

  return { shouldUseEpisode, episodeMap };
}

export function withUnknownFlag(mapping: EpisodeAssignmentMapping | undefined, checked: boolean): EpisodeAssignmentMapping {
  return {
    ...mapping,
    unknown: checked,
    season: checked ? undefined : mapping?.season,
    episode: checked ? undefined : mapping?.episode,
  };
}

export function withSeason(mapping: EpisodeAssignmentMapping | undefined, season?: number): EpisodeAssignmentMapping {
  return {
    ...mapping,
    season,
    unknown: false,
  };
}

export function withEpisode(mapping: EpisodeAssignmentMapping | undefined, episode?: number): EpisodeAssignmentMapping {
  return {
    ...mapping,
    episode,
    unknown: false,
  };
}

export function buildOmdbImdbResult(omdbData: any): SearchResult {
  const isEpisode = omdbData.Type === 'episode';
  return {
    id: omdbData.imdbID,
    title: omdbData.Title,
    year: omdbData.Year,
    type: isEpisode ? 'series' : omdbData.Type === 'series' ? 'series' : 'movie',
    poster: omdbData.Poster,
    imdbId: omdbData.imdbID,
    source: 'omdb',
    data: omdbData as unknown as Record<string, unknown>,
  };
}

export function buildManualAssignPayload(args: {
  itemId: string;
  mediaType: 'movie' | 'episode';
  result: SearchResult;
  mapping?: EpisodeAssignmentMapping;
  organizeAfterAssign: boolean;
}): QueueManualAssignPayload {
  const { itemId, mediaType, result, organizeAfterAssign } = args;
  const mapping = args.mapping || {};

  return {
    itemId,
    mediaType,
    title: result.title,
    year: Number.isFinite(Number(result.year)) ? Number(result.year) : undefined,
    source: result.source,
    imdbId: result.imdbId || undefined,
    mediaId: result.source === 'omdb'
      ? result.imdbId
      : result.source === 'tmdb'
        ? result.id.replace(/^tmdb-/, '')
        : result.id,
    legacyMediaId: result.source === 'catalog' ? result.id : undefined,
    rawData: (result.data as Record<string, unknown>) || undefined,
    posterUrl: result.poster || undefined,
    season: mediaType === 'episode' && !mapping.unknown ? mapping.season : undefined,
    episode: mediaType === 'episode' && !mapping.unknown ? mapping.episode : undefined,
    unknownEpisode: mediaType === 'episode' ? Boolean(mapping.unknown) : undefined,
    organizeNow: organizeAfterAssign,
  };
}
