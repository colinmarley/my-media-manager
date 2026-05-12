import { useState, useEffect } from 'react';
import { api } from '@/service/api/apiClient';
import { CatalogSeries } from '../../types/catalog/Series.type';

const useSeries = (_conditions?: [string, any][]) => {
  const [series, setSeries] = useState<CatalogSeries[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSeries = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<CatalogSeries[]>('/api/catalog/series');
        setSeries(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSeries();
  }, []);

  return { series, loading, error };
};

export default useSeries;
