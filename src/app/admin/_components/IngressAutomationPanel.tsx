"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
  Grid,
  InputLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
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
  Edit,
  Replay,
  HealthAndSafety,
} from '@mui/icons-material';
import IngressAutomationService, {
  IngressConfig,
  IngressQueueItem,
  IngressQueueStatus,
  IngressWatcherStatus,
} from '@/service/ingress/IngressAutomationService';
import MediaAssignmentSearchService, { SearchResult } from '@/service/library/MediaAssignmentSearchService';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  pending: 'info',
  processing: 'info',
  auto_assigned: 'success',
  needs_review: 'warning',
  failed: 'error',
  completed: 'success',
};

const BULK_SELECTABLE_STATUSES = new Set(['needs_review', 'auto_assigned', 'failed']);

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
  const [selectedQueueItemIds, setSelectedQueueItemIds] = useState<string[]>([]);
  // Editable config state
  const [editThreshold, setEditThreshold] = useState<number>(80);
  const [editAutoOrganize, setEditAutoOrganize] = useState<boolean>(true);
  const [editAutoProcess, setEditAutoProcess] = useState<boolean>(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignSearching, setAssignSearching] = useState(false);
  const [assignTargetItemIds, setAssignTargetItemIds] = useState<string[]>([]);
  const [assignMediaType, setAssignMediaType] = useState<'movie' | 'episode'>('movie');
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [assignSearchResults, setAssignSearchResults] = useState<SearchResult[]>([]);
  const [selectedAssignResult, setSelectedAssignResult] = useState<SearchResult | null>(null);
  const [organizeAfterAssign, setOrganizeAfterAssign] = useState(false);
  const [episodeMapByItemId, setEpisodeMapByItemId] = useState<Record<string, { season?: number; episode?: number }>>({});

  const defaultPaths = useMemo(() => config?.defaultIngressPaths || [], [config]);
  const visibleQueueItems = useMemo(() => queueItems.slice(0, 30), [queueItems]);
  const selectableVisibleItems = useMemo(
    () => visibleQueueItems.filter((item) => BULK_SELECTABLE_STATUSES.has(item.status)),
    [visibleQueueItems]
  );
  const selectedVisibleCount = useMemo(
    () => selectableVisibleItems.filter((item) => selectedQueueItemIds.includes(item.id)).length,
    [selectableVisibleItems, selectedQueueItemIds]
  );
  const selectedQueueItems = useMemo(
    () => queueItems.filter((item) => selectedQueueItemIds.includes(item.id)),
    [queueItems, selectedQueueItemIds]
  );
  const selectedAcceptCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned').length,
    [selectedQueueItems]
  );
  const selectedRejectCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review').length,
    [selectedQueueItems]
  );
  const selectedRetryCount = useMemo(
    () => selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'failed').length,
    [selectedQueueItems]
  );

  const assignTargets = useMemo(
    () => queueItems.filter((item) => assignTargetItemIds.includes(item.id)),
    [queueItems, assignTargetItemIds]
  );

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
  setSelectedQueueItemIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
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

  const isQueueItemSelectable = (item: IngressQueueItem) => BULK_SELECTABLE_STATUSES.has(item.status);

  const toggleQueueItemSelection = (itemId: string) => {
    setSelectedQueueItemIds((prev) => (
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    ));
  };

  const toggleSelectAllVisible = () => {
    const selectableIds = selectableVisibleItems.map((item) => item.id);
    if (selectableIds.length === 0) {
      return;
    }

    setSelectedQueueItemIds((prev) => {
      const allSelected = selectableIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !selectableIds.includes(id));
      }

      return Array.from(new Set([...prev, ...selectableIds]));
    });
  };

  const runBulkAction = async (
    actionLabel: string,
    eligibleItems: IngressQueueItem[],
    action: (item: IngressQueueItem) => Promise<unknown>
  ) => {
    if (eligibleItems.length === 0) {
      setError(`No selected items can be ${actionLabel.toLowerCase()}.`);
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const results = await Promise.allSettled(eligibleItems.map((item) => action(item)));
      const failedCount = results.filter((result) => result.status === 'rejected').length;

      if (failedCount > 0) {
        setError(`${actionLabel} completed with ${failedCount} failure${failedCount === 1 ? '' : 's'}.`);
      }

      await refreshAll();
    } catch (err: any) {
      setError(err?.message || `${actionLabel} failed`);
    } finally {
      setWorking(false);
    }
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

  const handleBulkAccept = async () => {
    await runBulkAction(
      'Accept',
      selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'auto_assigned'),
      (item) => IngressAutomationService.markComplete(item.id)
    );
  };

  const handleBulkReject = async () => {
    await runBulkAction(
      'Reject',
      selectedQueueItems.filter((item) => item.status === 'needs_review'),
      (item) => IngressAutomationService.markFailed(item.id, 'Manually dismissed')
    );
  };

  const handleBulkRetry = async () => {
    await runBulkAction(
      'Retry',
      selectedQueueItems.filter((item) => item.status === 'needs_review' || item.status === 'failed'),
      (item) => IngressAutomationService.retryItem(item.id)
    );
  };

  const openAssignDialog = (itemIds: string[]) => {
    const targets = queueItems.filter((item) => itemIds.includes(item.id));
    if (targets.length === 0) {
      setError('Select one or more queue items to assign.');
      return;
    }

    const shouldUseEpisode = targets.some((item) => {
      const mediaType = item.parsed_info?.media_type || item.best_match?.media_type;
      return mediaType === 'episode' || mediaType === 'series';
    });

    const defaultEpisodeMap: Record<string, { season?: number; episode?: number }> = {};
    targets.forEach((item) => {
      defaultEpisodeMap[item.id] = {
        season: item.parsed_info?.season || item.best_match?.season,
        episode: item.parsed_info?.episode || item.best_match?.episode,
      };
    });

    setAssignTargetItemIds(itemIds);
    setAssignMediaType(shouldUseEpisode ? 'episode' : 'movie');
    setEpisodeMapByItemId(defaultEpisodeMap);
    setAssignSearchQuery('');
    setAssignSearchResults([]);
    setSelectedAssignResult(null);
    setOrganizeAfterAssign(false);
    setAssignDialogOpen(true);
  };

  const closeAssignDialog = () => {
    if (assigning) {
      return;
    }

    setAssignDialogOpen(false);
  };

  const handleAssignSearch = async () => {
    if (!assignSearchQuery.trim()) {
      setAssignSearchResults([]);
      return;
    }

    setAssignSearching(true);
    try {
      const results = await MediaAssignmentSearchService.combinedSearch(
        assignSearchQuery.trim(),
        assignMediaType === 'movie' ? 'movie' : 'series'
      );
      setAssignSearchResults(results);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Failed to search titles');
    } finally {
      setAssignSearching(false);
    }
  };

  const handleManualAssign = async () => {
    if (!selectedAssignResult) {
      setError('Select a title to assign.');
      return;
    }

    if (assignTargetItemIds.length === 0) {
      setError('No queue items selected for assignment.');
      return;
    }

    if (assignMediaType === 'episode') {
      const missingMapping = assignTargetItemIds.find((itemId) => {
        const mapping = episodeMapByItemId[itemId];
        return !mapping?.season || !mapping?.episode;
      });
      if (missingMapping) {
        setError('Each selected queue item needs season and episode values.');
        return;
      }
    }

    setAssigning(true);
    setError(null);
    try {
      for (const itemId of assignTargetItemIds) {
        const mapping = episodeMapByItemId[itemId] || {};
        await IngressAutomationService.manualAssign({
          itemId,
          mediaType: assignMediaType,
          title: selectedAssignResult.title,
          year: Number.isFinite(Number(selectedAssignResult.year)) ? Number(selectedAssignResult.year) : undefined,
          source: selectedAssignResult.source,
          imdbId: selectedAssignResult.imdbId || undefined,
          mediaId: selectedAssignResult.source === 'omdb' ? selectedAssignResult.imdbId : selectedAssignResult.id,
          firebaseMediaId: selectedAssignResult.source === 'firebase' ? selectedAssignResult.id : undefined,
          season: assignMediaType === 'episode' ? mapping.season : undefined,
          episode: assignMediaType === 'episode' ? mapping.episode : undefined,
          organizeNow: organizeAfterAssign,
        });
      }

      setAssignDialogOpen(false);
      setSelectedQueueItemIds((prev) => prev.filter((id) => !assignTargetItemIds.includes(id)));
      await refreshAll();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Manual assignment failed');
    } finally {
      setAssigning(false);
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
        &ldquo;needs_review&rdquo; for manual action here.
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <Typography variant="h6">Queue Items</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    {selectedQueueItemIds.length > 0
                      ? `${selectedQueueItemIds.length} selected`
                      : `${selectableVisibleItems.length} selectable`}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleBulkAccept}
                    disabled={working || selectedAcceptCount === 0}
                  >
                    Accept Selected
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleBulkReject}
                    disabled={working || selectedRejectCount === 0}
                  >
                    Reject Selected
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleBulkRetry}
                    disabled={working || selectedRetryCount === 0}
                  >
                    Retry Selected
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => openAssignDialog(selectedQueueItemIds)}
                    disabled={working || selectedQueueItemIds.length === 0}
                  >
                    Assign Selected
                  </Button>
                </Box>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          indeterminate={selectedVisibleCount > 0 && selectedVisibleCount < selectableVisibleItems.length}
                          checked={selectableVisibleItems.length > 0 && selectedVisibleCount === selectableVisibleItems.length}
                          disabled={selectableVisibleItems.length === 0}
                          onChange={toggleSelectAllVisible}
                          inputProps={{ 'aria-label': 'Select all queue items' }}
                        />
                      </TableCell>
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
                        <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
                          No queue items.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleQueueItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedQueueItemIds.includes(item.id)}
                              disabled={!isQueueItemSelectable(item) || working}
                              onChange={() => toggleQueueItemSelection(item.id)}
                              inputProps={{ 'aria-label': `Select ${item.file_name}` }}
                            />
                          </TableCell>
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
                              {(item.status === 'needs_review' || item.status === 'failed') && (
                                <Tooltip title="Assign manually">
                                  <IconButton size="small" onClick={() => openAssignDialog([item.id])}>
                                    <Edit fontSize="small" color="primary" />
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

      <Dialog open={assignDialogOpen} onClose={closeAssignDialog} maxWidth="md" fullWidth>
        <DialogTitle>Manual Assignment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Assigning {assignTargetItemIds.length} queue item{assignTargetItemIds.length === 1 ? '' : 's'}.
            </Typography>

            <FormControl size="small" sx={{ maxWidth: 240 }}>
              <InputLabel id="assign-media-type-label">Assignment Type</InputLabel>
              <Select
                labelId="assign-media-type-label"
                label="Assignment Type"
                value={assignMediaType}
                onChange={(event) => setAssignMediaType(event.target.value as 'movie' | 'episode')}
              >
                <MenuItem value="movie">Movie</MenuItem>
                <MenuItem value="episode">TV Episode</MenuItem>
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label={assignMediaType === 'movie' ? 'Search movie' : 'Search series'}
                fullWidth
                size="small"
                value={assignSearchQuery}
                onChange={(event) => setAssignSearchQuery(event.target.value)}
              />
              <Button variant="contained" onClick={handleAssignSearch} disabled={assignSearching || !assignSearchQuery.trim()}>
                {assignSearching ? 'Searching…' : 'Search'}
              </Button>
            </Box>

            <Autocomplete
              options={assignSearchResults}
              value={selectedAssignResult}
              onChange={(_, value) => setSelectedAssignResult(value)}
              getOptionLabel={(option) => `${option.title} (${option.year}) [${option.source}]`}
              renderInput={(params) => <TextField {...params} label="Select title" size="small" />}
            />

            {assignMediaType === 'episode' && assignTargets.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Episode Mapping
                </Typography>
                <Stack spacing={1.2}>
                  {assignTargets.map((item) => {
                    const mapping = episodeMapByItemId[item.id] || {};
                    return (
                      <Box key={item.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ minWidth: 260 }} noWrap title={item.file_name}>
                          {item.file_name}
                        </Typography>
                        <TextField
                          label="Season"
                          type="number"
                          size="small"
                          value={mapping.season ?? ''}
                          onChange={(event) => {
                            const seasonValue = event.target.value ? Number(event.target.value) : undefined;
                            setEpisodeMapByItemId((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                season: seasonValue,
                              },
                            }));
                          }}
                          sx={{ width: 120 }}
                        />
                        <TextField
                          label="Episode"
                          type="number"
                          size="small"
                          value={mapping.episode ?? ''}
                          onChange={(event) => {
                            const episodeValue = event.target.value ? Number(event.target.value) : undefined;
                            setEpisodeMapByItemId((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                episode: episodeValue,
                              },
                            }));
                          }}
                          sx={{ width: 120 }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={organizeAfterAssign}
                  onChange={(event) => setOrganizeAfterAssign(event.target.checked)}
                />
              }
              label="Organize files immediately"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAssignDialog} disabled={assigning}>Cancel</Button>
          <Button variant="contained" onClick={handleManualAssign} disabled={assigning || !selectedAssignResult}>
            {assigning ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default IngressAutomationPanel;

