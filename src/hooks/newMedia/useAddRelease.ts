import { useState } from 'react';
import { CatalogRelease, Extra, ImageFile, MovieInfoSmall, SeasonInfoSmall, SeriesInfoSmall, EpisodeInfoSmall } from '../../types/catalog/Release.type';
import { DiscFormat, MediaType } from '../../types/catalog/Common.type';
import CatalogService from '../../service/catalog/CatalogService';

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
      const release: CatalogRelease = {
        id: '',
        title,
        year,
        containsExtras,
        containsInserts,
        discIds,
        discTypes: discTypes as DiscFormat[],
        extras,
        mediaType: mediaType as MediaType,
        images,
        episodeIds,
        movieIds,
        seasonIds,
        seriesIds,
      };

      const service = new CatalogService('releases');
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