import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material';
import React from 'react';

import { LibraryMedia } from '../libraryHelpers';
import MediaOverviewCard from './MediaOverviewCard';
import CatalogMetadataCard, { NfoMetadataCard } from './MetadataCards';

interface Props {
  media: LibraryMedia;
  catalogType: 'movie' | 'series' | null;
  folderPath: string | null;
  externalIds: { imdbId?: string; tmdbId?: number } | null;
  legacyImdbId?: string;
  nfoMetadata: Record<string, unknown> | null;
  diskNfoData: Record<string, unknown> | null;
}

/** Labelled catalog fields; the raw catalog and NFO JSON stay behind a "Raw data" disclosure. */
const MetadataTab = ({ media, catalogType, folderPath, externalIds, legacyImdbId, nfoMetadata, diskNfoData }: Props) => (
  <Box>
    <MediaOverviewCard
      media={media}
      catalogType={catalogType}
      folderPath={folderPath}
      externalIds={externalIds}
      legacyImdbId={legacyImdbId}
    />
    <Accordion disableGutters variant="outlined" sx={{ mt: 2 }} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="raw-data-content" id="raw-data-header">
        <Typography variant="subtitle1">Raw data</Typography>
      </AccordionSummary>
      <AccordionDetails id="raw-data-content">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
          <CatalogMetadataCard media={media} />
          <NfoMetadataCard nfoMetadata={nfoMetadata} diskNfoData={diskNfoData} />
        </Box>
      </AccordionDetails>
    </Accordion>
  </Box>
);

export default MetadataTab;
