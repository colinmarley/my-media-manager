import React, { useState } from 'react';
import { TextField, Button, Autocomplete } from '@mui/material';
import Grid from '@mui/material/Grid';
import { MovieDirector } from '@/types/collections/Common.type';
import useFormStore from '@/store/useFormStore';

interface DirectorInputProps {
  onAddDirector: (newDirector: MovieDirector) => void;
}

const InitialMovieDirector: MovieDirector = {
  directorId: '',
  name: '',
  title: '',
};

const DirectorInput: React.FC<DirectorInputProps> = ({ onAddDirector }) => {
  const { directorOptions, openAddDirectorModal, refreshDirectorOptions } = useFormStore();
  const [newDirector, setNewDirector] = useState<MovieDirector>(InitialMovieDirector);

  React.useEffect(() => {
    void refreshDirectorOptions();
  }, [refreshDirectorOptions]);

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
        <Autocomplete
          options={directorOptions}
          getOptionLabel={(option) => option.label || ''}
          onChange={(event, value) => {
            if (value) {
              if (value.id === 'new') {
                openAddDirectorModal();
              } else {
                setNewDirector({ ...newDirector, name: value.label, directorId: value.id });
              }
            }
          }}
          renderInput={(params) => (
            <TextField {...params} label="Name" fullWidth />
          )}
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