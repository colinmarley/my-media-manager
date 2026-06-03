"use client";

import { Box, Grid, Typography } from '@mui/material';
import DashboardCard from './_components/DashboardCard';

const Dashboard = () => {
  const dashboardLinks = [
    { title: 'My Library', description: 'Browse and manage your saved movies and shows.', href: '/dashboard/my-library' },
    { title: 'Movie Organizer', description: 'Preview and apply Jellyfin extras organization for processed movie folders.', href: '/dashboard/movie-organization' },
    { title: 'TV Organizer', description: 'Preview and apply Jellyfin show episode/special/extras organization for processed TV folders.', href: '/dashboard/show-organization' },
    { title: 'Ingress Automation', description: 'Monitor ingestion queue and automation health.', href: '/ingress-automation' },
    { title: 'Tape Ingest', description: 'Digitize VHS, VHS-C, and Mini DV tapes — scan, classify, and send to Jellyfin.', href: '/admin/tape-ingest' },
    { title: 'Admin', description: 'Manage records, scanning, and tools.', href: '/admin' },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>
        Dashboard
      </Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Choose a workspace below.
      </Typography>

      <Grid container spacing={2}>
        {dashboardLinks.map((link) => (
          <DashboardCard key={link.href} {...link} />
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;