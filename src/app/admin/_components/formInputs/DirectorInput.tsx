import React from 'react';
import { Grid, Button } from '@mui/material';
import FormTextField from './FormTextField';
import { Director } from '../../../../types/firebase/FBMovie.type';

interface DirectorInputProps {
  directors: Director[];
  handleDirectorChange: (index: number, field: keyof Director, value: string) => void;
  handleAddDirector: () => void;
}

const DirectorInput: React.FC<DirectorInputProps> = ({ directors, handleDirectorChange, handleAddDirector }) => {
  return (
    <Grid item xs={12}>
      {directors.map((director, index) => (
        <Grid container spacing={2} key={index}>
          <Grid item xs={6}>
            <FormTextField label="Name" value={director.name} onChange={(e) => handleDirectorChange(index, 'name', e.target.value)} />
          </Grid>
          <Grid item xs={6}>
            <FormTextField label="Title" value={director.title} onChange={(e) => handleDirectorChange(index, 'title', e.target.value)} />
          </Grid>
        </Grid>
      ))}
      <Button onClick={handleAddDirector}>Add Director</Button>
    </Grid>
  );
};

export default DirectorInput;