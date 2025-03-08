import { FBEpisode } from '../types/firebase/FBEpisode.type';

const useEpisodeValidation = () => {
  const validateTitle = (title: string): string | null => {
    if (!title) {
      return 'Title is required';
    }
    return null;
  };

  const validateSeasonId = (seasonId: string): string | null => {
    if (!seasonId) {
      return 'Season ID is required';
    }
    return null;
  };

  const validateSeriesId = (seriesId: string): string | null => {
    if (!seriesId) {
      return 'Series ID is required';
    }
    return null;
  };

  const validateEpisodeNumber = (episodeNumber: string): string | null => {
    if (!episodeNumber) {
      return 'Episode Number is required';
    }
    return null;
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    if (!countryOfOrigin) {
      return 'Country of Origin is required';
    }
    return null;
  };

  const validateDirectors = (directors: FBEpisode['directors']): string | null => {
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

  const validateImageFiles = (imageFiles: FBEpisode['imageFiles']): string | null => {
    if (imageFiles.length === 0) {
      return 'At least one image file is required';
    }
    return null;
  };

  const validateReleaseDate = (releaseDate: string): string | null => {
    if (!releaseDate) {
      return 'Release Date is required';
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

  const validateActors = (actors: string[]): string | null => {
    if (actors.length === 0) {
      return 'At least one actor is required';
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