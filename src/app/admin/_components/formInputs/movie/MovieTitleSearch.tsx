import React from 'react';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { FormTextField } from '../common/FormTextField';
import MovieSearchResults from './MovieSearchResults';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import { FormInputData } from '@/types/inputs/FormInput.type'; 

interface MovieTitleSearchProps {
  title: FormInputData<string>;
  setTitle: (title: string) => void;
  omdbResults: OmdbSearchResponse[];
  handleMovieTitleSearch: (title: string) => void;
  handleMovieSelect: (title: string, year: string, imdbId: string) => void;
}

const MovieTitleSearch: React.FC<MovieTitleSearchProps> = ({
  title,
  setTitle,
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
          value={title?.value || ''}
          onChange={(e) => setTitle(e.target.value)}
          error={title?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3}>
        <Button
          onClick={() => handleMovieTitleSearch(title?.value || '')}
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