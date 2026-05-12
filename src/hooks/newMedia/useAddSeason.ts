import { useState } from 'react';
import { CatalogSeason, Episode } from '../../types/catalog/Season.type';
import { DirectorEntry, ImageFile } from '../../types/catalog/Common.type';
import CatalogService from '../../service/catalog/CatalogService';

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
      const season: CatalogSeason = {
        id: '',
        title,
        seriesId,
        number,
        countryOfOrigin: Array.isArray(countryOfOrigin) ? countryOfOrigin : [countryOfOrigin],
        directors: directors.map(director => ({
          fullName: director.fullName,
          notes: '',
          portfolio: [],
          otherCollections: [],
          awards: [],
        })),
        imageFiles,
        letterboxdLink,
        plexLink,
        releaseDate,
        releaseIds: releases,
        runtime,
        topCast: topCast.map(actorName => ({ actorName })),
        writers,
        isPartOfCollection,
        collectionIds,
        episodes,
        genres,
        languages: [language],
        regionCode,
      };

      const service = new CatalogService('seasons');
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