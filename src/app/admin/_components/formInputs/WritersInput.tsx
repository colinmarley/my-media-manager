import React from 'react';
import Grid from '@mui/material/Grid2';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';

interface WritersInputProps {
  writers: string[];
  setWriters: (writers: string[]) => void;
  error?: string | null;
}

const WritersInput: React.FC<WritersInputProps> = ({ writers, setWriters, error }) => {
  const handleWriterChange = (index: number, value: string) => {
    const newWriters = [...writers];
    newWriters[index] = value;
    setWriters(newWriters);
  };

  const handleAddWriter = () => {
    setWriters([...writers, '']);
  };

  return (
    <Grid size={3}>
        <Grid container spacing={2}>
            {writers.map((writer, index) => (
                <Grid size={12} key={index}>
                <TextField
                    label={`Writer ${index + 1}`}
                    value={writer}
                    onChange={(e) => handleWriterChange(index, e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    required
                    error={!!error}
                    helperText={error}
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