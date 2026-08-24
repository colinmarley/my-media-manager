import React from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import NestedEpisodeEditor, { EpisodeEntry } from './NestedEpisodeEditor';

export interface SeasonEntry {
  id: string;
  title: string;
  number: number;
  episodes: EpisodeEntry[];
}

interface NestedSeasonEditorProps {
  seasons: SeasonEntry[];
  onChange: (seasons: SeasonEntry[]) => void;
  error?: string | null;
}

const emptySeason = (): SeasonEntry => ({ id: '', title: '', number: 0, episodes: [] });

const NestedSeasonEditor: React.FC<NestedSeasonEditorProps> = ({ seasons, onChange, error }) => {
  const handleAdd = () => {
    onChange([...seasons, emptySeason()]);
  };

  const handleRemove = (index: number) => {
    onChange(seasons.filter((_, i) => i !== index));
  };

  const handleFieldChange = (
    index: number,
    field: keyof SeasonEntry,
    value: string | number | EpisodeEntry[],
  ) => {
    const updated = [...seasons];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <Stack spacing={2}>
      {seasons.length === 0 && (
        <Typography variant="body2" color="rgba(255,255,255,0.5)">
          No seasons added yet.
        </Typography>
      )}
      {seasons.map((season, index) => (
        <Box
          key={index}
          sx={{ p: 2, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 1 }}
        >
          <Grid container spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Grid size={2}>
              <TextField
                label="Season #"
                type="number"
                value={season.number}
                onChange={(e) =>
                  handleFieldChange(index, 'number', parseInt(e.target.value) || 0)
                }
                size="small"
                fullWidth
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={8}>
              <TextField
                label="Season Title"
                value={season.title}
                onChange={(e) => handleFieldChange(index, 'title', e.target.value)}
                size="small"
                fullWidth
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
          <Typography
            variant="subtitle2"
            color="rgba(255,255,255,0.7)"
            sx={{ mb: 1 }}
          >
            Episodes
          </Typography>
          <NestedEpisodeEditor
            episodes={season.episodes}
            onChange={(eps) => handleFieldChange(index, 'episodes', eps)}
          />
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
        data-testid="add-season-btn"
      >
        Add Season
      </Button>
    </Stack>
  );
};

export default NestedSeasonEditor;
