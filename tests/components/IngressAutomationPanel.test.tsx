import { describe, expect, it } from 'vitest';

import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import {
  filterSelectableQueueItemIds,
  getQueueClassificationBadges,
  isEpisodeMappingValid,
  runQueueActionsSequentially,
} from '@/app/admin/_components/IngressAutomationPanel';

describe('filterSelectableQueueItemIds', () => {
  it('removes completed stale selections and keeps only currently selectable rows', () => {
    const items: IngressQueueItem[] = [
      {
        id: 'completed-tv-1',
        file_path: '/shows/old-episode-1.mkv',
        file_name: 'old-episode-1.mkv',
        status: 'completed',
        attempts: 1,
        queued_at: 1,
      },
      {
        id: 'needs-review-1',
        file_path: '/ingest/new-extra-1.mkv',
        file_name: 'new-extra-1.mkv',
        status: 'needs_review',
        attempts: 0,
        queued_at: 2,
      },
      {
        id: 'needs-review-2',
        file_path: '/ingest/new-extra-2.mkv',
        file_name: 'new-extra-2.mkv',
        status: 'needs_review',
        attempts: 0,
        queued_at: 3,
      },
    ];

    expect(
      filterSelectableQueueItemIds(
        ['completed-tv-1', 'needs-review-1', 'missing-item'],
        items
      )
    ).toEqual(['needs-review-1']);
  });
});

describe('runQueueActionsSequentially', () => {
  it('processes queue items one at a time in selection order', async () => {
    const callOrder: string[] = [];

    await runQueueActionsSequentially(['a', 'b', 'c'], async (item) => {
      callOrder.push(item);
    });

    expect(callOrder).toEqual(['a', 'b', 'c']);
  });
});

describe('isEpisodeMappingValid', () => {
  it('accepts a mapping marked as unknown even without season and episode numbers', () => {
    expect(isEpisodeMappingValid({ unknown: true })).toBe(true);
    expect(isEpisodeMappingValid({ season: 2, unknown: true })).toBe(true);
  });

  it('requires both season and episode when the mapping is not unknown', () => {
    expect(isEpisodeMappingValid({ season: 2, episode: 5 })).toBe(true);
    expect(isEpisodeMappingValid({ season: 2 })).toBe(false);
    expect(isEpisodeMappingValid({ episode: 5 })).toBe(false);
    expect(isEpisodeMappingValid({})).toBe(false);
  });
});

describe('getQueueClassificationBadges', () => {
  it('marks files from extras folders as special features even before a title match exists', () => {
    const item: IngressQueueItem = {
      id: 'extra-1',
      file_path: '/ark/media/jellyfin/ingest/Alfred Hitchcock-A Legacy of Suspense D4 (2011)/extras/A12_t06.mkv',
      file_name: 'A12_t06.mkv',
      status: 'needs_review',
      attempts: 0,
      queued_at: 1,
      parsed_info: {
        media_type: 'movie',
        title: 'Alfred Hitchcock-A Legacy of Suspense',
        year: 2011,
      },
      proposed_path: '_NeedsReview/A12_t06 - NEEDS REVIEW.mkv',
    };

    const labels = getQueueClassificationBadges(item).map((badge) => badge.label);
    expect(labels).toContain('Special Feature');
    expect(labels).not.toContain('Main Feature');
  });
});
