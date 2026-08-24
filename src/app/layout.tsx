'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  useMediaQuery,
  Tooltip,
  Typography,
} from '@mui/material';
import { ChevronLeft, Menu as MenuIcon, Settings } from '@mui/icons-material';
import { usePathname } from 'next/navigation';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import { ThemeProvider } from '@emotion/react';
import { AppProvider } from '@toolpad/core/AppProvider';
import ProfileAccess from './_components/ProfileAccess';
import useAuthenticationStore from '@/store/useAuthenticationStore';
import theme from './theme';
import { BUTTON_LABELS } from '@/constants/global';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const DRAWER_WIDTH = 280;
  const { authenticated, checkSession } = useAuthenticationStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  const navLinks = useMemo(() => [
    { label: BUTTON_LABELS.dashboard, href: '/dashboard' },
    { label: BUTTON_LABELS.myLibrary, href: '/dashboard/my-library' },
    { label: 'Movie Organizer', href: '/dashboard/movie-organization' },
    { label: 'TV Organizer', href: '/dashboard/show-organization' },
    { label: BUTTON_LABELS.ingressAutomation, href: '/ingress-automation' },
    { label: BUTTON_LABELS.admin, href: '/admin' },
    { label: 'Settings', href: '/settings' },
  ], []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <html lang="en">
      <body>
        <AppProvider theme={theme}>
          <ThemeProvider theme={theme}>
            <MediaSelectorProvider>
              <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                variant={isDesktop ? 'persistent' : 'temporary'}
                ModalProps={{
                  keepMounted: true,
                }}
                PaperProps={{
                  sx: {
                    width: DRAWER_WIDTH,
                    backgroundColor: '#1f1f1f',
                    color: '#fff',
                    borderRight: '1px solid #333',
                  },
                }}
              >
                <Box sx={Styles.drawerHeader}>
                  <Typography variant="h6" sx={{ color: '#fff' }}>Navigation</Typography>
                  <IconButton onClick={() => setDrawerOpen(false)} sx={{ color: '#fff' }} aria-label="Close navigation">
                    <ChevronLeft />
                  </IconButton>
                </Box>
                <List sx={{ pt: 0 }}>
                  {navLinks.map((item) => {
                    const selected = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                    return (
                      <ListItem key={item.href} disablePadding>
                        <ListItemButton
                          component={Link}
                          href={item.href}
                          onClick={() => setDrawerOpen(false)}
                          sx={{
                            py: 1.2,
                            px: 2,
                            backgroundColor: selected ? 'rgba(25, 118, 210, 0.2)' : 'transparent',
                            borderLeft: selected ? '3px solid #1976d2' : '3px solid transparent',
                            '&:hover': {
                              backgroundColor: 'rgba(255,255,255,0.08)',
                            },
                          }}
                        >
                          <ListItemText primary={item.label} />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Drawer>

              {/* Header */}
              <Box component="header" sx={Styles.header}>
                <Box sx={Styles.headerLeft}>
                  <Tooltip title="Open navigation">
                    <IconButton color="inherit" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" sx={{ color: '#fff' }}>
                      <MenuIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={Styles.headerCenter}>
                  <Typography variant="h6" sx={Styles.headerTitle}>
                    Media Manager
                  </Typography>
                </Box>
                <Box sx={Styles.headerRight}>
                  <Tooltip title="Settings">
                    <Link href="/settings" passHref>
                      <IconButton color="inherit" aria-label="Settings" sx={{ color: '#fff', mr: 1 }}>
                        <Settings />
                      </IconButton>
                    </Link>
                  </Tooltip>
                  {authenticated ? (
                    <ProfileAccess />
                  ) : (
                    <Link href="/login" passHref>
                      <Button variant="contained" color="primary" sx={Styles.headerButton}>
                        {BUTTON_LABELS.signIn}
                      </Button>
                    </Link>
                  )}
                </Box>
              </Box>

              {/* Main Content */}
              {!drawerOpen && isDesktop && (
                <Button
                  variant="contained"
                  onClick={() => setDrawerOpen(true)}
                  sx={Styles.drawerEdgeTab}
                  aria-label="Open navigation sidebar"
                >
                  Open Menu
                </Button>
              )}

              <Box component="main" sx={{ ...Styles.main, ml: drawerOpen && isDesktop ? `${DRAWER_WIDTH}px` : 0 }}>
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
    gap: '6px',
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
    transition: 'margin-left 0.2s ease-in-out',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    p: 1.5,
    borderBottom: '1px solid #333',
  },
  drawerEdgeTab: {
    position: 'fixed',
    left: 0,
    top: 70,
    zIndex: 1201,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    minWidth: 40,
    px: 1,
    py: 1,
    backgroundColor: '#1976d2',
    '&:hover': {
      backgroundColor: '#115293',
    },
  },
};