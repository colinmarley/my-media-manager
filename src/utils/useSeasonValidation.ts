import { FBSeason } from '../types/firebase/FBSeason.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateOptionalTextNotEmpty,
  validateRequiredText,
  validateUniqueNumbers,
} from './validation/commonValidation';

const useSeasonValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateSeriesId = (seriesId: string): string | null => {
    return toLegacyError(validateRequiredText(seriesId, 'Series ID'));
  };

  const validateNumber = (number: number): string | null => {
    if (number <= 0) {
      return 'Number must be greater than 0';
    }
    return null;
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    return toLegacyError(validateRequiredText(countryOfOrigin, 'Country of Origin'));
  };

  const validateDirectors = (directors: FBSeason['directors']): string | null => {
    if (directors.length === 0) {
      return 'At least one director is required';
    }
    for (const director of directors) {
      if (!director.name) {
        return 'Director name is required';
      }
    }
    return null;
  };

  const validateImageFiles = (imageFiles: FBSeason['imageFiles']): string | null => {
    return toLegacyError(validateNonEmptyArray(imageFiles, 'image file'));
  };

  const validateReleaseDate = (releaseDate: string): string | null => {
    return toLegacyError(validateRequiredText(releaseDate, 'Release Date'));
  };

  const validateRuntime = (runtime: string): string | null => {
    return toLegacyError(validateRequiredText(runtime, 'Runtime'));
  };

  const validateTopCast = (topCast: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(topCast, 'top cast member'));
  };

  const validateWriters = (writers: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(writers, 'writer'));
  };

  const validateEpisodes = (episodes: FBSeason['episodes']): string | null => {
    if (episodes.length === 0) {
      return 'At least one episode is required';
    }
    const episodeNumberErrors = validateUniqueNumbers(episodes, 'episode');
    if (episodeNumberErrors.length > 0) {
      return episodeNumberErrors[0];
    }
    for (const episode of episodes) {
      if (!episode.title) {
        return 'Episode title is required';
      }
    }
    return null;
  };

  const validateGenres = (genres?: string[]): string | null => {
    if (genres && genres.length === 0) {
      return 'At least one genre is required';
    }
    return null;
  };

  const validateLanguage = (language?: string): string | null => {
    const errors = validateOptionalTextNotEmpty(language, 'Language');
    if (errors.length > 0) {
      return 'Language is required';
    }
    return null;
  };

  const validateRegionCode = (regionCode?: string): string | null => {
    const errors = validateOptionalTextNotEmpty(regionCode, 'Region Code');
    if (errors.length > 0) {
      return 'Region Code is required';
    }
    return null;
  };

  return {
    validateTitle,
    validateSeriesId,
    validateNumber,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateReleaseDate,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateEpisodes,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  };
};

export default useSeasonValidation;