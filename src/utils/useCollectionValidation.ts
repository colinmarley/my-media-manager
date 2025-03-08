import { FBCollection } from '../types/firebase/FBCollection.type';

const useCollectionValidation = () => {
  const validateTitle = (title: string): string | null => {
    if (!title) {
      return 'Title is required';
    }
    return null;
  };

  const validateDescription = (description: string): string | null => {
    if (!description) {
      return 'Description is required';
    }
    return null;
  };

  const validateImageFiles = (imageFiles: string[]): string | null => {
    if (imageFiles.length === 0) {
      return 'At least one image file is required';
    }
    return null;
  };

  const validateDirectors = (directors: string[]): string | null => {
    if (directors.length === 0) {
      return 'At least one director is required';
    }
    return null;
  };

  const validateGenres = (genres: string[]): string | null => {
    if (genres.length === 0) {
      return 'At least one genre is required';
    }
    return null;
  };

  const validateMovieIds = (movieIds?: string[]): string | null => {
    if (movieIds && movieIds.length === 0) {
      return 'At least one movie ID is required';
    }
    return null;
  };

  const validateSeriesIds = (seriesIds?: string[]): string | null => {
    if (seriesIds && seriesIds.length === 0) {
      return 'At least one series ID is required';
    }
    return null;
  };

  const validateSeasonIds = (seasonIds?: string[]): string | null => {
    if (seasonIds && seasonIds.length === 0) {
      return 'At least one season ID is required';
    }
    return null;
  };

  const validateEpisodeIds = (episodeIds?: string[]): string | null => {
    if (episodeIds && episodeIds.length === 0) {
      return 'At least one episode ID is required';
    }
    return null;
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