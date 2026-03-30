import { FBCollection } from '../types/firebase/FBCollection.type';
import { ImageFile } from '../types/firebase/FBCommon.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateOptionalNonEmptyArray,
  validateRequiredText,
} from './validation/commonValidation';

const useCollectionValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateDescription = (description: string): string | null => {
    return toLegacyError(validateRequiredText(description, 'Description'));
  };

  const validateImageFiles = (imageFiles: ImageFile[]): string | null => {
    return toLegacyError(validateNonEmptyArray(imageFiles, 'image file'));
  };

  const validateDirectors = (directors: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(directors, 'director'));
  };

  const validateGenres = (genres: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(genres, 'genre'));
  };

  const validateMovieIds = (movieIds?: string[]): string | null => {
    return toLegacyError(validateOptionalNonEmptyArray(movieIds, 'movie ID'));
  };

  const validateSeriesIds = (seriesIds?: string[]): string | null => {
    return toLegacyError(validateOptionalNonEmptyArray(seriesIds, 'series ID'));
  };

  const validateSeasonIds = (seasonIds?: string[]): string | null => {
    return toLegacyError(validateOptionalNonEmptyArray(seasonIds, 'season ID'));
  };

  const validateEpisodeIds = (episodeIds?: string[]): string | null => {
    return toLegacyError(validateOptionalNonEmptyArray(episodeIds, 'episode ID'));
  };

  return {
    validateTitle,
    validateDescription,
    validateImageFiles,
    validateDirectors,
    validateGenres,
    validateMovieIds,
    validateSeriesIds,
    validateSeasonIds,
    validateEpisodeIds,
  };
};

export default useCollectionValidation;