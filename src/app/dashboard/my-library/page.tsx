'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  TextField,
  Tabs,
  Typography
} from '@mui/material';
import useMovies from '@/hooks/firebase/useMovies';
import useSeries from '@/hooks/firebase/useSeries';
import useDiscs from '@/hooks/firebase/useDiscs';
import { FBMovie } from '@/types/firebase/FBMovie.type';
import { FBSeries } from '@/types/firebase/FBSeries.type';
import {
  getTitleYearLabel,
  LibraryMediaType,
  toComputedMedia
} from './_components/libraryHelpers';
import {
  ExternalSearchResult,
  ImportSource,
  saveExternalMetadataToFirebase,
  searchExternalMetadata,
} from '@/service/library/LibraryMetadataImportService';

const placeholderPoster = 'https://placehold.co/500x750/111111/f4f4f4?text=No+Poster';

const MyLibraryPage = () => {
  const [selectedTab, setSelectedTab] = useState<LibraryMediaType>('movie');
  const [searchSource, setSearchSource] = useState<ImportSource>('omdb');
  const [searchType, setSearchType] = useState<LibraryMediaType>('movie');
  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [saveLoadingId, setSaveLoadingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ExternalSearchResult[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [manualAdds, setManualAdds] = useState<(FBMovie | FBSeries)[]>([]);

  const { movies, loading: moviesLoading, error: moviesError } = useMovies();
  const { series, loading: seriesLoading, error: seriesError } = useSeries();
  const { discs } = useDiscs();

  const loading = moviesLoading || seriesLoading;
  const error = moviesError || seriesError;

  const discMap = useMemo(() => {
    return new Map(discs.map((disc) => [disc.id, disc]));
  }, [discs]);

  const computedMedia = useMemo(() => {
    const allMedia = [...movies, ...series, ...manualAdds];
    return allMedia.map((media) => toComputedMedia(media, discMap));
  }, [movies, series, manualAdds, discMap]);

  const movieCards = computedMedia.filter((item) => item.mediaType === 'movie');
  const seriesCards = computedMedia.filter((item) => item.mediaType === 'series');

  const visibleCards = selectedTab === 'movie' ? movieCards : seriesCards;

  const handleSearch = async () => {
    setSearchError(null);
    setImportStatus(null);
    setSearchLoading(true);

    try {
      const results = await searchExternalMetadata(searchText, searchType, searchSource);
      setSearchResults(results);
      if (results.length === 0) {
        setImportStatus('No matching titles found from the selected source.');
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSaveResult = async (result: ExternalSearchResult) => {
    const candidateId = result.imdbId || result.tmdbId?.toString() || result.title;
    setSaveLoadingId(candidateId);
    setImportStatus(null);
    setSearchError(null);

    const saveResult = await saveExternalMetadataToFirebase(result);
    setImportStatus(saveResult.message);

    if (saveResult.status === 'created' && saveResult.document) {
      setManualAdds((prev) => [saveResult.document as unknown as FBMovie | FBSeries, ...prev]);
    }

    if (saveResult.status === 'error') {
      setSearchError(saveResult.message);
    }

    setSaveLoadingId(null);
  };

  return (
    <Box sx={styles.page}>
      <Box sx={styles.headerCard}>
        <Typography variant="h3" sx={styles.title}>
          My Library
        </Typography>
        <Typography variant="body1" sx={styles.subtitle}>
          Browse your saved titles, check local availability, and open details for Firebase and NFO metadata.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={styles.summaryRow}>
          <Chip label={`Movies: ${movieCards.length}`} color="primary" variant="filled" />
          <Chip label={`Shows: ${seriesCards.length}`} color="secondary" variant="filled" />
          <Chip
            label={`In Library: ${computedMedia.filter((item) => item.inLibrary).length}`}
            color="success"
            variant="outlined"
          />
        </Stack>
      </Box>

      <Box sx={styles.importCard}>
        <Typography variant="h5" sx={styles.importTitle}>
          Add Metadata From OMDB / TMDB
        </Typography>
        <Typography variant="body2" sx={styles.importSubtitle}>
          Search a movie or show, then save it to Firebase so it appears in My Library and can be matched by automation.
        </Typography>

        <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Search title"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Example: Battlestar Galactica"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="library-source-label">Source</InputLabel>
              <Select
                labelId="library-source-label"
                label="Source"
                value={searchSource}
                onChange={(event) => setSearchSource(event.target.value as ImportSource)}
              >
                <MenuItem value="omdb">OMDB</MenuItem>
                <MenuItem value="tmdb">TMDB</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="library-type-label">Type</InputLabel>
              <Select
                labelId="library-type-label"
                label="Type"
                value={searchType}
                onChange={(event) => setSearchType(event.target.value as LibraryMediaType)}
              >
                <MenuItem value="movie">Movie</MenuItem>
                <MenuItem value="series">Show</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 2 }}>
            <Button
              fullWidth
              variant="contained"
              sx={{ height: '56px' }}
              onClick={handleSearch}
              disabled={searchLoading || !searchText.trim()}
            >
              {searchLoading ? <CircularProgress size={20} color="inherit" /> : 'Search'}
            </Button>
          </Grid>
        </Grid>

        {searchError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {searchError}
          </Alert>
        )}

        {importStatus && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            {importStatus}
          </Alert>
        )}

        {searchResults.length > 0 && (
          <>
            <Divider sx={{ borderColor: 'rgba(190, 219, 245, 0.24)', mb: 1.5 }} />
            <Grid container spacing={2}>
              {searchResults.map((result) => {
                const candidateId = result.imdbId || result.tmdbId?.toString() || result.title;
                const poster = result.posterUrl && result.posterUrl !== 'N/A' ? result.posterUrl : placeholderPoster;

                return (
                  <Grid key={`${result.source}-${candidateId}`} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                    <Card sx={styles.importResultCard}>
                      <CardMedia component="img" image={poster} alt={result.title} sx={styles.importPoster} />
                      <CardContent>
                        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                          <Chip size="small" label={result.mediaType === 'movie' ? 'Movie' : 'Show'} color="primary" />
                          <Chip size="small" label={result.source.toUpperCase()} variant="outlined" />
                        </Stack>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {result.title}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(230, 242, 255, 0.72)', mb: 1 }}>
                          {result.year || 'Year N/A'}
                        </Typography>
                        <Button
                          fullWidth
                          variant="contained"
                          onClick={() => handleSaveResult(result)}
                          disabled={saveLoadingId === candidateId}
                        >
                          {saveLoadingId === candidateId ? <CircularProgress size={20} color="inherit" /> : 'Save To Firebase'}
                        </Button>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </>
        )}
      </Box>

      <Box sx={styles.switcherWrap}>
        <Tabs
          value={selectedTab}
          onChange={(_, value) => setSelectedTab(value)}
          textColor="inherit"
          indicatorColor="primary"
          aria-label="switch media type"
        >
          <Tab value="movie" label={`Movies (${movieCards.length})`} />
          <Tab value="series" label={`Shows (${seriesCards.length})`} />
        </Tabs>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load library data: {error}
        </Alert>
      )}

      {loading && (
        <Typography variant="body1" sx={styles.loadingText}>
          Loading your library...
        </Typography>
      )}

      {!loading && visibleCards.length === 0 && (
        <Alert severity="info">No {selectedTab === 'movie' ? 'movies' : 'shows'} found in your library.</Alert>
      )}

      <Grid container spacing={2.5}>
        {visibleCards.map((item) => {
          const media = item.media;
          const posterCandidate = media.imageFiles[0]?.fileName;
          const poster = posterCandidate && posterCandidate !== 'N/A'
            ? posterCandidate
            : placeholderPoster;

          return (
            <Grid key={`${item.mediaType}-${item.mediaId}`} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <Card sx={styles.card}>
                <CardActionArea
                  component={Link}
                  href={`/dashboard/my-library/${item.mediaType}/${encodeURIComponent(item.mediaId)}`}
                >
                  <CardMedia component="img" image={poster} alt={media.title} sx={styles.poster} />
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={styles.badgeRow}>
                      <Chip
                        size="small"
                        label={item.inLibrary ? 'In Library' : 'Not In Library'}
                        color={item.inLibrary ? 'success' : 'warning'}
                        variant={item.inLibrary ? 'filled' : 'outlined'}
                      />
                      <Chip size="small" label={`${item.fileCount} file${item.fileCount === 1 ? '' : 's'}`} />
                    </Stack>

                    <Typography variant="h6" sx={styles.cardTitle}>
                      {media.title}
                    </Typography>
                    <Typography variant="body2" sx={styles.cardSubtitle}>
                      {getTitleYearLabel(media)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    p: { xs: 2, md: 3 },
    background: 'radial-gradient(circle at 20% 20%, rgba(195, 227, 255, 0.18), transparent 48%), linear-gradient(145deg, #0e1418 0%, #17252f 60%, #1f3340 100%)',
    color: '#f8fbff'
  },
  headerCard: {
    mb: 3,
    p: { xs: 2, md: 3 },
    borderRadius: 2,
    backgroundColor: 'rgba(9, 16, 20, 0.78)',
    backdropFilter: 'blur(2px)',
    border: '1px solid rgba(148, 188, 214, 0.25)'
  },
  title: {
    fontWeight: 700,
    letterSpacing: 0.5,
    mb: 0.5
  },
  subtitle: {
    opacity: 0.9,
    mb: 2,
    maxWidth: 850
  },
  summaryRow: {
    flexWrap: 'wrap'
  },
  switcherWrap: {
    mb: 2,
    borderBottom: '1px solid rgba(200, 230, 255, 0.25)'
  },
  importCard: {
    mb: 3,
    p: { xs: 2, md: 2.5 },
    borderRadius: 2,
    backgroundColor: 'rgba(9, 16, 20, 0.78)',
    border: '1px solid rgba(148, 188, 214, 0.25)'
  },
  importTitle: {
    fontWeight: 700,
    mb: 0.5
  },
  importSubtitle: {
    opacity: 0.9,
    mb: 2
  },
  importResultCard: {
    borderRadius: 2,
    background: 'linear-gradient(180deg, rgba(9, 16, 20, 0.97), rgba(12, 20, 25, 0.92))',
    border: '1px solid rgba(158, 199, 226, 0.16)'
  },
  importPoster: {
    height: 300,
    objectFit: 'cover'
  },
  loadingText: {
    mb: 2
  },
  card: {
    height: '100%',
    borderRadius: 2,
    background: 'linear-gradient(180deg, rgba(9, 16, 20, 0.97), rgba(12, 20, 25, 0.92))',
    border: '1px solid rgba(158, 199, 226, 0.16)',
    boxShadow: '0 18px 28px rgba(0, 0, 0, 0.24)',
    transition: 'transform 140ms ease, box-shadow 140ms ease',
    '&:hover': {
      transform: 'translateY(-3px)',
      boxShadow: '0 22px 34px rgba(0, 0, 0, 0.35)'
    }
  },
  poster: {
    height: 360,
    objectFit: 'cover'
  },
  badgeRow: {
    mb: 1,
    flexWrap: 'wrap'
  },
  cardTitle: {
    fontWeight: 700,
    lineHeight: 1.25,
    minHeight: 56
  },
  cardSubtitle: {
    color: 'rgba(230, 242, 255, 0.72)'
  }
};

export default MyLibraryPage;
