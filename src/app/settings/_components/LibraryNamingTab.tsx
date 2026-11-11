'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';

/**
 * The library settings (Jellyfin root, naming conventions, auto-matching) are
 * edited on /admin/library, where they share state with the scan tools and
 * the folder browser; they are linked rather than embedded.
 */
export default function LibraryNamingTab() {
  return (
    <Box sx={{ maxWidth: 600 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" component="h2" gutterBottom>Library &amp; naming</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The Jellyfin root path, naming conventions and auto-matching rules are edited alongside your
            library paths, where scans and the folder browser use them.
          </Typography>
          <Button variant="contained" component={Link} href="/admin/library?tab=settings">
            Open library settings
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
