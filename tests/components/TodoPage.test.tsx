/**
 * The To-Do page (/organize/todo) against a stubbed `fetch`: kind tabs with counts, search,
 * the rename flow (single and bulk), dismiss + undo, clearing a flag, and the empty and
 * unsupported states.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/organize/todo',
}));

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>{children}</a>
  )),
}));

import TodoRoute from '@/app/organize/todo/page';
import { NotificationProvider } from '@/context/NotificationContext';
import { resetAttentionSummaryStore } from '@/hooks/attention/useAttentionSummary';
import type { AttentionItem, AttentionSummary } from '@/types/attention/Attention.type';
import { attentionItem, attentionSummary } from '../utils/attentionFixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const RENAME_A = attentionItem();
const RENAME_B = attentionItem({
  id: 'needs_rename:media_file:f2', subjectId: 'f2', title: 'Rename heat.mkv', mediaId: 'm2', mediaTitle: 'Heat',
  filePath: '/lib/Movies/Heat (1995)/heat.mkv', relativePath: 'Movies/Heat (1995)/heat.mkv',
  current: 'Movies/Heat (1995)/heat.mkv', expected: 'Movies/Heat (1995)/Heat (1995).mkv',
  file: { id: 'f2', fileName: 'heat.mkv', filePath: '/lib/Movies/Heat (1995)/heat.mkv', fileSize: 4 * 1024 ** 3, detectedMediaType: 'movie', assignmentStatus: null, targetPath: null, organizationStatus: null, createdAt: null, resolutionCategory: '1080p', videoCodec: 'h264' },
});
const FLAGGED = attentionItem({
  id: 'needs_review:media_file:f3', kind: 'needs_review', subjectId: 'f3', title: 'Check extra.mkv', reasons: ['flagged'], dismissible: false,
  current: null, expected: null,
});

interface State {
  summary: AttentionSummary | 'unsupported';
  items: AttentionItem[];
  /** fileId → conflict on preview. */
  conflicts: Set<string>;
}

let state: State;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = () =>
  fetchMock.mock.calls.map(([u, init]) => ({ url: String(u), method: (init as RequestInit | undefined)?.method ?? 'GET', body: (init as RequestInit | undefined)?.body }));

const stubFetch = () => {
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('/api/attention/summary')) {
      return state.summary === 'unsupported' ? new Response('Not Found', { status: 404 }) : json(state.summary);
    }
    if (url.pathname.endsWith('/api/attention/items')) {
      const kinds = url.searchParams.get('kind')?.split(',');
      const mediaId = url.searchParams.get('mediaId');
      const items = state.items.filter((i) => (!kinds || kinds.includes(i.kind)) && (!mediaId || i.mediaId === mediaId));
      return json({ items, total: items.length });
    }
    if (url.pathname.endsWith('/api/attention/dismiss') && method === 'POST') {
      return json({ id: 'dis-1', itemId: 'x', kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', fingerprint: null, dismissedUntil: null, note: null, createdAt: null });
    }
    if (url.pathname.includes('/api/attention/dismiss/') && method === 'DELETE') return json({ success: true });
    if (url.pathname.endsWith('/api/attention/dismissals')) return json({ dismissals: [] });
    const rename = /media-files\/([^/]+)\/rename-canonical/.exec(url.pathname);
    if (rename) {
      const id = rename[1];
      const conflict = state.conflicts.has(id);
      return json({
        fileId: id, currentPath: `/lib/${id}-old.mkv`, canonicalPath: `/lib/${id}-new.mkv`,
        currentRelativePath: `${id}-old.mkv`, canonicalRelativePath: `${id}-new.mkv`,
        changed: true, applied: url.searchParams.get('dryRun') === 'false' && !conflict, conflict, file: null,
      });
    }
    if (/media-files\/[^/]+\/review/.test(url.pathname)) return json({ id: 'f3', needsReview: false });
    return json(null);
  });
  vi.stubGlobal('fetch', fetchMock);
};

const renderPage = () => render(<NotificationProvider><TodoRoute /></NotificationProvider>);
const itemLoads = () => calls().filter((c) => c.url.includes('/api/attention/items')).length;
const summaryLoads = () => calls().filter((c) => c.url.includes('/api/attention/summary')).length;

describe('To-Do page', () => {
  beforeEach(() => {
    resetAttentionSummaryStore();
    nav.search = '';
    nav.replace.mockReset();
    state = { summary: attentionSummary({ needs_rename: 2, needs_review: 1, unprobed: 5 }), items: [RENAME_A, RENAME_B, FLAGGED], conflicts: new Set() };
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAttentionSummaryStore();
  });

  it('shows kind tabs with counts and opens the first kind with items', async () => {
    renderPage();
    const renameTab = await screen.findByRole('tab', { name: /Needs renaming \(2\)/ });
    expect(renameTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Needs assignment \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Needs a second look \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /No technical details \(5\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dismissed' })).toBeInTheDocument();

    const table = await screen.findByRole('table', { name: 'Needs renaming' });
    expect(within(table).getByRole('rowheader', { name: /Rename inception.mkv/ })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Inception' })).toHaveAttribute('href', '/dashboard/my-library/movie/m1?tab=files');
    expect(within(table).getByText('Movies/Heat (1995)/Heat (1995).mkv')).toBeInTheDocument();
    expect(within(table).getByText('4.0 GB')).toBeInTheDocument();
    expect(calls().some((c) => c.url.includes('kind=needs_rename'))).toBe(true);
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Needs a second look/ }));
    expect(nav.replace).toHaveBeenCalledWith('/organize/todo?kind=needs_review', { scroll: false });
  });

  it('filters the list by title or file name', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Needs renaming' });
    fireEvent.change(screen.getByLabelText('Search titles and files'), { target: { value: 'heat' } });
    const table = screen.getByRole('table', { name: 'Needs renaming' });
    expect(within(table).queryByText('Rename inception.mkv')).not.toBeInTheDocument();
    expect(within(table).getByText('Rename heat.mkv')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search titles and files'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('renames one file: dry-run preview, apply, then refetches the list and the summary', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Needs renaming' });
    const before = { items: itemLoads(), summary: summaryLoads() };

    fireEvent.click(screen.getByRole('button', { name: 'Rename: Rename inception.mkv' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename to canonical name' });
    expect(await within(dialog).findByText('f1-new.mkv')).toBeInTheDocument();
    expect(calls().some((c) => c.url.includes('/media-files/f1/rename-canonical?dryRun=true'))).toBe(true);
    expect(calls().some((c) => c.url.includes('dryRun=false'))).toBe(false);

    state.items = [RENAME_B, FLAGGED];
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 1 rename' }));
    await waitFor(() => expect(calls().some((c) => c.url.includes('/media-files/f1/rename-canonical?dryRun=false'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('Rename inception.mkv')).not.toBeInTheDocument());
    expect(itemLoads()).toBeGreaterThan(before.items);
    expect(summaryLoads()).toBeGreaterThan(before.summary);
  });

  it('bulk-renames the selection, skipping conflicts', async () => {
    state.conflicts = new Set(['f2']);
    renderPage();
    await screen.findByRole('table', { name: 'Needs renaming' });
    expect(screen.getByRole('button', { name: 'Rename selected' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename selected (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename to canonical name' });
    expect(await within(dialog).findByText('Target exists')).toBeInTheDocument();
    expect(within(dialog).getByText('Will rename')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 1 rename' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const applied = calls().filter((c) => c.url.includes('dryRun=false')).map((c) => c.url);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('/media-files/f1/');
  });

  it('dismisses an item until it changes and undoes it from the toast', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Needs renaming' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Rename inception.mkv' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Dismiss until it changes' }));

    await waitFor(() => expect(calls().some((c) => c.method === 'POST' && c.url.endsWith('/api/attention/dismiss'))).toBe(true));
    const post = calls().find((c) => c.method === 'POST' && c.url.endsWith('/api/attention/dismiss'))!;
    expect(JSON.parse(String(post.body))).toEqual({ kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', days: null });

    expect(await screen.findByText('Dismissed until it changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls().some((c) => c.method === 'DELETE' && c.url.endsWith('/api/attention/dismiss/dis-1'))).toBe(true));
  });

  it('dismisses for 30 days', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Needs renaming' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Rename heat.mkv' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Dismiss for 30 days' }));
    await waitFor(() => {
      const post = calls().find((c) => c.method === 'POST' && c.url.endsWith('/api/attention/dismiss'));
      expect(JSON.parse(String(post?.body ?? '{}'))).toMatchObject({ subjectId: 'f2', days: 30 });
    });
  });

  it('clears a hand flag with the review endpoint (no Dismiss for it)', async () => {
    nav.search = 'kind=needs_review';
    renderPage();
    const table = await screen.findByRole('table', { name: 'Needs a second look' });
    fireEvent.click(within(table).getByRole('button', { name: 'More actions for Check extra.mkv' }));
    expect(screen.queryByRole('menuitem', { name: /Dismiss/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    fireEvent.click(within(table).getByRole('button', { name: 'Clear flag: Check extra.mkv' }));
    await waitFor(() => {
      const patch = calls().find((c) => c.method === 'PATCH' && c.url.includes('/media-files/f3/review'));
      expect(JSON.parse(String(patch?.body ?? '{}'))).toEqual({ needsReview: false });
    });
  });

  it('opens the ingest manual-assign dialog for a queue item', async () => {
    const queued = attentionItem({
      id: 'needs_assignment:queue_item:q1', kind: 'needs_assignment', subjectType: 'queue_item', subjectId: 'q1', queueItemId: 'q1',
      title: 'Assign mystery.mkv', mediaId: null, mediaTitle: null, current: null, expected: null,
      queue: { status: 'needs_review', reviewReason: 'no_match', lastError: null, confidence: 30, bestMatchTitle: null, bestMatchYear: null, bestMatchMediaType: null, proposedPath: null },
    });
    state.summary = attentionSummary({ needs_assignment: 1 });
    state.items = [queued];
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes('/api/ingress/queue/items')) {
        return json({ success: true, data: { items: [{ id: 'q1', file_path: '/ingest/mystery.mkv', file_name: 'mystery.mkv', status: 'needs_review', attempts: 0, queued_at: 0 }] } });
      }
      return base(input, init);
    });

    renderPage();
    const table = await screen.findByRole('table', { name: 'Needs assignment' });
    expect(within(table).getByText('No title yet')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Assign: Assign mystery.mkv' }));
    expect(await screen.findByRole('dialog', { name: 'Manual Assignment' })).toBeInTheDocument();
    expect(calls().some((c) => c.url.includes('/api/ingress/queue/items?status=needs_review'))).toBe(true);
  });

  it('lists dismissed items and restores one', async () => {
    nav.search = 'kind=dismissed';
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith('/api/attention/dismissals')) {
        return json({ dismissals: [{ id: 'dis-9', itemId: 'needs_rename:media_file:f1', kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', fingerprint: null, dismissedUntil: null, note: 'Director cut name', createdAt: null }] });
      }
      return base(input, init);
    });
    renderPage();
    const table = await screen.findByRole('table', { name: 'Dismissed items' });
    expect(within(table).getByText('Director cut name')).toBeInTheDocument();
    expect(within(table).getByText('Until it changes')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Restore media file f1' }));
    await waitFor(() => expect(calls().some((c) => c.method === 'DELETE' && c.url.endsWith('/api/attention/dismiss/dis-9'))).toBe(true));
  });

  it('shows the per-kind empty state and the all-clear state', async () => {
    nav.search = 'kind=missing_file';
    const { unmount } = renderPage();
    expect(await screen.findByText('No files are missing')).toBeInTheDocument();
    unmount();

    resetAttentionSummaryStore();
    nav.search = '';
    state.summary = attentionSummary();
    state.items = [];
    renderPage();
    expect(await screen.findByText('All organized')).toBeInTheDocument();
  });

  it('explains when the server has no To-Do list', async () => {
    state.summary = 'unsupported';
    renderPage();
    expect(await screen.findByText('The To-Do list is not available yet')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('filters to one title from ?mediaType=&mediaId= with a removable chip', async () => {
    nav.search = 'mediaType=movie&mediaId=m1';
    renderPage();
    const table = await screen.findByRole('table', { name: 'Needs renaming' });
    expect(within(table).getByText('Rename inception.mkv')).toBeInTheDocument();
    expect(within(table).queryByText('Rename heat.mkv')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Needs renaming \(1\)/ })).toBeInTheDocument();
    expect(calls().some((c) => c.url.includes('mediaType=movie&mediaId=m1'))).toBe(true);

    const chip = screen.getByRole('button', { name: /Showing only Inception/ });
    fireEvent.click(within(chip).getByTestId('CancelIcon'));
    expect(nav.replace).toHaveBeenCalledWith('/organize/todo', { scroll: false });
  });
});
