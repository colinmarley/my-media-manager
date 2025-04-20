import React from 'react';
import { Box, FormControl, Typography, TextField, Button } from '@mui/material';

interface ImageEditorComponentProps {
  currentName: string;
  newName: string;
  subfolder: string;
  message: string;
  setCurrentName: (name: string) => void;
  handleNewNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubfolderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRename: (currentName: string, newName: string, subfolder: string) => void;
}

const ImageEditorComponent: React.FC<ImageEditorComponentProps> = ({
  currentName,
  newName,
  subfolder,
  message,
  setCurrentName,
  handleNewNameChange,
  handleSubfolderChange,
  handleRename,
}) => {
  return (
    <Box mb={4}>
      <FormControl
        color="secondary"
        sx={Styles.formControl}
      >
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
          onChange={handleNewNameChange}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Subfolder (optional)"
          value={subfolder}
          onChange={handleSubfolderChange}
          fullWidth
          margin="normal"
        />
        <Button
          variant="contained"
          type="submit"
          color="primary"
          onClick={() => handleRename(currentName, newName, subfolder)}>
          Rename
        </Button>
        {message && (
          <Typography variant="body1" color="success.main" mt={2}>
            {message}
          </Typography>
        )}
      </FormControl>
    </Box>
  );
};

const Styles = {
  formControl: { display: 'flex', flexDirection: 'column', gap: 2 },
}

export default ImageEditorComponent;