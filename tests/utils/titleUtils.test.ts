/**
 * Unit tests for titleUtils
 * Tests the prepareTitleForStorage function used in form submissions
 */

import { prepareTitleForStorage, prepareMovieData, prepareSeriesData, normalizeSearchQuery } from '../../src/utils/titleUtils';

describe('titleUtils', () => {
  describe('prepareTitleForStorage', () => {
    it('should create title and titleLower fields', () => {
      const result = prepareTitleForStorage('The Matrix');
      expect(result).toEqual({
        title: 'The Matrix',
        titleLower: 'the matrix'
      });
    });

    it('should handle empty strings', () => {
      const result = prepareTitleForStorage('');
      expect(result).toEqual({
        title: '',
        titleLower: ''
      });
    });

    it('should handle mixed case titles', () => {
      const result = prepareTitleForStorage('ThE DaRk KnIgHt');
      expect(result).toEqual({
        title: 'ThE DaRk KnIgHt',
        titleLower: 'the dark knight'
      });
    });

    it('should handle titles with numbers', () => {
      const result = prepareTitleForStorage('2001: A Space Odyssey');
      expect(result).toEqual({
        title: '2001: A Space Odyssey',
        titleLower: '2001: a space odyssey'
      });
    });

    it('should handle titles with special characters', () => {
      const result = prepareTitleForStorage('Amélie: The Movie!');
      expect(result).toEqual({
        title: 'Amélie: The Movie!',
        titleLower: 'amélie: the movie!'
      });
    });

    it('should trim whitespace', () => {
      const result = prepareTitleForStorage('  The Matrix  ');
      expect(result).toEqual({
        title: 'The Matrix',
        titleLower: 'the matrix'
      });
    });
  });

  describe('prepareMovieData', () => {
    it('should add titleLower to movie data', () => {
      const movieData = {
        title: 'The Matrix',
        year: '1999',
        genre: 'Sci-Fi'
      };

      const result = prepareMovieData(movieData);
      expect(result).toEqual({
        title: 'The Matrix',
        titleLower: 'the matrix',
        year: '1999',
        genre: 'Sci-Fi'
      });
    });

    it('should override existing titleLower with correct value', () => {
      const movieData = {
        title: 'The Matrix',
        titleLower: 'WRONG',
        year: '1999'
      };

      const result = prepareMovieData(movieData);
      expect(result).toEqual({
        title: 'The Matrix',
        titleLower: 'the matrix',
        year: '1999'
      });
    });
  });

  describe('prepareSeriesData', () => {
    it('should add titleLower to series data', () => {
      const seriesData = {
        title: 'Breaking Bad',
        seasons: 5
      };

      const result = prepareSeriesData(seriesData);
      expect(result).toEqual({
        title: 'Breaking Bad',
        titleLower: 'breaking bad',
        seasons: 5
      });
    });
  });

  describe('normalizeSearchQuery', () => {
    it('should lowercase and trim query', () => {
      expect(normalizeSearchQuery('  The Matrix  ')).toBe('the matrix');
    });

    it('should handle empty strings', () => {
      expect(normalizeSearchQuery('')).toBe('');
    });

    it('should handle special characters', () => {
      expect(normalizeSearchQuery('Amélie')).toBe('amélie');
    });
  });
});
