/**
 * useMediaDetailRecord loads a title with one GET .../detail. Only a 404 / 405 (no such title,
 * or a backend from before /detail) falls back to searching the whole catalog client-side.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useMediaDetailRecord from '../../src/hooks/library/useMediaDetailRecord';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MOVIE = { id: 'movie-1', title: 'Big Movie', mediaType: 'movie', folderPath: '/ark/Movies/Big Movie', releases: [{ discIds: ['disc-1'] }] };

const DETAIL = {
  record: MOVIE,
  mediaType: 'movie',
  catalogType: 'movie',
  discs: [{ id: 'disc-1', title: 'Disc One' }],
  tapes: [],
  files: {
    main: [{ id: 'f1', fileName: 'Big Movie.mkv', filePath: '/ark/Movies/Big Movie/Big Movie.mkv', fileSize: 10, role: 'main' }],
    versions: [],
    extras: [],
    other: [],
    seasons: [],
  },
  summary: { fileCount: 1, totalSize: 10, missingCount: 0, unprobedCount: 1 },
};

const stub = (routes: (url: string) => Response | Promise<Response>) => {
  const fetchMock = vi.fn(async (input: unknown) => routes(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const urls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(([u]) => String(u));

describe('useMediaDetailRecord', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads everything from one /detail request', async () => {
    const fetchMock = stub(() => json(DETAIL));

    const { result } = renderHook(() => useMediaDetailRecord({ mediaTypeFromRoute: 'movie', mediaIdFromRoute: 'movie-1' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(urls(fetchMock)).toEqual(['/api/backend/api/catalog/media/movie/movie-1/detail']);
    expect(result.current.source).toBe('detail');
    expect(result.current.matchedMedia?.title).toBe('Big Movie');
    expect(result.current.associatedDiscs.map((d) => d.id)).toEqual(['disc-1']);
    expect(result.current.allFiles.map((f) => f.id)).toEqual(['f1']);
    expect(result.current.summary.fileCount).toBe(1);
    expect(result.current.folderPath).toBe('/ark/Movies/Big Movie');
    expect(result.current.isSeries).toBe(false);
  });

  it('falls back to the old catalog search when /detail does not exist', async () => {
    const fetchMock = stub((url) => {
      if (url.endsWith('/detail')) return json({ detail: 'Not Found' }, 404);
      if (url.endsWith('/api/catalog/movies')) return json([MOVIE]);
      if (url.endsWith('/api/catalog/series')) return json([]);
      if (url.endsWith('/api/catalog/discs')) return json([{ id: 'disc-1', title: 'Disc One' }]);
      if (url.includes('/api/catalog/media/movie/movie-1/discs')) return json({ discs: [{ id: 'disc-2', title: 'Disc Two' }], tapes: [] });
      return json(null);
    });

    const { result } = renderHook(() => useMediaDetailRecord({ mediaTypeFromRoute: 'movie', mediaIdFromRoute: 'movie-1' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe('legacy');
    expect(result.current.matchedMedia?.id).toBe('movie-1');
    // Forward links (releases[].discIds) merged with the reverse lookup.
    expect(result.current.associatedDiscs.map((d) => d.id).sort()).toEqual(['disc-1', 'disc-2']);
    expect(result.current.allFiles).toEqual([]);
    expect(urls(fetchMock)).toContain('/api/backend/api/catalog/movies');
  });

  it('falls back on 405 too, and reports not found when the catalog has no such title', async () => {
    stub((url) => {
      if (url.endsWith('/detail')) return json({ detail: 'Method Not Allowed' }, 405);
      if (url.endsWith('/api/catalog/movies') || url.endsWith('/api/catalog/series') || url.endsWith('/api/catalog/discs')) return json([]);
      return json(null);
    });

    const { result } = renderHook(() => useMediaDetailRecord({ mediaTypeFromRoute: 'movie', mediaIdFromRoute: 'nope' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matchedMedia).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces other errors without the fallback and recovers on refetch', async () => {
    let fail = true;
    const fetchMock = stub(() => (fail ? json({ detail: 'boom' }, 500) : json(DETAIL)));

    const { result } = renderHook(() => useMediaDetailRecord({ mediaTypeFromRoute: 'movie', mediaIdFromRoute: 'movie-1' }));

    await waitFor(() => expect(result.current.error).toMatch(/API error 500/));
    expect(urls(fetchMock).some((u) => u.endsWith('/api/catalog/movies'))).toBe(false);

    fail = false;
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.matchedMedia?.title).toBe('Big Movie');
  });
});
