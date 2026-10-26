'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { api } from '@/service/api/apiClient';

// Shape returned by the backend's read-only ripper proxy (GET /api/ripper/jobs).
interface RipperJobSummary {
  id: string;
  title: string | null;
  status: string;
  active: boolean;
  progress: number;
  error: string | null;
  fileCount: number;
  updatedAt: string | null;
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'found'; job: RipperJobSummary }
  | { kind: 'not-found' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

function statusColor(job: RipperJobSummary): 'info' | 'success' | 'error' | 'default' {
  if (job.active) return 'info';
  if (job.status === 'done') return 'success';
  if (job.status === 'failed') return 'error';
  return 'default';
}

export default function DiscRipStatusPanel({ discId }: { discId: string }) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api.get<{ jobs: RipperJobSummary[] }>(
      `/api/ripper/jobs?catalogDiscId=${encodeURIComponent(discId)}&limit=1`,
    )
      .then((data) => {
        if (cancelled) return;
        const job = data?.jobs?.[0];
        setState(job ? { kind: 'found', job } : { kind: 'not-found' });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Unknown error';
        // The proxy answers 503 when the ripper service isn't running.
        setState(message.startsWith('API error 503') ? { kind: 'unavailable' } : { kind: 'error', message });
      });
    return () => { cancelled = true; };
  }, [discId]);

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Rip Status</Typography>
      {state.kind === 'loading' && <CircularProgress size={20} />}
      {state.kind === 'not-found' && (
        <Typography variant="body2" color="text.secondary">No rip job for this disc yet.</Typography>
      )}
      {state.kind === 'unavailable' && (
        <Alert severity="info">The disc ripper is unavailable right now, so rip status can&apos;t be shown.</Alert>
      )}
      {state.kind === 'error' && (
        <Alert severity="warning">Couldn&apos;t load rip status: {state.message}</Alert>
      )}
      {state.kind === 'found' && (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Chip label={state.job.status} size="small" color={statusColor(state.job)} />
            {state.job.active && (
              <Typography variant="body2" color="text.secondary">
                {Math.round(state.job.progress)}%
              </Typography>
            )}
            {!state.job.active && state.job.fileCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {state.job.fileCount} file{state.job.fileCount === 1 ? '' : 's'}
              </Typography>
            )}
          </Stack>
          {state.job.active && (
            <LinearProgress variant="determinate" value={Math.min(100, Math.max(0, state.job.progress))} />
          )}
          {state.job.error && (
            <Alert severity="error" sx={{ mt: 1 }}>{state.job.error}</Alert>
          )}
        </Box>
      )}
    </Paper>
  );
}
