import { Alert, Box, Chip, Grid, Paper, Stack, Typography } from '@mui/material';

import { LibraryProcessingSummary } from '../libraryHelpers';
import styles from './mediaDetailStyles';

/** File processing progress for one title, with episode/season coverage for series. */
const MediaProcessingSummaryCard = ({ summary }: { summary: LibraryProcessingSummary | null }) => (
  <Paper sx={styles.sectionCard}>
    <Typography variant="h6" sx={styles.sectionTitle}>
      Processing Summary
    </Typography>

    {summary ? (
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Box sx={styles.metricTile}>
            <Typography variant="caption" sx={styles.metricLabel}>Processed</Typography>
            <Typography variant="h5" sx={styles.metricValue}>
              {summary.assignedFiles}
            </Typography>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Box sx={styles.metricTile}>
            <Typography variant="caption" sx={styles.metricLabel}>Total Files</Typography>
            <Typography variant="h5" sx={styles.metricValue}>
              {summary.totalFiles}
            </Typography>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Box sx={styles.metricTile}>
            <Typography variant="caption" sx={styles.metricLabel}>Unprocessed</Typography>
            <Typography variant="h5" sx={styles.metricValue}>
              {summary.unassignedFiles}
            </Typography>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Box sx={styles.metricTile}>
            <Typography variant="caption" sx={styles.metricLabel}>Completion</Typography>
            <Typography variant="h5" sx={styles.metricValue}>
              {summary.completionPercent}%
            </Typography>
          </Box>
        </Grid>

        {summary.mediaType === 'series' && (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="body2" sx={styles.metaLabel}>Episode Coverage</Typography>
              <Typography variant="body1">
                {(summary.episodesWithFiles ?? 0)} / {(summary.totalEpisodes ?? 0)} episodes with files
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="body2" sx={styles.metaLabel}>Season Coverage</Typography>
              <Typography variant="body1">
                {(summary.seasonsWithFiles ?? 0)} / {(summary.totalSeasons ?? 0)} seasons with files
              </Typography>
            </Grid>
          </>
        )}

        <Grid size={{ xs: 12 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {summary.hasAssignmentSummary ? (
              <Chip size="small" color="success" label="Assignment summary available" />
            ) : (
              <Chip size="small" color="warning" variant="outlined" label="Using fallback counts from discs/files" />
            )}
            {summary.totalFileSizeFormatted && (
              <Chip size="small" label={`Total size: ${summary.totalFileSizeFormatted}`} />
            )}
          </Stack>
        </Grid>
      </Grid>
    ) : (
      <Alert severity="info">Processing summary is not available for this title yet.</Alert>
    )}
  </Paper>
);

export default MediaProcessingSummaryCard;
