'use client';

import React from 'react';
import { Box, Button, Card, CardContent, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import type { IngressWatcherStatus } from '@/service/ingress/IngressAutomationService';

type Props = {
  pathsInput: string;
  onPathsInputChange: (value: string) => void;
  processExistingOnStart: boolean;
  onProcessExistingOnStartChange: (value: boolean) => void;
  resetCompletedOnStart: boolean;
  onResetCompletedOnStartChange: (value: boolean) => void;
  working: boolean;
  watcher: IngressWatcherStatus | null;
  onOpenFolderBrowser: () => void;
  onStartWatcher: () => void;
  onStopWatcher: () => void;
  onProcessPending: () => void;
  onRefresh: () => void;
};

const IngressWatcherControlCard: React.FC<Props> = ({
  pathsInput,
  onPathsInputChange,
  processExistingOnStart,
  onProcessExistingOnStartChange,
  resetCompletedOnStart,
  onResetCompletedOnStartChange,
  working,
  watcher,
  onOpenFolderBrowser,
  onStartWatcher,
  onStopWatcher,
  onProcessPending,
  onRefresh,
}) => (
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <Typography variant="h6" sx={{ mb: 2 }}>Watcher Control</Typography>
      <TextField
        multiline
        minRows={2}
        label="Ingress Paths (one per line)"
        fullWidth
        value={pathsInput}
        onChange={(e) => onPathsInputChange(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Button
          variant="outlined"
          onClick={onOpenFolderBrowser}
          disabled={working}
        >
          Browse Folder
        </Button>
      </Box>
      <FormControlLabel
        control={
          <Switch
            checked={processExistingOnStart}
            onChange={(e) => onProcessExistingOnStartChange(e.target.checked)}
          />
        }
        label="Queue existing files in these paths before starting watcher"
        sx={{ mb: 1 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={resetCompletedOnStart}
            onChange={(e) => onResetCompletedOnStartChange(e.target.checked)}
          />
        }
        label="Move completed organized files back to encoded before starting watcher"
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={onStartWatcher} disabled={working}>
          {working
            ? 'Working…'
            : watcher?.initial_queue?.in_progress
              ? 'Queueing Existing Files…'
              : 'Start Watcher'}
        </Button>
        <Button variant="outlined" onClick={onStopWatcher} disabled={working}>
          Stop Watcher
        </Button>
        <Button variant="outlined" onClick={onProcessPending} disabled={working}>
          Process Pending Now
        </Button>
        <Button variant="text" onClick={onRefresh} disabled={working}>
          Refresh
        </Button>
      </Box>
    </CardContent>
  </Card>
);

export default IngressWatcherControlCard;
