import React from 'react';
import Grid from '@mui/material/Grid';
import Divider from '@mui/material/Divider';
import { FormTextField } from '../common/FormTextField';
import { FormInputData } from '@/types/inputs/FormInput.type';
import { Typography } from '@mui/material';

interface MovieDetailsInputProps {
  releaseDate: FormInputData<string>;
  setReleaseDate: (value: string) => void;
  countries: FormInputData<string[]>;
  setCountries: (value: string[]) => void;
  runtime: FormInputData<string>;
  setRuntime: (value: string) => void;
  genres: FormInputData<string[]>;
  setGenres: (value: string[]) => void;
  languages: FormInputData<string[]>;
  setLanguages: (value: string[]) => void;
  certification: FormInputData<string>;
  setCertification: (value: string) => void;
}

const MovieDetailsInput: React.FC<MovieDetailsInputProps> = ({
  releaseDate,
  setReleaseDate,
  countries,
  setCountries,
  runtime,
  setRuntime,
  genres,
  setGenres,
  languages,
  setLanguages,
  certification,
  setCertification,
}) => {

  const year = releaseDate.value.split('-')[2]; // Extract year from release date

  return (
    <>
      <Grid size={12}>
        <Divider sx={{ color: 'white' }} variant="fullWidth">
          Movie Details
        </Divider>
      </Grid>
      <Grid size={3} color={'white'}>
        <Typography variant="h6" color="white">
          Year: {year}
        </Typography>
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Release Date"
          value={releaseDate?.value}
          onChange={(e) => setReleaseDate(e.target.value)}
          error={releaseDate?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3} color={'white'}>
        <FormTextField
          label="Country of Origin"
          value={countries?.value.join(', ')}
          onChange={(e) => setCountries(e.target.value.split(',').map((val) => val.trim()))}
          error={countries?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Runtime"
          value={runtime?.value}
          onChange={(e) => setRuntime(e.target.value)}
          error={runtime?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Genres"
          value={genres?.value.join(', ')}
          onChange={(e) => setGenres(e.target.value.split(', '))}
          error={genres?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Language"
          value={languages?.value.join(', ')}
          onChange={(e) => setLanguages(e.target.value.split(',').map((val) => val.trim()))}
          error={languages?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={3}>
        <FormTextField
          label="Certification"
          value={certification?.value || ''}  
          onChange={(e) => setCertification(e.target.value)}
          error={certification?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Language"
          value={languages?.value.join(', ')}
          onChange={(e) => setLanguages(e.target.value.split(',').map((val) => val.trim()))}
          error={languages.errors.join('\n') || null}
        />
      </Grid>
    </>
  );
};

export default MovieDetailsInput;