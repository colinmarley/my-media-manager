import { FBDisc } from '../types/firebase/FBDisc.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateOptionalIsoDate,
  validateOptionalNonEmptyArray,
  validateOptionalTextNotEmpty,
  validateRequiredText,
} from './validation/commonValidation';

const useDiscValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateVideoFiles = (videoFiles: FBDisc['videoFiles']): string | null => {
    return toLegacyError(validateNonEmptyArray(videoFiles, 'video file'));
  };

  const validateImageFiles = (imageFiles: FBDisc['imageFiles']): string | null => {
    return toLegacyError(validateNonEmptyArray(imageFiles, 'image file'));
  };

  const validateReleaseDate = (releaseDate?: string): string | null => {
    return toLegacyError(validateOptionalIsoDate(releaseDate, 'Release Date'));
  };

  const validateGenre = (genre?: string): string | null => {
    return toLegacyError(validateOptionalTextNotEmpty(genre, 'Genre'));
  };

  const validateLanguage = (language?: string): string | null => {
    return toLegacyError(validateOptionalTextNotEmpty(language, 'Language'));
  };

  const validateSubtitles = (subtitles?: string[]): string | null => {
    const subtitleErrors = validateOptionalNonEmptyArray(subtitles, 'subtitle');
    if (subtitleErrors.length > 0) {
      return 'Subtitles cannot be empty';
    }
    return null;
  };

  const validateRegionCode = (regionCode?: string): string | null => {
    return toLegacyError(validateOptionalTextNotEmpty(regionCode, 'Region Code'));
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