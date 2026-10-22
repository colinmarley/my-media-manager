import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  browseDestFolder,
  countMediaFilesInFolder,
  formatFileSize,
  getSeasonFolders,
  isSeasonFolderName,
  isVideoFileName,
  loadMovieFolderFiles,
  toFolderFileEntries,
} from '@/service/library/mediaFolderFiles';

const browseResponse = (entries: unknown) => ({
  ok: true,
  json: async () => ({ data: entries }),
});

describe('mediaFolderFiles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('formatFileSize', () => {
    it('returns an empty string for zero-byte files', () => {
      expect(formatFileSize(0)).toBe('');
    });

    it('scales up through the byte units', () => {
      expect(formatFileSize(512)).toBe('512.0 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('file and folder predicates', () => {
    it('detects video extensions case-insensitively', () => {
      expect(isVideoFileName('Severance.S01E01.mkv')).toBe(true);
      expect(isVideoFileName('MOVIE.MKV')).toBe(true);
      expect(isVideoFileName('poster.jpg')).toBe(false);
    });

    it('detects padded and unpadded season folder names', () => {
      expect(isSeasonFolderName('Season 01')).toBe(true);
      expect(isSeasonFolderName('Season 1')).toBe(true);
      expect(isSeasonFolderName('Extras')).toBe(false);
    });
  });

  describe('toFolderFileEntries', () => {
    it('drops directories and keeps file entries', () => {
      const entries = toFolderFileEntries([
        { name: 'Season 01', path: '/show/Season 01', isDirectory: true, size: 0 },
        { name: 'show.nfo', path: '/show/show.nfo', isDirectory: false, size: 10 },
      ]);

      expect(entries).toEqual([{ name: 'show.nfo', path: '/show/show.nfo', size: 10 }]);
    });
  });

  describe('getSeasonFolders', () => {
    it('keeps only season directories', () => {
      const seasons = getSeasonFolders([
        { name: 'Season 02', path: '/show/Season 02', isDirectory: true, size: 0 },
        { name: 'Extras', path: '/show/Extras', isDirectory: true, size: 0 },
        { name: 'Season 01', path: '/show/Season 01', isDirectory: false, size: 0 },
      ]);

      expect(seasons.map((season) => season.path)).toEqual(['/show/Season 02']);
    });

    it('orders season names numerically', () => {
      const seasons = getSeasonFolders([
        { name: 'Season 10', path: '/show/Season 10', isDirectory: true, size: 0 },
        { name: 'Season 2', path: '/show/Season 2', isDirectory: true, size: 0 },
      ]);

      expect(seasons.map((season) => season.name)).toEqual(['Season 2', 'Season 10']);
    });
  });

  describe('countMediaFilesInFolder', () => {
    it('prefers video files', () => {
      expect(
        countMediaFilesInFolder([
          { name: 's01e01.mkv', path: '/show/Season 01/s01e01.mkv', size: 1 },
          { name: 's01e01.nfo', path: '/show/Season 01/s01e01.nfo', size: 1 },
        ]),
      ).toBe(1);
    });

    it('falls back to non-sidecar files and then to the raw file count', () => {
      expect(
        countMediaFilesInFolder([
          { name: 's01e01.nfo', path: '/show/Season 01/s01e01.nfo', size: 1 },
          { name: 'raw-data.bin', path: '/show/Season 01/raw-data.bin', size: 1 },
        ]),
      ).toBe(1);

      expect(
        countMediaFilesInFolder([{ name: 's01e01.nfo', path: '/show/Season 01/s01e01.nfo', size: 1 }]),
      ).toBe(1);

      expect(countMediaFilesInFolder([])).toBe(0);
    });
  });

  describe('browseDestFolder', () => {
    it('posts the folder path and returns the browse entries', async () => {
      const entries = [{ name: 'Season 01', path: '/show/Season 01', isDirectory: true, size: 0 }];
      const fetchMock = vi.fn().mockResolvedValue(browseResponse(entries));
      vi.stubGlobal('fetch', fetchMock);

      await expect(browseDestFolder('/show/Severance (2022)')).resolves.toEqual(entries);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/backend/api/files/dest-folder/browse');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ path: '/show/Severance (2022)' });
    });

    it('returns an empty list when the payload has no entries', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

      await expect(browseDestFolder('/show')).resolves.toEqual([]);
    });

    it('surfaces the HTTP status when the folder cannot be browsed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

      await expect(browseDestFolder('/nope')).rejects.toThrow('Failed to browse folder (500)');
    });
  });

  describe('loadMovieFolderFiles', () => {
    it('merges root files with labelled subfolder files and sorts by name', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          browseResponse([
            { name: 'kalata-jpg.jpg', path: '/movies/Kalata/kalata-jpg.jpg', isDirectory: false, size: 1 },
            { name: 'Extras', path: '/movies/Kalata/Extras', isDirectory: true, size: 0 },
            { name: 'kalata.mkv', path: '/movies/Kalata/kalata.mkv', isDirectory: false, size: 10 },
          ]),
        )
        .mockResolvedValueOnce(
          browseResponse([
            { name: 'bonus.mkv', path: '/movies/Kalata/Extras/bonus.mkv', isDirectory: false, size: 2 },
            { name: 'bonus.nfo', path: '/movies/Kalata/Extras/bonus.nfo', isDirectory: false, size: 1 },
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const files = await loadMovieFolderFiles('/movies/Kalata');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ path: '/movies/Kalata/Extras' });
      expect(files).toEqual([
        { name: 'Extras / bonus.mkv', path: '/movies/Kalata/Extras/bonus.mkv', size: 2 },
        { name: 'Extras / bonus.nfo', path: '/movies/Kalata/Extras/bonus.nfo', size: 1 },
        { name: 'kalata-jpg.jpg', path: '/movies/Kalata/kalata-jpg.jpg', size: 1 },
        { name: 'kalata.mkv', path: '/movies/Kalata/kalata.mkv', size: 10 },
      ]);
    });

    it('keeps root files when a subfolder browse fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          browseResponse([
            { name: 'kalata.mkv', path: '/movies/Kalata/kalata.mkv', isDirectory: false, size: 10 },
            { name: 'Extras', path: '/movies/Kalata/Extras', isDirectory: true, size: 0 },
          ]),
        )
        .mockRejectedValueOnce(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);

      const files = await loadMovieFolderFiles('/movies/Kalata');

      expect(files).toEqual([{ name: 'kalata.mkv', path: '/movies/Kalata/kalata.mkv', size: 10 }]);
    });
  });
});
