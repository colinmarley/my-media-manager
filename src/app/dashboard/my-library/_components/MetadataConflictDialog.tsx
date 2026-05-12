'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useMemo, useState } from 'react';
import {
  applyConflictResolution,
  ConflictResolution,
  FieldConflict,
  SaveMetadataResult,
} from '@/service/library/LibraryMetadataImportService';

interface Props {
  open: boolean;
  saveResult: SaveMetadataResult;
  onClose: () => void;
  onApplied: (result: SaveMetadataResult) => void;
}

const formatValue = (val: unknown): string => {
  if (val === null || val === undefined || val === '') return '—';
  if (Array.isArray(val)) return val.join(', ') || '—';
  return String(val);
};

export default function MetadataConflictDialog({ open, saveResult, onClose, onApplied }: Props) {
  const conflicts = saveResult.conflicts ?? [];
  const autoFilledCount = saveResult.autoFilledCount ?? 0;
  const existingTitle = saveResult.document?.['title'] as string | undefined;

  const [resolution, setResolution] = useState<ConflictResolution>(() =>
    Object.fromEntries(conflicts.map((c) => [c.field, 'existing' as const]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAll = (choice: 'existing' | 'incoming') => {
    setResolution(Object.fromEntries(conflicts.map((c) => [c.field, choice])));
  };

  const incomingCount = useMemo(
    () => Object.values(resolution).filter((v) => v === 'incoming').length,
    [resolution]
  );

  const handleApply = async () => {
    if (!saveResult.documentId || !saveResult.document) return;
    setSaving(true);
    setError(null);
    const result = await applyConflictResolution(
      saveResult.documentId,
      saveResult.collection,
      saveResult.document,
      conflicts,
      resolution
    );
    setSaving(false);
    if (result.status === 'error') {
      setError(result.message);
    } else {
      onApplied(result);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <WarningAmberIcon color="warning" />
          <Box>
            <Typography variant="h6" component="span">
              Update Catalog Entry
            </Typography>
            {existingTitle && (
              <Typography variant="body2" color="text.secondary">
                {existingTitle}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {autoFilledCount > 0 && (
          <Alert
            severity="success"
            icon={<AutoFixHighIcon />}
            sx={{ mb: 2 }}
          >
            <strong>{autoFilledCount} empty field{autoFilledCount !== 1 ? 's were' : ' was'} auto-filled</strong> with retrieved data and will be saved automatically.
          </Alert>
        )}

        {conflicts.length > 0 && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              The following {conflicts.length} field{conflicts.length !== 1 ? 's' : ''} already have values that differ from the retrieved data. Choose which value to keep for each.
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <Tooltip title="Keep all current values from your database">
                <Button size="small" variant="outlined" onClick={() => setAll('existing')}>
                  Keep All Current
                </Button>
              </Tooltip>
              <Tooltip title="Replace all with values just retrieved from the source">
                <Button size="small" variant="outlined" color="warning" onClick={() => setAll('incoming')}>
                  Use All Retrieved
                </Button>
              </Tooltip>
              {incomingCount > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  label={`${incomingCount} field${incomingCount !== 1 ? 's' : ''} will be overwritten`}
                />
              )}
            </Stack>

            <Divider sx={{ mb: 1.5 }} />

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '15%', fontWeight: 700 }}>Field</TableCell>
                    <TableCell sx={{ width: '38%', fontWeight: 700 }}>Current Value</TableCell>
                    <TableCell sx={{ width: '38%', fontWeight: 700 }}>Retrieved Value</TableCell>
                    <TableCell sx={{ width: '9%' }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {conflicts.map((conflict: FieldConflict) => {
                    const choice = resolution[conflict.field] ?? 'existing';
                    return (
                      <TableRow
                        key={conflict.field}
                        sx={{ '&:last-child td': { border: 0 } }}
                      >
                        <TableCell>
                          <Typography variant="caption" fontWeight={600} color="text.secondary">
                            {conflict.label}
                          </Typography>
                        </TableCell>

                        <TableCell
                          onClick={() =>
                            setResolution((prev) => ({ ...prev, [conflict.field]: 'existing' }))
                          }
                          sx={{
                            cursor: 'pointer',
                            borderRadius: 1,
                            bgcolor: choice === 'existing' ? 'success.dark' : 'transparent',
                            outline: choice === 'existing' ? '2px solid' : '1px solid',
                            outlineColor: choice === 'existing' ? 'success.main' : 'divider',
                            transition: 'all 0.15s',
                            verticalAlign: 'top',
                            py: 1,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: 80,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {formatValue(conflict.existing)}
                          </Typography>
                        </TableCell>

                        <TableCell
                          onClick={() =>
                            setResolution((prev) => ({ ...prev, [conflict.field]: 'incoming' }))
                          }
                          sx={{
                            cursor: 'pointer',
                            borderRadius: 1,
                            bgcolor: choice === 'incoming' ? 'warning.dark' : 'transparent',
                            outline: choice === 'incoming' ? '2px solid' : '1px solid',
                            outlineColor: choice === 'incoming' ? 'warning.main' : 'divider',
                            transition: 'all 0.15s',
                            verticalAlign: 'top',
                            py: 1,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: 80,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {formatValue(conflict.incoming)}
                          </Typography>
                        </TableCell>

                        <TableCell align="center">
                          <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={choice}
                            onChange={(_, val) => {
                              if (val) setResolution((prev) => ({ ...prev, [conflict.field]: val }));
                            }}
                            orientation="vertical"
                          >
                            <ToggleButton value="existing" color="success" sx={{ px: 0.5, py: 0.25, fontSize: '0.65rem' }}>
                              Current
                            </ToggleButton>
                            <ToggleButton value="incoming" color="warning" sx={{ px: 0.5, py: 0.25, fontSize: '0.65rem' }}>
                              New
                            </ToggleButton>
                          </ToggleButtonGroup>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleApply}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
