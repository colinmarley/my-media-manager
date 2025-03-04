import React, { useState } from 'react';
import ImageService from '../../../../service/ImageService';
import { Button, TextField, Typography, Box, IconButton, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { CopyAll, Preview } from '@mui/icons-material';

const ImageManager: React.FC = () => {
  const [listResults, setListResults] = useState<{ name: string; url: string }[]>([]);
  const [currentName, setCurrentName] = useState('');
  const [newName, setNewName] = useState('');
  const [subfolder, setSubfolder] = useState('');
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>('');
  const [renameMessage, setRenameMessage] = useState<string>('');

  const imageService = new ImageService();

  const handleList = async () => {
    try {
      const results = await imageService.listImages();
      setListResults(results);
    } catch (error) {
      console.error('Error listing images:', error);
    }
  };

  const handleRename = async () => {
    try {
      const resultMessage = await imageService.renameImage(currentName, newName, subfolder);
      setMessage(resultMessage);
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  };

  const handleCopy = (name: string) => {
    navigator.clipboard.writeText(name);
    alert(`Copied: ${name}`);
  };

  const handlePreview = async (name: string, url: string) => {
    setPreviewUrl(`http://localhost:8082${url}`);
    setPreviewName(name);
  };

  const handleClosePreview = () => {
    setPreviewUrl(null);
    setPreviewName('');
    setRenameMessage('');
  };

  const handleRenamePreview = async () => {
    try {
      const resultMessage = await imageService.renameImage(previewName, newName, subfolder);
      setRenameMessage(resultMessage);
      setPreviewName(newName);
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Image Manager
      </Typography>
      <Box mb={4}>
        <Typography variant="h6">List Images</Typography>
        <Button variant="contained" color="primary" onClick={handleList}>
          List Images
        </Button>
        <Box mt={2}>
          {listResults.map((image) => (
            <Box key={image.name} display="flex" alignItems="center" mb={2}>
              <Typography variant="body1" sx={{ flexGrow: 1 }}>
                {image.name}
              </Typography>
              <IconButton onClick={() => handleCopy(image.name)}>
                <CopyAll />
              </IconButton>
              <IconButton onClick={() => handlePreview(image.name, image.url)}>
                <Preview />
              </IconButton>
            </Box>
          ))}
        </Box>
      </Box>
      <Box mb={4}>
        <Typography variant="h6">Rename Image</Typography>
        <TextField
          label="Current Name"
          value={currentName}
          onChange={(e) => setCurrentName(e.target.value)}
          fullWidth
          margin="normal"
        />
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
        <Button variant="contained" color="primary" onClick={handleRename}>
          Rename
        </Button>
        {message && (
          <Typography variant="body1" color="success.main" mt={2}>
            {message}
          </Typography>
        )}
      </Box>
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
          <Button variant="contained" color="primary" onClick={handleRenamePreview}>
            Rename
          </Button>
          {renameMessage && (
            <Typography variant="body1" color="success.main" mt={2}>
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
    </Box>
  );
};

export default ImageManager;