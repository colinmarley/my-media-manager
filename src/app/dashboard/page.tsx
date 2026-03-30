"use client";

import Link from 'next/link';
import { Box, Button, Card, CardContent, Grid, Typography } from '@mui/material';

const Dashboard = () => {
  const dashboardLinks = [
    { title: 'My Library', description: 'Browse and manage your saved movies and shows.', href: '/dashboard/my-library' },
    { title: 'Ingress Automation', description: 'Monitor ingestion queue and automation health.', href: '/ingress-automation' },
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
          <Grid key={link.href} size={{ xs: 12, sm: 6 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {link.title}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {link.description}
                </Typography>
                <Button component={Link} href={link.href} variant="contained">
                  Open
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;