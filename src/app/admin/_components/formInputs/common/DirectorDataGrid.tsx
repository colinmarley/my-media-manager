import React, { useState } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { Button, TextField, Box, Autocomplete } from '@mui/material';
import Grid from '@mui/material/Grid2';
import useFormStore from '@/store/useFormStore';
import { Director } from '@/types/collections/Director.type';
import { EpisodeDirector, MovieDirector, SeasonDirector, SeriesDirector } from '@/types/collections/Common.type';
import DirectorInput from './DirectorInput';

type FormDirectorType = MovieDirector | SeriesDirector | SeasonDirector | EpisodeDirector

interface DirectorDataGridProps {
  directorList: FormDirectorType[];
  onAddDirector: (newDirector: FormDirectorType) => void;
}

const DirectorDataGrid: React.FC<DirectorDataGridProps> = ({ directorList, onAddDirector }) => {
  const columns: GridColDef[] = [
    { field: 'fullName', headerName: 'Name', width: 200 },
    { field: 'title', headerName: 'Title', width: 200 },
    { field: 'id', headerName: 'Director ID', width: 200 },
  ];

  return (
    <Box>
      <DataGrid
        rows={directorList.map((director, index) => ({ ...director, id: index }))}
        columns={columns}
        disableRowSelectionOnClick
      />

      <Box mt={2}>
        <DirectorInput onAddDirector={onAddDirector} />
      </Box>
    </Box>
  );
};

export default DirectorDataGrid;