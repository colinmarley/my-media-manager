import { FBSeries } from '../types/firebase/FBSeries.type';

const useSeriesValidation = () => {
  const validateTitle = (title: string): string | null => {
    if (!title) {
      return 'Title is required';
    }
    return null;
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    if (!countryOfOrigin) {
      return 'Country of Origin is required';
    }
    return null;
  };

  const validateDirectors = (directors: FBSeries['directors']): string | null => {
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

  const validateImageFiles = (imageFiles: FBSeries['imageFiles']): string | null => {
    if (imageFiles.length === 0) {
      return 'At least one image file is required';
    }
    return null;
  };

  const validateRunningDates = (runningDates: string): string | null => {
    if (!runningDates) {
      return 'Running Dates are required';
    }
    return null;
  };

  const validateRuntime = (runtime: string): string | null => {
    if (!runtime) {
      return 'Runtime is required';
    }
    return null;
  };

  const validateTopCast = (topCast: string[]): string | null => {
    if (topCast.length === 0) {
      return 'At least one top cast member is required';
    }
    return null;
  };

  const validateWriters = (writers: string[]): string | null => {
    if (writers.length === 0) {
      return 'At least one writer is required';
    }
    return null;
  };

  const validateSeasons = (seasons: FBSeries['seasons']): string | null => {
    if (seasons.length === 0) {
      return 'At least one season is required';
    }
    for (const season of seasons) {
      if (!season.title) {
        return 'Season title is required';
      }
      if (season.episodes.length === 0) {
        return 'At least one episode is required in each season';
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
    if (language && language.length === 0) {
      return 'Language is required';
    }
    return null;
  };

  const validateRegionCode = (regionCode?: string): string | null => {
    if (regionCode && regionCode.length === 0) {
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