'use client'

import React from 'react';
import Link from 'next/link';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import './globals.css'; // Import the global CSS file
import { ThemeProvider } from '@emotion/react';
import { createTheme } from '@mui/material/styles';


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
      primary: '#000000',
      secondary: '#aaaaaa',
    },
  },
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`dark-theme`}>
        <ThemeProvider theme={theme}>
          <MediaSelectorProvider>
            <header className="header">
              <div className="header-left">
                <Link href="/dashboard">
                  <button className="header-button">Dashboard</button>
                </Link>
              </div>
              <div className="header-center">
                <h1 className="header-title">My App</h1>
              </div>
              <div className="header-right">
                <Link href="/signup">
                  <button className="header-button">Login/Sign Up</button>
                </Link>
              </div>
            </header>
            <main className="main-content">
              {children}
            </main>
          </MediaSelectorProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}