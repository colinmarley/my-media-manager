import { useState, useEffect } from 'react';
import { api } from '@/service/api/apiClient';
import { CatalogMovie } from '../../types/catalog/Movie.type';

const useMovies = (_conditions?: [string, any][]) => {
  const [movies, setMovies] = useState<CatalogMovie[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMovies = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<CatalogMovie[]>('/api/catalog/movies');
        setMovies(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMovies();
  }, []);

  return { movies, loading, error };
};

export default useMovies;
