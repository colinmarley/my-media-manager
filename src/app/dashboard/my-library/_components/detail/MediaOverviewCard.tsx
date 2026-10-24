import { Box, Chip, Divider, Grid, Paper, Stack, Typography } from '@mui/material';

import {
  getCastDisplay,
  getDirectorsDisplay,
  getTitleYearLabel,
  LibraryMedia,
  LibraryMediaType,
} from '../libraryHelpers';
import styles from './mediaDetailStyles';

interface Props {
  media: LibraryMedia;
  mediaType: LibraryMediaType;
  inLibrary: boolean;
  fileCount: number;
  folderPath: string | null;
  externalIds: { imdbId?: string; tmdbId?: number } | null;
  legacyImdbId?: string;
}

/** Title, library chips and the headline metadata grid for one catalog record. */
const MediaOverviewCard = ({
  media,
  mediaType,
  inLibrary,
  fileCount,
  folderPath,
  externalIds,
  legacyImdbId,
}: Props) => (
  <Paper sx={styles.sectionCard}>
    <Typography variant="h4" sx={styles.title}>
      {media.title || <em style={{ opacity: 0.5 }}>[No Title]</em>}
    </Typography>

    <Stack direction="row" spacing={1} sx={styles.chipRow}>
      <Chip label={mediaType === 'movie' ? 'Movie' : 'Show'} color="primary" />
      <Chip
        label={inLibrary ? 'In Library' : 'Not In Library'}
        color={inLibrary ? 'success' : 'warning'}
        variant={inLibrary ? 'filled' : 'outlined'}
      />
      <Chip label={`${fileCount} file${fileCount === 1 ? '' : 's'}`} />
    </Stack>

    <Divider sx={styles.divider} />

    <Grid container spacing={1.5}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Release / Running Dates</Typography>
        <Typography variant="body1">{getTitleYearLabel(media)}</Typography>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Runtime</Typography>
        <Typography variant="body1">{media.runtime || 'N/A'}</Typography>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Country</Typography>
        <Typography variant="body1">
          {Array.isArray(media.countryOfOrigin) && media.countryOfOrigin.length > 0
            ? media.countryOfOrigin.join(', ')
            : 'N/A'}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Genres</Typography>
        <Typography variant="body1">
          {Array.isArray(media.genres) && media.genres.length > 0
            ? media.genres.join(', ')
            : 'N/A'}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Directors</Typography>
        <Typography variant="body1">{getDirectorsDisplay(media)}</Typography>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Top Cast</Typography>
        <Typography variant="body1">{getCastDisplay(media)}</Typography>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Writers</Typography>
        <Typography variant="body1">
          {Array.isArray(media.writers) && media.writers.length > 0
            ? media.writers.join(', ')
            : 'N/A'}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Typography variant="body2" sx={styles.metaLabel}>Folder Path</Typography>
        <Typography variant="body1">
          {folderPath || 'N/A'}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <Typography variant="body2" sx={styles.metaLabel}>External IDs</Typography>
        <Typography variant="body1">
          {externalIds
            ? `IMDB: ${externalIds.imdbId || legacyImdbId || 'N/A'} | TMDB: ${externalIds.tmdbId || 'N/A'}`
            : `IMDB: ${legacyImdbId || 'N/A'}`}
        </Typography>
      </Grid>
    </Grid>
  </Paper>
);

export default MediaOverviewCard;
