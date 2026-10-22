import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { Button, Stack } from '@mui/material';
import Link from 'next/link';

/** Back link plus the "Remove from Library" entry point. */
const MediaDetailHeaderBar = ({ hasMedia, onRemoveFromLibrary }: { hasMedia: boolean; onRemoveFromLibrary: () => void }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
    <Button
      component={Link}
      href="/dashboard/my-library"
      variant="text"
      startIcon={<ArrowBackIcon />}
      sx={{ color: '#cde7ff' }}
    >
      Back to My Library
    </Button>
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
