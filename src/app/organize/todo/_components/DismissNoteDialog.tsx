'use client';

import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';

import type { AttentionItem } from '@/types/attention/Attention.type';

interface Props {
  item: AttentionItem | null;
  onClose: () => void;
  onDismiss: (item: AttentionItem, days: number | null, note: string) => void;
}

/** Dismiss with a note: how long, and why (shown in the Dismissed list). */
const DismissNoteDialog = ({ item, onClose, onDismiss }: Props) => {
  const [duration, setDuration] = useState<'change' | '30'>('change');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (item) {
      setDuration('change');
      setNote('');
    }
  }, [item]);

  return (
    <Dialog open={Boolean(item)} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="dismiss-note-title">
      <DialogTitle id="dismiss-note-title">Dismiss this item</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, overflowWrap: 'anywhere' }}>{item?.title}</Typography>
        <RadioGroup value={duration} onChange={(event) => setDuration(event.target.value as 'change' | '30')} aria-label="How long">
          <FormControlLabel value="change" control={<Radio size="small" />} label="Until it changes" />
          <FormControlLabel value="30" control={<Radio size="small" />} label="For 30 days" />
        </RadioGroup>
        <TextField
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          fullWidth
          multiline
          minRows={2}
          size="small"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => item && onDismiss(item, duration === '30' ? 30 : null, note)}>Dismiss</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DismissNoteDialog;
