import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), axiosGet: vi.fn() }));

vi.mock('@/service/api/apiClient', () => ({
  api: { get: mocks.apiGet },
}));

vi.mock('axios', () => ({
  default: { create: () => ({ get: mocks.axiosGet }) },
}));

import { findSeasonRips } from '@/service/catalog/DiscCatalogService';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';

describe('DiscRipperService.getDiscInfo', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset().mockResolvedValue({ data: { titles: [], error: null } });
  });

  it('sends no parameter for an ordinary scan, so any ripper build answers as before', async () => {
    await DiscRipperService.getDiscInfo();
    expect(mocks.axiosGet).toHaveBeenCalledWith('/disc/info', { params: undefined });
  });

  it('asks for a minimum title length when the short titles are wanted', async () => {
    await DiscRipperService.getDiscInfo({ minLengthSeconds: 0 });
    expect(mocks.axiosGet).toHaveBeenCalledWith('/disc/info', { params: { min_length: 0 } });
  });
});

describe('findSeasonRips', () => {
  const rips = [
    { id: 'a', mediaType: 'show', season: 1, tmdbId: 2316, imdbId: 'tt0386676' },
    { id: 'b', mediaType: 'show', season: 2, tmdbId: 2316, imdbId: 'tt0386676' },
    { id: 'c', mediaType: 'show', season: 1, tmdbId: null, imdbId: 'tt0386676' },
    { id: 'd', mediaType: 'show', season: 1, tmdbId: 999, imdbId: 'tt0000001' },
    { id: 'e', mediaType: 'movie', season: 1, tmdbId: 2316, imdbId: null },
  ];

  beforeEach(() => {
    mocks.apiGet.mockReset().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/rips?')) return rips;
      const id = url.split('/').pop();
      if (id === 'c') throw new Error('gone');
      return { ...rips.find((r) => r.id === id), titles: [{ titleIndex: 0, status: 'delivered', episode: 1 }] };
    });
  });

  it('returns the season\'s rips of the show with their titles', async () => {
    const found = await findSeasonRips({ tmdbId: 2316, imdbId: ' tt0386676 ', season: 1 });
    expect(found.map((r) => r.id)).toEqual(['a']);
    expect(found[0].titles).toHaveLength(1);
    expect(mocks.apiGet).toHaveBeenCalledWith('/api/rips/a');
    expect(mocks.apiGet).toHaveBeenCalledWith('/api/rips/c');
    expect(mocks.apiGet).not.toHaveBeenCalledWith('/api/rips/b');
    expect(mocks.apiGet).not.toHaveBeenCalledWith('/api/rips/d');
    expect(mocks.apiGet).not.toHaveBeenCalledWith('/api/rips/e');
  });

  it('asks nothing without an id to match on, and is empty when the lookup fails', async () => {
    expect(await findSeasonRips({ season: 1 })).toEqual([]);
    expect(mocks.apiGet).not.toHaveBeenCalled();
    mocks.apiGet.mockRejectedValue(new Error('down'));
    expect(await findSeasonRips({ tmdbId: 2316, season: 1 })).toEqual([]);
  });
});
