import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Button, CircularProgress, Stack } from '@mui/material';
import React from 'react';
import Link from 'next/link';

interface Props {
  hasMedia: boolean;
  onRemoveFromLibrary: () => void;
  /** Omit to hide "Rescan files" (e.g. a backend without the file inventory). */
  onRescan?: () => void;
  scanning?: boolean;
}

/** The title page's actions: back to the library, rescan the library's files, remove the title. */
const MediaDetailHeaderBar = ({ hasMedia, onRemoveFromLibrary, onRescan, scanning = false }: Props) => (
  <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
    <Button component={Link} href="/dashboard/my-library" variant="text" startIcon={<ArrowBackIcon />}>
      Back to My Library
    </Button>
    {hasMedia && onRescan && (
      <Button
        variant="outlined"
        size="small"
        startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />}
        onClick={onRescan}
        disabled={scanning}
      >
        {scanning ? 'Scanning…' : 'Rescan files'}
      </Button>
    )}
    {hasMedia && (
      <Button
        variant="outlined"
        color="error"
        size="small"
        startIcon={<DeleteForeverIcon />}
        onClick={onRemoveFromLibrary}
      >
        Remove from Library
      </Button>
    )}
  </Stack>
);

export default MediaDetailHeaderBar;
