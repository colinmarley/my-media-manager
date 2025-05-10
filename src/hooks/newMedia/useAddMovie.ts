import { useState } from 'react';
import { ActorPreview, ImageFile, MovieDirector, RatingEntry, ReleasePreview } from '@/types/collections/Common.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../types/OmdbResponse.type';
import useMovieValidation from '@/utils/useMovieValidation';
import { FormInputData } from '@/types/inputs/FormInput.type';

const useAddMovie = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Movie Fields
  const [id, setId] = useState<FormInputData<string>>({value: '', errors: []}); // Unique identifier for the movie
  const [title, setTitle] = useState<FormInputData<string>>({value: '', errors: []}); // Original title of the movie
  const [countries, setCountries] = useState<FormInputData<string[]>>({value: [], errors: []}); // Countries where the movie originated
  const [directors, setDirectors] = useState<FormInputData<MovieDirector[]>>({value: [], errors: []}); // List of directors involved in the movie
  const [genres, setGenres] = useState<FormInputData<string[]>>({value: [], errors: []}); // Genres of the movie, must match predefined enums
  const [imageFiles, setImageFiles] = useState<FormInputData<ImageFile[]>>({value: [], errors: []}); // Images related to the movie (e.g., posters, stills)
  const [languages, setLanguages] = useState<FormInputData<string[]>>({value: [], errors: []}); // Original languages of the movie
  const [letterboxdLink, setLetterboxdLink] = useState<FormInputData<string>>({value: '', errors: []}); // Optional URL to the Letterboxd page
  const [plexLink, setPlexLink] = useState<FormInputData<string>>({value: '', errors: []}); // Optional URL to the Plex page
  const [releaseDate, setReleaseDate] = useState<FormInputData<string>>({value: '', errors: []}); // Release date in the format "DayAsNumber-Month-Year"
  const [releases, setReleases] = useState<FormInputData<ReleasePreview[]>>({value: [], errors: []}); // Known releases of the movie on physical media
  const [runtime, setRuntime] = useState<FormInputData<string>>({value: '', errors: []}); // Runtime in the format "{hours}:{minutes}:{seconds}"
  const [cast, setCast] = useState<FormInputData<ActorPreview[]>>({value: [], errors: []}); // List of actors in the movie
  const [writers, setWriters] = useState<FormInputData<string[]>>({value: [], errors: []}); // Names of writers credited in the movie
  const [omdbData, setOmdbData] = useState<FormInputData<OmdbResponseFull | null>>({value: null, errors: []}); // OMDB data for the movie
  const [omdbResults, setOmdbResults] = useState<FormInputData<OmdbSearchResponse[]>>({value: [], errors: []}); // Search results from OMDB API based on search query
  const [ratings, setRatings] = useState<FormInputData<RatingEntry[]>>({value: [], errors: []}); // Ratings for the movie from various sources
  const [imdbId, setImdbId] = useState(<FormInputData<string>>{value: '', errors: []}); // IMDB ID of the movie
  const [certification, setCertification] = useState<FormInputData<string>>({value: '', errors: []}); // Movie certification (e.g., PG-13, R)
  const [plot, setPlot] = useState<FormInputData<string>>({value: '', errors: []}); // Plot summary of the movie
  const {
    validateTitle, validateCountries, validateDirectors,
    validateGenres, validateImageFiles, validateLanguages,
    validateLetterboxdLink, validatePlexLink, validateReleaseDate,
    validateReleases, validateRuntime, validateCast,
    validateWriters, validateRatings, validateImdbId,
    validateCertification, validatePlot
   } = useMovieValidation();

  const setTitleValue = (value: string) => {
    // Validate the Title value and set value and errors accordingly
    setTitle({value, errors: validateTitle(value)});
  }

  const setCountriesValue = (value: string[]) => {
    // Validate the Countries value and set value and errors accordingly
    setCountries({value, errors: validateCountries(value)});
  }

  const setDirectorsValue = (value: MovieDirector[]) => {
    // Validate the Directors value and set value and errors accordingly
    setDirectors({value, errors: validateDirectors(value)});
  }

  const setGenresValue = (value: string[]) => {
    // Validate the Genres value and set value and errors accordingly
    setGenres({value, errors: validateGenres(value)});
  }

  const setImageFilesValue = (value: ImageFile[]) => {
    // Validate the ImageFiles value and set value and errors accordingly
    setImageFiles({value, errors: validateImageFiles(value)});
  }

  const setLanguagesValue = (value: string[]) => {
    // Validate the Languages value and set value and errors accordingly
    setLanguages({value, errors: validateLanguages(value)});
  }

  const setLetterboxdLinkValue = (value: string) => {
    // Validate the LetterboxdLink value and set value and errors accordingly
    setLetterboxdLink({value, errors: validateLetterboxdLink(value)});
  }

  const setPlexLinkValue = (value: string) => {
    // Validate the PlexLink value and set value and errors accordingly
    setPlexLink({value, errors: validatePlexLink(value)});
  }

  const setReleaseDateValue = (value: string) => {
    // Validate the ReleaseDate value and set value and errors accordingly
    setReleaseDate({value, errors: validateReleaseDate(value)});
  }

  const setReleasesValue = (value: ReleasePreview[]) => {
    // Validate the Releases value and set value and errors accordingly
    setReleases({value, errors: validateReleases(value)});
  }

  const setRuntimeValue = (value: string) => {
    // Validate the Runtime value and set value and errors accordingly
    setRuntime({value, errors: validateRuntime(value)});
  }

  const setCastValue = (value: ActorPreview[]) => {
    // Validate the Cast value and set value and errors accordingly
    setCast({value, errors: validateCast(value)});
  }

  const setWritersValue = (value: string[]) => {
    // Validate the Writers value and set value and errors accordingly
    setWriters({value, errors: validateWriters(value)});
  }

  const setOmdbDataValue = (value: OmdbResponseFull | null) => {
    // Validate the OMDBData value and set value and errors accordingly
    setOmdbData({value, errors: []}); // Assuming no validation needed for OMDB data
  }

  const setOmdbResultsValue = (value: OmdbSearchResponse[]) => {
    // Validate the OMDBResults value and set value and errors accordingly
    setOmdbResults({value, errors: []}); // Assuming no validation needed for OMDB results
  }

  const setRatingsValue = (value: RatingEntry[]) => {
    // Validate the Ratings value and set value and errors accordingly
    setRatings({value, errors: validateRatings(value)});
  }

  const setImdbIdValue = (value: string) => {
    // Validate the IMDBId value and set value and errors accordingly
    setImdbId({value, errors: validateImdbId(value)});
  }

  const setCertificationValue = (value: string) => {
    // Validate the Certification value and set value and errors accordingly
    setCertification({value, errors: validateCertification(value)});
  }

  const setPlotValue = (value: string) => {
    // Validate the Plot value and set value and errors accordingly
    setPlot({value, errors: validatePlot(value)});
  }

  const clearAll = () => {
    // Clear all state values and errors
    setId({value: '', errors: []});
    setTitle({value: '', errors: []});
    setCountries({value: [], errors: []});
    setDirectors({value: [], errors: []});
    setGenres({value: [], errors: []});
    setImageFiles({value: [], errors: []});
    setLanguages({value: [], errors: []});
    setLetterboxdLink({value: '', errors: []});
    setPlexLink({value: '', errors: []});
    setReleaseDate({value: '', errors: []});
    setReleases({value: [], errors: []});
    setRuntime({value: '', errors: []});
    setCast({value: [], errors: []});
    setWriters({value: [], errors: []});
    setOmdbData({value: null, errors: []});
    setOmdbResults({value: [], errors: []});
    setRatings({value: [], errors: []});
    setImdbId({value: '', errors: []});
    setCertification({value: '', errors: []});
    setPlot({value: '', errors: []});
  }

  return { 
    loading, setLoading,
    error, setError,
    id, setId,
    title, setTitleValue,
    countries, setCountriesValue,
    directors, setDirectorsValue,
    genres, setGenresValue,
    imageFiles, setImageFilesValue,
    languages, setLanguagesValue,
    letterboxdLink, setLetterboxdLinkValue,
    plexLink, setPlexLinkValue,
    releaseDate, setReleaseDateValue,
    releases, setReleasesValue,
    runtime, setRuntimeValue,
    cast, setCastValue,
    writers, setWritersValue,
    omdbData, setOmdbDataValue,
    omdbResults, setOmdbResultsValue,
    ratings, setRatingsValue,
    imdbId, setImdbIdValue,
    certification, setCertificationValue,
    plot, setPlotValue,
    clearAll,
   };
};

export default useAddMovie;