import { useState } from 'react';
import { FBMovie, Director, ImageFile } from '../../types/firebase/FBMovie.type';
import { OmdbResponseFull } from '../../types/OmdbResponse.type';
import FirestoreService from '../../service/firebase/FirestoreService';
import { FBRelease } from '@/types/firebase/FBRelease.type';

const useAddMovie = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const addMovie = async (
    title: string,
    countryOfOrigin: string,
    directors: Director[],
    imageFiles: ImageFile[],
    omdbData: OmdbResponseFull,
    releaseDate: string,
    releases: FBRelease[],
    runtime: string,
    topCast: string[],
    writers: string[],
    isPartOfCollection: boolean,
    letterboxdLink?: string,
    plexLink?: string,
    genres?: string[],
    language?: string
  ) => {
    setLoading(true);
    setError(null);

    try {
      const movie: FBMovie = {
        id: '', // Firebase will generate the ID
        title,
        countryOfOrigin,
        directors,
        imageFiles,
        letterboxdLink,
        plexLink,
        omdbData,
        releaseDate,
        releases,
        runtime,
        topCast,
        writers,
        isPartOfCollection,
        genres,
        language,
      };

      const service = new FirestoreService('movies');
      await service.addDocument(movie);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { addMovie, loading, error };
};

export default useAddMovie;