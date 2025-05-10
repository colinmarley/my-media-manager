import React from 'react';
import Grid from '@mui/material/Grid2';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { FormInputData } from '@/types/inputs/FormInput.type';

interface WritersInputProps {
  writers: FormInputData<string[]>;
  setWriters: (writers: string[]) => void;
}

const WritersInput: React.FC<WritersInputProps> = ({ writers, setWriters }) => {
  const handleWriterChange = (index: number, value: string) => {
    const newWriters = [...writers?.value];
    newWriters[index] = value;
    setWriters(newWriters);
  };

  const handleAddWriter = () => {
    setWriters([...writers?.value, '']);
  };

  return (
    <Grid size={3}>
        <Grid container spacing={2}>
            {writers?.value.map((writer, index) => (
                <Grid size={12} key={index}>
                <TextField
                    label={`Writer ${index + 1}`}
                    value={writer}
                    onChange={(e) => handleWriterChange(index, e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    required
                    error={writers?.errors.length > 0}
                    helperText={writers?.errors.join('\n')}
                />
                </Grid>
            ))}
            <Grid size={12}>
                <Button onClick={handleAddWriter} variant="contained" color="primary">
                Add Writer
                </Button>
            </Grid>
        </Grid>
    </Grid>
  );
};

export default WritersInput;