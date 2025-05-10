import React from 'react';
import Grid from '@mui/material/Grid2';
import Divider from '@mui/material/Divider';
import { FormTextField } from '../common/FormTextField';
import { FormInputData } from '@/types/inputs/FormInput.type';

interface MovieLinkInputProps {
  letterboxdLink: FormInputData<string>;
  setLetterboxdLink: (value: string) => void;
  plexLink: FormInputData<string>;
  setPlexLink: (value: string) => void;
}

const MovieLinkInput: React.FC<MovieLinkInputProps> = ({
  letterboxdLink,
  setLetterboxdLink,
  plexLink,
  setPlexLink,
}) => {
  return (
    <>
      <Grid size={12}>
        <Divider sx={{ color: 'white' }} variant="fullWidth">
          Links
        </Divider>
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Letterboxd Link"
          value={letterboxdLink?.value || ''}
          required={false}
          onChange={(e) => setLetterboxdLink(e.target.value)}
          error={letterboxdLink?.errors.join('\n') || null}
        />
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Plex Link"
          value={plexLink?.value || ''}
          required={false}
          onChange={(e) => setPlexLink(e.target.value)}
          error={plexLink?.errors.join('\n') || null}
        />
      </Grid>
    </>
  );
};

export default MovieLinkInput;