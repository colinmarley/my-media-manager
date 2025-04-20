'use client'

import React from 'react';
import Link from 'next/link';
import Container from '@mui/material/Container';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import './globals.css'; // Import the global CSS file
import { ThemeProvider } from '@emotion/react';
import { createTheme } from '@mui/material/styles';
import { Button } from '@mui/material';
import { AppProvider } from '@toolpad/core/AppProvider';
import ProfileAccess from './_components/ProfileAccess';
import useAuthenticationStore from '@/store/useAuthenticationStore';

const theme = createTheme({
  palette: {
    mode: 'dark', // Example: dark mode
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    background: {
      default: '#121212',
      paper: '#1d1d1d',
    },
    text: {
      primary: '#ffffff',
      secondary: '#aaaaaa',
    },
  },
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = useAuthenticationStore();
  return (
    <html lang="en">
      <body className={`dark-theme`}>
        <AppProvider theme={theme}>
          <ThemeProvider theme={theme}>
            <MediaSelectorProvider>
              <header className="header">
                <Container className="header-left">
                  <Link href="/dashboard">
                    <Button className="header-button" variant="contained" color="primary">
                      Dashboard
                    </Button>
                  </Link>
                  <Link href="/admin">
                    <Button className="header-button" variant="contained" color="primary">
                      Admin
                    </Button>
                  </Link>
                </Container>
                <Container className="header-center">
                  <h1 className="header-title">My App</h1>
                </Container>
                <Container className="header-right">
                  {user && <ProfileAccess />}
                  {!user && (
                    <Link href="/signup">
                      <Button className="header-button" variant="contained" color="primary">
                        Login/Sign Up
                      </Button>
                    </Link>
                  )}
                </Container>
              </header>
              <main >
                {children}
              </main>
            </MediaSelectorProvider>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
