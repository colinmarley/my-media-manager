import { Director } from '@/types/collections/Director.type';

const useDirectorValidation = () => {
  const validateDirector = (director: Partial<Director>): string[] => {
    const errors: string[] = [];

    if (!director.fullName || director.fullName.trim() === '') {
      errors.push('Director name is required.');
    }

    if (director.movieIds && !Array.isArray(director.movieIds)) {
      errors.push('Movie IDs must be an array.');
    }

    if (director.seriesIds && !Array.isArray(director.seriesIds)) {
      errors.push('Series IDs must be an array.');
    }

    if (director.birthday && isNaN(Date.parse(director.birthday))) {
      errors.push('Invalid birthday format.');
    }

    return errors;
  };

  return { validateDirector };
};

export default useDirectorValidation;