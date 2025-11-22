import React, { useState } from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { ActorPreview } from '@/types/collections/Common.type';
import { Button, TextField, Box, Autocomplete } from '@mui/material';
import Grid from '@mui/material/Grid2';
import useFormStore from '@/store/useFormStore';
import CastInput from './CastInput';

interface CastDataGridProps {
  castList: ActorPreview[];
  onAddCastMember: (newMember: ActorPreview) => void;
  setShowModal: (show: boolean, callback?: () => void) => void;
}

const CastDataGrid: React.FC<CastDataGridProps> = ({ castList, onAddCastMember }) => {
  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'actorId', headerName: 'Actor ID', width: 200 },
    { field: 'characters', headerName: 'Characters', width: 300, valueGetter: (value, row) => row.characters.join(', ') },
  ];

  return (
    <Box>
      <DataGrid
        rows={castList.map((actor, index) => ({ id: index, ...actor }))}
        columns={columns}
        disableRowSelectionOnClick
      />
      <CastInput
        castList={castList}
        onAddCastMember={onAddCastMember} />
    </Box>
  );
};

export default CastDataGrid;