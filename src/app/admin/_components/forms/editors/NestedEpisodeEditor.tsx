import React from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';

export interface EpisodeEntry {
  id: string;
  title: string;
  number: number;
  runtime: string;
}

interface NestedEpisodeEditorProps {
  episodes: EpisodeEntry[];
  onChange: (episodes: EpisodeEntry[]) => void;
  error?: string | null;
}

const emptyEpisode = (): EpisodeEntry => ({ id: '', title: '', number: 0, runtime: '' });

const NestedEpisodeEditor: React.FC<NestedEpisodeEditorProps> = ({ episodes, onChange, error }) => {
  const handleAdd = () => {
    onChange([...episodes, emptyEpisode()]);
  };

  const handleRemove = (index: number) => {
    onChange(episodes.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof EpisodeEntry, value: string | number) => {
    const updated = [...episodes];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <Stack spacing={1.5}>
      {episodes.length === 0 && (
        <Typography variant="body2" color="rgba(255,255,255,0.5)">
          No episodes added yet.
        </Typography>
      )}
      {episodes.map((ep, index) => (
        <Box
          key={index}
          sx={{ p: 1.5, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 1 }}
        >
          <Grid container spacing={1.5} alignItems="center">
            <Grid size={2}>
              <TextField
                label="Ep #"
                type="number"
                value={ep.number}
                onChange={(e) => handleChange(index, 'number', parseInt(e.target.value) || 0)}
                size="small"
                fullWidth
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={5}>
              <TextField
                label="Title"
                value={ep.title}
                onChange={(e) => handleChange(index, 'title', e.target.value)}
                size="small"
                fullWidth
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={3}>
              <TextField
                label="Runtime"
                value={ep.runtime}
                onChange={(e) => handleChange(index, 'runtime', e.target.value)}
                size="small"
                fullWidth
                placeholder="h:mm:ss"
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={2}>
              <Button
                onClick={() => handleRemove(index)}
                color="error"
                size="small"
                variant="outlined"
              >
                Remove
              </Button>
            </Grid>
          </Grid>
        </Box>
      ))}
      {error && (
        <Typography variant="body2" color="error">{error}</Typography>
      )}
      <Button
        onClick={handleAdd}
        variant="outlined"
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="add-episode-btn"
      >
        Add Episode
      </Button>
    </Stack>
  );
};

export default NestedEpisodeEditor;
