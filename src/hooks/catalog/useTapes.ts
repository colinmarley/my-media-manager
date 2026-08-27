import { useState, useEffect, useCallback } from 'react';
import { api } from '@/service/api/apiClient';
import { CatalogTape } from '../../types/catalog/Tape.type';

const useTapes = () => {
  const [tapes, setTapes] = useState<CatalogTape[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CatalogTape[]>('/api/catalog/tapes');
      setTapes(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tapes, loading, error, refetch };
};

export default useTapes;
