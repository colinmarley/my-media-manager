'use client'

import React, { useEffect, useState } from 'react';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import './globals.css'; // Import the global CSS file
import { ThemeProvider } from '@emotion/react';
import { createTheme } from '@mui/material/styles';
import { AppProvider } from '@toolpad/core/AppProvider';
import useAuth from '@/hooks/useAuth';
import useAuthenticationStore from '@/store/useAuthenticationStore';
import Link from '@mui/material/Link';
import { Avatar, Button, ButtonGroup } from '@mui/material';
import { deepOrange } from '@mui/material/colors';


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
  const [displayName, setDisplayName] = useState<string | null>(null);
  const { handleLogout } = useAuth();

  useEffect(() => {
    if (user) {
      if (user.providerData[0].displayName) {
        setDisplayName(user.providerData[0].displayName);
      } else {
        setDisplayName(user.providerData[0].email);
      }
    } else {
      setDisplayName(null);
    }
  }, [user]);

  return (
    <html lang="en">
      <body className={`dark-theme`}>
        <AppProvider theme={theme}>
          <ThemeProvider theme={theme}>
            <MediaSelectorProvider>
              <header className="header">
                <div className="header-left">
                  <Link href="/dashboard">Dashboard</Link>
                </div>
                <div className="header-center">
                  <h1 className="header-title">My App</h1>
                </div>
                <div className="header-right">
                {user && (
                    <ButtonGroup>
                      <Button>
                        {displayName}
                      </Button>
                      <Avatar sx={{ bgcolor: deepOrange[500] }}></Avatar>
                      <Button onClick={handleLogout}>Logout</Button>
                    </ButtonGroup>
                  )}
                  {!user && (
                    <Link href="/signup">Login/Sign Up</Link>
                  )}
                </div>
              </header>
              <main className="main-content">
                {children}
              </main>
            </MediaSelectorProvider>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
