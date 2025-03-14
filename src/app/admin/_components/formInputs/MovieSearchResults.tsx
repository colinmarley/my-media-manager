import React from 'react';
import { Grid, Typography, List, ListItem, ListItemButton, ListItemText } from '@mui/material';
import { OmdbSearchResponse } from '../../../../types/OmdbResponse.type';

interface MovieSearchResultsProps {
  omdbResults: OmdbSearchResponse[];
  handleMovieSelect: (title: string, year: string, imdbId: string) => void;
}

const MovieSearchResults: React.FC<MovieSearchResultsProps> = ({ omdbResults, handleMovieSelect }) => {
  return (
    <>
      {omdbResults.length > 0 && (
        <Grid item xs={12}>
          <Typography variant="h6">Search Results:</Typography>
          <List>
            {omdbResults.map((result, index) => (
              <ListItem key={`search-result-${index}`} disablePadding>
                <ListItemButton onClick={() => handleMovieSelect(result.Title, result.Year, result.imdbID)}>
                  <ListItemText primary={`${result.Title} (${result.Year})`} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Grid>
      )}
    </>
  );
};

export default MovieSearchResults;