import React from 'react';
import styles from '../_styles/MovieTile.module.css';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import Container from '@mui/material/Container';

interface MovieTileProps {
  movieInfo: OmdbSearchResponse;
}

const MovieTile: React.FC<MovieTileProps> = ({movieInfo}) => {
  return (
    <Container key={movieInfo.imdbID} className={styles.movieTile}>
      <img src={movieInfo.Poster} alt={`${movieInfo.Title} poster`} className={styles.poster} />
      <Container className={styles.details}>
        <h3>{movieInfo.Title}</h3>
        <p><strong>Year:</strong> {movieInfo.Year}</p>
      </Container>
    </Container>
  );
};

export default MovieTile;