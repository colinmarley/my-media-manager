import React from 'react';
import Grid from '@mui/material/Grid2';
import Divider from '@mui/material/Divider';
import FormTextField from './FormTextField';

interface MovieOptionalInputProps {
  dvd: string;
  setDvd: (value: string) => void;
  production: string;
  setProduction: (value: string) => void;
  totalSeasons: string;
  setTotalSeasons: (value: string) => void;
}

const MovieOptionalInput: React.FC<MovieOptionalInputProps> = ({
  dvd,
  setDvd,
  production,
  setProduction,
  totalSeasons,
  setTotalSeasons,
}) => {
  return (
    <>
      <Grid size={12}>
        <Divider sx={{ color: 'white' }} variant="fullWidth">
          Optional Details
        </Divider>
      </Grid>
      <Grid size={12}>
        <FormTextField
          label="DVD Release Date"
          value={dvd}
          required={false}
          onChange={(e) => setDvd(e.target.value)}
        />
      </Grid>
      <Grid size={12}>
        <FormTextField
          label="Production"
          value={production}
          required={false}
          onChange={(e) => setProduction(e.target.value)}
        />
      </Grid>
      <Grid size={12}>
        <FormTextField
          label="Total Seasons"
          value={totalSeasons}
          required={false}
          onChange={(e) => setTotalSeasons(e.target.value)}
        />
      </Grid>
    </>
  );
};

export default MovieOptionalInput;