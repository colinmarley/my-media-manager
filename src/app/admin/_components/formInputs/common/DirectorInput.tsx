import React, { useState } from 'react';
import { TextField, Button } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { MovieDirector } from '@/types/collections/Common.type';

interface DirectorInputProps {
  onAddDirector: (newDirector: MovieDirector) => void;
}

const InitialMovieDirector: MovieDirector = {
  directorId: '',
  name: '',
  title: '',
};

const DirectorInput: React.FC<DirectorInputProps> = ({ onAddDirector }) => {
  const [newDirector, setNewDirector] = useState<MovieDirector>(InitialMovieDirector);

  const resetNewDirectorFields = () => {
    setNewDirector(InitialMovieDirector);
  }

  const handleAddDirector = () => {
    if (newDirector.name && newDirector.directorId) {
      const directorToAdd: MovieDirector = {
        ...newDirector,
        title: newDirector.title || "Director",
      };
    
      onAddDirector(directorToAdd);
      resetNewDirectorFields();
    } else {
      alert('Please fill out all fields before adding a new director.');
    }
  };

  return (
    <Grid container spacing={2}>
      <Grid size={4}>
        <TextField
          label="Name"
          value={newDirector.name}
          onChange={(e) => setNewDirector({ ...newDirector, name: e.target.value })}
          fullWidth
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label="Title"
          value={newDirector.title}
          onChange={(e) => setNewDirector({ ...newDirector, title: e.target.value })}
          fullWidth
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label="Director ID"
          value={newDirector.directorId}
          onChange={(e) => setNewDirector({ ...newDirector, directorId: e.target.value })}
          fullWidth
        />
      </Grid>
      <Grid size={12}>
        <Button variant="contained" color="primary" onClick={handleAddDirector}>
          Add Director
        </Button>
      </Grid>
    </Grid>
  );
};

export default DirectorInput;