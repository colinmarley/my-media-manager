import FirestoreService from '@/service/firebase/FirestoreService';
import { FBMovie } from '../types/firebase/FBMovie.type';
import { TopCastEntry } from '@/types/inputs/MovieInputs';
import { ActorPreview, MovieDirector, RatingEntry } from '@/types/collections/Common.type';
import { ImageFile, ReleasePreview } from '@/types/collections/Common.type';
import { MediaCertification, MediaGenre, ReleaseType } from '@/types/enums/MediaEnums';
import { OmdbResponseFull } from '@/types/OmdbResponse.type';

const movieCollection = new FirestoreService('movies');

const useMovieValidation = () => {

  // Validate the Title of the movie
  const validateTitle = (title: string): string[] | [] => {
    if (!title) {
      return ['Title is required'];
    }

    if (title.length === 0) {
      return ['Title cannot be empty'];
    }

    return [];
  };

  // Validate the Year of the movie
  const validateYear = (year: string): string[] | [] => {
    if (!year) {
      return ['Year is required'];
    }

    if (!/^\d{4}$/.test(year)) {
      return ['Year must be a 4-digit number'];
    }

    return [];
  };

  const validateCountries = (countries: string[]): string[] | [] => {
    if (!countries || countries.length === 0) {
      return ['Country of Origin is required'];
    }

    return [];
  };

  const validateDirectors = (directors: MovieDirector[]): string[] | [] => {
    if (directors.length === 0) {
      return ['At least one director is required'];
    }
    let errorList: string[] = [];
    const directorsCollection = new FirestoreService('directors');
    directors.forEach((director, ind) => {
      const dirId = director?.directorId;
      if (dirId && dirId.length === 20 && /^[a-zA-Z0-9]+$/.test(dirId)) {
        directorsCollection.getDocumentById(dirId).then((doc: any) => {
          console.log(doc);
          if (!doc) {
            errorList.push(`${ind}:directorId:Director ID does not exist`);
          }
          if (doc && doc?.name !== director.name) {
            errorList.push(`${ind}:name:Director name does not match the ID`);
          }
        });
      }
      if (!director.name) {
        errorList.push(`${ind}:name:Director name is required`);
      }

      if (!director.title) {
        errorList.push(`${ind}:title:Director title is required`);
      }

      if (!director.directorId) {
        errorList.push(`${ind}:directorId:Director ID is required`);
      }

      if (director.directorId && director?.directorId.length !== 20) {
        errorList.push(`${ind}:directorId:Director ID must be 20 alphanumeric characters`);
      }

      if (director.directorId && !/^[a-zA-Z0-9]+$/.test(director.directorId)) {
        errorList.push(`${ind}:directorId:Director ID must be alphanumeric characters only`);
      }
    });
    return errorList;
  };

  const validateGenres = (genres: string[]): string[] | [] => {
    if (!genres || genres.length === 0) {
      return ['At least one genre is required'];
    }

    let errorList: string[] = [];
    genres.forEach((genre, ind) => {
      if (!genre) {
        errorList.push(`${ind}:Genre is required`);
      }

      if(genre.length === 0) {
        errorList.push(`${ind}:Genre cannot be empty`);
      }

      if (MediaGenre[genre as keyof typeof MediaGenre] === undefined) {
        errorList.push(`${ind}:${genre} is an invalid genre type`);
      }
    });

    return errorList;
  };

  const validateImageFiles = (imageFiles: ImageFile[]): string[] | [] => {
    // Check if imageFiles is null or empty
    if (!imageFiles || imageFiles.length === 0) {
      return ['At least one image file is required'];
    }

    let errorList: string[] = [];
    imageFiles.forEach((imageFile, ind) => {
      if (!imageFile.fileName) {
        errorList.push(`${ind}:fileName:Image file name is required`);
      }

      if (!imageFile.fileSize) {
        errorList.push(`${ind}:fileSize:Image file size is required`);
      }

      if (!imageFile.format) {
        errorList.push(`${ind}:format:Image file format is required`);
      }

      if (!imageFile.resolution) {
        errorList.push(`${ind}:resolution:Image file resolution is required`);
      }
    });

    return errorList;
  };

  const validateLanguages = (languages: string[]): string[] | [] => {
    if (!languages || languages.length === 0) {
      return ['At least one language is required'];
    }

    let errorList: string[] = [];
    languages.forEach((language, ind) => {
      if (!language) {
        errorList.push(`${ind}:Language is required`);
      }

      if (language.length === 0) {
        errorList.push(`${ind}:Language cannot be empty`);
      }
    });

    return errorList;
  };

  const validateLetterboxdLink = (letterboxdLink: string): string[] | [] => {
    if (!letterboxdLink || letterboxdLink.length === 0) {
      return ['Letterboxd link cannot be empty'];
    }

    if (letterboxdLink === "N/A") {
      return [];
    }

    // Match this format https://letterboxd.com/film/clash-of-the-titans-2010/
    if (!/^(https?:\/\/)?(www\.)?letterboxd\.com\/film\/[a-zA-Z0-9\-]+\/?$/.test(letterboxdLink)) {
      return ['Invalid Letterboxd link format'];
    }

    return [];
  }

  const validatePlexLink = (plexLink: string): string[] | [] => {
    if (!plexLink || plexLink.length === 0) {
      return ['Plex link cannot be empty'];
    }

    if (!/^https?:\/\/(www\.)?plex\.tv\/[a-zA-Z0-9]+\/?$/.test(plexLink)) {
      return ['Invalid Plex link format'];
    }

    return [];
  }

  const validateReleaseDate = (releaseDate: string): string[] | [] => {
    if (!releaseDate) {
      return ['Release Date is required'];
    }

    if (!/^\d{1,2}-\w{3}-\d{4}$/.test(releaseDate)) {
      return ['Release Date must be in the format "DayAsNumber-Month-Year"'];
    }

    return [];
  };

  const validateReleases = (releases: ReleasePreview[]): string[] | [] => {
    if (!releases || releases.length === 0) {
      return ['At least one release is required'];
    }

    let errorList: string[] = [];
    releases.forEach((release, ind) => {
      if (!release.releaseName || release.releaseName.length === 0) {
        errorList.push(`${ind}:releaseName:Release Name is required`);
      }

      if (!release.releaseId || release.releaseId.length === 0) {
        errorList.push(`${ind}:releaseId:Release Id is required`);
      }

      if (!release.releaseType || release.releaseType.length === 0) {
        errorList.push(`${ind}:releaseType:Release Type is required`);
      }

      if (!release.year || release.year.length === 0) {
        errorList.push(`${ind}:year:Release Year is required`);
      }

      if (release.releaseId && release.releaseId.length !== 20) {
        errorList.push(`${ind}:releaseId:Release ID must be 20 alphanumeric characters`);
      }

      if (release.releaseId && !/^[a-zA-Z0-9]+$/.test(release.releaseId)) {
        errorList.push(`${ind}:releaseId:Release ID must be alphanumeric characters only`);
      }

      if (release.releaseType && !ReleaseType[release.releaseType as keyof typeof ReleaseType]) {
        errorList.push(`${ind}:releaseType:${release.releaseType} is an invalid release type`);
      }
    });

    return errorList;
  }

  const validateRuntime = (runtime: string): string[] | [] => {
    if (!runtime || runtime.length === 0) {
      return ['Runtime is required'];
    }

    if (!/^\d{1,2}:\d{2}:\d{2}$/.test(runtime)) {
      return ['Runtime must be in the format "{hours}:{minutes}:{seconds}"'];
    }

    return [];
  };

  const validateCast = (cast: ActorPreview[]): string[] | [] => {
    if (!cast || cast.length === 0) {
      return ['At least one cast member is required'];
    }

    let errorList: string[] = [];
    const actorsCollection = new FirestoreService('actors');

    cast.forEach((actor, ind) => {
      const actorId = actor?.actorId;
      if (actorId && actorId.length === 20 && /^[a-zA-Z0-9]+$/.test(actorId)) {
        actorsCollection.getDocumentById(actorId).then((doc: any) => {
          if (!doc) {
            errorList.push(`${ind}:actorId:Actor ID does not exist`);
          }
          console.log(doc);
          if (doc && doc?.fullname !== actor.name) {
            errorList.push(`${ind}:actorId:Actor name does not match the ID`);
          }
        });
      }
      if (!actor.name || actor.name.length === 0) {
        errorList.push(`${ind}:name:Actor name is required`);
      }

      if (!actor.actorId || actor.actorId.length === 0) {
        errorList.push(`${ind}:actorId:Actor ID is required`);
      }

      if (actor.actorId && actor.actorId.length !== 20) {
        errorList.push(`${ind}:actorId:Actor ID must be 20 alphanumeric characters`);
      }

      if (actor.actorId && !/^[a-zA-Z0-9]+$/.test(actor.actorId)) {
        errorList.push(`${ind}:actorId:Actor ID must be alphanumeric characters only`);
      }

      if (actor.characters.length === 0) {
        errorList.push(`${ind}:characters:At least one character is required`);
      }
    });

    return errorList;
  };

  const validateWriters = (writers: string[]): string[] | [] => {
    if (writers.length === 0) {
      return ['At least one writer is required'];
    }

    let errorList: string[] = [];
    writers.forEach((writer, ind) => {
      if (!writer || writer.length === 0) {
        errorList.push(`${ind}:Writer name can't be blank`);
      }
    });

    return errorList;
  };

  const validateRatings = (ratings: RatingEntry[]): string[] | [] => {
    if (!ratings || ratings.length === 0) {
      return ['At least one rating is required'];
    }

    let errorList: string[] = [];
    ratings.forEach((rating, ind) => {
      if (!rating.source || rating.source.length === 0) {
        errorList.push(`${ind}:source:Rating source is required`);
      }

      if (!rating.value || rating.value.length === 0) {
        errorList.push(`${ind}:value:Rating value is required`);
      }
    });

    return errorList;
  };

  const validateImdbId = (imdbId: string): string[] | [] => {

    //Can be empty, but if not, must be 9 characters long and alphanumeric
    const errorList: string[] = [];
    if (0 < imdbId.length && imdbId.length !== 9) {
      errorList.push('IMDB ID must be 9 characters long');
    }

    if (!/^[a-zA-Z0-9]+$/.test(imdbId)) {
      errorList.push('IMDB ID must be alphanumeric characters only');
    }

    return errorList;
  }

  const validateCertification = (certification: string): string[] | [] => {
    //Can be empty, but if not, must be 2 characters long and alphanumeric
    if (!certification) {
      return ['Certification value must exist, but can be empty'];
    }

    if (certification.length === 0) {
      return [];
    }

    // Check if the certification is a valid MediaCertification enum value, not key
    if (!Object.values(MediaCertification).includes(certification as MediaCertification)) {
      return [`${certification} is an invalid certification type`];
    }

    return [];
  }

  const validatePlot = (plot: string): string[] | [] => {
    if (!plot) {
      return ['Plot value is required'];
    }

    if (plot.length === 0) {
      return ['Plot cannot be empty'];
    }

    return [];
  }
  

  return {
    validateTitle,
    validateYear,
    validateCountries,
    validateDirectors,
    validateGenres,
    validateImageFiles,
    validateLanguages,
    validateLetterboxdLink,
    validatePlexLink,
    validateReleaseDate,
    validateReleases,
    validateRuntime,
    validateCast,
    validateWriters,
    validateRatings,
    validateImdbId,
    validateCertification,
    validatePlot,
  };
};

export default useMovieValidation;