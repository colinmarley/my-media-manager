'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import LibraryComplianceService from '@/service/library/LibraryComplianceService';
import {
  ComplianceAction,
  ComplianceFinding,
  CompliancePreview,
  ComplianceScanStatus,
  ComplianceStatus,
  ComplianceSummary,
} from '@/types/library/LibraryCompliance';

const STATUS_OPTIONS: ComplianceStatus[] = [
  'open',
  'ignored',
  'snoozed',
  'resolved',
  'needs_manual_review',
];

const severityColor: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const LibraryCompliancePanel: React.FC = () => {
  const [libraryPath, setLibraryPath] = useState('/ark/media/jellyfin/Movies');
  const [scanMediaType, setScanMediaType] = useState<'movie' | 'series'>('movie');
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ComplianceScanStatus | null>(null);
  const [findings, setFindings] = useState<ComplianceFinding[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComplianceStatus | 'all'>('open');
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<ComplianceFinding | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<CompliancePreview | null>(null);
  const [actionEdits, setActionEdits] = useState<Record<string, { selected: boolean; targetPath: string | null }>>({});
  const [working, setWorking] = useState(false);

  const initActionEdits = (actions: ComplianceAction[]): void => {
    const next: Record<string, { selected: boolean; targetPath: string | null }> = {};
    actions.forEach((action) => {
      next[action.id] = {
        selected: Boolean(action.selected),
        targetPath: action.targetPath || null,
      };
    });
    setActionEdits(next);
  };

  const loadSummary = async (): Promise<void> => {
    const data = await LibraryComplianceService.getSummary();
    setSummary(data);
  };

  const loadFindings = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await LibraryComplianceService.getFindings({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      });
      setFindings(data);
      setSelectedFindingIds((prev) => prev.filter((id) => data.some((item) => item.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load findings');
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async (): Promise<void> => {
    await Promise.all([loadSummary(), loadFindings()]);
  };

  const handleStartScan = async (): Promise<void> => {
    if (!libraryPath.trim()) {
      setError('Library path is required.');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const started = await LibraryComplianceService.startScan(libraryPath.trim(), scanMediaType);
      setScanId(started.scanId);

      let status: ComplianceScanStatus | null = null;
      for (let i = 0; i < 600; i += 1) {
        status = await LibraryComplianceService.getScanStatus(started.scanId);
        setScanStatus(status);
        if (status.status !== 'running') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setWorking(false);
    }
  };

  const openFinding = async (findingId: string): Promise<void> => {
    setSelectedFindingId(findingId);
    setPreview(null);
    try {
      const finding = await LibraryComplianceService.getFinding(findingId);
      setSelectedFinding(finding);
      initActionEdits(finding.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finding details');
    }
  };

  const setActionSelected = (actionId: string, selected: boolean): void => {
    setActionEdits((prev) => ({
      ...prev,
      [actionId]: {
        selected,
        targetPath: prev[actionId]?.targetPath ?? null,
      },
    }));
  };

  const setActionTargetPath = (actionId: string, targetPath: string): void => {
    setActionEdits((prev) => ({
      ...prev,
      [actionId]: {
        selected: prev[actionId]?.selected ?? true,
        targetPath,
      },
    }));
  };

  const setMoveKeepFilename = (action: ComplianceAction): void => {
    if (!action.sourcePath || !action.targetPath) return;
    const sourceName = action.sourcePath.split(/[\\/]/).pop() || '';
    if (!sourceName) return;
    const targetDir = action.targetPath.replace(/[\\/][^\\/]+$/, '');
    const normalized = `${targetDir}/${sourceName}`;
    setActionTargetPath(action.id, normalized);
  };

  const collectActionUpdates = (finding: ComplianceFinding): Array<{
    actionId: string;
    selected: boolean;
    targetPath: string | null;
  }> => finding.actions
    .map((action) => {
      const edit = actionEdits[action.id];
      if (!edit) return null;
      const originalTarget = action.targetPath || null;
      const nextTarget = edit.targetPath?.trim() || null;
      const targetChanged = originalTarget !== nextTarget;
      const selectedChanged = Boolean(action.selected) !== Boolean(edit.selected);
      if (!targetChanged && !selectedChanged) return null;
      return {
        actionId: action.id,
        selected: edit.selected,
        targetPath: nextTarget,
      };
    })
    .filter((value): value is { actionId: string; selected: boolean; targetPath: string | null } => Boolean(value));

  const persistActionEdits = async (finding: ComplianceFinding): Promise<boolean> => {
    const updates = collectActionUpdates(finding);
    if (updates.length === 0) {
      return false;
    }

    await Promise.all(
      updates.map((update) => LibraryComplianceService.updateAction(finding.id, update.actionId, {
        selected: update.selected,
        targetPath: update.targetPath,
      })),
    );

    const refreshedFinding = await LibraryComplianceService.getFinding(finding.id);
    setSelectedFinding(refreshedFinding);
    initActionEdits(refreshedFinding.actions);
    return true;
  };

  const handleSaveActionEdits = async (): Promise<void> => {
    if (!selectedFinding) return;

    setWorking(true);
    setError(null);
    try {
      const didPersist = await persistActionEdits(selectedFinding);
      if (!didPersist) return;
      setPreview(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save action changes');
    } finally {
      setWorking(false);
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!selectedFindingId || !selectedFinding) return;

    setWorking(true);
    setError(null);
    try {
      await persistActionEdits(selectedFinding);
      const data = await LibraryComplianceService.previewFinding(selectedFindingId);
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview actions');
    } finally {
      setWorking(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (!selectedFindingId || !selectedFinding) return;

    setWorking(true);
    setError(null);
    try {
      await persistActionEdits(selectedFinding);
      await LibraryComplianceService.applyFinding(selectedFindingId);
      const finding = await LibraryComplianceService.getFinding(selectedFindingId);
      setSelectedFinding(finding);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply actions');
    } finally {
      setWorking(false);
    }
  };

  const handleStatusChange = async (status: ComplianceStatus): Promise<void> => {
    if (!selectedFindingId) return;

    setWorking(true);
    setError(null);
    try {
      const updated = await LibraryComplianceService.updateFindingStatus(selectedFindingId, status);
      setSelectedFinding(updated);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setWorking(false);
    }
  };

  const toggleFindingSelection = (findingId: string): void => {
    setSelectedFindingIds((prev) => (
      prev.includes(findingId) ? prev.filter((id) => id !== findingId) : [...prev, findingId]
    ));
  };

  const toggleAllVisible = (): void => {
    if (selectedFindingIds.length === findingRows.length) {
      setSelectedFindingIds([]);
      return;
    }
    setSelectedFindingIds(findingRows.map((row) => row.id));
  };

  const handleBulkApply = async (): Promise<void> => {
    if (selectedFindingIds.length === 0) {
      setError('Select one or more findings first.');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      await LibraryComplianceService.bulkApply(selectedFindingIds);
      await refreshAll();
      setSelectedFindingIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to bulk apply findings');
    } finally {
      setWorking(false);
    }
  };

  const handleBulkStatus = async (status: ComplianceStatus): Promise<void> => {
    if (selectedFindingIds.length === 0) {
      setError('Select one or more findings first.');
      return;
    }

    setWorking(true);
    setError(null);
    try {
      await LibraryComplianceService.bulkStatus(selectedFindingIds, status);
      await refreshAll();
      setSelectedFindingIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update bulk status');
    } finally {
      setWorking(false);
    }
  };

  const handleDismissAll = async (): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      await LibraryComplianceService.dismissAllFindings();
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss all findings');
    } finally {
      setWorking(false);
    }
  };

  const findingRows = useMemo(() => findings, [findings]);

  React.useEffect(() => {
    refreshAll().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load compliance data');
    });
  }, []);

  React.useEffect(() => {
    loadFindings().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load findings');
    });
  }, [statusFilter]);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Library Compliance Audit
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Select
                  size="small"
                  value={scanMediaType}
                  onChange={(event) => setScanMediaType(event.target.value as 'movie' | 'series')}
                >
                  <MenuItem value="movie">Movies</MenuItem>
                  <MenuItem value="series">Series</MenuItem>
                </Select>
                <TextField
                  fullWidth
                  label="Library Path"
                  value={libraryPath}
                  onChange={(event) => setLibraryPath(event.target.value)}
                />
                <Button variant="contained" onClick={handleStartScan} disabled={working}>
                  Run Compliance Scan
                </Button>
              </Stack>
              {working && scanStatus?.status === 'running' && (
                <Box sx={{ mt: 2 }}>
                  <LinearProgress variant="determinate" value={scanStatus.percentage} />
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    {scanStatus.processedFolders}/{scanStatus.totalFolders} folders processed ({scanStatus.percentage}%)
                  </Typography>
                </Box>
              )}
              {scanId && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Scan ID: {scanId}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Summary
              </Typography>
              {!summary ? (
                <CircularProgress size={20} />
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={`Open: ${summary.open}`} color="warning" size="small" />
                  <Chip label={`Critical: ${summary.critical}`} color="error" size="small" />
                  <Chip label={`High: ${summary.high}`} color="warning" size="small" />
                  <Chip label={`Duplicates: ${summary.duplicateMain}`} size="small" />
                  <Chip label={`Misplaced: ${summary.misplacedSpecial}`} size="small" />
                  <Chip label={`Naming: ${summary.namingMismatch}`} size="small" />
                  <Chip label={`Season Naming: ${summary.seasonNamingMismatch || 0}`} size="small" />
                  <Chip label={`Episode Naming: ${summary.episodeNamingMismatch || 0}`} size="small" />
                  <Chip label={`Specials Placement: ${summary.specialsMisplaced || 0}`} size="small" />
                  <Chip label={`Unknown Episodes: ${summary.unknownEpisodePattern || 0}`} size="small" />
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
            <Typography variant="h6">Findings</Typography>
            <Select
              size="small"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ComplianceStatus | 'all')}
            >
              <MenuItem value="all">All</MenuItem>
              {STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </Select>
            <Button variant="outlined" onClick={refreshAll} disabled={loading || working}>
              Refresh
            </Button>
            <Button
              variant="outlined"
              onClick={handleBulkApply}
              disabled={working || selectedFindingIds.length === 0}
            >
              Apply Selected
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => handleBulkStatus('ignored')}
              disabled={working || selectedFindingIds.length === 0}
            >
              Ignore Selected
            </Button>
            <Chip size="small" label={`${selectedFindingIds.length} selected`} />
          </Stack>

          {loading ? (
            <CircularProgress size={24} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        indeterminate={selectedFindingIds.length > 0 && selectedFindingIds.length < findingRows.length}
                        checked={findingRows.length > 0 && selectedFindingIds.length === findingRows.length}
                        onChange={toggleAllVisible}
                      />
                    </TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Issue</TableCell>
                    <TableCell>Path</TableCell>
                    <TableCell>Proposed Target</TableCell>
                    <TableCell>Confidence</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {findingRows.map((finding) => (
                    <TableRow key={finding.id} hover>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={selectedFindingIds.includes(finding.id)}
                          onChange={() => toggleFindingSelection(finding.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip label={finding.status} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={finding.severity}
                          size="small"
                          color={severityColor[finding.severity] || 'default'}
                        />
                      </TableCell>
                      <TableCell>{finding.issueType}</TableCell>
                      <TableCell sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {finding.filePath || finding.folderPath || '-'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {finding.actions?.[0]?.targetPath || '-'}
                      </TableCell>
                      <TableCell>{finding.confidence}</TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => openFinding(finding.id)}>
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {findingRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        No findings for current filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedFindingId)}
        onClose={() => {
          setSelectedFindingId(null);
          setSelectedFinding(null);
          setPreview(null);
          setActionEdits({});
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Compliance Finding Review</DialogTitle>
        <DialogContent>
          {!selectedFinding ? (
            <CircularProgress size={24} />
          ) : (
            <Stack spacing={2}>
              <Typography variant="subtitle2">Issue</Typography>
              <Typography>{selectedFinding.issueType}</Typography>

              <Typography variant="subtitle2">Rationale</Typography>
              <Typography>{selectedFinding.rationale || 'No rationale provided.'}</Typography>

              <Typography variant="subtitle2">Path</Typography>
              <Typography>{selectedFinding.filePath || selectedFinding.folderPath || '-'}</Typography>

              <Stack direction="row" spacing={1}>
                {STATUS_OPTIONS.map((status) => (
                  <Button
                    key={status}
                    size="small"
                    variant={selectedFinding.status === status ? 'contained' : 'outlined'}
                    onClick={() => handleStatusChange(status)}
                    disabled={working}
                  >
                    {status}
                  </Button>
                ))}
              </Stack>

              <Typography variant="subtitle2">Proposed Actions</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Selected</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selectedFinding.actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>{action.actionType}</TableCell>
                      <TableCell>{action.sourcePath || '-'}</TableCell>
                      <TableCell sx={{ minWidth: 320 }}>
                        {(action.actionType === 'rename' || action.actionType === 'move') ? (
                          <Stack direction="row" spacing={1} alignItems="center">
                            <TextField
                              size="small"
                              fullWidth
                              label="Target path"
                              value={actionEdits[action.id]?.targetPath || ''}
                              onChange={(event) => setActionTargetPath(action.id, event.target.value)}
                            />
                            {action.actionType === 'move' && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => setMoveKeepFilename(action)}
                              >
                                Keep filename
                              </Button>
                            )}
                          </Stack>
                        ) : (
                          action.targetPath || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          size="small"
                          checked={actionEdits[action.id]?.selected ?? action.selected}
                          onChange={(event) => setActionSelected(action.id, event.target.checked)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {preview && (
                <Alert severity={preview.safeToApply ? 'success' : 'warning'}>
                  {preview.safeToApply
                    ? 'Preview passed. Selected actions can be applied.'
                    : 'Preview found blockers. Review action details before applying.'}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSaveActionEdits} disabled={working || !selectedFinding}>
            Save Action Changes
          </Button>
          <Button onClick={handlePreview} disabled={working || !selectedFinding}>
            Preview
          </Button>
          <Button onClick={handleApply} variant="contained" disabled={working || !selectedFinding}>
            Apply Selected Fixes
          </Button>
          <Button
            onClick={() => {
              setSelectedFindingId(null);
              setSelectedFinding(null);
              setPreview(null);
              setActionEdits({});
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LibraryCompliancePanel;
