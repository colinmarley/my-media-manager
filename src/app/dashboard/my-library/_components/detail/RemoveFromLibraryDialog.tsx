import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import React from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  error: string | null;
  deleting: boolean;
  onConfirm: () => void;
}

/**
 * Removing a title from the catalog never deletes files outright: an organized folder is moved
 * to _NeedsReview so the user decides later.
 */
const RemoveFromLibraryDialog = ({ open, onClose, title, error, deleting, onConfirm }: Props) => (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
    <DialogTitle>Remove from Library?</DialogTitle>
    <DialogContent>
      <Typography>
        <strong>{title}</strong> will be removed from your catalog.
      </Typography>
      <Typography sx={{ mt: 1 }}>
        If an organized folder exists on disk, it will be moved to <strong>_NeedsReview</strong> so you can decide whether to reprocess or permanently delete the files.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={deleting}>
        Cancel
      </Button>
      <Button
        variant="contained"
        color="error"
        onClick={onConfirm}
        disabled={deleting}
        startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
      >
        {deleting ? 'Removing…' : 'Remove'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default RemoveFromLibraryDialog;
