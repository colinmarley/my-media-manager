'use client'

import React from 'react';
import MovieForm from '../_components/MovieForm';

const MoviePage: React.FC = () => {
  return (
    <div>
      <h1>Add New Movie</h1>
      <MovieForm />
    </div>
  );
};

export default MoviePage;