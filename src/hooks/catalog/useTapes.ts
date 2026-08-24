import { useState, useEffect } from 'react';
import { api } from '@/service/api/apiClient';
import { CatalogTape } from '../../types/catalog/Tape.type';

const useTapes = () => {
  const [tapes, setTapes] = useState<CatalogTape[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTapes = async () => {
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
    };

    fetchTapes();
  }, []);

  return { tapes, loading, error };
};

export default useTapes;
