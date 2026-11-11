'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@emotion/react';
import { AppProvider } from '@toolpad/core/AppProvider';
import { MediaSelectorProvider } from '@/context/MediaSelectorContext';
import { NotificationProvider } from '@/context/NotificationContext';
import AppShell from '@/components/shell/AppShell';
import { isShellHidden } from '@/components/shell/navConfig';
import useAuthenticationStore from '@/store/useAuthenticationStore';
import { fontVariables } from '@/theme/fonts';
import theme from './theme';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { checkSession } = useAuthenticationStore();
  const pathname = usePathname();

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <html lang="en" className={fontVariables}>
      <body>
        <AppProvider theme={theme}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <NotificationProvider>
              <MediaSelectorProvider>
                {isShellHidden(pathname) ? children : <AppShell>{children}</AppShell>}
              </MediaSelectorProvider>
            </NotificationProvider>
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
