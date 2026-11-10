import { describe, expect, it, vi } from 'vitest';

import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';
import {
  ASSIGN_RESULTS_BATCH_SIZE,
  CLASSIFICATION_OPTIONS,
  QUEUE_ROWS_PER_PAGE_OPTIONS,
  appendIngressPath,
  buildDefaultEpisodeAssignments,
  buildManualAssignPayload,
  buildOmdbImdbResult,
  filterSelectableQueueItemIds,
  formatDuration,
  getAcceptEligibleItems,
  getIngressBacklog,
  getIngressHealthFlags,
  getQueueActionCounts,
  getQueueClassificationBadges,
  getRecentHistoryEntries,
  getRejectEligibleItems,
  getRetryEligibleItems,
  getSelectableQueueItemIds,
  isClassificationEditable,
  isEpisodeMappingValid,
  isQueueItemAssignable,
  isQueueItemSelectable,
  resolveIngressPaths,
  runQueueActionsSequentially,
  sortActiveQueueItems,
  withEpisode,
  withSeason,
  withUnknownFlag,
} from '@/service/ingress/ingressQueueModel';

const makeItem = (
  overrides: Partial<IngressQueueItem> & { id: string; status: string }
): IngressQueueItem => ({
  file_path: `/ingest/${overrides.id}.mkv`,
  file_name: `${overrides.id}.mkv`,
  attempts: 0,
  queued_at: 0,
  ...overrides,
});

describe('queue row selectability', () => {
  it('only lets bulk-checked rows sit in needs_review or auto_assigned', () => {
    expect(isQueueItemSelectable(makeItem({ id: '1', status: 'needs_review' }))).toBe(true);
    expect(isQueueItemSelectable(makeItem({ id: '2', status: 'auto_assigned' }))).toBe(true);
    for (const status of ['pending', 'processing', 'failed', 'completed']) {
      expect(isQueueItemSelectable(makeItem({ id: '3', status }))).toBe(false);
    }
  });

  it('derives the shift-range id list in table order', () => {
    const items = [
      makeItem({ id: 'a', status: 'needs_review' }),
      makeItem({ id: 'b', status: 'processing' }),
      makeItem({ id: 'c', status: 'auto_assigned' }),
    ];

    expect(getSelectableQueueItemIds(items)).toEqual(['a', 'c']);
  });

  it('keeps selection order while dropping stale and unselectable ids', () => {
    const items = [
      makeItem({ id: 'a', status: 'needs_review' }),
      makeItem({ id: 'b', status: 'completed' }),
      makeItem({ id: 'c', status: 'auto_assigned' }),
    ];

    expect(filterSelectableQueueItemIds(['c', 'gone', 'b', 'a'], items)).toEqual(['c', 'a']);
  });

  it('separates what can be reclassified, assigned and acted on', () => {
    const editable = makeItem({ id: '1', status: 'needs_review' });
    const done = makeItem({ id: '2', status: 'completed' });

    expect(isClassificationEditable(editable)).toBe(true);
    expect(isClassificationEditable(done)).toBe(false);
    expect(isQueueItemAssignable(editable)).toBe(true);
    expect(isQueueItemAssignable(done)).toBe(false);
  });

  it('counts accept / reject / retry availability across the selection', () => {
    const items = [
      makeItem({ id: '1', status: 'needs_review' }),
      makeItem({ id: '2', status: 'auto_assigned' }),
      makeItem({ id: '3', status: 'failed' }),
      makeItem({ id: '4', status: 'completed' }),
    ];

    expect(getQueueActionCounts(items)).toEqual({ acceptCount: 2, rejectCount: 1, retryCount: 2 });
    expect(getAcceptEligibleItems(items).map((item) => item.id)).toEqual(['1', '2']);
    expect(getRejectEligibleItems(items).map((item) => item.id)).toEqual(['1']);
    expect(getRetryEligibleItems(items).map((item) => item.id)).toEqual(['1', '3']);
  });
});

describe('runQueueActionsSequentially', () => {
  it('keeps going after a failure and returns one settled result per item', async () => {
    let call = 0;
    const action = vi.fn(async (id: string) => {
      call += 1;
      if (call === 2) {
        throw new Error('boom');
      }
      return id;
    });

    const results = await runQueueActionsSequentially(['a', 'b', 'c'], action);

    expect(results).toEqual([
      { status: 'fulfilled', value: 'a' },
      { status: 'rejected', reason: new Error('boom') },
      { status: 'fulfilled', value: 'c' },
    ]);
  });
});

describe('active queue ordering', () => {
  it('drops finished rows and orders by status urgency, then by queue time', () => {
    const items = [
      makeItem({ id: 'auto-old', status: 'auto_assigned', queued_at: 1 }),
      makeItem({ id: 'review-old', status: 'needs_review', queued_at: 2 }),
      makeItem({ id: 'done', status: 'completed', queued_at: 0 }),
      makeItem({ id: 'failed', status: 'failed', queued_at: 0 }),
      makeItem({ id: 'pending', status: 'pending', queued_at: 5 }),
      makeItem({ id: 'review-new', status: 'needs_review', queued_at: 9 }),
    ];

    expect(sortActiveQueueItems(items).map((item) => item.id)).toEqual([
      'review-old',
      'review-new',
      'pending',
      'auto-old',
    ]);
  });

  it('formats durations the way the queue column shows them', () => {
    expect(formatDuration(95_250_000)).toBe('26h 27m');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(1_850_000)).toBe('30m 50s');
  });
});

describe('classification badges', () => {
  it('labels a matched TV episode with its season and episode number', () => {
    const badges = getQueueClassificationBadges(
      makeItem({
        id: 'tv',
        status: 'needs_review',
        parsed_info: { media_type: 'episode', season: 1, episode: 2, quality: '1080p' },
      })
    );

    expect(badges.map((badge) => badge.label)).toEqual(['TV Episode', 'S01E02', '1080P']);
  });

  it('warns instead of inventing an episode number', () => {
    const badges = getQueueClassificationBadges(
      makeItem({ id: 'tv', status: 'needs_review', parsed_info: { media_type: 'episode' } })
    );

    expect(badges.map((badge) => badge.label)).toEqual(['Unknown Episode']);
  });

  it('marks a series-rooted match as a parent match and pins an active override', () => {
    const badges = getQueueClassificationBadges(
      makeItem({
        id: 'main',
        status: 'needs_review',
        file_name: 'movie.mkv',
        classification_override: 'main_feature',
        best_match: {
          title: 'Alien',
          media_type: 'movie',
          inferred_from_source_root: true,
        } as IngressQueueItem['best_match'],
      })
    );

    expect(badges.map((badge) => badge.label)).toEqual(['Main Feature', 'Parent Match', 'Override']);
  });

  it('falls back to Unclassified when nothing hints at the kind of file', () => {
    const badges = getQueueClassificationBadges(makeItem({ id: 'x', status: 'needs_review' }));

    expect(badges.map((badge) => badge.label)).toEqual(['Unclassified']);
  });

  it('offers the same override menu as the docs list', () => {
    expect(CLASSIFICATION_OPTIONS.map((option) => option.value)).toEqual([
      'auto',
      'main_feature',
      'special_feature',
      'alternate_version',
    ]);
    expect(QUEUE_ROWS_PER_PAGE_OPTIONS).toEqual([10, 25, 50, 100]);
    expect(ASSIGN_RESULTS_BATCH_SIZE).toBe(10);
  });
});

describe('recent history', () => {
  it('returns the ten newest entries first without mutating the source list', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      item_id: `item-${index}`,
      file_path: `/ingest/movie-${index}.mkv`,
      status: 'completed',
    }));
    const snapshot = history.map((entry) => entry.item_id);

    const recent = getRecentHistoryEntries(history);

    expect(recent).toHaveLength(10);
    expect(recent[0].item_id).toBe('item-11');
    expect(recent[recent.length - 1].item_id).toBe('item-2');
    expect(history.map((entry) => entry.item_id)).toEqual(snapshot);
  });
});

describe('health and backlog summaries', () => {
  it('treats a missing health payload as healthy', () => {
    expect(getIngressHealthFlags(null)).toEqual({
      ingressPathsHealthy: true,
      destHealthy: true,
    });
  });

  it('flags an unreadable ingress path and a missing destination mount', () => {
    expect(
      getIngressHealthFlags({
        ingress_paths: [
          { path: '/ok', exists: true, readable: true },
          { path: '/nope', exists: true, readable: false },
        ],
        destination: { exists: false },
      })
    ).toEqual({ ingressPathsHealthy: false, destHealthy: false });
  });

  it('adds pending and needs_review into one backlog number', () => {
    expect(
      getIngressBacklog({ total: 3, counts: { pending: 2, needs_review: 1 }, recent: [] })
    ).toEqual({ pending: 2, needsReview: 1, backlog: 3 });
    expect(getIngressBacklog(null)).toEqual({ pending: 0, needsReview: 0, backlog: 0 });
  });
});

describe('ingress path input', () => {
  it('falls back to the configured defaults when the textarea is blank', () => {
    expect(resolveIngressPaths('  \n ', ['/default/movies'])).toEqual(['/default/movies']);
    expect(resolveIngressPaths(' /a \n\n /b  ', ['/default'])).toEqual(['/a', '/b']);
  });

  it('appends a browsed path only when it is new', () => {
    expect(appendIngressPath('', '/data/movies')).toBe('/data/movies');
    expect(appendIngressPath('/a', '  /b  ')).toBe('/a\n/b');
    expect(appendIngressPath('/a\n/b', '/b')).toBe('/a\n/b');
    expect(appendIngressPath('/a', '   ')).toBe('/a');
  });
});

describe('episode assignment mapping', () => {
  const episodeItem = makeItem({
    id: 'ep-1',
    status: 'needs_review',
    parsed_info: { media_type: 'episode', season: 3, episode: 7 },
  });
  const episodeWithoutNumbers = makeItem({
    id: 'ep-2',
    status: 'needs_review',
    parsed_info: { media_type: 'episode' },
    best_match: { title: 'The Wire', media_type: 'series', season: 2 },
  });
  const movieItem = makeItem({ id: 'mv', status: 'needs_review', parsed_info: { media_type: 'movie' } });

  it('defaults the dialog to episode mode when any target is episode-like', () => {
    const { shouldUseEpisode, episodeMap } = buildDefaultEpisodeAssignments([episodeItem, episodeWithoutNumbers, movieItem]);

    expect(shouldUseEpisode).toBe(true);
    expect(episodeMap['ep-1']).toEqual({ season: 3, episode: 7, unknown: false });
    expect(episodeMap['ep-2']).toEqual({ season: 2, episode: undefined, unknown: true });
    expect(episodeMap['mv']).toEqual({ season: undefined, episode: undefined, unknown: true });
  });

  it('stays in movie mode when no target looks like an episode', () => {
    expect(buildDefaultEpisodeAssignments([movieItem]).shouldUseEpisode).toBe(false);
  });

  it('clears the numbers when a row is marked Unknown and clears Unknown when typed again', () => {
    const initial = { season: 3, episode: 7, unknown: false };

    expect(withUnknownFlag(initial, true)).toEqual({ season: undefined, episode: undefined, unknown: true });
    expect(withUnknownFlag(initial, false)).toEqual(initial);
    expect(withSeason({ season: 3, episode: 7, unknown: true }, 4)).toEqual({ season: 4, episode: 7, unknown: false });
    expect(withSeason({ season: 3 }, undefined)).toEqual({ season: undefined, unknown: false });
    expect(withEpisode({ season: 3, episode: 7, unknown: true }, 2)).toEqual({ season: 3, episode: 2, unknown: false });
  });

  it('rejects partial mappings but honours the Unknown escape hatch', () => {
    expect(isEpisodeMappingValid({ season: 2, episode: 5 })).toBe(true);
    expect(isEpisodeMappingValid({ season: 2.5, episode: 5 })).toBe(false);
    expect(isEpisodeMappingValid(undefined)).toBe(false);
  });

  it('turns an IMDb lookup into the shape the assign payload expects', () => {
    const episode = buildOmdbImdbResult({ imdbID: 'tt01', Title: 'The Wire', Year: '2002', Type: 'episode' });
    const movie = buildOmdbImdbResult({ imdbID: 'tt02', Title: 'Alien', Year: '1979', Type: 'movie' });

    expect(episode).toMatchObject({ id: 'tt01', imdbId: 'tt01', type: 'series', source: 'omdb' });
    expect(movie.type).toBe('movie');
  });
});

describe('manual assign payload', () => {
  const result = {
    id: 'tmdb-550',
    title: 'Fight Club',
    year: '1999',
    type: 'movie' as const,
    poster: 'https://poster',
    imdbId: 'tt0137523',
    source: 'tmdb',
    data: { raw: true },
  };

  it('uses the IMDb id for OMDB hits and strips the tmdb prefix from TMDB hits', () => {
    expect(
      buildManualAssignPayload({
        itemId: '1',
        mediaType: 'movie',
        result: { ...result, source: 'omdb', id: 'tt0137523' },
        organizeAfterAssign: false,
      }).mediaId
    ).toBe('tt0137523');

    const tmdb = buildManualAssignPayload({
      itemId: '1',
      mediaType: 'movie',
      result,
      organizeAfterAssign: true,
    });

    expect(tmdb.mediaId).toBe('550');
    expect(tmdb.legacyMediaId).toBeUndefined();
    expect(tmdb.year).toBe(1999);
    expect(tmdb.organizeNow).toBe(true);
    expect(tmdb.posterUrl).toBe('https://poster');
    expect(tmdb.rawData).toEqual({ raw: true });
    expect({ season: tmdb.season, episode: tmdb.episode, unknownEpisode: tmdb.unknownEpisode }).toEqual({
      season: undefined,
      episode: undefined,
      unknownEpisode: undefined,
    });
  });

  it('sends season/episode for a mapped episode and the unknown flag otherwise', () => {
    const mapped = buildManualAssignPayload({
      itemId: '1',
      mediaType: 'episode',
      result,
      mapping: { season: 2, episode: 4 },
      organizeAfterAssign: false,
    });
    const unknown = buildManualAssignPayload({
      itemId: '1',
      mediaType: 'episode',
      result,
      mapping: { unknown: true },
      organizeAfterAssign: false,
    });

    expect({ season: mapped.season, episode: mapped.episode, unknownEpisode: mapped.unknownEpisode }).toEqual({
      season: 2,
      episode: 4,
      unknownEpisode: false,
    });
    expect({ season: unknown.season, episode: unknown.episode, unknownEpisode: unknown.unknownEpisode }).toEqual({
      season: undefined,
      episode: undefined,
      unknownEpisode: true,
    });
  });

  it('leaves the year unset when the search result has none', () => {
    expect(
      buildManualAssignPayload({
        itemId: '1',
        mediaType: 'movie',
        result: { ...result, year: 'N/A' },
        organizeAfterAssign: false,
      }).year
    ).toBeUndefined();
  });
});
