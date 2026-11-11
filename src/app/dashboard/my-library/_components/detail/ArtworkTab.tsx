import { Box } from '@mui/material';
import React from 'react';

import useMediaPoster from '@/hooks/library/useMediaPoster';
import PosterGalleryCard from './PosterGalleryCard';
import PosterToolsCard from './PosterToolsCard';

interface Props {
  mediaTypeFromRoute?: string;
  mediaIdFromRoute: string;
  title: string;
  hasPosterSource: boolean;
  poster: ReturnType<typeof useMediaPoster>;
}

/** The cached poster gallery next to the poster-source tools. */
const ArtworkTab = ({ mediaTypeFromRoute, mediaIdFromRoute, title, hasPosterSource, poster }: Props) => (
  <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 320px) minmax(0, 1fr)' }, alignItems: 'start' }}>
    <PosterGalleryCard
      mediaTypeFromRoute={mediaTypeFromRoute}
      mediaIdFromRoute={mediaIdFromRoute}
      title={title}
      posterIndex={poster.posterIndex}
      posterCount={poster.posterCount}
      posterLoadFailed={poster.posterLoadFailed}
      posterCacheBust={poster.posterCacheBust}
      setPosterIndex={poster.setPosterIndex}
      onPosterLoadError={poster.handlePosterLoadError}
    />
    <PosterToolsCard
      posterSourceInput={poster.posterSourceInput}
      onPosterSourceInputChange={poster.setPosterSourceInput}
      posterSourceSaving={poster.posterSourceSaving}
      posterSourceStatus={poster.posterSourceStatus}
      hasPosterSource={hasPosterSource}
      onSavePosterSource={poster.handlePosterSourceUpdate}
    />
  </Box>
);

export default ArtworkTab;
