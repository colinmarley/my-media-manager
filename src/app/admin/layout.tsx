'use client';

import React, { ReactNode } from 'react';
import { Tabs, Tab, Box } from '@mui/material';
import useAdminStore from '@/store/useAdminStore';

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const { selectedType, setSelectedType } = useAdminStore();

  React.useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (!requestedView) {
      return;
    }

    const validViews = new Set([
      'Movie',
      'Release',
      'Series',
      'Season',
      'Episode',
      'Disc',
      'Collection',
      'ImageManager',
    ]);

    if (validViews.has(requestedView) && requestedView !== selectedType) {
      setSelectedType(requestedView);
    }
  }, [selectedType, setSelectedType]);

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    setSelectedType(newValue);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={selectedType.length ? selectedType : "Movie"}
        onChange={handleChange}
        indicatorColor="primary"
        textColor="primary"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab label="Movies" value="Movie" />
        <Tab label="Release" value="Release" />
        <Tab label="Series" value="Series" />
        <Tab label="Seasons" value="Season" />
        <Tab label="Episodes" value="Episode" />
        <Tab label="Discs" value="Disc" />
        <Tab label="Collection" value="Collection" />
        <Tab label="Image Manager" value="ImageManager" />
      </Tabs>
      <Box sx={{ padding: 2 }}>
        {children}
      </Box>
    </Box>
  );
};

export default AdminLayout;