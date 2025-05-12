import React, { useState } from 'react';
import { DataGrid, GridColDef, GridRowsProp } from '@mui/x-data-grid';
import { ActorPreview } from '@/types/collections/Common.type';
import { Button, TextField, Box } from '@mui/material';
import Grid from '@mui/material/Grid2';

interface CastDataGridProps {
  castList: ActorPreview[];
  onAddCastMember: (newMember: ActorPreview) => void;
  setShowModal: (show: boolean) => void;
}

const CastDataGrid: React.FC<CastDataGridProps> = ({ castList, onAddCastMember, setShowModal }) => {
  const [newActor, setNewActor] = useState<ActorPreview>({ name: '', actorId: '', characters: [] });

  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'actorId', headerName: 'Actor ID', width: 200 },
    { field: 'characters', headerName: 'Characters', width: 300, valueGetter: (value, row) => row.characters.join(', ') },
  ];

  const handleAddActor = () => {
    if (newActor.name && newActor.actorId && newActor.characters.length > 0) {
      onAddCastMember(newActor);
      setNewActor({ name: '', actorId: '', characters: [] });
    } else {
      alert('Please fill out all fields before adding a new actor.');
    }
  };

  return (
    <Box>
      <DataGrid
        rows={castList.map((actor, index) => ({ id: index, ...actor }))}
        columns={columns}
        disableRowSelectionOnClick
      />

      <Box mt={2}>
        <Grid container spacing={2}>
          <Grid size={4}>
            <TextField
              label="Name"
              value={newActor.name}
              onChange={(e) => setNewActor({ ...newActor, name: e.target.value })}
              fullWidth
            />
          </Grid>
          <Grid size={4}>
            <TextField
              label="Actor ID"
              value={newActor.actorId}
              onChange={(e) => setNewActor({ ...newActor, actorId: e.target.value })}
              fullWidth
            />
          </Grid>
          <Grid size={4}>
            <TextField
              label="Characters (comma-separated)"
              value={newActor.characters.join(', ')}
              onChange={(e) => setNewActor({ ...newActor, characters: e.target.value.split(',').map((char) => char.trim()) })}
              fullWidth
            />
          </Grid>
          <Grid size={12}>
            <Button variant="contained" color="primary" onClick={handleAddActor}>
              Add Actor
            </Button>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default CastDataGrid;