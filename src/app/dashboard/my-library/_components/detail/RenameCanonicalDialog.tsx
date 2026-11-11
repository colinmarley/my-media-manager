import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';

import StatusChip from '@/components/ui/StatusChip';
import { useNotify } from '@/context/NotificationContext';
import { forEachFile, isEndpointUnavailable, renameToCanonical } from '@/service/library/MediaFilesService';
import { fontFamilies } from '@/theme/tokens';
import { MediaFile, RenameCanonicalResult } from '@/types/library/MediaFile.type';

interface Props {
  open: boolean;
  files: MediaFile[];
  onClose: () => void;
  /** After a rename was applied: refetch the title. */
  onApplied: () => Promise<unknown> | void;
  /** The endpoint answered 404 / 405: the page disables the action from here on. */
  onUnavailable: () => void;
}

type Preview =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; rows: { file: MediaFile; result?: RenameCanonicalResult; error?: string }[] };

const mono = { fontFamily: fontFamilies.mono, fontSize: '0.75rem', overflowWrap: 'anywhere' } as const;

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Preview failed');

/** Renames files to their canonical library path: a dry-run preview (current → canonical), then apply. */
const RenameCanonicalDialog = ({ open, files, onClose, onApplied, onUnavailable }: Props) => {
  const notify = useNotify();
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open || files.length === 0) return;
    let cancelled = false;
    setPreview({ kind: 'loading' });
    (async () => {
      const rows: { file: MediaFile; result?: RenameCanonicalResult; error?: string }[] = [];
      for (const file of files) {
        try {
          rows.push({ file, result: await renameToCanonical(file.id, true) });
        } catch (error) {
          if (isEndpointUnavailable(error)) {
            if (!cancelled) {
              setPreview({ kind: 'unavailable' });
              onUnavailable();
            }
            return;
          }
          rows.push({ file, error: errorText(error) });
        }
      }
      if (!cancelled) setPreview({ kind: 'ready', rows });
    })();
    return () => {
      cancelled = true;
    };
    // Preview once per opening; the parent passes a fresh array on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applicable = preview.kind === 'ready'
    ? preview.rows.filter((row) => row.result && row.result.changed && !row.result.conflict)
    : [];

  const apply = async () => {
    setApplying(true);
    setProgress(0);
    try {
      // Sequential, so the button can count: "Renaming 2 of 5…".
      const { succeeded, failed } = await forEachFile(applicable.map((row) => row.file.id), async (id) => {
        try {
          return await renameToCanonical(id, false);
        } finally {
          setProgress((done) => done + 1);
        }
      });
      if (failed.length === 0) {
        notify(`Renamed ${succeeded.length} file${succeeded.length === 1 ? '' : 's'} to the canonical name.`, 'success');
      } else {
        notify(`Renamed ${succeeded.length}; ${failed.length} failed: ${errorText(failed[0].error)}`, 'error');
      }
      await onApplied();
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onClose={applying ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="rename-canonical-title">
      <DialogTitle id="rename-canonical-title">Rename to canonical name</DialogTitle>
      <DialogContent dividers>
        {preview.kind === 'loading' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} role="status">
            <CircularProgress size={18} /> <Typography variant="body2">Previewing the new names…</Typography>
          </Box>
        )}
        {preview.kind === 'unavailable' && (
          <Alert severity="info">Renaming to the canonical name is not available on this server yet.</Alert>
        )}
        {preview.kind === 'ready' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Nothing changes until you apply. Files already at their canonical path, or whose target is taken, are skipped.
            </Typography>
            <List dense disablePadding>
              {preview.rows.map(({ file, result, error }) => (
                <ListItem key={file.id} divider sx={{ display: 'block', py: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{file.fileName}</Typography>
                    {error && <StatusChip status="error" label="Preview failed" />}
                    {result && !result.changed && <StatusChip status="neutral" label="Already canonical" />}
                    {result && result.changed && result.conflict && <StatusChip status="warning" label="Target exists" />}
                    {result && result.changed && !result.conflict && <StatusChip status="info" label="Will rename" />}
                  </Box>
                  {error && <Typography variant="caption" color="error">{error}</Typography>}
                  {result && (
                    <Box aria-label={`Rename preview for ${file.fileName}`}>
                      <Typography component="div" sx={mono} color="text.secondary">
                        {result.currentRelativePath || result.currentPath}
                      </Typography>
                      {result.changed && (
                        <>
                          <ArrowDownwardIcon sx={{ fontSize: 14, color: 'text.disabled' }} aria-label="becomes" />
                          <Typography component="div" sx={mono}>{result.canonicalRelativePath || result.canonicalPath}</Typography>
                        </>
                      )}
                    </Box>
                  )}
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>{preview.kind === 'ready' ? 'Cancel' : 'Close'}</Button>
        {preview.kind === 'ready' && (
          <Button variant="contained" onClick={apply} disabled={applying || applicable.length === 0}>
            {applying
              ? applicable.length > 1 ? `Renaming ${Math.min(progress + 1, applicable.length)} of ${applicable.length}…` : 'Renaming…'
              : `Apply ${applicable.length} rename${applicable.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RenameCanonicalDialog;
