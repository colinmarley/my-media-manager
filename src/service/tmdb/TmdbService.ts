import axios from 'axios';
import TmdbAuthentication from './TmdbAuthentication';

const TMDB_BASE_URL = process.env.NEXT_PUBLIC_TMDB_BASE_URL?.replace(/\/$/, '') || 'https://api.themoviedb.org/3';
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

const getTmdbApiKey = (): string => {
  if (!TMDB_API_KEY || TMDB_API_KEY.includes('your_')) {
    throw new Error('TMDB is not configured. Set NEXT_PUBLIC_TMDB_API_KEY in .env.local and restart Next.js.');
  }
  return TMDB_API_KEY;
};

const TmdbService = {
  /**
   * Fetch details of a movie by its ID.
   * @param movieId - The ID of the movie to fetch.
   * @returns A promise resolving to the movie details.
   */
  getMovieDetails: async (movieId: number) => {
    try {
      const apiKey = getTmdbApiKey();
      const sessionId = TmdbAuthentication.getSessionId(); // Get the session ID from the authentication module
      const response = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
        params: {
          api_key: apiKey,
          ...(sessionId && { session_id: sessionId }), // Include session_id if available
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching movie details:', error);
      throw error;
    }
  },

  /**
   * Search for movies by a query string.
   * @param query - The search query.
   * @returns A promise resolving to the search results.
   */
  searchMovies: async (query: string) => {
    try {
      const apiKey = getTmdbApiKey();
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
        params: {
          api_key: apiKey,
          query,
          ...sessionId && { session_id: sessionId }, // Include session_id if available
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error searching for movies:', error);
      throw error;
    }
  },

  /**
   * Search for TV series by a query string.
   * @param query - The search query.
   * @returns A promise resolving to TV search results.
   */
  searchTV: async (query: string) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
        params: {
          api_key: apiKey,
          query,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error searching for TV series:', error);
      throw error;
    }
  },

  /**
   * Fetch popular movies.
   * @returns A promise resolving to the list of popular movies.
   */
  getPopularMovies: async () => {
    try {
      const apiKey = getTmdbApiKey();
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/popular`, {
        params: {
          api_key: apiKey,
        },
      ...(sessionId && { session_id: sessionId }), // Include session_id if available
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching popular movies:', error);
      throw error;
    }
  },

  /**
   * Fetch top-rated movies.
   * @returns A promise resolving to the list of top-rated movies.
   */
  getTopRatedMovies: async () => {
    try {
      const apiKey = getTmdbApiKey();
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/top_rated`, {
        params: {
          api_key: apiKey,
        },
        ...(sessionId && { session_id: sessionId }), // Include session_id if available
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching top-rated movies:', error);
      throw error;
    }
  },

  /**
   * Fetch upcoming movies.
   * @returns A promise resolving to the list of upcoming movies.
   */
  getUpcomingMovies: async () => {
    try {
      const apiKey = getTmdbApiKey();
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/upcoming`, {
        params: {
          api_key: apiKey,
          ...sessionId && { session_id: sessionId }, // Include session_id if available
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching upcoming movies:', error);
      throw error;
    }
  },

  /**
   * Search for TV series by IMDb ID
   * @param imdbId - The IMDb ID to search for
   * @returns A promise resolving to the TV series details with TMDB ID
   */
  findTVSeriesByImdbId: async (imdbId: string) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/find/${imdbId}`, {
        params: {
          api_key: apiKey,
          external_source: 'imdb_id',
        },
      });
      return response.data.tv_results?.[0]; // Returns first TV result
    } catch (error) {
      console.error('Error finding TV series by IMDb ID:', error);
      throw error;
    }
  },

  /**
   * Get TV series details by TMDB ID
   * @param seriesId - The TMDB series ID
   * @returns A promise resolving to the series details
   */
  getTVSeriesDetails: async (seriesId: number) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}`, {
        params: {
          api_key: apiKey,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching TV series details:', error);
      throw error;
    }
  },

  /**
   * Get external IDs for a TV series (includes imdb_id when available).
   * @param seriesId - The TMDB series ID
   * @returns A promise resolving to external IDs
   */
  getTVSeriesExternalIds: async (seriesId: number) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}/external_ids`, {
        params: {
          api_key: apiKey,
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching TV series external IDs:', error);
      throw error;
    }
  },

  /**
   * Get season details including episodes
   * @param seriesId - The TMDB series ID
   * @param seasonNumber - The season number
   * @returns A promise resolving to the season details with episodes
   */
  getSeasonDetails: async (seriesId: number, seasonNumber: number) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}/season/${seasonNumber}`, {
        params: {
          api_key: apiKey,
        },
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching season ${seasonNumber} details:`, error);
      throw error;
    }
  },

  /**
   * Get episode details
   * @param seriesId - The TMDB series ID
   * @param seasonNumber - The season number
   * @param episodeNumber - The episode number
   * @returns A promise resolving to the episode details
   */
  getEpisodeDetails: async (seriesId: number, seasonNumber: number, episodeNumber: number) => {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}`, {
        params: {
          api_key: apiKey,
        },
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching episode ${seasonNumber}x${episodeNumber} details:`, error);
      throw error;
    }
  },
};

export default TmdbService;