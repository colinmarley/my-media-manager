import React from 'react';
import styles from './MovieTile.module.css';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';

interface MovieTileProps {
  movieInfo: OmdbSearchResponse;
}

const MovieTile: React.FC<MovieTileProps> = ({movieInfo}) => {
  return (
    <div className={styles.movieTile}>
      <img src={movieInfo.Poster} alt={`${movieInfo.Title} poster`} className={styles.poster} />
      <div className={styles.details}>
        <h3>{movieInfo.Title}</h3>
        <p><strong>Year:</strong> {movieInfo.Year}</p>
      </div>
    </div>
  );
};

export default MovieTile;