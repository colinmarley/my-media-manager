import { OmdbResponseFull, OmdbSearchResponse } from '../../types/OmdbResponse.type';

const API_KEY = process.env.NEXT_PUBLIC_OMDB_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_OMDB_BASE_URL || 'https://www.omdbapi.com/';

const ensureOmdbConfig = (): void => {
  if (!API_KEY || API_KEY.includes('your_')) {
    throw new Error(
      'OMDB is not configured. Set NEXT_PUBLIC_OMDB_API_KEY in .env.local and restart Next.js.',
    );
  }
};

const requestOmdb = async (params: URLSearchParams): Promise<any> => {
  ensureOmdbConfig();

  params.set('apikey', API_KEY as string);
  const url = `${BASE_URL}?${params.toString()}`;
  const response = await fetch(url);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await response.text();
    throw new Error(`OMDB returned a non-JSON response (${response.status}). URL: ${url}. Body: ${body.slice(0, 120)}`);
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.Error || `OMDB request failed with status ${response.status}`);
  }

  return data;
};

const searchOmdb = async (queryText: string): Promise<OmdbSearchResponse[]> => {
  const params = new URLSearchParams({ s: queryText });
  const data = await requestOmdb(params);

  if (data.Response === 'True') {
    return data.Search;
  }

  throw new Error(data.Error || 'No OMDB search results found.');
};

const fetchFromOmdb = async (params: URLSearchParams): Promise<OmdbResponseFull> => {
  const data = await requestOmdb(params);

  if (data.Response === 'True') {
    return data;
  }

  throw new Error(data.Error || 'OMDB metadata request failed.');
};

export const retrieveMovieDataByTitle = async (title: string): Promise<OmdbResponseFull> => {
  const params = new URLSearchParams({ t: title, type: 'movie', plot: 'full' });
  return fetchFromOmdb(params);
};

export const retrieveShowDataByTitle = async (title: string): Promise<OmdbResponseFull> => {
  const params = new URLSearchParams({ t: title, type: 'series', plot: 'full' });
  return fetchFromOmdb(params);
};

export const retrieveMediaDataById = async (id: string): Promise<OmdbResponseFull> => {
  const params = new URLSearchParams({ i: id, plot: 'full' });
  return fetchFromOmdb(params);
};

export const searchByText = async (text: string, type?: 'movie' | 'series' | 'episode'): Promise<OmdbSearchResponse[]> => {
  const params = new URLSearchParams({ s: text });
  if (type) params.set('type', type);
  const data = await requestOmdb(params);
  if (data.Response === 'True') return data.Search;
  return [];
};

export const retrieveEpisodeData = async (seriesId: string, season: number, episode: number): Promise<OmdbResponseFull> => {
  const params = new URLSearchParams({ i: seriesId, Season: String(season), Episode: String(episode) });
  return fetchFromOmdb(params);
};
