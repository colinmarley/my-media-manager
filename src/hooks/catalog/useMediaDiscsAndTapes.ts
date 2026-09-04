import { useState, useEffect, useCallback } from 'react';
import { getDiscsAndTapesForMedia } from '@/service/catalog/MediaLinksService';
import { CatalogDisc } from '../../types/catalog/Disc.type';
import { CatalogTape } from '../../types/catalog/Tape.type';

const useMediaDiscsAndTapes = (mediaType: 'movie' | 'series' | undefined, mediaId: string | undefined) => {
  const [discs, setDiscs] = useState<CatalogDisc[]>([]);
  const [tapes, setTapes] = useState<CatalogTape[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!mediaType || !mediaId) {
      setDiscs([]);
      setTapes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getDiscsAndTapesForMedia(mediaType, mediaId);
      setDiscs(data.discs);
      setTapes(data.tapes);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [mediaType, mediaId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { discs, tapes, loading, error, refetch };
};

export default useMediaDiscsAndTapes;
