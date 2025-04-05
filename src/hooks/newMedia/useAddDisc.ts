import { useState } from 'react';
import { FBDisc } from '../../types/firebase/FBDisc.type';
import { ImageFile, VideoFile } from '@/types/firebase/FBCommon.type';
import FirestoreService from '../../service/firebase/FirestoreService';

const useAddDisc = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const addDisc = async (
    title: string,
    videoFiles: VideoFile[],
    imageFiles: ImageFile[],
    isPartOfSet: boolean,
    isRentalDisc: boolean,
    containsSpecialFeatures: boolean,
    resourceId?: string,
    releaseDate?: string,
    genre?: string,
    language?: string,
    subtitles?: string[],
    regionCode?: string
  ) => {
    setLoading(true);
    setError(null);

    try {
      const disc: FBDisc = {
        id: '', // Firebase will generate the ID
        title,
        videoFiles,
        imageFiles,
        isPartOfSet,
        isRentalDisc,
        containsSpecialFeatures,
        resourceId,
        releaseDate,
        genre,
        language,
        subtitles,
        regionCode,
      };

      const service = new FirestoreService('discs');
      await service.addDocument(disc);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { addDisc, loading, error };
};

export default useAddDisc;