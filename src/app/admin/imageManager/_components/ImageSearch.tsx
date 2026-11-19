import React, { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import ImageList from '@mui/material/ImageList';
import ImageListItem from '@mui/material/ImageListItem';
import ImageListItemBar from '@mui/material/ImageListItemBar';
import ImageService from '../../../../service/image/ImageService';

const ImageSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);

  const imageService = new ImageService();

  const handleSearch = async () => {
    try {
      const results = await imageService.searchImages(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching images:', error);
      setSearchResults([]);
    } finally {
      setSearched(true);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Find a saved image</Typography>
      <Stack direction="row" spacing={1} sx={{ maxWidth: 480 }}>
        <TextField
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
          placeholder="File name"
          slotProps={{ htmlInput: { 'aria-label': 'Search saved images' } }}
        />
        <Button variant="outlined" onClick={handleSearch}>Search</Button>
      </Stack>
      {searched && searchResults.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>No saved images match that name.</Typography>
      )}
      {searchResults.length > 0 && (
        <ImageList cols={4} gap={12} sx={{ mt: 2, maxWidth: 640, maxHeight: 450 }}>
          {searchResults.map((file, index) => (
            <ImageListItem key={index}>
              <img src={`/api/backend${file}`} alt={file} loading="lazy" />
              <ImageListItemBar title={file.split('/').pop()} position="below" />
            </ImageListItem>
          ))}
        </ImageList>
      )}
    </Box>
  );
};

export default ImageSearch;
