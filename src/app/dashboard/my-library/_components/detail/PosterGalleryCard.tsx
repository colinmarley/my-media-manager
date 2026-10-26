import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import React from 'react';

import { PLACEHOLDER_POSTER } from '@/service/library/mediaDetailModel';
import styles from './mediaDetailStyles';

interface Props {
  mediaTypeFromRoute?: string;
  mediaIdFromRoute: string;
  title: string;
  posterIndex: number;
  posterCount: number;
  posterLoadFailed: boolean;
  posterCacheBust: number;
  setPosterIndex: React.Dispatch<React.SetStateAction<number>>;
  onPosterLoadError: (img: HTMLImageElement) => void;
}

/** The cached poster image with paging when a title has more than one stored poster. */
const PosterGalleryCard = ({
  mediaTypeFromRoute,
  mediaIdFromRoute,
  title,
  posterIndex,
  posterCount,
  posterLoadFailed,
  posterCacheBust,
  setPosterIndex,
  onPosterLoadError,
}: Props) => (
  <Paper sx={styles.posterCard}>
    <Box
      component="img"
      src={posterLoadFailed
        ? PLACEHOLDER_POSTER
        : `/api/backend/api/posters/${mediaTypeFromRoute}/${encodeURIComponent(mediaIdFromRoute)}?index=${posterIndex}&v=${posterCacheBust}`}
      alt={title || 'Media poster'}
      sx={styles.poster}
      loading="lazy"
      onError={(e) => {
        onPosterLoadError(e.currentTarget as HTMLImageElement);
      }}
    />
    {posterCount > 1 && (
      <Stack direction="row" justifyContent="center" alignItems="center" sx={{ pt: 1 }}>
        <IconButton
          size="small"
          disabled={posterIndex === 0}
          onClick={() => setPosterIndex((i) => i - 1)}
          aria-label="previous poster"
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="caption" sx={{ mx: 1, opacity: 0.7 }}>
          {posterIndex + 1} / {posterCount}
        </Typography>
        <IconButton
          size="small"
          disabled={posterIndex === posterCount - 1}
          onClick={() => setPosterIndex((i) => i + 1)}
          aria-label="next poster"
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>
    )}
  </Paper>
);

export default PosterGalleryCard;
