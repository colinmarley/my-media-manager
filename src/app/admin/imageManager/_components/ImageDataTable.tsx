import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TextField, Button } from '@mui/material';
import useImageStore, { ImageResult } from '../../../../store/useImageStore';

interface ImageDataTableProps {
  images: ImageResult[];
  handleRename: (currentName: string, newName: string, subfolder: string) => void;
}

const ImageDataTable: React.FC<ImageDataTableProps> = ({ images, handleRename }) => {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>('');
  const [subfolder, setSubfolder] = useState<string>('');

  const startEditing = (name: string) => {
    setEditingName(name);
    setNewName(name);
  };

  const stopEditing = () => {
    setEditingName(null);
    setNewName('');
    setSubfolder('');
  };

  const handleRenameClick = (ind: number) => {
    if (editingName) {
      handleRename(editingName, newName, subfolder);
      images[ind].name = newName;
      stopEditing();
    }
  };

  return (
    <TableContainer component={Paper}>
      {images && <Table sx={{ minWidth: 650 }} aria-label="image data table">
        <TableHead>
          <TableRow>
            <TableCell>Image Preview</TableCell>
            <TableCell>Image Name</TableCell>
            <TableCell>Parent Folder</TableCell>
            <TableCell>Size</TableCell>
            <TableCell>Last Modified</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {images.map((image, ind) => (
            <TableRow key={image.name}>
              <TableCell>
                <img src={`http://localhost:8082${image.url}`} alt={image.name} style={{ width: '150px', height: '90px' }} />
              </TableCell>
              <TableCell>
                {editingName === image.name ? (
                  <div>
                    <TextField
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        fullWidth
                        margin="normal"
                    />
                    <Button variant="contained" color="primary" onClick={() => handleRenameClick(ind)}>
                      Rename
                    </Button>
                    <Button variant="contained" color="secondary" onClick={stopEditing}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <span onClick={() => startEditing(image.name)}>{image.name}</span>
                )}
              </TableCell>
              <TableCell>{image.parentFolder}</TableCell>
              <TableCell>{image.size}</TableCell>
              <TableCell>{image.lastModified}</TableCell>
              {editingName === image.name && (
                <TableCell>
                  <TextField
                    label="Subfolder (optional)"
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    fullWidth
                    margin="normal"
                  />
                  <Button variant="contained" color="primary" onClick={() => handleRenameClick(ind)}>
                    Rename
                  </Button>
                  <Button variant="contained" color="secondary" onClick={stopEditing}>
                    Cancel
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>}
    </TableContainer>
  );
};

export default ImageDataTable;