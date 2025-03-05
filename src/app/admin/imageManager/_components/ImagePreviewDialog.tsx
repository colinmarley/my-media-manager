import React, { useMemo } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Typography } from '@mui/material';
import useImageStore from '@/store/useImageStore';

interface ImagePreviewDialogProps {
  previewUrl: string | null;
  newName: string;
  subfolder: string;
  renameMessage: string;
  handleNewNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubfolderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRenamePreview: () => void;
  handleClosePreview: () => void;
}

const ImagePreview = useMemo(() => {
    const { previewUrl } = useImageStore();
    return (
        <div>
            {previewUrl && <img src={previewUrl} alt="Preview" style={{ width: '100%' }} />}
        </div>
    )
  }, [] );

const ImagePreviewDialog: React.FC<ImagePreviewDialogProps> = ({
  previewUrl,
  handleRenamePreview,
  handleClosePreview,
}) => {
  const { newName, subfolder, renameMessage, setNewName, setSubfolder } = useImageStore();

  return (
    <Dialog open={Boolean(previewUrl)} onClose={handleClosePreview}>
      <DialogTitle>Image Preview</DialogTitle>
      <DialogContent>
        {previewUrl && <img src={previewUrl} alt="Preview" style={{ width: '100%' }} />}
        {/* <ImagePreview /> */}
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
          onClick={handleRenamePreview}>
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