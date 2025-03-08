import { FBDisc } from '../types/firebase/FBDisc.type';

const useDiscValidation = () => {
  const validateTitle = (title: string): string | null => {
    if (!title) {
      return 'Title is required';
    }
    return null;
  };

  const validateVideoFiles = (videoFiles: FBDisc['videoFiles']): string | null => {
    if (videoFiles.length === 0) {
      return 'At least one video file is required';
    }
    return null;
  };

  const validateImageFiles = (imageFiles: FBDisc['imageFiles']): string | null => {
    if (imageFiles.length === 0) {
      return 'At least one image file is required';
    }
    return null;
  };

  const validateReleaseDate = (releaseDate?: string): string | null => {
    if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      return 'Release Date must be in the format YYYY-MM-DD';
    }
    return null;
  };

  const validateGenre = (genre?: string): string | null => {
    if (genre && genre.length === 0) {
      return 'Genre cannot be empty';
    }
    return null;
  };

  const validateLanguage = (language?: string): string | null => {
    if (language && language.length === 0) {
      return 'Language cannot be empty';
    }
    return null;
  };

  const validateSubtitles = (subtitles?: string[]): string | null => {
    if (subtitles && subtitles.length === 0) {
      return 'Subtitles cannot be empty';
    }
    return null;
  };

  const validateRegionCode = (regionCode?: string): string | null => {
    if (regionCode && regionCode.length === 0) {
      return 'Region Code cannot be empty';
    }
    return null;
  };

  return {
    validateTitle,
    validateVideoFiles,
    validateImageFiles,
    validateReleaseDate,
    validateGenre,
    validateLanguage,
    validateSubtitles,
    validateRegionCode,
  };
};

export default useDiscValidation;