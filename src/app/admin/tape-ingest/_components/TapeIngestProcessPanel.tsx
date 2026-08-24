'use client';
import React from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, LinearProgress, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Info as InfoIcon, PlayArrow as ProcessIcon } from '@mui/icons-material';
import { useTapeIngestStore } from '@/store/useTapeIngestStore';

export default function TapeIngestProcessPanel() {
  const { items, tapeType, destinationBase, applyFfmpeg, processStatus, setDestinationBase, setApplyFfmpeg, processAll } = useTapeIngestStore();

  const movies = items.filter((i) => i.contentType === 'movie');
  const tvShows = items.filter((i) => i.contentType === 'tv_show');
  const homeVideos = items.filter((i) => i.contentType === 'home_video');
  const trailers = items.filter((i) => i.contentType === 'trailer');
  const commercials = items.filter((i) => i.contentType === 'commercial');
  const skipped = items.filter((i) => i.contentType === 'skip');
  const unclassified = items.filter((i) => i.contentType === 'unclassified');

  const isRunning = processStatus?.overallStatus === 'running';
  const isDone = processStatus?.overallStatus === 'completed' || processStatus?.overallStatus === 'failed';
  const processableCount = movies.length + tvShows.length + homeVideos.length + trailers.length + commercials.length;
  const isVhsFamily = tapeType === 'vhs' || tapeType === 'vhs_c';

  const statusColor = (s: string) => {
    if (s === 'completed') return 'success'; if (s === 'failed') return 'error';
    if (s === 'processing') return 'info'; if (s === 'skipped') return 'warning';
    return 'default';
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Step 3 — Process</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
        <Chip label={`${movies.length} movies`} color="primary" variant="outlined" />
        <Chip label={`${tvShows.length} TV episodes`} color="info" variant="outlined" />
        <Chip label={`${homeVideos.length} home videos`} color="success" variant="outlined" />
        <Chip label={`${trailers.length} trailers`} color="info" variant="outlined" />
        <Chip label={`${commercials.length} commercials`} color="info" variant="outlined" />
        <Chip label={`${skipped.length} skipped`} color="warning" variant="outlined" />
        {unclassified.length > 0 && <Chip label={`${unclassified.length} unclassified`} color="default" variant="outlined" />}
      </Stack>

      {unclassified.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {unclassified.length} file{unclassified.length !== 1 ? 's' : ''} still unclassified — they will be moved to <code>_NeedsReview</code>.
        </Alert>
      )}

      <TextField label="Destination Base Path" size="small" fullWidth value={destinationBase}
        onChange={(e) => setDestinationBase(e.target.value)} sx={{ mb: 2 }}
        helperText="Base path under which Movies/, TV Shows/, Home Videos/ etc. will be created" />

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <FormControlLabel control={
          <Switch checked={applyFfmpeg && isVhsFamily} disabled={tapeType === 'mini_dv'}
            onChange={(e) => setApplyFfmpeg(e.target.checked)} />
        } label="Apply VHS/VHS-C post-processing (deinterlace + denoise)" />
        <Tooltip title="Runs yadif deinterlace and hqdn3d denoise via FFmpeg before copying. ~1× realtime per file. Disabled for Mini DV.">
          <InfoIcon fontSize="small" color="action" />
        </Tooltip>
        {tapeType === 'mini_dv' && <Typography variant="caption" color="text.secondary">(disabled for Mini DV)</Typography>}
      </Stack>

      <Button variant="contained" size="large" startIcon={<ProcessIcon />} onClick={processAll}
        disabled={processableCount === 0 || isRunning}>
        {isRunning ? 'Processing…' : 'Process All'}
      </Button>

      {processStatus && (
        <Box sx={{ mt: 3 }}>
          {isRunning && <LinearProgress variant="determinate" value={(processStatus.completed / Math.max(processStatus.total, 1)) * 100} sx={{ mb: 1 }} />}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {processStatus.completed}/{processStatus.total} complete{processStatus.failed > 0 ? ` · ${processStatus.failed} failed` : ''}
          </Typography>
          <Stack spacing={0.5}>
            {processStatus.items.map((item) => (
              <Stack key={item.filePath} direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={item.status} color={statusColor(item.status) as 'success' | 'error' | 'info' | 'warning' | 'default'} />
                <Typography variant="caption" noWrap sx={{ flex: 1 }}>{item.fileName}</Typography>
                {item.error && <Tooltip title={item.error}><Typography variant="caption" color="error">error</Typography></Tooltip>}
              </Stack>
            ))}
          </Stack>
          {isDone && processStatus.failed === 0 && <Alert severity="success" sx={{ mt: 2 }}>All files processed. Refresh Jellyfin library to see new entries.</Alert>}
          {isDone && processStatus.failed > 0 && <Alert severity="error" sx={{ mt: 2 }}>{processStatus.failed} file{processStatus.failed !== 1 ? 's' : ''} failed. Check errors above.</Alert>}
        </Box>
      )}
    </Box>
  );
}
