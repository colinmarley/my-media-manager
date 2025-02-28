'use client'

import React from 'react';
import SeasonForm from '../_components/SeasonForm';

const SeasonPage: React.FC = () => {
  return (
    <div>
      <h1>Add New Season</h1>
      <SeasonForm />
    </div>
  );
};

export default SeasonPage;