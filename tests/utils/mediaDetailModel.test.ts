import { describe, expect, it } from 'vitest';

import {
  getEffectiveFolderPath,
  getEpisodeHintFromFileName,
  getLegacyOmdbData,
  getPosterSourceFromMedia,
  getSeasonNumberFromFolderPath,
  getSeriesEpisodeOptions,
  PLACEHOLDER_POSTER,
  withFallbackFileCounts,
} from '@/service/library/mediaDetailModel';

describe('mediaDetailModel', () => {
  describe('PLACEHOLDER_POSTER', () => {
    it('is the same placeholder the details page used before the split', () => {
      expect(PLACEHOLDER_POSTER).toBe('https://placehold.co/500x750/111111/f4f4f4?text=No+Poster');
    });
  });

  describe('getEffectiveFolderPath', () => {
    it('strips a season leaf from series folder paths', () => {
      expect(getEffectiveFolderPath('/mnt/library/Severance (2022)/Season 01', true)).toBe(
        '/mnt/library/Severance (2022)',
      );
      expect(getEffectiveFolderPath('C:\\library\\Severance (2022)\\Season 1', true)).toBe(
        'C:/library/Severance (2022)',
      );
    });

    it('leaves series roots and movie paths untouched', () => {
      expect(getEffectiveFolderPath('/mnt/library/Severance (2022)', true)).toBe(
        '/mnt/library/Severance (2022)',
      );
      expect(getEffectiveFolderPath('/mnt/library/Kalata (1981)/Extras', true)).toBe(
        '/mnt/library/Kalata (1981)/Extras',
      );
      expect(getEffectiveFolderPath('/mnt/library/Kalata (1981)/Season 01', false)).toBe(
        '/mnt/library/Kalata (1981)/Season 01',
      );
      expect(getEffectiveFolderPath('', true)).toBe('');
    });
  });

  describe('getLegacyOmdbData', () => {
    it('returns the legacy omdb block when present', () => {
      expect(getLegacyOmdbData({ omdbData: { imdbID: 'tt0082694', Poster: 'https://x/y.jpg' } })).toEqual({
        imdbID: 'tt0082694',
        Poster: 'https://x/y.jpg',
      });
    });

    it('returns undefined for records without omdb data', () => {
      expect(getLegacyOmdbData({ title: 'Kalata' })).toBeUndefined();
      expect(getLegacyOmdbData(null)).toBeUndefined();
    });
  });

  describe('getPosterSourceFromMedia', () => {
    it('prefers catalog image files, then posterUrl/Poster, then the legacy OMDB poster', () => {
      expect(
        getPosterSourceFromMedia(
          { imageFiles: [{ fileName: 'https://images.example/poster.jpg' }], posterUrl: 'https://ignored/poster.jpg' },
          { Poster: 'https://ignored/omdb.jpg' },
        ),
      ).toBe('https://images.example/poster.jpg');

      expect(getPosterSourceFromMedia({ posterUrl: 'https://images.example/poster.jpg' })).toBe(
        'https://images.example/poster.jpg',
      );

      expect(getPosterSourceFromMedia({ Poster: 'https://images.example/poster.jpg' })).toBe(
        'https://images.example/poster.jpg',
      );

      expect(getPosterSourceFromMedia({ posterUrl: '/local/poster.jpg' }, { Poster: 'https://omdb/poster.jpg' })).toBe(
        'https://omdb/poster.jpg',
      );
    });

    it('treats non-http values and "N/A" OMDB posters as no source', () => {
      expect(getPosterSourceFromMedia({ imageFiles: [{ fileName: 'poster.jpg' }] })).toBe('');
      expect(getPosterSourceFromMedia({}, { Poster: 'N/A' })).toBe('');
      expect(getPosterSourceFromMedia(null)).toBe('');
    });
  });

  describe('getSeriesEpisodeOptions', () => {
    it('normalizes seasons and episodes and drops unusable episode numbers', () => {
      const options = getSeriesEpisodeOptions({
        seasons: [
          {
            number: 2,
            episodes: [
              { number: 4, title: 'Strange Machines' },
              { episodeNumber: '2', title: '   ' },
              { number: 0, title: 'Not an episode' },
            ],
          },
          { seasonNumber: '1', title: 'Season One', episodes: [{ episodeNumber: 1 }] },
        ],
      });

      expect(options).toEqual([
        {
          seasonNumber: 1,
          seasonTitle: 'Season One',
          episodes: [{ episodeNumber: 1, title: 'Episode 1' }],
        },
        {
          seasonNumber: 2,
          seasonTitle: 'Season 2',
          episodes: [
            { episodeNumber: 2, title: 'Episode 2' },
            { episodeNumber: 4, title: 'Strange Machines' },
          ],
        },
      ]);
    });

    it('returns an empty list when the record has no seasons', () => {
      expect(getSeriesEpisodeOptions({ title: 'Kalata' })).toEqual([]);
    });
  });

  describe('withFallbackFileCounts', () => {
    it('treats files on disk as fully processed when there is no assignment summary', () => {
      const summary = {
        mediaType: 'movie' as const,
        hasAssignmentSummary: true,
        totalFiles: 0,
        assignedFiles: 0,
        unassignedFiles: 0,
        completionPercent: 0,
      };

      expect(withFallbackFileCounts(summary, 3)).toMatchObject({
        hasAssignmentSummary: false,
        totalFiles: 3,
        assignedFiles: 3,
        unassignedFiles: 0,
        completionPercent: 100,
      });
    });

    it('leaves real summaries untouched', () => {
      const summary = {
        hasAssignmentSummary: true,
        totalFiles: 4,
        assignedFiles: 2,
        unassignedFiles: 2,
        completionPercent: 50,
      };

      expect(withFallbackFileCounts(summary, 9)).toBe(summary);
      expect(withFallbackFileCounts({ ...summary, totalFiles: 0 }, 0)).toEqual({
        ...summary,
        totalFiles: 0,
      });
    });
  });

  describe('episode and season hints', () => {
    it('reads season and episode numbers from S01E02-style filenames', () => {
      expect(getEpisodeHintFromFileName('Severance.S01E03-1080p.mkv')).toEqual({ season: '01', episode: '03' });
      expect(getEpisodeHintFromFileName('s1e9.mkv')).toEqual({ season: '1', episode: '9' });
    });

    it('returns empty strings when the filename has no episode marker', () => {
      expect(getEpisodeHintFromFileName('calendar-2022.mkv')).toEqual({ season: '', episode: '' });
    });

    it('reads the season number from a season folder path', () => {
      expect(getSeasonNumberFromFolderPath('/library/Severance (2022)/Season 02')).toBe('02');
      expect(getSeasonNumberFromFolderPath('/library/Severance (2022)')).toBeUndefined();
    });
  });
});
