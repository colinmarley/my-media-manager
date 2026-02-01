/**
 * Media Assignment Search Service
 * Handles combined searching from Firebase collections and OMDB API
 */

import { collection, query, where, getDocs, orderBy, limit, startAt, endAt, addDoc } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { Movie } from '@/types/collections/Movie.type';
import { Series } from '@/types/collections/Series.type';
import { OmdbSearchResponse, OmdbResponseFull } from '@/types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '../omdb/OmdbService';
import { prepareMovieData, prepareSeriesData } from '@/utils/titleUtils';
import SeriesDataService from './SeriesDataService';

export interface SearchResult {
  id: string;
  title: string;
  year: string;
  type: 'movie' | 'series';
  poster: string;
  imdbId: string;
  source: 'firebase' | 'omdb';
  data: Movie | Series | OmdbSearchResponse;
}

class MediaAssignmentSearchService {
  /**
   * Search Firebase collections as user types (autocomplete)
   * Fast, local search for existing media
   */
  async searchFirebase(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    if (!searchQuery || searchQuery.length < 2) {
      return [];
    }

    const collectionName = mediaType === 'movie' ? 'movies' : 'series';
    const searchLower = searchQuery.toLowerCase();

    try {
      // Use titleLower field for efficient case-insensitive prefix search
      const q = query(
        collection(db, collectionName),
        orderBy('titleLower'),
        startAt(searchLower),
        endAt(searchLower + '\uf8ff'),
        limit(10)
      );

      const querySnapshot = await getDocs(q);
      const results: SearchResult[] = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          year: this.extractYear(data),
          type: mediaType,
          poster: this.extractPoster(data),
          imdbId: data.externalIds?.imdbId || '',
          source: 'firebase' as const,
          data: { id: doc.id, ...data } as Movie | Series
        };
      });

      return results;
    } catch (error) {
      console.error('Firebase search failed:', error);
      return [];
    }
  }

  /**
   * Search OMDB API when user clicks search button
   * Returns external results not yet in Firebase
   */
  async searchOMDB(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    if (!searchQuery) {
      return [];
    }

    try {
      const results = await searchByText(searchQuery);

      // Filter by type and convert to SearchResult format
      const filtered = results
        .filter(result => {
          const resultType = result.Type === 'movie' ? 'movie' : 'series';
          return resultType === mediaType;
        })
        .map(result => ({
          id: result.imdbID,
          title: result.Title,
          year: result.Year,
          type: (result.Type === 'movie' ? 'movie' : 'series') as 'movie' | 'series',
          poster: result.Poster,
          imdbId: result.imdbID,
          source: 'omdb' as const,
          data: result
        }));

      return filtered;
    } catch (error) {
      console.error('OMDB search failed:', error);
      return [];
    }
  }

  /**
   * Combined search: Firebase first, then OMDB
   * Returns deduplicated results from both sources
   */
  async combinedSearch(
    searchQuery: string,
    mediaType: 'movie' | 'series'
  ): Promise<SearchResult[]> {
    const [firebaseResults, omdbResults] = await Promise.all([
      this.searchFirebase(searchQuery, mediaType),
      this.searchOMDB(searchQuery, mediaType)
    ]);

    // Deduplicate by IMDb ID (prefer Firebase results)
    const firebaseImdbIds = new Set(
      firebaseResults.map(r => r.imdbId).filter(Boolean)
    );

    const uniqueOmdbResults = omdbResults.filter(
      r => !firebaseImdbIds.has(r.imdbId)
    );

    // Firebase results first, then OMDB results
    return [...firebaseResults, ...uniqueOmdbResults];
  }

  /**
   * Get full media data from OMDB by IMDb ID
   */
  async getOMDBFullData(imdbId: string): Promise<OmdbResponseFull> {
    return retrieveMediaDataById(imdbId);
  }

  /**
   * Save OMDB result to Firebase as new movie
   */
  async saveMovieToFirebase(omdbData: OmdbResponseFull): Promise<string> {
    try {
      // Convert OMDB data to Movie format
      const movieData = this.convertOMDBToMovie(omdbData);
      
      // Add titleLower field
      const preparedData = prepareMovieData(movieData);

      // Save to Firebase
      const docRef = await addDoc(collection(db, 'movies'), preparedData);
      
      return docRef.id;
    } catch (error) {
      console.error('Error saving movie to Firebase:', error);
      throw error;
    }
  }

  /**
   * Save OMDB result to Firebase as new series
   * Also creates seasons and episodes from TMDB data
   */
  async saveSeriesToFirebase(omdbData: OmdbResponseFull): Promise<string> {
    try {
      // Convert OMDB data to Series format
      const seriesData = this.convertOMDBToSeries(omdbData);
      
      // Add titleLower field
      const preparedData = prepareSeriesData(seriesData);

      // Save to Firebase
      const docRef = await addDoc(collection(db, 'series'), preparedData);
      const seriesId = docRef.id;
      
      console.log(`Series saved with ID: ${seriesId}`);

      // Create seasons and episodes from TMDB in background
      // Don't wait for this to complete to avoid blocking the UI
      SeriesDataService.createSeasonsAndEpisodes(
        seriesId,
        omdbData.Title,
        omdbData.imdbID
      ).then(result => {
        console.log(`Background task complete: ${result.seasonsCreated} seasons, ${result.episodesCreated} episodes created`);
      }).catch(error => {
        console.error('Failed to create seasons/episodes:', error);
        // Don't throw - series is already saved successfully
      });
      
      return seriesId;
    } catch (error) {
      console.error('Error saving series to Firebase:', error);
      throw error;
    }
  }

  /**
   * Convert OMDB response to Movie type
   * Note: Creates minimal valid Movie object. Full data should be enriched later.
   */
  private convertOMDBToMovie(omdbData: OmdbResponseFull): Omit<Movie, 'id' | 'titleLower'> {
    return {
      title: omdbData.Title,
      countries: omdbData.Country ? omdbData.Country.split(', ') : [],
      directors: [], // Will need to be enriched with proper directorId and title
      genres: omdbData.Genre ? omdbData.Genre.split(', ') : [],
      imageFiles: [], // ImageFile structure is different from OMDB poster
      languages: omdbData.Language ? omdbData.Language.split(', ') : [],
      releaseDate: omdbData.Released || '',
      releases: [],
      runtime: omdbData.Runtime || '',
      cast: [], // Will need proper actorId and characters array
      writers: omdbData.Writer ? omdbData.Writer.split(', ') : [],
      omdbData: omdbData,
      externalIds: {
        imdbId: omdbData.imdbID
      },
      contentRatings: omdbData.Rated ? 
        [{
          country: 'US',
          rating: omdbData.Rated,
          ratingSystem: 'MPAA'
        }] : [],
      theatricalRelease: omdbData.Released ? {
        date: new Date(omdbData.Released),
        runtime: parseInt(omdbData.Runtime) || 0,
        runtimeFormatted: omdbData.Runtime
      } : undefined
    };
  }

  /**
   * Convert OMDB response to Series type
   * Note: Creates minimal valid Series object. Full data should be enriched later.
   */
  private convertOMDBToSeries(omdbData: OmdbResponseFull): Omit<Series, 'id' | 'titleLower'> {
    return {
      title: omdbData.Title,
      countries: omdbData.Country ? omdbData.Country.split(', ') : [],
      directors: [], // Will need proper directorId and title
      imageFiles: [], // ImageFile structure is different
      runningYears: omdbData.Year ? omdbData.Year.split('–').map(y => y.trim()) : [],
      releases: [],
      cast: [], // Will need proper actorId and characters array
      writers: omdbData.Writer ? omdbData.Writer.split(', ') : [],
      seasons: [],
      genres: omdbData.Genre ? omdbData.Genre.split(', ') : [],
      languages: omdbData.Language ? omdbData.Language.split(', ') : [],
      omdbData: omdbData,
      seriesSummary: {
        totalSeasons: omdbData.TotalSeasons ? parseInt(omdbData.TotalSeasons) : 0,
        totalEpisodes: 0,
        totalRuntime: 0,
        firstAired: omdbData.Released ? new Date(omdbData.Released) : new Date(),
        status: 'returning'
      },
      externalIds: {
        imdbId: omdbData.imdbID
      }
    };
  }

  /**
   * Extract year from Movie or Series data
   */
  private extractYear(data: any): string {
    if (data.releaseDate) {
      // Movie: releaseDate format "DayAsNumber-Month-Year"
      const parts = data.releaseDate.split('-');
      return parts[2] || '';
    }
    if (data.runningYears && data.runningYears.length > 0) {
      // Series: runningYears array
      return data.runningYears[0];
    }
    if (data.theatricalRelease?.date) {
      return new Date(data.theatricalRelease.date).getFullYear().toString();
    }
    return '';
  }

  /**
   * Extract poster URL from Movie or Series data
   */
  private extractPoster(data: any): string {
    if (data.imageFiles && data.imageFiles.length > 0) {
      const primary = data.imageFiles.find((img: any) => img.isPrimary);
      return primary?.url || data.imageFiles[0]?.url || '';
    }
    if (data.omdbData?.Poster && data.omdbData.Poster !== 'N/A') {
      return data.omdbData.Poster;
    }
    return '';
  }
}

export default new MediaAssignmentSearchService();
