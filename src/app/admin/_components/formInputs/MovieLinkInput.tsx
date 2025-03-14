import React from 'react';
import Grid from '@mui/material/Grid2';
import Divider from '@mui/material/Divider';
import FormTextField from './FormTextField';

interface MovieLinkInputProps {
  letterboxdLink: string;
  setLetterboxdLink: (value: string) => void;
  plexLink: string;
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
          value={letterboxdLink}
          required={false}
          onChange={(e) => setLetterboxdLink(e.target.value)}
        />
      </Grid>
      <Grid size={6}>
        <FormTextField
          label="Plex Link"
          value={plexLink}
          required={false}
          onChange={(e) => setPlexLink(e.target.value)}
        />
      </Grid>
    </>
  );
};

export default MovieLinkInput;