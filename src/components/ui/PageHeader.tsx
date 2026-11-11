'use client';

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { layout } from '@/theme/tokens';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Buttons / controls aligned to the right of the title. */
  actions?: React.ReactNode;
  /** Content under the title row (tabs, filters). */
  children?: React.ReactNode;
}

/** Title row every top-level page starts with. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, children }) => (
  <Box component="header" sx={{ mb: 3 }}>
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
      justifyContent="space-between"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h2" component="h1">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: '72ch' }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
          {actions}
        </Stack>
      )}
    </Stack>
    {children && <Box sx={{ mt: 2 }}>{children}</Box>}
  </Box>
);

export interface PageContainerProps {
  children: React.ReactNode;
  /** Caps the content width for form-like pages (px). */
  maxWidth?: number;
}

/** Standard page gutter. The shell's <main> has no padding of its own. */
export const PageContainer: React.FC<PageContainerProps> = ({ children, maxWidth }) => (
  <Box sx={{ px: layout.pageGutter, py: 3, maxWidth, boxSizing: 'content-box' }}>{children}</Box>
);

export default PageHeader;
