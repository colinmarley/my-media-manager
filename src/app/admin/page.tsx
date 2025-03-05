"use client";

import React from 'react';
import CollectionForm from './_components/CollectionForm';
import AddDiscForm from './_components/DiscForm';
import EpisodeForm from './_components/EpisodeForm';
import MovieForm from './_components/MovieForm';
import SeasonForm from './_components/SeasonForm';
import SeriesForm from './_components/SeriesForm';
import ImageManager from './imageManager/_components/ImageManager';
import { Box, SelectChangeEvent } from '@mui/material';
import useAdminStore from '../../store/useAdminStore';

const AdminPage: React.FC = () => {
  const { selectedType } = useAdminStore();

  return (
    <Box sx={{ padding: 2 }}>
      {selectedType && <AdminFormComponent type={selectedType} />}
    </Box>
  );
};

interface AdminFormComponentProps {
  type: string;
}

const AdminFormComponent: React.FC<AdminFormComponentProps> = ({ type }) => {
  switch (type) {
    case 'Disc':
      return <AddDiscForm />;
    case 'Movie':
      return <MovieForm />;
    case 'Collection':
      return <CollectionForm />;
    case 'Series':
      return <SeriesForm />;
    case 'Season':
      return <SeasonForm />;
    case 'Episode':
      return <EpisodeForm />;
    case 'ImageManager':
      return <ImageManager />;
    default:
      return null;
  }
};

export default AdminPage;