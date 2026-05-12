import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/api/apiClient', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/service/omdb/OmdbService', () => ({
  searchByText: vi.fn(),
  retrieveMediaDataById: vi.fn(),
  retrieveMovieDataByTitle: vi.fn(),
  retrieveShowDataByTitle: vi.fn(),
}));

import MediaAssignmentSearchService from '@/service/library/MediaAssignmentSearchService';
import { api } from '@/service/api/apiClient';
import { retrieveMovieDataByTitle, searchByText } from '@/service/omdb/OmdbService';

describe('MediaAssignmentSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to exact OMDb title lookup for short searches with too many results', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(searchByText).mockRejectedValue(new Error('Too many results.'));
    vi.mocked(retrieveMovieDataByTitle).mockResolvedValue({
      Title: 'It',
      Year: '2017',
      Type: 'movie',
      Poster: 'https://example.com/it.jpg',
      imdbID: 'tt1396484',
      Response: 'True',
    } as never);

    const results = await MediaAssignmentSearchService.combinedSearch('IT', 'movie');

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'It',
          imdbId: 'tt1396484',
          source: 'omdb',
        }),
      ])
    );
  });

  it('returns more than ten catalog matches so additional results can be shown while scrolling', async () => {
    vi.mocked(api.get).mockResolvedValue(
      Array.from({ length: 15 }, (_, index) => ({
        id: `movie-${index + 1}`,
        title: `Matrix Variant ${index + 1}`,
        releaseDate: '1999-01-01',
      }))
    );
    vi.mocked(searchByText).mockResolvedValue([] as never);

    const results = await MediaAssignmentSearchService.searchCatalog('matrix', 'movie');

    expect(results).toHaveLength(15);
  });
});
