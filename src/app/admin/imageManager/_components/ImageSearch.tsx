import React, { useState } from 'react';
import ImageList from '@mui/material/ImageList';
import ImageListItem from '@mui/material/ImageListItem';
import ImageListItemBar from '@mui/material/ImageListItemBar';
import ImageService from '../../../../service/ImageService';

const ImageSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);

  const imageService = new ImageService();

  const handleSearch = async () => {
    try {
      const results = await imageService.searchImages(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching images:', error);
    }
  };

  return (
    <div>
      <h2>Search Images</h2>
      <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search query" />
      <button onClick={handleSearch}>Search</button>
      <ImageList sx={{ width: 500, height: 450 }}>
        {searchResults.map((file, index) => (
          <ImageListItem key={index}>
            <img
              src={`http://localhost:8082${file}`}
              alt={file}
              loading="lazy"
            />
            <ImageListItemBar
              title={file.split('/').pop()}
              position="below"
            />
          </ImageListItem>
        ))}
      </ImageList>
    </div>
  );
};

export default ImageSearch;