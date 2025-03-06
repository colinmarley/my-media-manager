import React, { useEffect, useCallback } from 'react';
import { Button, Typography, Box } from '@mui/material';
import { debounce } from 'lodash';
import useImageStore from '../../../../store/useImageStore';
import ImageListComponent from './ImageListComponent';
import ImagePreviewDialog from './ImagePreviewDialog';
import ImageEditorComponent from './ImageEditorComponent';
import ImageDataTable from './ImageDataTable';

const ImageManager: React.FC = () => {
  const {
    imageResults,
    currentName,
    newName,
    subfolder,
    message,
    previewUrl,
    previewName,
    renameMessage,
    setCurrentName,
    setMessage,
    setNewName,
    setSubfolder,
    setPreviewUrl,
    setPreviewName,
    setRenameMessage,
    handleList,
    handleRename,
    handleRenamePreview,
  } = useImageStore();

  const handleCopy = (name: string) => {
    navigator.clipboard.writeText(name);
  };

  const handlePreview = (name: string, url: string) => {
    setPreviewUrl(`http://localhost:8082${url}`);
    setPreviewName(name);
  };

  const handleClosePreview = () => {
    setPreviewUrl(null);
    setNewName('');
    setCurrentName('');
    setPreviewName('');
    setRenameMessage('');
  };

  const debouncedSetNewName = useCallback(
    debounce((value: string) => {
      setNewName(value);
    }, 300),
    []
  );

  const debouncedSetSubfolder = useCallback(
    debounce((value: string) => {
      setSubfolder(value);
    }, 300),
    []
  );

  const handleNewNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewName(e.target.value);
    debouncedSetNewName(e.target.value);
  };

  const handleSubfolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubfolder(e.target.value);
    debouncedSetSubfolder(e.target.value);
  };

  useEffect(() => {
    if (renameMessage) {
      handleList();
      handleClosePreview();
    }
  }, [renameMessage]);

  useEffect(() => {
    setTimeout(() => {
      setMessage('');
    }, 5000);
  }, [message]);

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
        <ImageDataTable images={imageResults} handleRename={handleRename} />
      </Box>
      <ImageEditorComponent
        currentName={currentName}
        newName={newName}
        subfolder={subfolder}
        message={message}
        setCurrentName={setCurrentName}
        handleNewNameChange={handleNewNameChange}
        handleSubfolderChange={handleSubfolderChange}
        handleRename={handleRename}
      />
      <ImagePreviewDialog
        previewUrl={previewUrl}
        handleClosePreview={handleClosePreview}
      />
    </Box>
  );
};

export default ImageManager;