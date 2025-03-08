import { FBRelease } from '../types/firebase/FBRelease.type';

const useReleaseValidation = () => {
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

  const validateDiscIds = (discIds: string[]): string | null => {
    if (discIds.length === 0) {
      return 'At least one disc ID is required';
    }
    return null;
  };

  const validateDiscTypes = (discTypes: string[]): string | null => {
    if (discTypes.length === 0) {
      return 'At least one disc type is required';
    }
    return null;
  };

  const validateExtras = (extras: FBRelease['extras']): string | null => {
    for (const extra of extras) {
      if (!extra.title) {
        return 'Extra title is required';
      }
      if (!extra.runtime) {
        return 'Extra runtime is required';
      }
      if (!extra.type) {
        return 'Extra type is required';
      }
    }
    return null;
  };

  const validateMediaType = (mediaType: string): string | null => {
    if (!mediaType) {
      return 'Media type is required';
    }
    return null;
  };

  const validateImages = (images: FBRelease['images']): string | null => {
    if (images.length === 0) {
      return 'At least one image is required';
    }
    return null;
  };

  return {
    validateTitle,
    validateYear,
    validateDiscIds,
    validateDiscTypes,
    validateExtras,
    validateMediaType,
    validateImages,
  };
};

export default useReleaseValidation;