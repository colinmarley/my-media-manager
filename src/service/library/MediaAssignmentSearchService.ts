/**
 * Media Assignment Search Service
 * Handles combined searching from the catalog API and OMDB API
 */

import { api } from '../api/apiClient';
import { OmdbSearchResponse, OmdbResponseFull } from '@/types/OmdbResponse.type';
import {
  searchByText,
  retrieveMediaDataById,
  retrieveMovieDataByTitle,
  retrieveShowDataByTitle,
} from '../omdb/OmdbService';
import TmdbService from '../tmdb/TmdbService';

const generateId = (prefix: string): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === 'function') {
    return maybeCrypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface SearchResult {
  id: string;
  title: string;
  year: string;
  type: 'movie' | 'series';
  poster: string;
  imdbId: string;
  source: 'catalog' | 'omdb' | 'tmdb';
  data: Record<string, unknown> | OmdbSearchResponse;
}

export interface FolderFileStats {
  fileCount: number;
  totalFileSize: number;
}

class MediaAssignmentSearchService {
  /**
   * Search catalog API as user types (autocomplete)
   */
  async searchCatalog(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery || normalizedQuery.length < 2) {
      return [];
    }

    const collectionName = mediaType === 'movie' ? 'movies' : 'series';

    try {
      const all = await api.get<Record<string, unknown>[]>(`/api/catalog/${collectionName}`);
      return all
        .map((item) => {
          const rawTitle = (item.title as string) || '';
          const title = rawTitle.toLowerCase();
          const words = title.split(/[^a-z0-9]+/).filter(Boolean);

          let matchPriority = 99;
          if (title === normalizedQuery) {
            matchPriority = 0;
          } else if (words.includes(normalizedQuery)) {
            matchPriority = 1;
          } else if (title.startsWith(normalizedQuery)) {
            matchPriority = 2;
          } else if (title.includes(normalizedQuery)) {
            matchPriority = 3;
          }

          return { item, matchPriority, titleLength: rawTitle.length };
        })
        .filter(({ matchPriority }) => matchPriority < 4)
        .sort((a, b) => a.matchPriority - b.matchPriority || a.titleLength - b.titleLength)
        .map(({ item }) => ({
          id: item.id as string,
          title: item.title as string,
          year: this.extractYear(item),
          type: mediaType,
          poster: this.extractPoster(item),
          imdbId: ((item.externalIds as Record<string, string>)?.imdbId) || (item.imdbId as string) || '',
          source: 'catalog' as const,
          data: item,
        }));
    } catch (error) {
      console.error('Catalog search failed:', error);
      return [];
    }
  }

  /**
   * Search OMDB API when user clicks search button
   */
  async searchOMDB(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      return [];
    }

    try {
      const results = await searchByText(normalizedQuery);
      return results
        .filter((result) => {
          const resultType = result.Type === 'movie' ? 'movie' : 'series';
          return resultType === mediaType;
        })
        .map((result) => ({
          id: result.imdbID,
          title: result.Title,
          year: result.Year,
          type: (result.Type === 'movie' ? 'movie' : 'series') as 'movie' | 'series',
          poster: result.Poster,
          imdbId: result.imdbID,
          source: 'omdb' as const,
          data: result,
        }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'OMDB search failed';
      const shouldTryExactLookup =
        normalizedQuery.length <= 3 && /too many results|no omdb search results found/i.test(errorMessage);

      if (shouldTryExactLookup) {
        try {
          const exactResult = mediaType === 'movie'
            ? await retrieveMovieDataByTitle(normalizedQuery)
            : await retrieveShowDataByTitle(normalizedQuery);

          return [{
            id: exactResult.imdbID,
            title: exactResult.Title,
            year: exactResult.Year,
            type: mediaType,
            poster: exactResult.Poster,
            imdbId: exactResult.imdbID,
            source: 'omdb' as const,
            data: exactResult,
          }];
        } catch (exactError) {
          console.error('OMDB exact title lookup failed:', exactError);
        }
      }

      console.error('OMDB search failed:', error);
      return [];
    }
  }

  /**
   * Combined search: catalog first, then OMDB; deduplicated by imdbId
   */
  async combinedSearch(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const [catalogResults, omdbResults] = await Promise.all([
      this.searchCatalog(searchQuery, mediaType),
      this.searchOMDB(searchQuery, mediaType),
    ]);

    const catalogImdbIds = new Set(catalogResults.map((r) => r.imdbId).filter(Boolean));
    const uniqueOmdbResults = omdbResults.filter((r) => !catalogImdbIds.has(r.imdbId));

    return [...catalogResults, ...uniqueOmdbResults];
  }

  /**
   * Search TMDB API by title
   */
  async searchTMDB(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) return [];

    try {
      const payload = mediaType === 'movie'
        ? await TmdbService.searchMovies(normalizedQuery)
        : await TmdbService.searchTV(normalizedQuery);

      const results: Array<Record<string, unknown>> = Array.isArray(payload?.results) ? payload.results : [];

      return results.map((item) => {
        const tmdbId = String(item.id ?? '');
        const title = mediaType === 'movie'
          ? String(item.title || item.original_title || '')
          : String(item.name || item.original_name || '');
        const dateStr = mediaType === 'movie'
          ? String(item.release_date || '')
          : String(item.first_air_date || '');
        const year = dateStr.slice(0, 4) || 'N/A';
        const posterPath = typeof item.poster_path === 'string' ? item.poster_path : '';
        const poster = posterPath ? `https://image.tmdb.org/t/p/w185${posterPath}` : '';

        return {
          id: `tmdb-${tmdbId}`,
          title,
          year,
          type: mediaType,
          poster,
          imdbId: '',
          source: 'tmdb' as const,
          data: item,
        };
      }).filter((r) => r.title);
    } catch (error) {
      console.error('TMDB search failed:', error);
      return [];
    }
  }

  /**
   * Combined search: catalog first, then TMDB; deduplicated by tmdb id
   */
  async combinedSearchTmdb(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const [catalogResults, tmdbResults] = await Promise.all([
      this.searchCatalog(searchQuery, mediaType),
      this.searchTMDB(searchQuery, mediaType),
    ]);

    const catalogTmdbIds = new Set(
      catalogResults
        .map((r) => {
          const data = r.data as Record<string, unknown>;
          const extIds = data?.externalIds as Record<string, unknown> | undefined;
          return extIds?.tmdbId ? `tmdb-${extIds.tmdbId}` : null;
        })
        .filter(Boolean)
    );

    const uniqueTmdbResults = tmdbResults.filter((r) => !catalogTmdbIds.has(r.id));
    return [...catalogResults, ...uniqueTmdbResults];
  }

  /**
   * Get full media data from OMDB by IMDb ID
   */
  async getOMDBFullData(imdbId: string): Promise<OmdbResponseFull> {
    return retrieveMediaDataById(imdbId);
  }

  async ensureCatalogEntry(
    result: SearchResult,
    mediaType: 'movie' | 'series',
    folderPath?: string,
    fileStats?: FolderFileStats,
    movieMediaType: 'movie' | 'documentary' | 'live_performance' = 'movie',
  ): Promise<{ id: string; title: string }> {
    const normalizedMediaType = mediaType === 'series' ? 'series' : 'movie';

    if (result.imdbId) {
      try {
        const omdbFull = await this.getOMDBFullData(result.imdbId);
        const id = normalizedMediaType === 'series'
          ? await this.saveSeriesToCatalog(omdbFull, folderPath, fileStats)
          : await this.saveMovieToCatalog(omdbFull, folderPath, fileStats, movieMediaType);
        return { id, title: omdbFull.Title };
      } catch (error) {
        console.warn('Falling back to existing catalog entry without OMDB hydration:', error);
      }
    }

    if (result.source === 'catalog') {
      return { id: result.id, title: result.title };
    }

    throw new Error('Could not resolve a fully hydrated catalog entry for the selected title.');
  }

  /**
   * Save OMDB movie result to the catalog API
   */
  async saveMovieToCatalog(
    omdbData: OmdbResponseFull,
    folderPath?: string,
    fileStats?: FolderFileStats,
    movieMediaType: 'movie' | 'documentary' | 'live_performance' = 'movie',
  ): Promise<string> {
    const imdbId = omdbData.imdbID;
    const existing = imdbId
      ? await api.get<Record<string, unknown> | null>(`/api/catalog/movies/lookup?imdbId=${encodeURIComponent(imdbId)}`)
      : null;
    const existingId = existing && typeof existing.id === 'string' ? existing.id : null;
    const id = existingId ?? generateId('movie');

    const doc: Record<string, unknown> = {
      ...(existing ?? {}),
      id,
      mediaType: movieMediaType,
      title: omdbData.Title,
      titleLower: omdbData.Title.toLowerCase(),
      releaseDate: omdbData.Released || omdbData.Year || '',
      runtime: omdbData.Runtime || '',
      genres: omdbData.Genre ? omdbData.Genre.split(', ') : [],
      countries: omdbData.Country ? omdbData.Country.split(', ') : [],
      languages: omdbData.Language ? omdbData.Language.split(', ') : [],
      omdbData,
      externalIds: { imdbId: omdbData.imdbID },
      imageFiles: omdbData.Poster && omdbData.Poster !== 'N/A'
        ? [{ fileName: omdbData.Poster, format: 'jpg', fileSize: 0, resolution: '' }]
        : ((existing?.imageFiles as unknown[]) || []),
    };
    if (folderPath) {
      doc.folderPath = folderPath;
      doc.jellyfinInfo = {
        ...((existing?.jellyfinInfo as Record<string, unknown> | undefined) || {}),
        folderPath,
      };
      doc.libraryStatus = 'available';
    }
    if (fileStats) {
      doc.fileCount = fileStats.fileCount;
      doc.assignmentSummary = {
        totalFiles: fileStats.fileCount,
        assignedFiles: fileStats.fileCount,
        unassignedFiles: 0,
        totalFileSize: fileStats.totalFileSize,
      };
    }
    await api.put(`/api/catalog/movies/${id}`, doc);
    return id;
  }

  /**
   * Save OMDB series result to the catalog API
   */
  async saveSeriesToCatalog(
    omdbData: OmdbResponseFull,
    folderPath?: string,
    fileStats?: FolderFileStats,
  ): Promise<string> {
    const imdbId = omdbData.imdbID;
    const existing = imdbId
      ? await api.get<Record<string, unknown> | null>(`/api/catalog/series/lookup?imdbId=${encodeURIComponent(imdbId)}`)
      : null;
    const existingId = existing && typeof existing.id === 'string' ? existing.id : null;
    const id = existingId ?? generateId('series');

    const doc: Record<string, unknown> = {
      ...(existing ?? {}),
      id,
      mediaType: 'series',
      title: omdbData.Title,
      titleLower: omdbData.Title.toLowerCase(),
      genres: omdbData.Genre ? omdbData.Genre.split(', ') : [],
      countries: omdbData.Country ? omdbData.Country.split(', ') : [],
      languages: omdbData.Language ? omdbData.Language.split(', ') : [],
      runningDates: omdbData.Year || '',
      seasons: Array.isArray((existing as Record<string, unknown> | null)?.seasons)
        ? ((existing as Record<string, unknown>).seasons as unknown[])
        : [],
      omdbData,
      externalIds: { imdbId: omdbData.imdbID },
      imageFiles: omdbData.Poster && omdbData.Poster !== 'N/A'
        ? [{ fileName: omdbData.Poster, format: 'jpg', fileSize: 0, resolution: '' }]
        : ((existing?.imageFiles as unknown[]) || []),
    };
    if (folderPath) {
      doc.folderPath = folderPath;
      doc.jellyfinInfo = {
        ...((existing?.jellyfinInfo as Record<string, unknown> | undefined) || {}),
        folderPath,
      };
      doc.libraryStatus = 'available';
    }
    if (fileStats) {
      doc.fileCount = fileStats.fileCount;
      doc.assignmentSummary = {
        totalFiles: fileStats.fileCount,
        assignedFiles: fileStats.fileCount,
        unassignedFiles: 0,
        totalFileSize: fileStats.totalFileSize,
      };
    }
    await api.put(`/api/catalog/series/${id}`, doc);
    return id;
  }

  private extractYear(data: Record<string, unknown>): string {
    const releaseDate = data.releaseDate as string | undefined;
    if (releaseDate) {
      const match = releaseDate.match(/(19|20)\d{2}/);
      if (match) {
        return match[0];
      }
    }
    const runningYears = data.runningYears as string[] | undefined;
    if (runningYears?.length) {
      const match = runningYears[0]?.match(/(19|20)\d{2}/);
      return match ? match[0] : runningYears[0];
    }
    const omdb = data.omdbData as Record<string, string> | undefined;
    if (omdb?.Year) {
      const match = omdb.Year.match(/(19|20)\d{2}/);
      return match ? match[0] : omdb.Year;
    }
    return '';
  }

  private extractPoster(data: Record<string, unknown>): string {
    const omdb = data.omdbData as Record<string, string> | undefined;
    if (omdb?.Poster && omdb.Poster !== 'N/A') return omdb.Poster;
    return '';
  }
}

export default new MediaAssignmentSearchService();
