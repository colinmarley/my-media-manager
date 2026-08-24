import { CatalogEpisode } from '../types/catalog/Episode.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateOptionalTextNotEmpty,
  validateRequiredText,
} from './validation/commonValidation';

const useEpisodeValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateSeasonId = (seasonId: string): string | null => {
    return toLegacyError(validateRequiredText(seasonId, 'Season ID'));
  };

  const validateSeriesId = (seriesId: string): string | null => {
    return toLegacyError(validateRequiredText(seriesId, 'Series ID'));
  };

  const validateEpisodeNumber = (episodeNumber: string): string | null => {
    return toLegacyError(validateRequiredText(episodeNumber, 'Episode Number'));
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    return toLegacyError(validateRequiredText(countryOfOrigin, 'Country of Origin'));
  };

  const validateDirectors = (directors: CatalogEpisode['directors']): string | null => {
    if (directors.length === 0) {
      return 'At least one director is required';
    }
    for (const director of directors) {
      if (!director.fullName) {
        return 'Director name is required';
      }
    }
    return null;
  };

  const validateImageFiles = (imageFiles: CatalogEpisode['imageFiles']): string | null => {
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

  const validateActors = (actors: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(actors, 'actor'));
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
    validateSeasonId,
    validateSeriesId,
    validateEpisodeNumber,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateReleaseDate,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateActors,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  };
};

export default useEpisodeValidation;