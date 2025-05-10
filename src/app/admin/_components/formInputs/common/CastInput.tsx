import React from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import { ActorPreview } from '@/types/collections/Common.type';
import { FormInputData } from '@/types/inputs/FormInput.type';

interface CastInputProps {
  cast: FormInputData<ActorPreview[]>;
  setCast: (cast: ActorPreview[]) => void;
}

const CastInput: React.FC<CastInputProps> = ({ cast, setCast }) => {
  const handleActorChange = (index: number, value: string) => {
    const newCast = [...cast?.value];
    newCast[index].name = value;
    setCast(newCast);
  };

  const handleCharactersChange = (index: number, value: string) => {
    const newCast = [...cast?.value];
    value.split(", ").map((val: string) => { return newCast[index].characters.push(val) });
    setCast(newCast);
  };

  const handleAddCast = () => {
    setCast([...cast?.value, { name: '', characters: [], actorId: ''}]);
  };

  return (
    <Grid size={5}>
        <Grid container spacing={2}>
            {cast?.value.map((entry, index) => (
                <React.Fragment key={index}>
                <Grid size={6}>
                    <TextField
                    label={`Actor ${index + 1}`}
                    value={entry.name}
                    onChange={(e) => handleActorChange(index, e.target.value)}
                    fullWidth
                    required
                    error={cast?.errors.length > 0}
                    helperText={cast?.errors.join('\n')}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                <Grid size={6}>
                    <TextField
                    label={`Characters ${index + 1}`}
                    value={entry.characters.forEach((val: string) => { return val + ", " })}
                    onChange={(e) => handleCharactersChange(index, e.target.value)}
                    fullWidth
                    required
                    error={cast?.errors.length > 0}
                    helperText={cast?.errors.join('\n')}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                </React.Fragment>
            ))}
            <Grid size={12}>
                <Button onClick={handleAddCast} variant="contained" color="primary">
                Add  Cast
                </Button>
            </Grid>
        </Grid>
    </Grid>
  );
};

export default CastInput;