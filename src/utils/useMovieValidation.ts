import FirestoreService from '@/service/firebase/FirestoreService';
import { FBMovie } from '../types/firebase/FBMovie.type';
import { TopCastEntry } from '@/types/inputs/MovieInputs';

const movieCollection = new FirestoreService('movies');

const useMovieValidation = () => {
  const validateTitle = (title: string): string | null => {
    if (!title) {
      return 'Title is required';
    }
    return null;
  };

  const validateYear = (year: string): string | null => {
    if (!year) {
      return 'Year is required';
    }
    if (!/^\d{4}$/.test(year)) {
      return 'Year must be a 4-digit number';
    }
    return null;
  };

  const validateCountryOfOrigin = (countryOfOrigin: string): string | null => {
    if (!countryOfOrigin) {
      return 'Country of Origin is required';
    }
    return null;
  };

  const validateDirectors = (directors: FBMovie['directors']): string | null => {
    
    if (directors.length === 0) {
      return 'At least one director is required';
    }
    for (const director of directors) {
      if (!director.fullName) {
        return 'Director name is required';
      }
      if (!director.directorId) {
        return 'Director ID is required';
      }
      if (director.directorId.length !== 20) {
        return 'Director ID must be 20 alphanumeric characters';
      }
      if (!/^[a-zA-Z0-9]+$/.test(director.directorId)) {
        return 'Director ID must be alphanumeric characters only';
      }
      if (!director.title) {
        return 'Director title is required';
      }
    }
    return null;
  };

  const validateImageFiles = (imageFiles: FBMovie['imageFiles']): string | null => {
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

  const validateTopCast = (topCast: TopCastEntry[]): string | null => {
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

  const validateGenres = (genres: string[]): string | null => {
    if (genres.length === 0) {
      return 'At least one genre is required';
    }
    return null;
  };

  const validateLanguage = (language: string): string | null => {
    if (!language) {
      return 'Language is required';
    }
    return null;
  };

  const validateRated = (rated: string): string | null => {
    if (!rated) {
      return 'Rated is required';
    }
    return null;
  };

  const validatePlot = (plot: string): string | null => {
    if (!plot) {
      return 'Plot is required';
    }
    return null;
  };

  const validateAwards = (awards: string): string | null => {
    if (!awards) {
      return 'Awards is required';
    }
    return null;
  };

  const validateMetascore = (metascore: string): string | null => {
    if (!metascore) {
      return 'Metascore is required';
    }
    return null;
  };

  const validateImdbRating = (imdbRating: string): string | null => {
    if (!imdbRating) {
      return 'IMDb Rating is required';
    }
    return null;
  };

  const validateImdbVotes = (imdbVotes: string): string | null => {
    if (!imdbVotes) {
      return 'IMDb Votes is required';
    }
    return null;
  };

  return {
    validateTitle,
    validateYear,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateReleaseDate,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateGenres,
    validateLanguage,
    validateRated,
    validatePlot,
    validateAwards,
    validateMetascore,
    validateImdbRating,
    validateImdbVotes,
  };
};

export default useMovieValidation;