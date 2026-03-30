import React from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import { Extra } from '../../../../../types/firebase/FBRelease.type';

interface NestedExtrasEditorProps {
  extras: Extra[];
  onChange: (extras: Extra[]) => void;
  error?: string | null;
}

const emptyExtra = (): Extra => ({ title: '', runtime: '', type: '' });

const NestedExtrasEditor: React.FC<NestedExtrasEditorProps> = ({ extras, onChange, error }) => {
  const handleAdd = () => {
    onChange([...extras, emptyExtra()]);
  };

  const handleRemove = (index: number) => {
    onChange(extras.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof Extra, value: string) => {
    const updated = [...extras];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <Stack spacing={1.5}>
      {extras.length === 0 && (
        <Typography variant="body2" color="rgba(255,255,255,0.5)">
          No extras added yet.
        </Typography>
      )}
      {extras.map((extra, index) => (
        <Box
          key={index}
          sx={{ p: 1.5, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 1 }}
        >
          <Grid container spacing={1.5} alignItems="center">
            <Grid size={4}>
              <TextField
                label="Title"
                value={extra.title}
                onChange={(e) => handleChange(index, 'title', e.target.value)}
                size="small"
                fullWidth
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={3}>
              <TextField
                label="Runtime"
                value={extra.runtime}
                onChange={(e) => handleChange(index, 'runtime', e.target.value)}
                size="small"
                fullWidth
                placeholder="h:mm:ss"
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
              />
            </Grid>
            <Grid size={3}>
              <TextField
                label="Type"
                value={extra.type}
                onChange={(e) => handleChange(index, 'type', e.target.value)}
                size="small"
                fullWidth
                placeholder="e.g. Featurette"
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
        data-testid="add-extra-btn"
      >
        Add Extra
      </Button>
    </Stack>
  );
};

export default NestedExtrasEditor;
