import React from 'react';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';

interface MovieTileProps {
  movieInfo: OmdbSearchResponse;
}

const MovieTile: React.FC<MovieTileProps> = ({ movieInfo }) => {
  return (
    <Grid container sx={Styles.movieTile}>
      <Grid size={6}>
        {/* Movie Poster */}
        <Box
          component="img"
          src={movieInfo.Poster}
          alt={`${movieInfo.Title} poster`}
          sx={Styles.poster}
        />
      </Grid>
      <Grid size={6}>
        {/* Movie Details */}
        <Box sx={Styles.details}>
          <Typography variant="h6" sx={Styles.title}>
            {movieInfo.Title}
          </Typography>
          <Typography variant="body2" sx={Styles.text}>
            <strong>Year:</strong> {movieInfo.Year}
          </Typography>
        </Box>
      </Grid>
    </Grid>
  );
};

const Styles = {
  movieTile: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px',
    margin: '10px 0',
    backgroundColor: '#2a2a2a', // Darker background for tiles
    borderRadius: '10px',
    boxShadow: '0 0 5px rgba(0, 255, 255, 0.5)', // Neon glow effect
    color: '#00ffff', // Neon cyan text
  },
  poster: {
    width: '100px',
    height: 'auto',
    borderRadius: '5px',
    marginRight: '20px',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    margin: 0,
    marginBottom: '10px',
  },
  text: {
    margin: '5px 0',
  },
};

export default MovieTile;