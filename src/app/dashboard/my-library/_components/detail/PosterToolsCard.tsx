import { Alert, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';

import styles from './mediaDetailStyles';

interface Props {
  posterSourceInput: string;
  onPosterSourceInputChange: (value: string) => void;
  posterSourceSaving: boolean;
  posterSourceStatus: { type: 'success' | 'error'; message: string } | null;
  hasPosterSource: boolean;
  onSavePosterSource: () => void;
}

/** Poster source editor: paste a direct image URL to fetch and cache a poster for this title. */
const PosterToolsCard = ({
  posterSourceInput,
  onPosterSourceInputChange,
  posterSourceSaving,
  posterSourceStatus,
  hasPosterSource,
  onSavePosterSource,
}: Props) => (
  <Paper sx={{ ...styles.sectionCard, mb: 2.5 }}>
    <Typography variant="h6" sx={styles.sectionTitle}>
      Poster Tools
    </Typography>
    <Alert severity={hasPosterSource ? 'info' : 'warning'} sx={{ mb: 1.5 }}>
      {hasPosterSource
        ? 'Paste a new poster URL here to replace the current source and refresh the cache.'
        : 'No poster source is set yet. Paste a direct image URL here to fetch and cache one for this title.'}
    </Alert>
    <Stack spacing={1.25}>
      <TextField
        fullWidth
        size="small"
        label="Poster image URL"
        value={posterSourceInput}
        onChange={(e) => onPosterSourceInputChange(e.target.value)}
        placeholder="https://example.com/poster.jpg"
        disabled={posterSourceSaving}
        sx={styles.posterSourceInput}
      />
      <Button
        variant="contained"
        onClick={onSavePosterSource}
        disabled={posterSourceSaving || !posterSourceInput.trim()}
        sx={{ alignSelf: 'flex-start' }}
      >
        {posterSourceSaving ? <CircularProgress size={18} color="inherit" /> : 'Save Poster Source'}
      </Button>
      {posterSourceStatus && (
        <Alert severity={posterSourceStatus.type}>{posterSourceStatus.message}</Alert>
      )}
    </Stack>
  </Paper>
);

export default PosterToolsCard;
