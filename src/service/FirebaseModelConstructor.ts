import { OmdbResponseFull, OmdbSearchResponse } from '../types/OmdbResponse.type';
import FirestoreService from './FirestoreService';

class FirebaseModelConstructor {
  static createAllMediaDocument(data: OmdbResponseFull): OmdbResponseFull {
    // Validate the data
    if (!data.Title || !data.Year || !data.imdbID || !data.Type || !data.Poster) {
      throw new Error('Invalid data: Missing required fields');
    }

    return {
      Title: data.Title,
      Year: data.Year,
      Rated: data.Rated,
      Released: data.Released,
      Runtime: data.Runtime,
      Genre: data.Genre,
      Director: data.Director,
      Writer: data.Writer,
      Actors: data.Actors,
      Plot: data.Plot,
      Language: data.Language,
      Country: data.Country,
      Awards: data.Awards,
      Poster: data.Poster,
      Ratings: data.Ratings,
      Metascore: data.Metascore,
      imdbRating: data.imdbRating,
      imdbVotes: data.imdbVotes,
      imdbID: data.imdbID,
      Type: data.Type,
      Dvd: data.Dvd,
      BoxOffice: data.BoxOffice,
      Production: data.Production,
      Website: data.Website,
      Response: data.Response,
      TotalSeasons: data.TotalSeasons,
    };
  }

  static createMyMediaDocument(data: OmdbSearchResponse): OmdbSearchResponse {
    // Validate the data
    if (!data.Title || !data.Year || !data.imdbID || !data.Type || !data.Poster) {
      throw new Error('Invalid data: Missing required fields');
    }

    return {
      Title: data.Title,
      Year: data.Year,
      imdbID: data.imdbID,
      Type: data.Type,
      Poster: data.Poster,
    };
  }
}

// Example usage
const allMediaService = new FirestoreService('AllMedia');
const myMediaService = new FirestoreService('MyMedia');

const addAllMediaDocument = async (data: OmdbResponseFull) => {
  const validatedData = FirebaseModelConstructor.createAllMediaDocument(data);
  await allMediaService.addDocument(validatedData);
};

const addMyMediaDocument = async (data: OmdbSearchResponse) => {
  const validatedData = FirebaseModelConstructor.createMyMediaDocument(data);
  await myMediaService.addDocument(validatedData);
};

export { addAllMediaDocument, addMyMediaDocument };