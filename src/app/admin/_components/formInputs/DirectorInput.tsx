import React from 'react';
import Grid from '@mui/material/Grid2';
import Button from '@mui/material/Button';
import { FormTextField } from './common/FormTextField';
import { FormInputData } from '@/types/inputs/FormInput.type';
import { EpisodeDirector, MovieDirector, SeasonDirector, SeriesDirector } from '@/types/collections/Common.type';

type DirectorEntry = MovieDirector | SeriesDirector | SeasonDirector | EpisodeDirector;

interface DirectorInputProps {
  directors: FormInputData<DirectorEntry[]>;
  handleDirectorChange: (index: number, field: keyof DirectorEntry, value: string) => void;
  handleAddDirector: () => void;
  setShowModal: (show: boolean) => void;
}

const DirectorInput: React.FC<DirectorInputProps> = ({
  directors,
  handleDirectorChange,
  handleAddDirector,
  setShowModal
}) => {

  const getErrorString = (
    index: number,
    field: keyof DirectorEntry,
    errors: string[]
  ): string | null => {
    const filteredErrors = errors.filter(err => err.startsWith(`${index}:${field}`));
    return filteredErrors.length > 0 ? filteredErrors.map(filErr => filErr.split(":")[2]).join('\n') : null;
  }

  return (
    <Grid size={3}>
      {directors?.value.map((director, index) => (
        <Grid container spacing={2} key={index}>
          <Grid size={4}>
            <FormTextField
              label="Name"
              value={director.name}
              onChange={(e) => handleDirectorChange(index, 'name', e.target.value)}
              error={getErrorString(index, "name", directors?.errors)}
              required={true}
                />
          </Grid>
          <Grid size={4}>
            <FormTextField
              label="Title"
              value={director.title}
              onChange={(e) => handleDirectorChange(index, 'title', e.target.value)}
              error={getErrorString(index, "title", directors?.errors)} />
          </Grid>
          <Grid size={4}>
            <FormTextField
              label="directorId"
              value={director.directorId}
              onChange={(e) => handleDirectorChange(index, 'directorId', e.target.value)}
              error={getErrorString(index, "directorId", directors?.errors)} />
          </Grid>
        </Grid>
      ))}
      <Button onClick={handleAddDirector}>Add Director</Button>
      <Button onClick={() => setShowModal(true)}>Add Director Modal</Button>
    </Grid>
  );
};

export default DirectorInput;