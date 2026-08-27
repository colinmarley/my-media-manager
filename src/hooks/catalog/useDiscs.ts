import { useState, useEffect, useCallback } from 'react';
import { api } from '@/service/api/apiClient';
import { CatalogDisc } from '../../types/catalog/Disc.type';

const useDiscs = (_conditions?: [string, any][]) => {
  const [discs, setDiscs] = useState<CatalogDisc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CatalogDisc[]>('/api/catalog/discs');
      setDiscs(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { discs, loading, error, refetch };
};

export default useDiscs;
