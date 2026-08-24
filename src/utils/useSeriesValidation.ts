import { CatalogSeries } from '../types/catalog/Series.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateOptionalTextNotEmpty,
  validateRequiredText,
  validateUniqueNumbers,
} from './validation/commonValidation';

const useSeriesValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    return toLegacyError(validateRequiredText(countryOfOrigin, 'Country of Origin'));
  };

  const validateDirectors = (directors: CatalogSeries['directors']): string | null => {
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

  const validateImageFiles = (imageFiles: CatalogSeries['imageFiles']): string | null => {
    return toLegacyError(validateNonEmptyArray(imageFiles, 'image file'));
  };

  const validateRunningDates = (runningDates: string): string | null => {
    return toLegacyError(validateRequiredText(runningDates, 'Running Dates'));
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

  const validateSeasons = (seasons: CatalogSeries['seasons']): string | null => {
    if (seasons.length === 0) {
      return 'At least one season is required';
    }
    const seasonNumberErrors = validateUniqueNumbers(seasons, 'season');
    if (seasonNumberErrors.length > 0) {
      return seasonNumberErrors[0];
    }
    for (const season of seasons) {
      if (!season.title) {
        return 'Season title is required';
      }
      if (season.episodes.length === 0) {
        return 'At least one episode is required in each season';
      }
      const episodeNumberErrors = validateUniqueNumbers(season.episodes, 'episode');
      if (episodeNumberErrors.length > 0) {
        return episodeNumberErrors[0];
      }
      for (const episode of season.episodes) {
        if (!episode.title) {
          return 'Episode title is required';
        }
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
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateRunningDates,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateSeasons,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  };
};

export default useSeriesValidation;