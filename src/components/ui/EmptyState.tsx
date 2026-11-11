'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** A button or link that gets the user unstuck. */
  action?: React.ReactNode;
  /** Tighter spacing for use inside a panel. */
  compact?: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action, compact }) => (
  <Box
    role="status"
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 1,
      py: compact ? 3 : 6,
      px: 2,
      color: 'text.secondary',
    }}
  >
    {icon && <Box sx={{ color: 'text.disabled', '& svg': { fontSize: 32 } }}>{icon}</Box>}
    <Typography variant="subtitle1" color="text.primary">{title}</Typography>
    {description && <Typography variant="body2" sx={{ maxWidth: '56ch' }}>{description}</Typography>}
    {action && <Box sx={{ mt: 1 }}>{action}</Box>}
  </Box>
);

export default EmptyState;
