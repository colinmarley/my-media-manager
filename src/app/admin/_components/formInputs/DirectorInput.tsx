import React from 'react';
import Grid from '@mui/material/Grid2';
import Button from '@mui/material/Button';
import FormTextField from './FormTextField';
import { Director } from '../../../../types/firebase/FBMovie.type';

interface DirectorInputProps {
  directors: Director[];
  handleDirectorChange: (index: number, field: keyof Director, value: string) => void;
  handleAddDirector: () => void;
}

const DirectorInput: React.FC<DirectorInputProps> = ({ directors, handleDirectorChange, handleAddDirector }) => {
  return (
    <Grid size={3}>
      {directors.map((director, index) => (
        <Grid container spacing={2} key={index}>
          <Grid size={6}>
            <FormTextField label="Name" value={director.name} onChange={(e) => handleDirectorChange(index, 'name', e.target.value)} />
          </Grid>
          <Grid size={6}>
            <FormTextField label="Title" value={director.title} onChange={(e) => handleDirectorChange(index, 'title', e.target.value)} />
          </Grid>
        </Grid>
      ))}
      <Button onClick={handleAddDirector}>Add Director</Button>
    </Grid>
  );
};

export default DirectorInput;