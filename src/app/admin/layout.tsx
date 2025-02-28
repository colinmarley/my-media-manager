'use client';

import React, { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Tabs, Tab, Box } from '@mui/material';

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (event: React.ChangeEvent<{}>, newValue: string) => {
    router.push(newValue);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={pathname}
        onChange={handleChange}
        indicatorColor="primary"
        textColor="primary"
        centered
      >
        <Tab label="Movies" value="/admin/movie" />
        <Tab label="Series" value="/admin/series" />
        <Tab label="Seasons" value="/admin/season" />
        <Tab label="Episodes" value="/admin/episode" />
        <Tab label="Resources" value="/admin/resource" />
        <Tab label="Discs" value="/admin/disc" />
        <Tab label="Collection" value="/admin/collection" />
        <Tab label="Image Manager" value="/admin/imageManager" />
      </Tabs>
      <Box sx={{ padding: 2 }}>
        {children}
      </Box>
    </Box>
  );
};

export default AdminLayout;