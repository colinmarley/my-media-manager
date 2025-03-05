'use client';

import React, { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Tabs, Tab, Box } from '@mui/material';
import useAdminStore from '@/store/useAdminStore';

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { selectedType, setSelectedType } = useAdminStore();

  const handleChange = (event: React.ChangeEvent<{}>, newValue: string) => {
    // router.push(newValue);
    setSelectedType(newValue);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs
        value={selectedType.length ? selectedType : "Movie"}
        onChange={handleChange}
        indicatorColor="primary"
        textColor="primary"
        centered
      >
        <Tab label="Movies" value="Movie" />
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