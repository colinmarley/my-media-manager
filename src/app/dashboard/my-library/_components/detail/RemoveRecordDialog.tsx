'use client';

import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

import { MediaFile } from '@/types/library/MediaFile.type';

interface Props {
  /** The missing file whose record would be removed; null keeps the dialog closed. */
  file: MediaFile | null;
  onClose: () => void;
  /** Removes the record and reports the outcome itself (toast, refetch). */
  onConfirm: (file: MediaFile) => Promise<unknown>;
}

/** Confirms forgetting a file that is gone from disk. Nothing on disk changes. */
const RemoveRecordDialog = ({ file, onClose, onConfirm }: Props) => {
  const [removing, setRemoving] = useState(false);

  const confirm = async () => {
    if (!file) return;
    setRemoving(true);
    try {
      await onConfirm(file);
    } finally {
      setRemoving(false);
      onClose();
    }
  };

  return (
    <Dialog open={file !== null} onClose={removing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Remove this record?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ wordBreak: 'break-word' }}>
          <strong>{file?.fileName}</strong> is no longer on disk. Removing the record makes the library forget it,
          along with its link to a disc or tape. No file is deleted. If the file comes back, the next scan lists it
          again as a new file.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={removing}>Cancel</Button>
        <Button onClick={confirm} color="error" variant="contained" disabled={removing}>
          {removing ? 'Removing…' : 'Remove record'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RemoveRecordDialog;
