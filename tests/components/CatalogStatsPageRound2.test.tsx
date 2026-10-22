/**
 * Round-2 QA probes for /dashboard/stats (issue #16, AC2).
 *
 * CatalogStatsPage.test.tsx pins the happy path, the capped-list note and the
 * error panel. Still unproven after the rework:
 *
 *   * an empty catalog — the page must say so per panel instead of drawing
 *     zero-height bars or a blank list;
 *   * the "Retry" button on the error panel actually re-fetches (a dead button
 *     would strand the page until a full reload);
 *   * the loading state, and that the bars are real charts — width scaled to
 *     the largest bucket, not decoration;
 *   * undated counts of zero stay silent (the caption would otherwise read
 *     "0 record(s) have no release year").
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsPage from '@/app/dashboard/stats/page';
import { CatalogStats } from '@/types/catalog/CatalogStats.type';

const { getCatalogStats } = vi.hoisted(() => ({ getCatalogStats: vi.fn() }));

vi.mock('@/service/catalog/CatalogStatsService', () => ({ getCatalogStats }));

const EMPTY: CatalogStats = {
  generatedAt: '2026-02-01T08:00:00+00:00',
  recentDays: 30,
  totalItems: 0,
  byType: { movie: 0, series: 0, disc: 0, tape: 0 },
  byDiscFormat: [],
  byDecade: [],
  undated: 0,
  recentlyAdded: { days: 30, count: 0, items: [] },
  storage: { total: 0, withLocation: 0, withoutLocation: 0, byType: [] },
  lentOut: { count: 0, items: [] },
};

const POPULATED: CatalogStats = {
  ...EMPTY,
  totalItems: 9,
  byType: { movie: 6, series: 0, disc: 3, tape: 0 },
  byDiscFormat: [
    { label: 'Blu-ray', count: 3 },
    { label: 'DVD', count: 1 },
  ],
  byDecade: [{ label: '2010s', startYear: 2010, count: 4 }],
  undated: 5,
  recentlyAdded: {
    days: 30,
    count: 1,
    items: [{ id: 'm1', title: 'Alien', type: 'movie', createdAt: '2026-01-20T10:00:00+00:00' }],
  },
  storage: { total: 3, withLocation: 2, withoutLocation: 1, byType: [{ label: 'Box', count: 2 }] },
  lentOut: { count: 1, items: [{ id: 'd1', title: 'Alien 4K', type: 'disc', borrower: 'Sam' }] },
};

describe('StatsPage round-2 probes', () => {
  beforeEach(() => {
    getCatalogStats.mockReset();
  });

  it('shows a loading indicator before the first payload arrives', async () => {
    let resolve: (value: CatalogStats) => void = () => {};
    getCatalogStats.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<StatsPage />);

    expect(screen.getByRole('progressbar', { name: 'Loading catalog stats' })).toBeInTheDocument();
    expect(screen.queryByText('Total items')).not.toBeInTheDocument();

    resolve(POPULATED);
    expect(await screen.findByText('Total items')).toBeInTheDocument();
  });

  it('labels every panel as empty instead of drawing empty charts', async () => {
    getCatalogStats.mockResolvedValue(EMPTY);

    render(<StatsPage />);

    expect(await screen.findByText('Total items')).toBeInTheDocument();
    expect(screen.getByTestId('tile-Total items').textContent).toBe('0');
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.getByText('No discs catalogued.')).toBeInTheDocument();
    expect(screen.getByText('No release years to group.')).toBeInTheDocument();
    expect(screen.getByText('Nothing filed into a box or binder yet.')).toBeInTheDocument();
    expect(screen.getByText('Nothing added in the last 30 days.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is on loan.')).toBeInTheDocument();
    // An undated count of zero must not render a caption claiming records exist.
    expect(screen.queryByText(/record\(s\) have no release year/)).not.toBeInTheDocument();
    // No bars at all when nothing is counted.
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('draws one labelled bar per bucket, scaled to the largest in its chart', async () => {
    getCatalogStats.mockResolvedValue(POPULATED);

    render(<StatsPage />);

    await screen.findByText('By disc format');
    const bar = (label: string) => screen.getByRole('progressbar', { name: label }) as HTMLElement;

    // The accessible contract of the bar: its own count against the largest
    // bucket in the same chart, which is what the rendered width tracks.
    expect(bar('Movies: 6').getAttribute('aria-valuemax')).toBe('6');
    expect(bar('Discs: 3').getAttribute('aria-valuemax')).toBe('6');
    expect(bar('Blu-ray: 3').getAttribute('aria-valuemax')).toBe('3');
    expect(bar('DVD: 1').getAttribute('aria-valuemax')).toBe('3');
    expect(bar('2010s: 4').getAttribute('aria-valuenow')).toBe('4');

    // One bar per bucket, and no bar invented for a zero count.
    expect(screen.getAllByRole('progressbar')).toHaveLength(6);
  });

  it('recovers through the Retry button after a failed load', async () => {
    getCatalogStats.mockRejectedValueOnce(new Error('Could not reach backend service.'));

    render(<StatsPage />);

    expect(await screen.findByText('Could not reach backend service.')).toBeInTheDocument();

    getCatalogStats.mockResolvedValue(POPULATED);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Total items')).toBeInTheDocument();
    expect(getCatalogStats).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Could not reach backend service.')).not.toBeInTheDocument();
  });

  it('re-fetches when Refresh is pressed', async () => {
    getCatalogStats.mockResolvedValue(POPULATED);

    render(<StatsPage />);
    await screen.findByText('Total items');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(getCatalogStats).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Total items')).toBeInTheDocument();
  });
});
