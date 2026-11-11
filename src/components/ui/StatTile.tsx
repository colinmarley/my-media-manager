'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Paper, Skeleton, Typography } from '@mui/material';
import { status as statusColors, type StatusTone } from '@/theme/tokens';

export interface StatTileProps {
  label: string;
  /** null while loading (renders a skeleton). */
  value: React.ReactNode | null;
  /** Small line under the value ("of 412 discs"). */
  detail?: React.ReactNode;
  /** Colours the value; omit for plain numbers. */
  tone?: StatusTone;
  /** Makes the tile a link. */
  href?: string;
  loading?: boolean;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, detail, tone, href, loading }) => {
  const isLoading = loading || value === null;
  const body = (
    <>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography
        variant="h2"
        component="p"
        sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums', color: tone ? statusColors[tone].fg : 'text.primary' }}
      >
        {isLoading ? <Skeleton width={56} /> : value}
      </Typography>
      {detail && !isLoading && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25 }}>
          {detail}
        </Typography>
      )}
    </>
  );

  const sx = { display: 'block', p: 2, height: '100%', boxSizing: 'border-box', textDecoration: 'none', color: 'inherit' } as const;

  if (href) {
    return (
      <Paper
        variant="outlined"
        component={Link}
        href={href}
        sx={{ ...sx, '&:hover': { borderColor: 'text.disabled' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
      >
        {body}
      </Paper>
    );
  }
  return (
    <Paper variant="outlined" sx={sx}>
      <Box>{body}</Box>
    </Paper>
  );
};

export default StatTile;
