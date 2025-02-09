import { useState } from 'react';
import { FBRelease, Extra, ImageFile, MovieInfoSmall, SeasonInfoSmall, SeriesInfoSmall, EpisodeInfoSmall } from '../../types/firebase/FBRelease.type';
import FirestoreService from '../../service/FirestoreService';

const useAddRelease = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const addRelease = async (
    title: string,
    year: number,
    containsExtras: boolean,
    containsInserts: boolean,
    discIds: string[],
    discTypes: string[],
    extras: Extra[],
    mediaType: string,
    images: ImageFile[],
    episodeIds?: EpisodeInfoSmall[],
    movieIds?: MovieInfoSmall[],
    seasonIds?: SeasonInfoSmall[],
    seriesIds?: SeriesInfoSmall[]
  ) => {
    setLoading(true);
    setError(null);

    try {
      const release: FBRelease = {
        id: '', // Firebase will generate the ID
        title,
        year,
        containsExtras,
        containsInserts,
        discIds,
        discTypes,
        extras,
        mediaType,
        images,
        episodeIds,
        movieIds,
        seasonIds,
        seriesIds,
      };

      const service = new FirestoreService('releases');
      await service.addDocument(release);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { addRelease, loading, error };
};

export default useAddRelease;