import axios from 'axios';
import TmdbAuthentication from './TmdbAuthentication';

const TMDB_BASE_URL = process.env.NEXT_PUBLIC_TMDB_BASE_URL;
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not defined in the environment variables.');
}

const TmdbService = {
  /**
   * Fetch details of a movie by its ID.
   * @param movieId - The ID of the movie to fetch.
   * @returns A promise resolving to the movie details.
   */
  getMovieDetails: async (movieId: number) => {
    try {
      const sessionId = TmdbAuthentication.getSessionId(); // Get the session ID from the authentication module
      const response = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
        params: {
          api_key: TMDB_API_KEY,
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
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
        params: {
          api_key: TMDB_API_KEY,
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
   * Fetch popular movies.
   * @returns A promise resolving to the list of popular movies.
   */
  getPopularMovies: async () => {
    try {
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/popular`, {
        params: {
          api_key: TMDB_API_KEY,
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
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/top_rated`, {
        params: {
          api_key: TMDB_API_KEY,
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
      const sessionId = TmdbAuthentication.getSessionId();
      const response = await axios.get(`${TMDB_BASE_URL}/movie/upcoming`, {
        params: {
          api_key: TMDB_API_KEY,
          ...sessionId && { session_id: sessionId }, // Include session_id if available
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching upcoming movies:', error);
      throw error;
    }
  },
};

export default TmdbService;