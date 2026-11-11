/**
 * Pure mapping from the Home page's API payloads to what it renders. No
 * fetching here, so every rule is unit-tested (tests/utils/homeOverviewModel.test.ts).
 *
 * Sources:
 *   GET /api/ingress/queue/status       -> IngressQueueStatus (counts by backend status)
 *   GET /api/ingress/watcher/status     -> IngressWatcherStatus
 *   GET /api/catalog/stats              -> CatalogStats
 *   GET /api/library/compliance/summary -> ComplianceSummary
 */
import type { IngressQueueStatus, IngressWatcherStatus } from '@/service/ingress/IngressAutomationService';
import type { CatalogStats } from '@/types/catalog/CatalogStats.type';
import type { ComplianceSummary } from '@/types/library/LibraryCompliance';
import type { StatusTone } from '@/theme/tokens';

export type StageId = 'detected' | 'matched' | 'needsReview' | 'organized' | 'inLibrary';

export interface PipelineStage {
  id: StageId;
  label: string;
  /** null when the source endpoint is unavailable. */
  count: number | null;
  /** Highlight tone when the stage needs attention; 'neutral' otherwise. */
  tone: StatusTone;
  description: string;
}

/**
 * Which backend queue statuses (backend/services/ingress_queue_service.py)
 * feed each stage. `failed` and `ignored` sit outside the strip: failures are
 * called out separately and ignored files are deliberately dropped.
 */
export const STAGE_STATUSES: Record<Exclude<StageId, 'inLibrary'>, string[]> = {
  detected: ['pending', 'processing'],
  matched: ['auto_assigned'],
  needsReview: ['needs_review'],
  organized: ['completed'],
};

function sumStatuses(counts: Record<string, number> | undefined, statuses: string[]): number {
  return statuses.reduce((total, status) => total + (Number(counts?.[status]) || 0), 0);
}

/** Movies + shows in the catalog — the "In library" stage and the Titles tile. */
export function libraryTitleCount(stats: CatalogStats | null): number | null {
  if (!stats) return null;
  return (stats.byType?.movie ?? 0) + (stats.byType?.series ?? 0);
}

export function buildPipelineStages(queue: IngressQueueStatus | null, stats: CatalogStats | null): PipelineStage[] {
  const count = (id: Exclude<StageId, 'inLibrary'>) => (queue ? sumStatuses(queue.counts, STAGE_STATUSES[id]) : null);
  const needsReview = count('needsReview');
  return [
    { id: 'detected', label: 'Detected', count: count('detected'), tone: 'neutral', description: 'New files waiting to be matched' },
    { id: 'matched', label: 'Matched', count: count('matched'), tone: 'neutral', description: 'Matched automatically, about to be organized' },
    {
      id: 'needsReview',
      label: 'Needs review',
      count: needsReview,
      tone: needsReview ? 'warning' : 'neutral',
      description: 'Low-confidence matches waiting for you',
    },
    { id: 'organized', label: 'Organized', count: count('organized'), tone: 'neutral', description: 'Moved into the Jellyfin library' },
    { id: 'inLibrary', label: 'In library', count: libraryTitleCount(stats), tone: 'neutral', description: 'Movies and shows in your catalog' },
  ];
}

export interface QueueSummary {
  failed: number;
  ignored: number;
  /** Files still moving through the pipeline (detected + matched + needs review). */
  inFlight: number;
  pendingToProcess: number;
}

export function summarizeQueue(queue: IngressQueueStatus | null): QueueSummary | null {
  if (!queue) return null;
  return {
    failed: sumStatuses(queue.counts, ['failed']),
    ignored: sumStatuses(queue.counts, ['ignored']),
    inFlight: sumStatuses(queue.counts, [...STAGE_STATUSES.detected, ...STAGE_STATUSES.matched, ...STAGE_STATUSES.needsReview]),
    pendingToProcess: sumStatuses(queue.counts, ['pending']),
  };
}

export interface WatcherSummary {
  running: boolean;
  status: 'running' | 'stopped';
  watchedPaths: string[];
  /** e.g. "Scanning existing files: 120 found, 40 queued". */
  initialScan: string | null;
  lastError: string | null;
}

export function summarizeWatcher(watcher: IngressWatcherStatus | null): WatcherSummary | null {
  if (!watcher) return null;
  const scan = watcher.initial_queue;
  return {
    running: Boolean(watcher.is_running),
    status: watcher.is_running ? 'running' : 'stopped',
    watchedPaths: watcher.watched_paths ?? [],
    initialScan: scan?.in_progress
      ? `Scanning existing files: ${scan.scanned_files} found, ${scan.queued_files} queued`
      : null,
    lastError: scan?.last_error ?? null,
  };
}

export interface LibraryTile {
  id: 'titles' | 'discs' | 'tapes' | 'shelved' | 'lent' | 'compliance';
  label: string;
  value: number | null;
  detail?: string;
  tone?: StatusTone;
  href?: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Tiles fed by /api/catalog/stats. Empty when stats are unavailable. */
export function buildLibraryTiles(stats: CatalogStats | null): LibraryTile[] {
  if (!stats) return [];
  const movies = stats.byType?.movie ?? 0;
  const shows = stats.byType?.series ?? 0;
  const storage = stats.storage ?? { total: 0, withLocation: 0, withoutLocation: 0, byType: [] };
  return [
    { id: 'titles', label: 'Titles', value: movies + shows, detail: `${plural(movies, 'movie')}, ${plural(shows, 'show')}`, href: '/dashboard/my-library' },
    { id: 'discs', label: 'Discs', value: stats.byType?.disc ?? 0, href: '/dashboard/physical-media' },
    { id: 'tapes', label: 'Tapes', value: stats.byType?.tape ?? 0, href: '/dashboard/physical-media' },
    {
      id: 'shelved',
      label: 'Shelved',
      value: storage.withLocation,
      detail: storage.withoutLocation ? `${plural(storage.withoutLocation, 'item')} without a location` : 'Every disc and tape has a location',
      tone: storage.withoutLocation ? undefined : 'success',
    },
    { id: 'lent', label: 'Lent out', value: stats.lentOut?.count ?? 0, href: '/dashboard/stats' },
  ];
}

/** The compliance tile, fed by /api/library/compliance/summary. */
export function buildComplianceTile(summary: ComplianceSummary | null): LibraryTile | null {
  if (!summary) return null;
  const urgent = (summary.critical ?? 0) + (summary.high ?? 0);
  return {
    id: 'compliance',
    label: 'Compliance issues',
    value: summary.open ?? 0,
    detail: summary.open ? (urgent ? `${urgent.toLocaleString()} critical or high` : 'None critical') : 'Library folders follow the naming rules',
    tone: urgent ? 'error' : summary.open ? 'warning' : 'success',
    href: '/admin?view=LibraryCompliance',
  };
}
