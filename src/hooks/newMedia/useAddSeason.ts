import { useState } from 'react';
import { FBSeason, Episode } from '../../types/firebase/FBSeason.type';
import { DirectorEntry, ImageFile } from '../../types/firebase/FBCommon.type';
import FirestoreService from '../../service/FirestoreService';

const useAddSeason = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const addSeason = async (
    title: string,
    seriesId: string,
    number: number,
    countryOfOrigin: string,
    directors: DirectorEntry[],
    imageFiles: ImageFile[],
    letterboxdLink: string,
    plexLink: string,
    omdbData: any,
    releaseDate: string,
    releases: string[],
    runtime: string,
    topCast: string[],
    writers: string[],
    isPartOfCollection: boolean,
    collectionIds: string[],
    episodes: Episode[],
    genres: string[],
    language: string,
    regionCode: string
  ) => {
    setLoading(true);
    setError(null);

    try {
      const season: FBSeason = {
        id: '', // Firebase will generate the ID
        title,
        seriesId,
        number,
        countryOfOrigin,
        directors: directors.map(director => ({
          name: director.name,
          notes: '',
          portfolio: [],
          otherCollections: [],
          awards: [],
        })),
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
        collectionIds,
        episodes,
        genres,
        language,
        regionCode,
      };

      const service = new FirestoreService('seasons');
      await service.addDocument(season);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { addSeason, loading, error };
};

export default useAddSeason;