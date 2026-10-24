/**
 * Render tests for /dashboard/stats (issue #16).
 *
 * The page's only data source is GET /api/catalog/stats, reached through
 * CatalogStatsService — mocking that module keeps this a pure render test
 * (no fetch stubbing, no backend) and pins the payload shape the backend
 * test asserts on.
 *
 * Issue #16 acceptance criteria -> the test that pins them here:
 *
 *   AC2 "A `/dashboard/stats` page with summary tiles and simple charts (MUI
 *       or a light chart library already in use), linked from the nav."
 *       tiles and charts in one page -> 'AC2 the page renders the summary tiles and
 *                                       the simple charts the criterion asks for',
 *                                       'fetches catalog stats and renders the summary tiles',
 *                                       'charts items by type, disc format and release decade',
 *                                       'lists recently added items and what is lent out',
 *                                       'says what a capped list is leaving out',
 *                                       'shows a retryable error instead of zeroes when the
 *                                       endpoint fails'
 *       the nav link (the other half of AC2) -> tests/components/AppShellNav.test.tsx ::
 *                                       'links to the stats page from the drawer'
 *       loading / empty / retry / refresh / bar scaling ->
 *                                       tests/components/CatalogStatsPageRound2.test.tsx
 *
 *   AC3 "Backend unit test for the endpoint (mocked DB) and a render test for
 *       the page."
 *       the render test half of AC3 -> 'AC3 the render test needs no backend: one mocked
 *                                       service call draws the whole page'
 *                                       (the page never touches the network itself)
 *       the mocked-DB endpoint half -> backend/tests/test_catalog_stats.py ::
 *                                       test_ac3_the_endpoint_unit_tests_build_no_real_session
 *
 * AC1 (the GET /api/catalog/stats payload itself) is pinned server-side in
 * backend/tests/test_catalog_stats.py; this file is what consumes that shape.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsPage from '@/app/dashboard/stats/page';
import { CatalogStats } from '@/types/catalog/CatalogStats.type';

const { getCatalogStats } = vi.hoisted(() => ({ getCatalogStats: vi.fn() }));

vi.mock('@/service/catalog/CatalogStatsService', () => ({ getCatalogStats }));

const stats: CatalogStats = {
  generatedAt: '2026-02-01T08:00:00+00:00',
  recentDays: 30,
  totalItems: 21,
  byType: { movie: 10, series: 3, disc: 7, tape: 1 },
  byDiscFormat: [
    { label: 'Blu-ray', count: 5 },
    { label: 'DVD', count: 2 },
  ],
  byDecade: [
    { label: '1970s', startYear: 1970, count: 6 },
    { label: '2010s', startYear: 2010, count: 4 },
  ],
  undated: 10,
  recentlyAdded: {
    days: 30,
    count: 2,
    items: [
      { id: 'd1', title: 'Alien 4K', type: 'disc', createdAt: '2026-01-25T10:00:00+00:00' },
      { id: 'm1', title: 'Alien', type: 'movie', createdAt: '2026-01-20T10:00:00+00:00' },
    ],
  },
  storage: {
    total: 8,
    withLocation: 5,
    withoutLocation: 3,
    byType: [
      { label: 'Box', count: 4 },
      { label: 'Binder', count: 1 },
    ],
  },
  lentOut: {
    count: 1,
    items: [{ id: 'd7', title: 'Alien LaserDisc', type: 'disc', borrower: 'Sam' }],
  },
};

const tileValue = (label: string) => screen.getByTestId(`tile-${label}`).textContent;

describe('StatsPage', () => {
  beforeEach(() => {
    getCatalogStats.mockReset();
    getCatalogStats.mockResolvedValue(stats);
    vi.unstubAllGlobals();
  });

  it('fetches catalog stats and renders the summary tiles', async () => {
    render(<StatsPage />);

    await waitFor(() => expect(getCatalogStats).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('Total items')).toBeInTheDocument();
    expect(tileValue('Total items')).toBe('21');
    expect(tileValue('Movies')).toBe('10');
    expect(tileValue('Series')).toBe('3');
    expect(tileValue('Discs')).toBe('7');
    expect(tileValue('Tapes')).toBe('1');
    expect(tileValue('Lent out')).toBe('1');
    expect(tileValue('Without a location')).toBe('3');
    expect(tileValue('Added in 30 days')).toBe('2');
  });

  it('charts items by type, disc format and release decade', async () => {
    render(<StatsPage />);

    expect(await screen.findByText('By disc format')).toBeInTheDocument();
    expect(screen.getByText('By type')).toBeInTheDocument();
    expect(screen.getByText('By release decade')).toBeInTheDocument();

    expect(screen.getByText('Blu-ray')).toBeInTheDocument();
    expect(screen.getByText('DVD')).toBeInTheDocument();
    expect(screen.getByText('1970s')).toBeInTheDocument();
    expect(screen.getByText('2010s')).toBeInTheDocument();
    expect(screen.getByText('10 record(s) have no release year.')).toBeInTheDocument();
    expect(screen.getByText('Storage locations')).toBeInTheDocument();
  });

  it('lists recently added items and what is lent out', async () => {
    render(<StatsPage />);

    expect(await screen.findByText('Recently added (2)')).toBeInTheDocument();
    expect(screen.getByText('Lent out (1)')).toBeInTheDocument();
    expect(screen.getByText('Alien 4K')).toBeInTheDocument();
    expect(screen.getByText('Alien')).toBeInTheDocument();
    expect(screen.getByText('Alien LaserDisc')).toBeInTheDocument();
    expect(screen.getByText('with Sam')).toBeInTheDocument();
    // Nothing is hidden behind a cap in this payload, so nothing qualifies as
    // a partial list.
    expect(screen.queryByTestId('stats-list-note')).not.toBeInTheDocument();
  });

  it('says what a capped list is leaving out', async () => {
    // The server caps both lists at twelve (ITEM_LIST_LIMIT) while `count`
    // stays the whole total. Twelve rows under a "(21)" heading otherwise
    // reads as a miscount, and the page has to own that difference.
    const truncated: CatalogStats = {
      ...stats,
      recentlyAdded: {
        days: 30,
        count: 21,
        items: Array.from({ length: 12 }, (_, n) => ({
          id: `m${n}`,
          title: `Recent title ${n}`,
          type: 'movie' as const,
          createdAt: '2026-01-20T10:00:00+00:00',
        })),
      },
      lentOut: {
        count: 13,
        items: Array.from({ length: 12 }, (_, n) => ({
          id: `d${n}`,
          title: `Lent title ${n}`,
          type: 'disc' as const,
          borrower: 'Sam',
        })),
      },
    };
    getCatalogStats.mockResolvedValue(truncated);

    render(<StatsPage />);

    expect(await screen.findByText('Recently added (21)')).toBeInTheDocument();
    expect(screen.getByText('Lent out (13)')).toBeInTheDocument();
    expect(
      screen.getAllByTestId('stats-list-note').map((note) => note.textContent),
    ).toEqual(['Showing 12 of 21', 'Showing 12 of 13']);
    expect(screen.getByText('Lent title 11')).toBeInTheDocument();
    expect(screen.queryByText('Recent title 12')).not.toBeInTheDocument();
  });

  it('AC2 the page renders the summary tiles and the simple charts the criterion asks for', async () => {
    // AC2 names two things: summary tiles and simple charts. Count them both,
    // so a page that keeps the tiles but loses a chart (or draws charts with
    // no tiles) cannot pass on the more specific tests below.
    render(<StatsPage />);

    await screen.findByText('Total items');

    const tiles = screen.getAllByTestId(/^tile-/);
    expect(tiles.length).toBe(8); // total, movie, series, disc, tape, lent, no location, recent

    for (const chart of ['By type', 'By disc format', 'By release decade', 'Storage locations']) {
      expect(screen.getByText(chart)).toBeInTheDocument();
    }
    // "Simple charts" here means labelled bars drawn by this page — one bar per
    // bucket, no charting dependency in the payload contract.
    expect(screen.getAllByRole('progressbar')).toHaveLength(10);
  });

  it('AC3 the render test needs no backend: one mocked service call draws the whole page', async () => {
    // AC3 asks for a render test of the page, not an integration test. The page
    // must get everything from CatalogStatsService and never reach for the
    // network itself, which is what lets this file run without a backend.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<StatsPage />);

    expect(await screen.findByText('Total items')).toBeInTheDocument();
    expect(getCatalogStats).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('shows a retryable error instead of zeroes when the endpoint fails', async () => {
    getCatalogStats.mockRejectedValue(new Error('Could not reach backend service.'));

    render(<StatsPage />);

    expect(await screen.findByText('Could not reach backend service.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Total items')).not.toBeInTheDocument();
  });
});
