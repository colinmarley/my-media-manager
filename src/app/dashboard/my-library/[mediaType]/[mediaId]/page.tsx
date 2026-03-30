'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import useMovies from '@/hooks/firebase/useMovies';
import useSeries from '@/hooks/firebase/useSeries';
import useDiscs from '@/hooks/firebase/useDiscs';
import {
  getCastDisplay,
  getDirectorsDisplay,
  getDiscIdsForMedia,
  getExternalIds,
  getFolderPath,
  getMediaId,
  getMediaType,
  getNfoMetadata,
  getProcessingSummary,
  getTitleYearLabel,
  LibraryMedia,
  toComputedMedia
} from '../../_components/libraryHelpers';

const placeholderPoster = 'https://placehold.co/500x750/111111/f4f4f4?text=No+Poster';

const LibraryMediaDetailPage = () => {
  const params = useParams<{ mediaType: string; mediaId: string }>();
  const mediaTypeFromRoute = params?.mediaType;
  const mediaIdFromRoute = decodeURIComponent(params?.mediaId || '');

  const { movies, loading: moviesLoading, error: moviesError } = useMovies();
  const { series, loading: seriesLoading, error: seriesError } = useSeries();
  const { discs, loading: discsLoading } = useDiscs();

  const loading = moviesLoading || seriesLoading || discsLoading;
  const error = moviesError || seriesError;

  const discMap = useMemo(() => {
    return new Map(discs.map((disc) => [disc.id, disc]));
  }, [discs]);

  const matchedMedia = useMemo(() => {
    const allMedia: LibraryMedia[] = [...movies, ...series];

    return allMedia.find((entry) => {
      const entryId = getMediaId(entry);
      const entryType = getMediaType(entry);

      return entryId === mediaIdFromRoute && entryType === mediaTypeFromRoute;
    }) || null;
  }, [movies, series, mediaIdFromRoute, mediaTypeFromRoute]);

  const computed = useMemo(() => {
    if (!matchedMedia) {
      return null;
    }

    return toComputedMedia(matchedMedia, discMap);
  }, [matchedMedia, discMap]);

  const nfoMetadata = useMemo(() => {
    if (!matchedMedia) {
      return null;
    }

    return getNfoMetadata(matchedMedia);
  }, [matchedMedia]);

  const associatedDiscs = useMemo(() => {
    if (!matchedMedia) {
      return [];
    }

    const discIds = getDiscIdsForMedia(matchedMedia);
    return discIds
      .map((discId) => discMap.get(discId))
      .filter((disc): disc is NonNullable<typeof disc> => Boolean(disc));
  }, [matchedMedia, discMap]);

  const processingSummary = useMemo(() => {
    if (!matchedMedia || !computed) {
      return null;
    }

    return getProcessingSummary(matchedMedia, computed.fileCount);
  }, [matchedMedia, computed]);

  const legacyOmdbData = matchedMedia && typeof matchedMedia === 'object' && 'omdbData' in matchedMedia
    ? matchedMedia.omdbData as { Poster?: string; imdbID?: string } | undefined
    : undefined;

  const posterCandidate = matchedMedia?.imageFiles[0]?.fileName || legacyOmdbData?.Poster;
  const poster = posterCandidate && posterCandidate !== 'N/A'
    ? posterCandidate
    : placeholderPoster;

  const externalIds = matchedMedia ? getExternalIds(matchedMedia) : null;
  const folderPath = matchedMedia ? getFolderPath(matchedMedia) : null;

  return (
    <Box sx={styles.page}>
      <Button
        component={Link}
        href="/dashboard/my-library"
        variant="text"
        startIcon={<ArrowBackIcon />}
        sx={styles.backButton}
      >
        Back to My Library
      </Button>

      {error && <Alert severity="error">Unable to load details: {error}</Alert>}

      {loading && <Typography>Loading media details...</Typography>}

      {!loading && !matchedMedia && (
        <Alert severity="warning">
          This title was not found. It may have been removed or its identifier has changed.
        </Alert>
      )}

      {!loading && matchedMedia && computed && (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={styles.posterCard}>
              <Box component="img" src={poster} alt={matchedMedia.title} sx={styles.poster} />
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h4" sx={styles.title}>
                {matchedMedia.title}
              </Typography>

              <Stack direction="row" spacing={1} sx={styles.chipRow}>
                <Chip label={computed.mediaType === 'movie' ? 'Movie' : 'Show'} color="primary" />
                <Chip
                  label={computed.inLibrary ? 'In Library' : 'Not In Library'}
                  color={computed.inLibrary ? 'success' : 'warning'}
                  variant={computed.inLibrary ? 'filled' : 'outlined'}
                />
                <Chip label={`${computed.fileCount} file${computed.fileCount === 1 ? '' : 's'}`} />
              </Stack>

              <Divider sx={styles.divider} />

              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Release / Running Dates</Typography>
                  <Typography variant="body1">{getTitleYearLabel(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Runtime</Typography>
                  <Typography variant="body1">{matchedMedia.runtime || 'N/A'}</Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Country</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.countryOfOrigin) && matchedMedia.countryOfOrigin.length > 0
                      ? matchedMedia.countryOfOrigin.join(', ')
                      : 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Genres</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.genres) && matchedMedia.genres.length > 0
                      ? matchedMedia.genres.join(', ')
                      : 'N/A'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Directors</Typography>
                  <Typography variant="body1">{getDirectorsDisplay(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Top Cast</Typography>
                  <Typography variant="body1">{getCastDisplay(matchedMedia)}</Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" sx={styles.metaLabel}>Writers</Typography>
                  <Typography variant="body1">
                    {Array.isArray(matchedMedia.writers) && matchedMedia.writers.length > 0
                      ? matchedMedia.writers.join(', ')
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
                      ? `IMDB: ${externalIds.imdbId || legacyOmdbData?.imdbID || 'N/A'} | TMDB: ${externalIds.tmdbId || 'N/A'}`
                      : `IMDB: ${legacyOmdbData?.imdbID || 'N/A'}`}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                Processing Summary
              </Typography>

              {processingSummary ? (
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Processed</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {processingSummary.assignedFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Total Files</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {processingSummary.totalFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Unprocessed</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {processingSummary.unassignedFiles}
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <Box sx={styles.metricTile}>
                      <Typography variant="caption" sx={styles.metricLabel}>Completion</Typography>
                      <Typography variant="h5" sx={styles.metricValue}>
                        {processingSummary.completionPercent}%
                      </Typography>
                    </Box>
                  </Grid>

                  {processingSummary.mediaType === 'series' && (
                    <>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="body2" sx={styles.metaLabel}>Episode Coverage</Typography>
                        <Typography variant="body1">
                          {(processingSummary.episodesWithFiles ?? 0)} / {(processingSummary.totalEpisodes ?? 0)} episodes with files
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Typography variant="body2" sx={styles.metaLabel}>Season Coverage</Typography>
                        <Typography variant="body1">
                          {(processingSummary.seasonsWithFiles ?? 0)} / {(processingSummary.totalSeasons ?? 0)} seasons with files
                        </Typography>
                      </Grid>
                    </>
                  )}

                  <Grid size={{ xs: 12 }}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      {processingSummary.hasAssignmentSummary ? (
                        <Chip size="small" color="success" label="Assignment summary available" />
                      ) : (
                        <Chip size="small" color="warning" variant="outlined" label="Using fallback counts from discs/files" />
                      )}
                      {processingSummary.totalFileSizeFormatted && (
                        <Chip size="small" label={`Total size: ${processingSummary.totalFileSizeFormatted}`} />
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="info">Processing summary is not available for this title yet.</Alert>
              )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                Firebase Metadata
              </Typography>
              <Box component="pre" sx={styles.preBlock}>
                {JSON.stringify(matchedMedia, null, 2)}
              </Box>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                NFO Metadata
              </Typography>
              {nfoMetadata ? (
                <Box component="pre" sx={styles.preBlock}>
                  {JSON.stringify(nfoMetadata, null, 2)}
                </Box>
              ) : (
                <Alert severity="info">No NFO metadata is currently available for this title.</Alert>
              )}
            </Paper>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Paper sx={styles.sectionCard}>
              <Typography variant="h6" sx={styles.sectionTitle}>
                Associated Discs and Files
              </Typography>
              {associatedDiscs.length === 0 ? (
                <Alert severity="info">No associated disc or file records were found.</Alert>
              ) : (
                <List>
                  {associatedDiscs.map((disc) => (
                    <ListItem key={disc.id} sx={styles.listItem}>
                      <ListItemText
                        primary={disc.title || disc.id}
                        secondary={
                          Array.isArray(disc.videoFiles) && disc.videoFiles.length > 0
                            ? disc.videoFiles.map((file) => file.fileName).join(', ')
                            : 'No video file names were stored on this disc record.'
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    p: { xs: 2, md: 3 },
    background: 'radial-gradient(circle at 85% 10%, rgba(112, 182, 239, 0.2), transparent 50%), linear-gradient(145deg, #0f1519 0%, #15252f 50%, #1a2f3c 100%)',
    color: '#f7fbff'
  },
  backButton: {
    mb: 2,
    color: '#cde7ff'
  },
  posterCard: {
    p: 1.5,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  poster: {
    width: '100%',
    borderRadius: 1.5,
    maxHeight: 640,
    objectFit: 'cover'
  },
  sectionCard: {
    p: 2,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  title: {
    fontWeight: 700,
    mb: 1
  },
  chipRow: {
    mb: 1.5,
    flexWrap: 'wrap'
  },
  divider: {
    borderColor: 'rgba(190, 219, 245, 0.24)',
    mb: 1.5
  },
  metaLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600
  },
  sectionTitle: {
    mb: 1,
    fontWeight: 700
  },
  preBlock: {
    margin: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    p: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(2, 6, 9, 0.6)',
    border: '1px solid rgba(149, 185, 211, 0.2)',
    maxHeight: 420
  },
  listItem: {
    borderBottom: '1px solid rgba(190, 219, 245, 0.15)'
  },
  metricTile: {
    p: 1.5,
    borderRadius: 1,
    border: '1px solid rgba(149, 185, 211, 0.25)',
    backgroundColor: 'rgba(2, 6, 9, 0.5)',
  },
  metricLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    fontWeight: 800,
  }
};

export default LibraryMediaDetailPage;
