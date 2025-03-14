import React from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';

interface TopCastEntry {
  actor: string;
  characters: string[];
}

interface TopCastInputProps {
  topCast: TopCastEntry[];
  setTopCast: (topCast: TopCastEntry[]) => void;
  error?: string | null;
}

const TopCastInput: React.FC<TopCastInputProps> = ({ topCast, setTopCast, error }) => {
  const handleActorChange = (index: number, value: string) => {
    const newTopCast = [...topCast];
    newTopCast[index].actor = value;
    setTopCast(newTopCast);
  };

  const handleCharactersChange = (index: number, value: string) => {
    const newTopCast = [...topCast];
    value.split(", ").map((val: string) => { return newTopCast[index].characters.push(val) });
    setTopCast(newTopCast);
  };

  const handleAddTopCast = () => {
    setTopCast([...topCast, { actor: '', characters: [] }]);
  };

  return (
    <Grid size={5}>
        <Grid container spacing={2}>
            {topCast.map((entry, index) => (
                <React.Fragment key={index}>
                <Grid size={6}>
                    <TextField
                    label={`Actor ${index + 1}`}
                    value={entry.actor}
                    onChange={(e) => handleActorChange(index, e.target.value)}
                    fullWidth
                    required
                    error={!!error}
                    helperText={error}
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
                    error={!!error}
                    helperText={error}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                </React.Fragment>
            ))}
            <Grid size={12}>
                <Button onClick={handleAddTopCast} variant="contained" color="primary">
                Add Top Cast
                </Button>
            </Grid>
        </Grid>
    </Grid>
  );
};

export default TopCastInput;