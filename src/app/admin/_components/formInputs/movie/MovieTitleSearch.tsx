import React from 'react';
import Grid from '@mui/material/Grid2';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import FormTextField from '../FormTextField';
import MovieSearchResults from './MovieSearchResults';
import { OmdbSearchResponse } from '../../../../../types/OmdbResponse.type';

interface MovieTitleSearchProps {
  title: string;
  setTitle: (title: string) => void;
  errors: { title: string | null };
  omdbResults: OmdbSearchResponse[];
  handleMovieTitleSearch: (title: string) => void;
  handleMovieSelect: (title: string, year: string, imdbId: string) => void;
}

const MovieTitleSearch: React.FC<MovieTitleSearchProps> = ({
  title,
  setTitle,
  errors,
  omdbResults,
  handleMovieTitleSearch,
  handleMovieSelect,
}) => {
  return (
    <>
      <Grid size={12}>
        <Typography variant="h4" color="white">
          Add New Movie
        </Typography>
      </Grid>
      <Grid size={9}>
        <FormTextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
        />
      </Grid>
      <Grid size={3}>
        <Button
          onClick={() => handleMovieTitleSearch(title)}
          variant="contained"
          color="primary"
        >
          Search Movie Title
        </Button>
      </Grid>
      <MovieSearchResults
        omdbResults={omdbResults}
        handleMovieSelect={handleMovieSelect}
      />
    </>
  );
};

export default MovieTitleSearch;