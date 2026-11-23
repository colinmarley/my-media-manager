'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

import { changeExtraType, fileActionErrorMessage } from '@/service/library/MediaFilesService';
import { fontFamilies } from '@/theme/tokens';
import { EXTRAS_CATEGORIES, EXTRAS_CATEGORY_LABELS, ExtrasCategory } from '@/types/disc-ripper/DiscRipper.type';
import { ExtraTypeResult, MediaFile } from '@/types/library/MediaFile.type';

interface Props {
  /** The extra whose type would change; null keeps the dialog closed. */
  file: MediaFile | null;
  onClose: () => void;
  /** Applies the change and reports the outcome itself (toast, refetch). */
  onConfirm: (file: MediaFile, category: ExtrasCategory) => Promise<unknown>;
}

type Preview =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; result: ExtraTypeResult }
  | { kind: 'error'; message: string };

const mono = { fontFamily: fontFamilies.mono, fontSize: '0.8rem', overflowWrap: 'anywhere' } as const;

/**
 * Gives an extra another type (scene, featurette, blooper, ...). The type is the suffix of the
 * file name, so the dialog previews the new name with a dry run before anything is renamed.
 */
const ChangeExtraTypeDialog = ({ file, onClose, onConfirm }: Props) => {
  const [category, setCategory] = useState<ExtrasCategory | ''>('');
  const [preview, setPreview] = useState<Preview>({ kind: 'none' });
  const [changing, setChanging] = useState(false);
  const fileId = file?.id ?? null;

  // A fresh dialog for each file.
  useEffect(() => {
    setCategory('');
    setPreview({ kind: 'none' });
  }, [fileId]);

  useEffect(() => {
    if (!fileId || !category) return;
    let cancelled = false;
    setPreview({ kind: 'loading' });
    changeExtraType(fileId, category, true)
      .then((result) => {
        if (!cancelled) setPreview({ kind: 'ready', result });
      })
      .catch((error: unknown) => {
        if (!cancelled) setPreview({ kind: 'error', message: fileActionErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, category]);

  const confirm = async () => {
    if (!file || !category) return;
    setChanging(true);
    try {
      await onConfirm(file, category);
    } finally {
      setChanging(false);
      onClose();
    }
  };

  const sidecarCount = preview.kind === 'ready' ? preview.result.sidecars.length : 0;

  return (
    <Dialog open={file !== null} onClose={changing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Change the type of this extra</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ wordBreak: 'break-word', mb: 2 }}>
          The type of <strong>{file?.fileName}</strong> is part of its file name, so changing it renames the file
          in its folder. It stays linked to its disc or tape.
        </DialogContentText>
        <TextField
          select
          fullWidth
          size="small"
          label="Type"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExtrasCategory)}
          disabled={changing}
        >
          {EXTRAS_CATEGORIES.map((option) => (
            <MenuItem key={option} value={option}>
              {EXTRAS_CATEGORY_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ mt: 2, minHeight: 56 }} aria-live="polite">
          {preview.kind === 'loading' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} role="status">
              <CircularProgress size={18} /> <Typography variant="body2">Working out the new name…</Typography>
            </Box>
          )}
          {preview.kind === 'error' && <Alert severity="warning">{preview.message}</Alert>}
          {preview.kind === 'ready' && (
            <>
              <Typography variant="caption" color="text.secondary">New file name</Typography>
              <Typography component="div" sx={mono} aria-label="New file name">{preview.result.newName}</Typography>
              {sidecarCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {sidecarCount === 1 ? '1 file next to it (.nfo, subtitles) is' : `${sidecarCount} files next to it (.nfo, subtitles) are`} renamed with it.
                </Typography>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={changing}>Cancel</Button>
        <Button onClick={confirm} variant="contained" disabled={changing || preview.kind !== 'ready'}>
          {changing ? 'Changing…' : 'Change type'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChangeExtraTypeDialog;
