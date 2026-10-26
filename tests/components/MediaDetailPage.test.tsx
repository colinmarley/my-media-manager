/**
 * Render test for the library media details composition root
 * (src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx).
 *
 * The screen used to be one 1,465-line component. It is now a composition root over the
 * `hooks/library` data hooks and the `detail/*` section components, so this test drives the
 * real hooks against a stubbed `fetch` and pins the whole screen: every section must still be
 * rendered, wired to the same data, after the split.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();

  return {
    ...actual,
    useParams: () => ({ mediaType: 'movie', mediaId: 'movie-1' }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

// The disk reassign dialog owns a search / move / catalog-sync flow of its own. The behaviour pins
// below only need the page's half of a finished reassignment: the message the page keeps and how
// long it stays on screen.
vi.mock('../../src/app/dashboard/my-library/_components/DiskReassignDialog', () => ({
  default: ({ onReassigned }: { onReassigned: (newPath: string) => void }) => (
    <button type="button" onClick={() => onReassigned('/ark/media/library/moved')}>
      Stub Confirm Reassignment
    </button>
  ),
}));

import LibraryMediaDetailPage from '../../src/app/dashboard/my-library/[mediaType]/[mediaId]/page';

const FOLDER = '/ark/media/jellyfin/Movies/Big Movie';

const MOVIE = {
  id: 'movie-1',
  title: 'Big Movie',
  mediaType: 'movie',
  releaseDate: '1995-04-22',
  runtime: '178 min',
  genres: ['Crime', 'Drama'],
  folderPath: FOLDER,
  posterUrl: 'https://example.com/poster.jpg',
  externalIds: { imdbId: 'tt0110912', tmdbId: 155 },
  nfoData: { originaltitle: 'Big Movie', year: '1995' },
  releases: [{ discIds: ['disc-1'] }],
  assignmentSummary: {
    totalFiles: 2,
    assignedFiles: 1,
    unassignedFiles: 1,
    totalFileSizeFormatted: '5.0 GB',
  },
};

const DISC = {
  id: 'disc-1',
  title: 'Disc One',
  videoFiles: [{ fileName: 'Big Movie.mkv' }],
  storageType: 'Disc',
  storageId: 'A12',
};

const BROWSE_ENTRIES = [
  { name: 'Big Movie.mkv', path: `${FOLDER}/Big Movie.mkv`, isDirectory: false, size: 5368709120 },
];

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Routes every endpoint the details screen touches to a canned payload. */
const stubFetch = (
  {
    movies = [MOVIE] as unknown[],
    pendingRemove = false,
  }: { movies?: unknown[]; pendingRemove?: boolean } = {}
) => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);

    // `pendingRemove` leaves the removal request in flight (never settles) so the dialog can be
    // poked while `deleting` is true.
    if (url.includes('/remove-to-review')) {
      return pendingRemove ? new Promise<Response>(() => {}) : jsonResponse({ success: true });
    }
    if (url.includes('/api/catalog/media/')) {
      return jsonResponse({ discs: [], tapes: [] });
    }
    if (url.includes('/api/catalog/movies')) {
      return jsonResponse(movies);
    }
    if (url.includes('/api/catalog/series')) {
      return jsonResponse([]);
    }
    if (url.includes('/api/catalog/discs')) {
      return jsonResponse([DISC]);
    }
    if (url.includes('/posters/movie/movie-1/list')) {
      return jsonResponse({ count: 2 });
    }
    if (url.includes('/dest-folder/browse')) {
      return jsonResponse({ data: BROWSE_ENTRIES });
    }
    if (url.includes('/dest-folder/nfo')) {
      return jsonResponse({ data: null });
    }

    return jsonResponse(null);
  });

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

describe('LibraryMediaDetailPage', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the loading copy while the record is being fetched', () => {
    render(<LibraryMediaDetailPage />);

    expect(screen.getByText('Loading media details...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from Library' })).not.toBeInTheDocument();
  });

  it('renders every section of the screen wired to the loaded record', async () => {
    const { container } = render(<LibraryMediaDetailPage />);

    // Header bar.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove from Library' })).toBeInTheDocument()
    );
    expect(screen.getByRole('link', { name: 'Back to My Library' })).toHaveAttribute(
      'href',
      '/dashboard/my-library'
    );

    // Poster tools (pre-filled from the record's poster source).
    expect(screen.getByText('Poster Tools')).toBeInTheDocument();
    expect(screen.getByLabelText('Poster image URL')).toHaveValue('https://example.com/poster.jpg');

    // Poster gallery (poster count comes from the /list endpoint).
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/backend/api/posters/movie/movie-1?index=0')
    );
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();

    // Overview card.
    expect(screen.getByText('Big Movie')).toBeInTheDocument();
    expect(screen.getByText('In Library')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByText('IMDB: tt0110912 | TMDB: 155')).toBeInTheDocument();

    // Processing summary.
    expect(screen.getByText('Processing Summary')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Total size: 5.0 GB')).toBeInTheDocument();

    // Catalog + NFO metadata cards, both rendering their JSON blocks.
    expect(screen.getByText('Catalog Metadata')).toBeInTheDocument();
    expect(screen.getByText('NFO Metadata')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('pre')).map((pre) => pre.textContent)).toEqual(
      [expect.stringContaining('"title": "Big Movie"'), expect.stringContaining('"originaltitle"')]
    );

    // Associated files card: destination files on disk plus the linked disc record.
    expect(screen.getByText('Associated Discs and Files')).toBeInTheDocument();
    expect(
      screen.getByText('Destination files on disk. You can manually reassign the entire folder or individual files.')
    ).toBeInTheDocument();
    expect(screen.getByText('Big Movie.mkv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reassign Entire Folder/ })).toBeInTheDocument();
    expect(screen.getByText('Disc One')).toBeInTheDocument();
    expect(screen.getByText('Big Movie.mkv · Disc A12')).toBeInTheDocument();
  });

  it('opens the remove-from-library confirm dialog from the header action', async () => {
    render(<LibraryMediaDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Library' }));

    expect(await screen.findByText('Remove from Library?')).toBeInTheDocument();
    expect(screen.getByText('will be removed from your catalog.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('keeps a folder reassignment message up until it is dismissed', async () => {
    render(<LibraryMediaDetailPage />);

    // Load on real timers, then take the clocks over so the dismiss delay can be elapsed at once.
    const reassignFolder = await screen.findByRole('button', { name: /Reassign Entire Folder/ });
    fireEvent.click(reassignFolder);

    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Stub Confirm Reassignment' }));
    const message = 'Folder reassigned. New path: /ark/media/library/moved';
    expect(screen.getByText(message)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText(message)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it('keeps the remove-from-library dialog open while the removal is still running', async () => {
    vi.unstubAllGlobals();
    stubFetch({ pendingRemove: true });

    render(<LibraryMediaDetailPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();

    fireEvent.keyDown(screen.getByText('Remove from Library?'), { key: 'Escape' });
    fireEvent.click(document.querySelector('.MuiBackdrop-root') as Element);

    // A dismissed dialog unmounts once its exit transition ends, so wait past that window first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // Closing it mid-removal would leave `deleting` true with both actions dead on the next open.
    expect(screen.getByText('Remove from Library?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('warns when the title is no longer in the catalog', async () => {
    vi.unstubAllGlobals();
    stubFetch({ movies: [] });

    render(<LibraryMediaDetailPage />);

    expect(
      await screen.findByText(
        'This title was not found. It may have been removed or its identifier has changed.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Poster Tools')).toBeInTheDocument();
    expect(screen.queryByText('Processing Summary')).not.toBeInTheDocument();
  });
});
