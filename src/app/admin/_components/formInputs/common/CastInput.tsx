import React, { useState } from 'react';
import { Button, TextField, Box, Autocomplete } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { ActorPreview } from '@/types/collections/Common.type';
import useFormStore from '@/store/useFormStore';

interface CastInputProps {
  castList: ActorPreview[];
  onAddCastMember: (newMember: ActorPreview) => void;
}

const CastInput: React.FC<CastInputProps> = ({ castList, onAddCastMember }) => {
  const { actorOptions, openAddActorModal } = useFormStore();

  const [newActor, setNewActor] = useState<ActorPreview>({ name: '', actorId: '', characters: [] });

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
      <Grid container spacing={2}>
        <Grid size={4}>
          <Autocomplete
            options={actorOptions}
            getOptionLabel={(option) => option.label || ''}
            onChange={(event, value) => {
              if (value) {
                if (value.id === 'new') {
                  openAddActorModal();
                } else {
                  setNewActor({ ...newActor, name: value.label, actorId: value.id });
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
  );
};

export default CastInput;