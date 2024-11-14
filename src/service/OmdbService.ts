import { OmdbResponseFull, OmdbSearchResponse } from '../types/OmdbResponse.type';

const API_KEY = '4253525e';
const BASE_URL = 'https://www.omdbapi.com/';

const searchOmdb = async (params: string): Promise<OmdbSearchResponse[]> => {
  const response = await fetch(`${BASE_URL}?${params}&apikey=${API_KEY}`);
  console.log(response);
  const data = await response.json();
  console.log(data);
  if (data.Response === 'True') {
    return data.Search;
  } else {
    throw new Error(data.Error);
  }
};

const fetchFromOmdb = async (params: string): Promise<OmdbResponseFull[]> => {
  const response = await fetch(`${BASE_URL}?${params}&apikey=${API_KEY}`);
  const data = await response.json();
  if (data.Response === 'True') {
    return data;
  } else {
    throw new Error(data.Error);
  }
};

export const searchMovieByTitle = async (title: string): Promise<OmdbResponseFull[]> => {
  return fetchFromOmdb(`t=${title}&type=movie&plot=full`);
};

export const searchShowByTitle = async (title: string): Promise<OmdbResponseFull[]> => {
  return fetchFromOmdb(`t=${title}&type=series&plot=full`);
};

export const searchByText = async (text: string): Promise<OmdbSearchResponse[]> => {
  return searchOmdb(`s=${text}`);
};