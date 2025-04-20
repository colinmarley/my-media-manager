import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { CopyAll, Preview } from '@mui/icons-material';

interface ImageListComponentProps {
  listResults: { name: string; url: string }[];
  handleCopy: (name: string) => void;
  handlePreview: (name: string, url: string) => void;
}

const ImageListComponent: React.FC<ImageListComponentProps> = ({ listResults, handleCopy, handlePreview }) => {
  return (
    <Box mt={2} overflow={'auto'} maxHeight={400}>
      {listResults.map((image) => (
        <Box key={image.name} display="flex" alignItems="center" mb={2}>
          <Typography variant="body1" sx={Styles.imageName}>
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
  );
};

const Styles = {
  imageName: {
    flexGrow: 1,
  },
}

export default ImageListComponent;