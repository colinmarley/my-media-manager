import { useState } from 'react';
import { OmdbResponseFull, OmdbSearchResponse } from '../types/OmdbResponse.type';
import FirestoreService from '../service/FirestoreService';

const allMediaService = new FirestoreService('AllMedia');
const myMediaService = new FirestoreService('MyMedia');

const useCreateOmdbResponseFullDocument = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const createOmdbResponseFullDocument = async (data: OmdbResponseFull) => {
    setLoading(true);
    setError(null);

    try {
      // Validate the data
      if (!data.Title || !data.Year || !data.imdbID || !data.Type || !data.Poster) {
        throw new Error('Invalid data: Missing required fields');
      }

      const validatedData: OmdbResponseFull = {
        Title: data.Title,
        Year: data.Year,
        Rated: data.Rated,
        Released: data.Released,
        Runtime: data.Runtime,
        Genre: data.Genre,
        Director: data.Director,
        Writer: data.Writer,
        Actors: data.Actors,
        Plot: data.Plot,
        Language: data.Language,
        Country: data.Country,
        Awards: data.Awards,
        Poster: data.Poster,
        Ratings: data.Ratings,
        Metascore: data.Metascore,
        imdbRating: data.imdbRating,
        imdbVotes: data.imdbVotes,
        imdbID: data.imdbID,
        Type: data.Type,
        Dvd: data.Dvd,
        BoxOffice: data.BoxOffice,
        Production: data.Production,
        Website: data.Website,
        Response: data.Response,
        TotalSeasons: data.TotalSeasons,
      };

      await allMediaService.addDocument(validatedData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { createOmdbResponseFullDocument, loading, error };
};

const useCreateOmdbSearchResponseDocument = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const createOmdbSearchResponseDocument = async (data: OmdbSearchResponse) => {
    setLoading(true);
    setError(null);

    try {
      // Validate the data
      if (!data.Title || !data.Year || !data.imdbID || !data.Type || !data.Poster) {
        throw new Error('Invalid data: Missing required fields');
      }

      const validatedData: OmdbSearchResponse = {
        Title: data.Title,
        Year: data.Year,
        imdbID: data.imdbID,
        Type: data.Type,
        Poster: data.Poster,
      };

      await myMediaService.addDocument(validatedData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { createOmdbSearchResponseDocument, loading, error };
};

export { useCreateOmdbResponseFullDocument, useCreateOmdbSearchResponseDocument };