import React, { useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Typography } from '@mui/material';
import useImageStore from '@/store/useImageStore';

interface ImagePreviewDialogProps {
  previewUrl: string | null;
  handleClosePreview: () => void;
}

const ImagePreviewDialog: React.FC<ImagePreviewDialogProps> = ({
  previewUrl,
  handleClosePreview,
}) => {
  const { renameMessage } = useImageStore();
  const [newName, setNewName] = useState('');
  const [subfolder, setSubfolder] = useState('');
  const { handleRenamePreview } = useImageStore();

  const renameImage = () => {
    handleRenamePreview(newName, subfolder);
    setNewName('');
    setSubfolder('');
  }

  return (
    <Dialog open={Boolean(previewUrl)} onClose={handleClosePreview}>
      <DialogTitle>Image Preview</DialogTitle>
      <DialogContent>
        {previewUrl && <img src={previewUrl} alt="Preview" style={{ width: '100%' }} />}
        <TextField
          label="New Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Subfolder (optional)"
          value={subfolder}
          onChange={(e) => setSubfolder(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Button
          variant="contained"
          color="primary"
          onClick={renameImage}>
          Rename
        </Button>
        {renameMessage && (
          <Typography
            variant="body1"
            color="success.main"
            mt={2}>
            {renameMessage}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClosePreview} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImagePreviewDialog;