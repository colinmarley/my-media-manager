'use client';

import React, { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Tabs, Tab, Box } from '@mui/material';
import useAdminStore from '@/store/useAdminStore';

interface AdminLayoutProps {
  children: ReactNode;
}

const ROUTE_TABS = [
  { label: 'Tape Ingest', href: '/admin/tape-ingest' },
  { label: 'Disc Ripper', href: '/admin/disc-ripper' },
  { label: 'Settings', href: '/admin/settings' },
];

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { selectedType, setSelectedType } = useAdminStore();
  const activeRouteTab = ROUTE_TABS.find((t) => pathname.startsWith(t.href))?.href ?? null;

  React.useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (!requestedView) return;
    const validViews = new Set(['Movie','Release','Series','Season','Episode','Disc','Collection','ImageManager','LibraryCompliance']);
    if (validViews.has(requestedView) && requestedView !== selectedType) {
      setSelectedType(requestedView);
    }
  }, [selectedType, setSelectedType]);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Route-based tabs for standalone pages */}
      <Tabs
        value={activeRouteTab ?? false}
        onChange={(_: React.SyntheticEvent, href: string) => router.push(href)}
        indicatorColor="secondary"
        textColor="secondary"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {ROUTE_TABS.map((t) => <Tab key={t.href} label={t.label} value={t.href} />)}
      </Tabs>

      {/* State-based tabs for the main admin page */}
      {!activeRouteTab && (
        <Tabs
          value={selectedType.length ? selectedType : 'Movie'}
          onChange={(_event: React.SyntheticEvent, newValue: string) => setSelectedType(newValue)}
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
          <Tab label="Library Compliance" value="LibraryCompliance" />
        </Tabs>
      )}

      <Box sx={{ padding: 2 }}>
        {children}
      </Box>
    </Box>
  );
};

export default AdminLayout;
