import { OmdbResponseFull, OmdbSearchResponse } from '../../types/OmdbResponse.type';

const API_KEY = process.env.NEXT_PUBLIC_OMDB_API_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_OMDB_BASE_URL;

const searchOmdb = async (params: string): Promise<OmdbSearchResponse[]> => {
  const response = await fetch(`${BASE_URL}?${params}&apikey=${API_KEY}`);
  
  const data = await response.json();

  if (data.Response === 'True') {
    return data.Search;
  } else {
    throw new Error(data.Error);
  }
};

const fetchFromOmdb = async (params: string): Promise<OmdbResponseFull> => {
  const response = await fetch(`${BASE_URL}?${params}&apikey=${API_KEY}`);
  const data = await response.json();
  if (data.Response === 'True') {
    return data;
  } else {
    throw new Error(data.Error);
  }
};

export const retrieveMovieDataByTitle = async (title: string): Promise<OmdbResponseFull> => {
  return fetchFromOmdb(`t=${title}&type=movie&plot=full`);
};

export const retrieveShowDataByTitle = async (title: string): Promise<OmdbResponseFull> => {
  return fetchFromOmdb(`t=${title}&type=series&plot=full`);
};

export const retrieveMediaDataById = async (id: string): Promise<OmdbResponseFull> => {
  const response = await fetchFromOmdb(`i=${id}&plot=full`);
  return response;
}

export const searchByText = async (text: string): Promise<OmdbSearchResponse[]> => {
  return searchOmdb(`s=${text}`);
};