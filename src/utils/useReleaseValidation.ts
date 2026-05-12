import { CatalogRelease } from '../types/catalog/Release.type';
import {
  toLegacyError,
  validateNonEmptyArray,
  validateRequiredText,
  validateYear4Digit,
} from './validation/commonValidation';

const useReleaseValidation = () => {
  const validateTitle = (title: string): string | null => {
    return toLegacyError(validateRequiredText(title, 'Title'));
  };

  const validateYear = (year: string): string | null => {
    return toLegacyError(validateYear4Digit(year));
  };

  const validateDiscIds = (discIds: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(discIds, 'disc ID'));
  };

  const validateDiscTypes = (discTypes: string[]): string | null => {
    return toLegacyError(validateNonEmptyArray(discTypes, 'disc type'));
  };

  const validateExtras = (extras: CatalogRelease['extras']): string | null => {
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
    return toLegacyError(validateRequiredText(mediaType, 'Media type'));
  };

  const validateImages = (images: CatalogRelease['images']): string | null => {
    return toLegacyError(validateNonEmptyArray(images, 'image'));
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