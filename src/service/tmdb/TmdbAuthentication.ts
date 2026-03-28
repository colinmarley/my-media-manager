import axios from 'axios';

const TMDB_BASE_URL = process.env.NEXT_PUBLIC_TMDB_BASE_URL?.replace(/\/$/, '') || 'https://api.themoviedb.org/3';
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

const getTmdbApiKey = (): string => {
  if (!TMDB_API_KEY || TMDB_API_KEY.includes('your_')) {
    throw new Error('TMDB is not configured. Set NEXT_PUBLIC_TMDB_API_KEY in .env.local and restart Next.js.');
  }
  return TMDB_API_KEY;
};

class TmdbAuthentication {
  private requestToken: string | null = null;
  private sessionId: string | null = null;

  /**
   * Step 1: Create a new request token.
   * @returns The request token.
   */
  async createRequestToken(): Promise<string> {
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.get(`${TMDB_BASE_URL}/authentication/token/new`, {
        params: {
          api_key: apiKey,
        },
      });
      this.requestToken = response.data.request_token;
      return this?.requestToken || "";
    } catch (error) {
      console.error('Error creating request token:', error);
      throw error;
    }
  }

  /**
   * Step 2: Get the user to authorize the request token.
   * @param redirectUrl - The URL to redirect the user after authorization.
   * @returns The authorization URL.
   */
  getAuthorizationUrl(redirectUrl?: string): string {
    if (!this.requestToken) {
      throw new Error('Request token is not available. Call createRequestToken first.');
    }
    let url = `https://www.themoviedb.org/authenticate/${this.requestToken}`;
    if (redirectUrl) {
      url += `?redirect_to=${encodeURIComponent(redirectUrl)}`;
    }
    return url;
  }

  /**
   * Step 3: Create a new session ID with the authorized request token.
   * @returns The session ID.
   */
  async createSession(): Promise<string> {
    if (!this.requestToken) {
      throw new Error('Request token is not available. Call createRequestToken first.');
    }
    try {
      const apiKey = getTmdbApiKey();
      const response = await axios.post(`${TMDB_BASE_URL}/authentication/session/new`, {
        request_token: this.requestToken,
      }, {
        params: {
          api_key: apiKey,
        },
      });
      this.sessionId = response.data.session_id;
      return this.sessionId || "";
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Get the current session ID.
   * @returns The session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

export default new TmdbAuthentication();