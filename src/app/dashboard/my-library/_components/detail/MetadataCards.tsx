import { Alert, Box, Paper, Typography } from '@mui/material';

import styles from './mediaDetailStyles';

/** Raw catalog record, kept side-by-side with the NFO metadata for comparison. */
const CatalogMetadataCard = ({ media }: { media: unknown }) => (
  <Paper sx={styles.sectionCard}>
    <Typography variant="h6" sx={styles.sectionTitle}>
      Catalog Metadata
    </Typography>
    <Box component="pre" sx={styles.preBlock}>
      {JSON.stringify(media, null, 2)}
    </Box>
  </Paper>
);

/** Parsed NFO metadata (catalog copy when present, otherwise the copy read from disk). */
const NfoMetadataCard = ({ nfoMetadata, diskNfoData }: { nfoMetadata: Record<string, unknown> | null; diskNfoData: Record<string, unknown> | null }) => (
  <Paper sx={styles.sectionCard}>
    <Typography variant="h6" sx={styles.sectionTitle}>
      NFO Metadata
    </Typography>
    {(nfoMetadata || diskNfoData) ? (
      <Box component="pre" sx={styles.preBlock}>
        {JSON.stringify(nfoMetadata ?? diskNfoData, null, 2)}
      </Box>
    ) : (
      <Alert severity="info">No NFO metadata is currently available for this title.</Alert>
    )}
  </Paper>
);

export { NfoMetadataCard };
export default CatalogMetadataCard;
