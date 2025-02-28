'use client'

import React from 'react';
import EpisodeForm from '../_components/EpisodeForm';

const EpisodePage: React.FC = () => {
  return (
    <div>
      <h1>Add New Episode</h1>
      <EpisodeForm />
    </div>
  );
};

export default EpisodePage;