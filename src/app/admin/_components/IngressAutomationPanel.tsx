"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Replay,
  HealthAndSafety,
} from '@mui/icons-material';
import IngressAutomationService, {
  IngressConfig,
  IngressQueueItem,
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  pending: 'info',
  processing: 'info',
  auto_assigned: 'success',
  needs_review: 'warning',
  failed: 'error',
  completed: 'success',
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

const IngressAutomationPanel: React.FC = () => {
  const [config, setConfig] = useState<IngressConfig | null>(null);
  const [watcher, setWatcher] = useState<IngressWatcherStatus | null>(null);
  const [queueStatus, setQueueStatus] = useState<IngressQueueStatus | null>(null);
  const [queueItems, setQueueItems] = useState<IngressQueueItem[]>([]);
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [health, setHealth] = useState<Record<string, any> | null>(null);
  const [pathsInput, setPathsInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processExistingOnStart, setProcessExistingOnStart] = useState(false);
  // Editable config state
  const [editThreshold, setEditThreshold] = useState<number>(80);
  const [editAutoOrganize, setEditAutoOrganize] = useState<boolean>(true);
  const [editAutoProcess, setEditAutoProcess] = useState<boolean>(true);

  const defaultPaths = useMemo(() => config?.defaultIngressPaths || [], [config]);

  const refreshAll = async () => {
    setError(null);
    try {
      const [configData, watcherStatus, queueStatusData, items, historyItems, healthData] =
        await Promise.all([
          IngressAutomationService.getConfig(),
          IngressAutomationService.getWatcherStatus(),
          IngressAutomationService.getQueueStatus(),
          IngressAutomationService.getQueueItems(),
          IngressAutomationService.getHistory(25),
          IngressAutomationService.getHealth().catch(() => null),
        ]);

      setConfig(configData);
      setWatcher(watcherStatus);
      setQueueStatus(queueStatusData);
      setQueueItems(items);
      setHistory(historyItems);
      if (healthData) setHealth(healthData);
      if (!pathsInput && configData.defaultIngressPaths.length > 0) {
        setPathsInput(configData.defaultIngressPaths.join('\n'));
      }
      // Sync editable config fields only on first load
      setEditThreshold((prev) => (loading ? configData.autoAssignThreshold : prev));
      setEditAutoOrganize((prev) => (loading ? configData.autoOrganizeEnabled : prev));
      setEditAutoProcess((prev) => (loading ? configData.autoProcessEnabled : prev));
    } catch (err: any) {
      setError(err?.message || 'Failed to load ingress status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(refreshAll, 4000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsePathsInput = () => {
    const rows = pathsInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return rows.length > 0 ? rows : defaultPaths;
  };

  const handleStartWatcher = async () => {
    setWorking(true);
    setError(null);
    try {
      await IngressAutomationService.startWatcher(parsePathsInput(), {
        processExistingFiles: processExistingOnStart,
      });
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to start watcher');
    } finally {
      setWorking(false);
    }
  };

  const handleStopWatcher = async () => {
    setWorking(true);
    setError(null);
    try {
      await IngressAutomationService.stopWatcher();
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to stop watcher');
    } finally {
      setWorking(false);
    }
  };

  const handleProcessPending = async () => {
    setWorking(true);
    setError(null);
    try {
      await IngressAutomationService.processPending(50);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Failed to process pending queue items');
    } finally {
      setWorking(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const updated = await IngressAutomationService.updateConfig({
        autoAssignThreshold: editThreshold,
        autoOrganizeEnabled: editAutoOrganize,
        autoProcessEnabled: editAutoProcess,
        defaultIngressPaths: parsePathsInput(),
      });
      setConfig(updated);
    } catch (err: any) {
      setError(err?.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRetry = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.retryItem(itemId);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Retry failed');
    }
  };

  const handleMarkDone = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.markComplete(itemId);
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Mark complete failed');
    }
  };

  const handleMarkFailed = async (itemId: string) => {
    setError(null);
    try {
      await IngressAutomationService.markFailed(itemId, 'Manually dismissed');
      await refreshAll();
    } catch (err: any) {
      setError(err?.message || 'Mark failed action failed');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const ingressPathsHealthy =
    !health || health.ingress_paths?.every((p: any) => p.exists && p.readable);
  const destHealthy = !health || health.destination?.exists;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Ingress Automation
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {(!ingressPathsHealthy || !destHealthy) && (
        <Alert severity="warning" icon={<HealthAndSafety />} sx={{ mb: 2 }}>
          {!ingressPathsHealthy && 'One or more ingress paths are not accessible. '}
          {!destHealthy && 'Destination mount is not accessible — file organization will fail.'}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        High-confidence matches are auto-assigned and organized. Items below threshold appear as
        &ldquo;needs_review&rdquo; for manual action here or in Library Browser.
      </Alert>

      {/* Status Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Watcher</Typography>
              <Chip
                label={watcher?.is_running ? 'Running' : 'Stopped'}
                color={watcher?.is_running ? 'success' : 'default'}
                size="small"
                sx={{ mt: 1 }}
              />
              <Typography sx={{ mt: 1 }} variant="body2">
                Watching {watcher?.watched_paths?.length || 0} path(s)
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Queue</Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {Object.entries(queueStatus?.counts || {})
                  .filter(([, count]) => (count as number) > 0)
                  .map(([status, count]) => (
                    <Chip
                      key={status}
                      label={`${status}: ${count}`}
                      size="small"
                      color={STATUS_COLORS[status] || 'default'}
                    />
                  ))}
                {!queueStatus?.total && (
                  <Typography variant="body2" color="text.secondary">Empty</Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Paths</Typography>
              {health?.ingress_paths?.map((p: any) => (
                <Box key={p.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Chip
                    label={p.exists ? 'OK' : 'Missing'}
                    color={p.exists ? 'success' : 'error'}
                    size="small"
                  />
                  <Typography variant="caption" noWrap title={p.path}>{p.path}</Typography>
                </Box>
              )) || (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Health not loaded
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Watcher Control */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Watcher Control</Typography>
          <TextField
            multiline
            minRows={2}
            label="Ingress Paths (one per line)"
            fullWidth
            value={pathsInput}
            onChange={(e) => setPathsInput(e.target.value)}
            sx={{ mb: 2 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={processExistingOnStart}
                onChange={(e) => setProcessExistingOnStart(e.target.checked)}
              />
            }
            label="Queue existing files in these paths before starting watcher"
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={handleStartWatcher} disabled={working}>
              Start Watcher
            </Button>
            <Button variant="outlined" onClick={handleStopWatcher} disabled={working}>
              Stop Watcher
            </Button>
            <Button variant="outlined" onClick={handleProcessPending} disabled={working}>
              Process Pending Now
            </Button>
            <Button variant="text" onClick={refreshAll} disabled={working}>
              Refresh
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Config Editor */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Automation Settings</Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Auto-assign threshold (0–100)"
                type="number"
                fullWidth
                size="small"
                value={editThreshold}
                onChange={(e) => setEditThreshold(Number(e.target.value))}
                inputProps={{ min: 0, max: 100 }}
                helperText="Confidence score required for auto-assignment"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editAutoOrganize}
                    onChange={(e) => setEditAutoOrganize(e.target.checked)}
                  />
                }
                label="Auto-organize files on assignment"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={editAutoProcess}
                    onChange={(e) => setEditAutoProcess(e.target.checked)}
                  />
                }
                label="Auto-process queue when watcher runs"
              />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              onClick={handleSaveConfig}
              disabled={savingConfig}
            >
              {savingConfig ? 'Saving…' : 'Save Config'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Queue + History */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Queue Items</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>File</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Match / Proposed Path</TableCell>
                      <TableCell>Conf.</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {queueItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                          No queue items.
                        </TableCell>
                      </TableRow>
                    ) : (
                      queueItems.slice(0, 30).map((item) => (
                        <TableRow key={item.id}>
                          <TableCell sx={{ maxWidth: 240 }}>
                            <Typography variant="body2" noWrap title={item.file_path}>
                              {item.file_name}
                            </Typography>
                            {item.last_error && (
                              <Typography variant="caption" color="error" noWrap title={item.last_error}>
                                {item.last_error}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Typography variant="body2">
                              {item.media_duration_ms != null ? formatDuration(item.media_duration_ms) : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={item.status}
                              size="small"
                              color={STATUS_COLORS[item.status] || 'default'}
                            />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 200 }}>
                            <Typography variant="caption" noWrap title={item.best_match?.title}>
                              {item.best_match?.title || '—'}
                            </Typography>
                            {item.best_match?.year && (
                              <Typography variant="caption" color="text.secondary">
                                {' '}({item.best_match.year})
                              </Typography>
                            )}
                            {item.proposed_path && (
                              <Typography variant="caption" display="block" color="text.secondary" noWrap title={item.proposed_path} sx={{ fontStyle: 'italic' }}>
                                → {item.proposed_path}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{item.confidence_score ?? '—'}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {(item.status === 'failed' || item.status === 'needs_review') && (
                                <Tooltip title="Retry">
                                  <IconButton size="small" onClick={() => handleRetry(item.id)}>
                                    <Replay fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {(item.status === 'needs_review' || item.status === 'auto_assigned') && (
                                <Tooltip title="Mark done">
                                  <IconButton size="small" onClick={() => handleMarkDone(item.id)}>
                                    <CheckCircle fontSize="small" color="success" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {item.status === 'needs_review' && (
                                <Tooltip title="Dismiss / mark failed">
                                  <IconButton size="small" onClick={() => handleMarkFailed(item.id)}>
                                    <Cancel fontSize="small" color="error" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Recent History</Typography>
              {history.length === 0 ? (
                <Typography color="text.secondary">No processing history yet.</Typography>
              ) : (
                history
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((item, index) => (
                    <Box key={`${item.item_id || index}-${index}`} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={item.status}
                          size="small"
                          color={STATUS_COLORS[item.status as string] || 'default'}
                        />
                        {item.confidence_score != null && (
                          <Typography variant="caption" color="text.secondary">
                            {item.confidence_score}%
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ wordBreak: 'break-all' }}
                      >
                        {item.file_path || item.item_id}
                      </Typography>
                      {index < 9 && <Divider sx={{ mt: 1 }} />}
                    </Box>
                  ))
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default IngressAutomationPanel;

