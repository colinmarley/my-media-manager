import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>{children}</a>
  )),
}));

const ingress = vi.hoisted(() => ({
  getQueueStatus: vi.fn(),
  getWatcherStatus: vi.fn(),
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  processPending: vi.fn(),
}));
const getSummary = vi.hoisted(() => vi.fn());
const getCatalogStats = vi.hoisted(() => vi.fn());

vi.mock('@/service/ingress/IngressAutomationService', () => ({ default: ingress }));
vi.mock('@/service/library/LibraryComplianceService', () => ({ default: { getSummary } }));
vi.mock('@/service/catalog/CatalogStatsService', () => ({ getCatalogStats }));

import Dashboard from '@/app/dashboard/page';

const queue = {
  total: 26,
  counts: { pending: 3, processing: 1, auto_assigned: 2, needs_review: 5, failed: 4, completed: 12, ignored: 0 },
  recent: [],
};
const watcher = { is_running: false, watched_paths: ['/data/encoded'], pending_count: 0, queue_count: 0, processed_event_count: 0 };
const stats = {
  totalItems: 520,
  byType: { movie: 300, series: 40, disc: 150, tape: 30 },
  storage: { total: 180, withLocation: 170, withoutLocation: 10, byType: [] },
  lentOut: { count: 2, items: [] },
};
const compliance = { open: 7, critical: 1, high: 0, duplicateMain: 0, misplacedSpecial: 0, namingMismatch: 0 };

const stage = (id: string) => document.querySelector(`[data-stage="${id}"]`) as HTMLElement;

describe('Home page', () => {
  beforeEach(() => {
    ingress.getQueueStatus.mockReset().mockResolvedValue(queue);
    ingress.getWatcherStatus.mockReset().mockResolvedValue(watcher);
    ingress.startWatcher.mockReset().mockResolvedValue({ ...watcher, is_running: true });
    ingress.stopWatcher.mockReset();
    ingress.processPending.mockReset().mockResolvedValue(3);
    getSummary.mockReset().mockResolvedValue(compliance);
    getCatalogStats.mockReset().mockResolvedValue(stats);
  });

  it('renders the stage counts, failures and library tiles from the services', async () => {
    render(<Dashboard />);

    await waitFor(() => expect(within(stage('detected')).getByText('4')).toBeInTheDocument());
    expect(within(stage('matched')).getByText('2')).toBeInTheDocument();
    expect(within(stage('needsReview')).getByText('5')).toBeInTheDocument();
    expect(within(stage('organized')).getByText('12')).toBeInTheDocument();
    expect(within(stage('inLibrary')).getByText('340')).toBeInTheDocument();
    expect(within(stage('needsReview')).getByRole('link')).toHaveAttribute('href', '/ingress-automation');

    expect(screen.getByText('4 files failed to ingest.')).toBeInTheDocument();
    expect(screen.getByText('Watcher stopped')).toBeInTheDocument();
    expect(await screen.findByText('300 movies, 40 shows')).toBeInTheDocument();
    expect(await screen.findByText('Compliance issues')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open review queue' })).toHaveAttribute('href', '/ingress-automation');
  });

  it('keeps the rest of the page when one endpoint fails, and retries it', async () => {
    getCatalogStats.mockRejectedValueOnce(new Error('API error 500'));
    render(<Dashboard />);

    expect(await screen.findByText(/Library totals could not be loaded/)).toBeInTheDocument();
    await waitFor(() => expect(within(stage('needsReview')).getByText('5')).toBeInTheDocument());
    expect(within(stage('inLibrary')).getByText('—')).toBeInTheDocument();
    expect(await screen.findByText('Compliance issues')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('300 movies, 40 shows')).toBeInTheDocument();
    expect(screen.queryByText(/Library totals could not be loaded/)).not.toBeInTheDocument();
  });

  it('starts the watcher and processes pending files', async () => {
    render(<Dashboard />);
    const start = await screen.findByRole('button', { name: 'Start watcher' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(ingress.startWatcher).toHaveBeenCalledTimes(1));

    const process = screen.getByRole('button', { name: 'Process pending' });
    await waitFor(() => expect(process).toBeEnabled());
    fireEvent.click(process);
    await waitFor(() => expect(ingress.processPending).toHaveBeenCalledTimes(1));
  });

  it('does not render a To-Do section until a later PR fills the slot', async () => {
    render(<Dashboard />);
    await screen.findByText('300 movies, 40 shows');
    expect(screen.queryByRole('heading', { name: 'To-Do' })).not.toBeInTheDocument();
  });
});
