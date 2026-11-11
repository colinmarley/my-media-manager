'use client';

import React from 'react';
import { Alert, Button } from '@mui/material';

export interface SectionErrorProps {
  /** What could not be loaded, e.g. "Queue counts". */
  what: string;
  message: string;
  onRetry: () => void;
}

/** Inline, section-scoped failure with a retry, so one endpoint never blanks the page. */
const SectionError: React.FC<SectionErrorProps> = ({ what, message, onRetry }) => (
  <Alert
    severity="error"
    variant="outlined"
    action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}
    sx={{ mb: 2 }}
  >
    {what} could not be loaded. {message}
  </Alert>
);

export default SectionError;
