import { describe, expect, it } from 'vitest';
import {
  buildComplianceTile,
  buildLibraryTiles,
  buildPipelineStages,
  libraryTitleCount,
  summarizeQueue,
  summarizeWatcher,
} from '@/service/home/homeOverviewModel';
import type { IngressQueueStatus, IngressWatcherStatus } from '@/service/ingress/IngressAutomationService';
import type { CatalogStats } from '@/types/catalog/CatalogStats.type';

export const queueFixture: IngressQueueStatus = {
  total: 31,
  counts: { pending: 3, processing: 1, auto_assigned: 2, needs_review: 5, failed: 4, completed: 12, ignored: 4 },
  recent: [],
};

export const statsFixture = {
  generatedAt: '2026-11-11T00:00:00Z',
  recentDays: 30,
  totalItems: 520,
  byType: { movie: 300, series: 40, disc: 150, tape: 30 },
  byDiscFormat: [],
  byDecade: [],
  undated: 0,
  recentlyAdded: { days: 30, count: 0, items: [] },
  storage: { total: 180, withLocation: 170, withoutLocation: 10, byType: [] },
  lentOut: { count: 2, items: [] },
} as CatalogStats;

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;

describe('buildPipelineStages', () => {
  it('maps backend queue statuses onto the five stages in order', () => {
    const stages = buildPipelineStages(queueFixture, statsFixture);
    expect(stages.map((s) => [s.id, s.count])).toEqual([
      ['detected', 4],
      ['matched', 2],
      ['needsReview', 5],
      ['organized', 12],
      ['inLibrary', 340],
    ]);
  });

  it('flags Needs review only when something is waiting', () => {
    expect(byId(buildPipelineStages(queueFixture, null), 'needsReview').tone).toBe('warning');
    const empty = { ...queueFixture, counts: { ...queueFixture.counts, needs_review: 0 } };
    expect(byId(buildPipelineStages(empty, null), 'needsReview').tone).toBe('neutral');
  });

  it('reports null counts for an unavailable source instead of zeros', () => {
    const noQueue = buildPipelineStages(null, statsFixture);
    expect(noQueue.slice(0, 4).every((s) => s.count === null)).toBe(true);
    expect(byId(noQueue, 'inLibrary').count).toBe(340);
    expect(byId(buildPipelineStages(queueFixture, null), 'inLibrary').count).toBeNull();
  });

  it('treats missing status keys as zero', () => {
    const sparse: IngressQueueStatus = { total: 1, counts: { pending: 1 }, recent: [] };
    expect(buildPipelineStages(sparse, null).map((s) => s.count)).toEqual([1, 0, 0, 0, null]);
  });
});

describe('summarizeQueue / summarizeWatcher', () => {
  it('counts failures and pending work outside the strip', () => {
    expect(summarizeQueue(queueFixture)).toEqual({ failed: 4, ignored: 4, inFlight: 11, pendingToProcess: 3 });
    expect(summarizeQueue(null)).toBeNull();
  });

  it('describes the watcher and an in-progress initial scan', () => {
    const watcher: IngressWatcherStatus = {
      is_running: true,
      watched_paths: ['/data/a', '/data/b'],
      pending_count: 0,
      queue_count: 0,
      processed_event_count: 0,
      initial_queue: { in_progress: true, scanned_files: 120, queued_files: 40, last_error: null },
    };
    expect(summarizeWatcher(watcher)).toEqual({
      running: true,
      status: 'running',
      watchedPaths: ['/data/a', '/data/b'],
      initialScan: 'Scanning existing files: 120 found, 40 queued',
      lastError: null,
    });
    expect(summarizeWatcher({ ...watcher, is_running: false, initial_queue: undefined })?.status).toBe('stopped');
  });
});

describe('library tiles', () => {
  it('builds tiles from catalog stats', () => {
    const tiles = buildLibraryTiles(statsFixture);
    expect(byId(tiles, 'titles')).toMatchObject({ value: 340, detail: '300 movies, 40 shows' });
    expect(byId(tiles, 'discs').value).toBe(150);
    expect(byId(tiles, 'shelved')).toMatchObject({ value: 170, detail: '10 items without a location' });
    expect(byId(tiles, 'lent').value).toBe(2);
    expect(buildLibraryTiles(null)).toEqual([]);
    expect(libraryTitleCount(null)).toBeNull();
  });

  it('colours compliance by urgency and links to the compliance view', () => {
    const base = { open: 0, critical: 0, high: 0, duplicateMain: 0, misplacedSpecial: 0, namingMismatch: 0 };
    expect(buildComplianceTile({ ...base })?.tone).toBe('success');
    expect(buildComplianceTile({ ...base, open: 3 })?.tone).toBe('warning');
    const urgent = buildComplianceTile({ ...base, open: 3, critical: 1, high: 1 });
    expect(urgent).toMatchObject({ value: 3, tone: 'error', detail: '2 critical or high', href: '/admin?view=LibraryCompliance' });
    expect(buildComplianceTile(null)).toBeNull();
  });
});
