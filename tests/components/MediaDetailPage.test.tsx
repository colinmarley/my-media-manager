/**
 * Render test for the library title detail page
 * (src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx), driving the real hooks against a
 * stubbed `fetch`: the header, the ?tab= tabs, the link flow, feature detection of the endpoints
 * that arrive with a later backend PR, the error / not-found states and the legacy fallback.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useParams: () => ({ mediaType: 'movie', mediaId: 'movie-1' }),
    useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn(), prefetch: vi.fn() }),
    useSearchParams: () => new URLSearchParams(nav.search),
    usePathname: () => '/dashboard/my-library/movie/movie-1',
  };
});

import LibraryMediaDetailPage from '../../src/app/dashboard/my-library/[mediaType]/[mediaId]/page';

const GB = 1024 ** 3;
const FOLDER = '/ark/media/jellyfin/Movies/Big Movie';

const MOVIE = {
  id: 'movie-1',
  title: 'Big Movie',
  mediaType: 'movie',
  releaseDate: '1995-04-22',
  runtime: '178 min',
  genres: ['Crime', 'Drama'],
  directors: [{ fullName: 'Director One' }],
  folderPath: FOLDER,
  posterUrl: 'https://example.com/poster.jpg',
  externalIds: { imdbId: 'tt0110912', tmdbId: 155 },
  nfoData: { originaltitle: 'Big Movie', year: '1995' },
};

const fileDto = (overrides: Record<string, unknown>) => ({
  fileSize: GB,
  detectedMediaType: 'movie',
  assignmentStatus: 'assigned',
  targetPath: null,
  organizationStatus: 'completed',
  createdAt: null,
  probedAt: '2026-01-01T00:00:00Z',
  isAvailable: true,
  ...overrides,
});

const MAIN = fileDto({
  id: 'f1', fileName: 'Big Movie (1995).mkv', filePath: `${FOLDER}/Big Movie (1995).mkv`, role: 'main',
  resolutionCategory: '4K', hdrFormat: 'HDR10', videoCodec: 'hevc', audioCodec: 'truehd', audioChannels: 8, container: 'matroska',
  discId: 'disc-1', disc: { id: 'disc-1', title: 'Disc One', format: 'UHD Blu-ray' },
});
const EXTRA = fileDto({ id: 'f2', fileName: 'Featurette.mkv', filePath: `${FOLDER}/extras/Featurette.mkv`, role: 'extra', isAvailable: false });

const DETAIL = {
  record: MOVIE,
  mediaType: 'movie',
  catalogType: 'movie',
  discs: [{ id: 'disc-1', title: 'Disc One', format: 'UHD Blu-ray', storageType: 'Box', storageId: 'MED0001', linkedFileCount: 1 }],
  tapes: [],
  files: { main: [MAIN], versions: [], extras: [EXTRA], other: [], seasons: [] },
  summary: { fileCount: 2, totalSize: 2 * GB, missingCount: 1, unprobedCount: 0 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Canned payloads for every endpoint the page touches; `extra` runs first. */
const stubFetch = (extra?: Route) => {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.includes('/remove-to-review')) return json({ success: true });
    if (url.endsWith('/detail')) return json(DETAIL);
    if (url.includes('/posters/movie/movie-1/list')) return json({ count: 2 });
    if (url.includes('/dest-folder/browse')) return json({ data: [{ name: 'Big Movie.mkv', path: `${FOLDER}/Big Movie.mkv`, isDirectory: false, size: GB }] });
    if (url.includes('/dest-folder/nfo')) return json({ data: null });
    return json(null);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const calls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([u, init]) => ({ url: String(u), method: (init as RequestInit | undefined)?.method ?? 'GET', body: (init as RequestInit | undefined)?.body }));

const detailLoads = (fetchMock: ReturnType<typeof vi.fn>) => calls(fetchMock).filter((c) => c.url.endsWith('/detail')).length;

describe('LibraryMediaDetailPage', () => {
  beforeEach(() => {
    nav.search = '';
    nav.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows skeletons while loading, then the header with facts, stats and actions', async () => {
    const fetchMock = stubFetch();
    render(<LibraryMediaDetailPage />);

    expect(screen.getByLabelText('Loading title')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1, name: /Big Movie/ })).toHaveTextContent('Big Movie(1995)');
    expect(screen.getByText('178 min · Crime, Drama · Directed by Director One')).toBeInTheDocument();
    expect(screen.getByText('Movie')).toBeInTheDocument();
    expect(screen.getByText('Total size', { selector: 'p' }).nextElementSibling).toHaveTextContent('2.0 GB');
    expect(screen.getByText('Missing', { selector: 'p' }).nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Discs & tapes', { selector: 'p' }).nextElementSibling).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Back to My Library' })).toHaveAttribute('href', '/dashboard/my-library');
    expect(screen.getByRole('button', { name: 'Rescan files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from Library' })).toBeInTheDocument();

    // One request for the title instead of three whole-catalog loads.
    expect(calls(fetchMock).some((c) => c.url.endsWith('/api/catalog/movies'))).toBe(false);
  });

  it('shows the title’s To-Do banner under the header', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/api/attention/items')
        ? json({ items: [{ id: 'needs_rename:media_file:f1', kind: 'needs_rename', subjectType: 'media_file', subjectId: 'f1', mediaType: 'movie', mediaId: 'movie-1', catalogType: 'movie' }], total: 1 })
        : undefined,
    );
    render(<LibraryMediaDetailPage />);

    expect(await screen.findByText('1 file needs renaming')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open To-Do' })).toHaveAttribute('href', '/organize/todo?mediaType=movie&mediaId=movie-1');
    expect(calls(fetchMock).some((c) => c.url.includes('/api/attention/items?mediaType=movie&mediaId=movie-1'))).toBe(true);
  });

  it('opens on the Files tab and switches tabs through ?tab=', async () => {
    stubFetch();
    render(<LibraryMediaDetailPage />);

    const filesTab = await screen.findByRole('tab', { name: 'Files (2)' });
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'detail-tab-files');
    expect(screen.getByText('4K · HDR10')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Featurette.mkv/ }).closest('tr')).toHaveAttribute('data-missing', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(nav.replace).toHaveBeenCalledWith('/dashboard/my-library/movie/movie-1?tab=metadata', { scroll: false });
  });

  it('shows labelled metadata with the raw JSON behind a disclosure', async () => {
    nav.search = 'tab=metadata';
    stubFetch();
    const { container } = render(<LibraryMediaDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /IMDb tt0110912/ })).toBeInTheDocument();
    expect(container.querySelectorAll('pre')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Raw data' }));
    await waitFor(() => expect(container.querySelectorAll('pre')).toHaveLength(2));
    expect(container.querySelector('pre')?.textContent).toContain('"title": "Big Movie"');
  });

  it('shows the poster gallery and tools on the Artwork tab', async () => {
    nav.search = 'tab=artwork';
    stubFetch();
    render(<LibraryMediaDetailPage />);

    expect(await screen.findByText('Poster Tools')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Poster image URL')).toHaveValue('https://example.com/poster.jpg'));
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('links files to a disc from the Discs & Tapes tab, then reloads the title', async () => {
    nav.search = 'tab=discs';
    const fetchMock = stubFetch((url, init) => (url.endsWith('/link') && init?.method === 'PATCH' ? json({ id: 'f2' }) : undefined));
    render(<LibraryMediaDetailPage />);

    const card = await screen.findByRole('article', { name: 'Disc One' });
    expect(within(card).getByText('Big Movie (1995).mkv')).toBeInTheDocument();
    expect(detailLoads(fetchMock)).toBe(1);

    fireEvent.click(within(card).getByRole('button', { name: 'Link files…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link files to "Disc One"' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Featurette.mkv' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Link 1 file' }));
    });

    await waitFor(() => expect(detailLoads(fetchMock)).toBe(2));
    const patch = calls(fetchMock).find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/backend/api/catalog/media-files/f2/link');
    expect(JSON.parse(String(patch?.body))).toEqual({ discId: 'disc-1' });
  });

  it('disables "Flag for second look" once the review endpoint answers 404', async () => {
    const fetchMock = stubFetch((url) => (url.endsWith('/review') ? json({ detail: 'Not Found' }, 404) : undefined));
    render(<LibraryMediaDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Big Movie (1995).mkv' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Flag for second look/ }));
    });
    await waitFor(() => expect(calls(fetchMock).some((c) => c.url.endsWith('/f1/review'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Big Movie (1995).mkv' }));
    const item = await within(screen.getByRole('menu')).findByRole('menuitem', { name: /Flag for second look/ });
    await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'true'));
    expect(within(item).getByText('Not available on this server yet')).toBeInTheDocument();
  });

  it('rescans the library and reloads the title when the scan finishes', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/inventory/scan')) return json({ success: true });
      if (url.endsWith('/inventory/status')) return json({ success: true, data: { running: false, phase: 'done', counts: {} } });
      return undefined;
    });
    render(<LibraryMediaDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rescan files' }));
    await waitFor(() => expect(detailLoads(fetchMock)).toBe(2), { timeout: 4000 });
    expect(calls(fetchMock).find((c) => c.url.endsWith('/inventory/scan'))?.method).toBe('POST');
  });

  it('shows an inline error with a retry', async () => {
    let fail = true;
    stubFetch((url) => (url.endsWith('/detail') && fail ? json({ detail: 'boom' }, 500) : undefined));
    render(<LibraryMediaDetailPage />);

    expect(await screen.findByText(/Unable to load this title: API error 500/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('tab', { name: 'Files (2)' })).toBeInTheDocument();
    expect(screen.queryByText(/Unable to load this title/)).not.toBeInTheDocument();
  });

  it('falls back to the catalog search and the folder listing on a backend without /detail', async () => {
    stubFetch((url) => {
      if (url.endsWith('/detail')) return json({ detail: 'Not Found' }, 404);
      if (url.endsWith('/api/catalog/movies')) return json([MOVIE]);
      if (url.endsWith('/api/catalog/series') || url.endsWith('/api/catalog/discs')) return json([]);
      if (url.includes('/api/catalog/media/movie/movie-1/discs')) return json({ discs: [], tapes: [] });
      return undefined;
    });
    render(<LibraryMediaDetailPage />);

    expect(await screen.findByText('File inventory is not available')).toBeInTheDocument();
    expect(await screen.findByText('Destination files on disk. You can manually reassign the entire folder or individual files.')).toBeInTheDocument();
    expect(screen.getByText('Big Movie.mkv')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rescan files' })).not.toBeInTheDocument();
  });

  it('warns when the title is not in the catalog', async () => {
    stubFetch((url) => {
      if (url.endsWith('/detail')) return json({ detail: 'No movie found for movie-1' }, 404);
      if (/\/api\/catalog\/(movies|series|discs)$/.test(url)) return json([]);
      return undefined;
    });
    render(<LibraryMediaDetailPage />);

    expect(await screen.findByText('This title was not found. It may have been removed or its identifier has changed.')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('keeps the remove-from-library dialog open while the removal is still running', async () => {
    stubFetch((url) => (url.includes('/remove-to-review') ? new Promise<Response>(() => {}) : undefined));
    render(<LibraryMediaDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Library' }));
    expect(await screen.findByText('Remove from Library?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();

    fireEvent.keyDown(screen.getByText('Remove from Library?'), { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(screen.getByText('Remove from Library?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
