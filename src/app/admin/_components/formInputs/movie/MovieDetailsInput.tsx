import React from 'react';
import Grid from '@mui/material/Grid2';
import Divider from '@mui/material/Divider';
import FormTextField from '../FormTextField';

interface MovieDetailsInputProps {
  year: string;
  setYear: (value: string) => void;
  releaseDate: string;
  setReleaseDate: (value: string) => void;
  countryOfOrigin: string;
  setCountryOfOrigin: (value: string) => void;
  runtime: string;
  setRuntime: (value: string) => void;
  genres: string[];
  setGenres: (value: string[]) => void;
  language: string;
  setLanguage: (value: string) => void;
  boxOffice: string;
  setBoxOffice: (value: string) => void;
  rated: string;
  setRated: (value: string) => void;
  awards: string;
  setAwards: (value: string) => void;
  errors: {
    year: string | null;
    releaseDate: string | null;
    countryOfOrigin: string | null;
    runtime: string | null;
    genres: string | null;
    language: string | null;
    rated: string | null;
    awards: string | null;
  };
}

const MovieDetailsInput: React.FC<MovieDetailsInputProps> = ({
  year,
  setYear,
  releaseDate,
  setReleaseDate,
  countryOfOrigin,
  setCountryOfOrigin,
  runtime,
  setRuntime,
  genres,
  setGenres,
  language,
  setLanguage,
  boxOffice,
  setBoxOffice,
  rated,
  setRated,
  awards,
  setAwards,
  errors,
}) => {
  return (
    <>
      <Grid size={12}>
        <Divider sx={{ color: 'white' }} variant="fullWidth">
          Movie Details
        </Divider>
      </Grid>
      <Grid size={3} color={'white'}>
        <FormTextField
          label="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          error={errors.year}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Release Date"
          value={releaseDate}
          onChange={(e) => setReleaseDate(e.target.value)}
          error={errors.releaseDate}
        />
      </Grid>
      <Grid size={3} color={'white'}>
        <FormTextField
          label="Country of Origin"
          value={countryOfOrigin}
          onChange={(e) => setCountryOfOrigin(e.target.value)}
          error={errors.countryOfOrigin}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Runtime"
          value={runtime}
          onChange={(e) => setRuntime(e.target.value)}
          error={errors.runtime}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Genres"
          value={genres.join(', ')}
          onChange={(e) => setGenres(e.target.value.split(', '))}
          error={errors.genres}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          error={errors.language}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Box Office"
          value={boxOffice}
          required={false}
          onChange={(e) => setBoxOffice(e.target.value)}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Rated"
          value={rated}
          onChange={(e) => setRated(e.target.value)}
          error={errors.rated}
        />
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Awards"
          value={awards}
          onChange={(e) => setAwards(e.target.value)}
          error={errors.awards}
        />
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          error={errors.language}
        />
      </Grid>
    </>
  );
};

export default MovieDetailsInput;