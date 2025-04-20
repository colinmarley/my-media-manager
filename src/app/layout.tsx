'use client';

import React from 'react';
import Link from 'next/link';
import { Container, Box, Typography, Button } from '@mui/material';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import { ThemeProvider } from '@emotion/react';
import { AppProvider } from '@toolpad/core/AppProvider';
import ProfileAccess from './_components/ProfileAccess';
import useAuthenticationStore from '@/store/useAuthenticationStore';
import theme from './theme';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = useAuthenticationStore();

  return (
    <html lang="en">
      <body>
        <AppProvider theme={theme}>
          <ThemeProvider theme={theme}>
            <MediaSelectorProvider>
              {/* Header */}
              <Box component="header" sx={Styles.header}>
                <Box sx={Styles.headerLeft}>
                  <Link href="/dashboard" passHref>
                    <Button variant="contained" color="primary" sx={Styles.headerButton}>
                      Dashboard
                    </Button>
                  </Link>
                  <Link href="/admin" passHref>
                    <Button variant="contained" color="primary" sx={Styles.headerButton}>
                      Admin
                    </Button>
                  </Link>
                  <Link href="/dashboard/media" passHref>
                    <Button variant="contained" color="primary" sx={Styles.headerButton}>
                      Media
                    </Button>
                  </Link>
                </Box>
                <Box sx={Styles.headerCenter}>
                  <Typography variant="h6" sx={Styles.headerTitle}>
                    My App
                  </Typography>
                </Box>
                <Box sx={Styles.headerRight}>
                  {user ? (
                    <ProfileAccess />
                  ) : (
                    <Link href="/signup" passHref>
                      <Button variant="contained" color="primary" sx={Styles.headerButton}>
                        Login/Sign Up
                      </Button>
                    </Link>
                  )}
                </Box>
              </Box>

              {/* Main Content */}
              <Box component="main" sx={Styles.main}>
                {children}
              </Box>
            </MediaSelectorProvider>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}

const Styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 20px',
    backgroundColor: '#3a3a3a',
    borderBottom: '1px solid #444',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerTitle: {
    margin: 0,
    fontSize: '24px',
    textAlign: 'center',
    color: '#ffffff',
  },
  headerButton: {
    padding: '10px 20px',
    fontSize: '16px',
    borderRadius: '5px',
    transition: 'background-color 0.3s',
    '&:hover': {
      backgroundColor: '#0056b3',
    },
  },
  main: {
    padding: '20px',
    backgroundColor: '#2f2f2f',
    color: '#ffffff',
    minHeight: 'calc(100vh - 60px)', // Adjust for header height
  },
};