'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import ProfileAccess from '@/app/_components/ProfileAccess';
import useAuthenticationStore from '@/store/useAuthenticationStore';
import { BUTTON_LABELS } from '@/constants/global';
import { borders, layout, surfaces, text } from '@/theme/tokens';

export interface TopBarProps {
  /** Group the current page sits in ("Library"); omitted for Home. */
  section?: string | null;
  title: string;
  showMenuButton: boolean;
  onOpenMenu: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ section, title, showMenuButton, onOpenMenu }) => {
  const { authenticated } = useAuthenticationStore();

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        height: layout.topBarHeight,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: layout.pageGutter,
        bgcolor: surfaces.chrome,
        borderBottom: `1px solid ${borders.subtle}`,
      }}
    >
      {showMenuButton && (
        <IconButton edge="start" onClick={onOpenMenu} aria-label="Open navigation" sx={{ color: text.secondary }}>
          <MenuIcon />
        </IconButton>
      )}
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 1 }}>
        {section && (
          <>
            <Typography variant="body2" color="text.secondary" noWrap>{section}</Typography>
            <Typography variant="body2" color="text.disabled" aria-hidden>/</Typography>
          </>
        )}
        <Typography variant="body2" component="p" noWrap sx={{ fontWeight: 600 }} data-testid="shell-page-title">
          {title}
        </Typography>
      </Box>
      {authenticated ? (
        <ProfileAccess />
      ) : (
        <Button component={Link} href="/login" variant="outlined" size="small">
          {BUTTON_LABELS.signIn}
        </Button>
      )}
    </Box>
  );
};

export default TopBar;
