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
import useMovies from '@/hooks/catalog/useMovies';
import useSeries from '@/hooks/catalog/useSeries';
import useDiscs from '@/hooks/catalog/useDiscs';
import { CatalogMovie } from '@/types/catalog/Movie.type';
import { CatalogSeries } from '@/types/catalog/Series.type';
import {
  getTitleYearLabel,
  LibraryMediaType,
  toComputedMedia
} from './_components/libraryHelpers';
import {
  ExternalSearchResult,
  ImportMediaType,
  ImportSource,
  saveExternalMetadataToCatalog,
  saveManualMovieTitle,
  SaveMetadataResult,
  searchExternalMetadata,
  searchExternalMetadataByImdbId,
} from '@/service/library/LibraryMetadataImportService';
import MetadataConflictDialog from './_components/MetadataConflictDialog';
import DestFolderBrowser from './_components/DestFolderBrowser';

const placeholderPoster = 'https://placehold.co/500x750/111111/f4f4f4?text=No+Poster';
const MAX_POSTER_CHECKS = 1;

const getFolderDisplayName = (media: CatalogMovie | CatalogSeries): string => {
  const record = media as unknown as Record<string, unknown>;
  const directPath = typeof record.folderPath === 'string' ? record.folderPath : '';
  const jellyfinInfo = (record.jellyfinInfo && typeof record.jellyfinInfo === 'object')
    ? (record.jellyfinInfo as Record<string, unknown>)
    : null;
  const jellyfinPath = jellyfinInfo && typeof jellyfinInfo.folderPath === 'string' ? jellyfinInfo.folderPath : '';
  const path = directPath || jellyfinPath;
  if (!path) {
    return media.title;
  }
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || media.title;
};

const MyLibraryPage = () => {
  const [selectedTab, setSelectedTab] = useState<LibraryMediaType | 'files'>('movie');
  const [searchSource, setSearchSource] = useState<ImportSource>('omdb');
  const [searchType, setSearchType] = useState<ImportMediaType>('movie');
  const [movieSubType, setMovieSubType] = useState<'live_performance' | 'home_video' | ''>('');
  const [searchMode, setSearchMode] = useState<'title' | 'imdb_id'>('title');
  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [saveLoadingId, setSaveLoadingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ExternalSearchResult[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [manualAdds, setManualAdds] = useState<(CatalogMovie | CatalogSeries)[]>([]);
  const [pendingConflict, setPendingConflict] = useState<SaveMetadataResult | null>(null);
  const [posterCheckCounts, setPosterCheckCounts] = useState<Record<string, number>>({});
  const [manualTitle, setManualTitle] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualSaveLoading, setManualSaveLoading] = useState(false);
  const [manualSaveStatus, setManualSaveStatus] = useState<string | null>(null);
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'in_library' | 'not_in_library' | 'has_files' | 'no_files'>('all');

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
  const documentaryCards = computedMedia.filter((item) => item.mediaType === 'documentary');
  const livePerformanceCards = computedMedia.filter((item) => item.mediaType === 'live_performance');
  const homeVideoCards = computedMedia.filter((item) => item.mediaType === 'home_video');
  const needsReviewCards = computedMedia.filter((item) => item.mediaType === 'needs_review');

  const cardsByTab: Record<string, typeof computedMedia> = {
    movie: movieCards,
    series: seriesCards,
    documentary: documentaryCards,
    live_performance: livePerformanceCards,
    home_video: homeVideoCards,
    needs_review: needsReviewCards,
  };

  const visibleCards = cardsByTab[selectedTab] ?? [];

  const filteredVisibleCards = useMemo(() => {
    const searchLower = librarySearchQuery.trim().toLowerCase();

    return visibleCards.filter((item) => {
      if (libraryFilter === 'in_library' && !item.inLibrary) {
        return false;
      }
      if (libraryFilter === 'not_in_library' && item.inLibrary) {
        return false;
      }
      if (libraryFilter === 'has_files' && item.fileCount <= 0) {
        return false;
      }
      if (libraryFilter === 'no_files' && item.fileCount > 0) {
        return false;
      }

      if (!searchLower) {
        return true;
      }

      const media = item.media;
      const title = media.title?.toLowerCase() || '';
      const yearLabel = getTitleYearLabel(media).toLowerCase();
      const mediaId = item.mediaId.toLowerCase();

      return title.includes(searchLower) || yearLabel.includes(searchLower) || mediaId.includes(searchLower);
    });
  }, [visibleCards, libraryFilter, librarySearchQuery]);

  const markPosterChecked = (posterKey: string) => {
    setPosterCheckCounts((prev) => {
      const nextCount = Math.min((prev[posterKey] ?? 0) + 1, MAX_POSTER_CHECKS);
      if ((prev[posterKey] ?? 0) === nextCount) {
        return prev;
      }
      return { ...prev, [posterKey]: nextCount };
    });
  };

  const handleSearch = async () => {
    setSearchError(null);
    setImportStatus(null);
    setSearchLoading(true);

    try {
      const results = searchMode === 'imdb_id'
        ? await searchExternalMetadataByImdbId(searchText, searchType)
        : await searchExternalMetadata(searchText, searchType, searchSource);
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

  const handleManualSave = async () => {
    if (!manualTitle.trim()) return;
    setManualSaveLoading(true);
    setManualSaveStatus(null);
    setManualSaveError(null);

    const subType = movieSubType || 'live_performance';
    const result = await saveManualMovieTitle(manualTitle, manualYear, subType);

    if (result.status === 'error') {
      setManualSaveError(result.message);
    } else {
      setManualSaveStatus(result.message);
      if (result.status === 'created' && result.document) {
        setManualAdds((prev) => [result.document as unknown as CatalogMovie | CatalogSeries, ...prev]);
      }
      setManualTitle('');
      setManualYear('');
    }
    setManualSaveLoading(false);
  };

  const handleSaveResult = async (result: ExternalSearchResult) => {
    const candidateId = result.imdbId || result.tmdbId?.toString() || result.title;
    setSaveLoadingId(candidateId);
    setImportStatus(null);
    setSearchError(null);

    const subType = result.mediaType === 'movie' && movieSubType ? movieSubType : undefined;
    const saveResult = await saveExternalMetadataToCatalog(result, subType);

    if (saveResult.status === 'conflicts') {
      setPendingConflict(saveResult);
      setSaveLoadingId(null);
      return;
    }

    setImportStatus(saveResult.message);

    if (saveResult.status === 'created' && saveResult.document) {
      setManualAdds((prev) => [saveResult.document as unknown as CatalogMovie | CatalogSeries, ...prev]);
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
          Browse your saved titles, check local availability, and open details for catalog and NFO metadata.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={styles.summaryRow}>
          <Chip label={`Movies: ${movieCards.length}`} color="primary" variant="filled" />
          <Chip label={`Shows: ${seriesCards.length}`} color="secondary" variant="filled" />
          <Chip label={`Documentaries: ${documentaryCards.length}`} color="info" variant="outlined" />
          <Chip label={`Live Performances: ${livePerformanceCards.length}`} color="info" variant="outlined" />
          {homeVideoCards.length > 0 && (
            <Chip label={`Home Videos: ${homeVideoCards.length}`} color="default" variant="outlined" />
          )}
          {needsReviewCards.length > 0 && (
            <Chip label={`Needs Review: ${needsReviewCards.length}`} color="warning" variant="filled" />
          )}
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
          Search a movie or show, then add it to your library so it appears in My Library and can be matched by automation.
        </Typography>

        <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
          <Grid size={{ xs: 12, md: searchMode === 'imdb_id' ? 8 : 6 }}>
            <TextField
              fullWidth
              label={searchMode === 'imdb_id' ? 'IMDb ID' : 'Search title'}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={searchMode === 'imdb_id' ? 'Example: tt1234567' : 'Example: Battlestar Galactica'}
              onKeyDown={(event) => { if (event.key === 'Enter' && searchText.trim()) handleSearch(); }}
            />
          </Grid>
          {searchMode === 'title' && (
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
          )}
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="library-type-label">Type</InputLabel>
              <Select
                labelId="library-type-label"
                label="Type"
                value={searchType}
                onChange={(event) => {
                  setSearchType(event.target.value as ImportMediaType);
                  setMovieSubType('');
                }}
              >
                <MenuItem value="movie">Movie</MenuItem>
                <MenuItem value="series">Show</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {searchType === 'movie' && (
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <FormControl fullWidth>
                <InputLabel id="library-subtype-label">Subtype</InputLabel>
                <Select
                  labelId="library-subtype-label"
                  label="Subtype"
                  value={movieSubType}
                  onChange={(event) => setMovieSubType(event.target.value as 'live_performance' | 'home_video' | '')}
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="live_performance">Live Performance</MenuItem>
                  <MenuItem value="home_video">Home Video</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="library-mode-label">Search by</InputLabel>
              <Select
                labelId="library-mode-label"
                label="Search by"
                value={searchMode}
                onChange={(event) => {
                  setSearchMode(event.target.value as 'title' | 'imdb_id');
                  setSearchText('');
                  setSearchResults([]);
                  setSearchError(null);
                }}
              >
                <MenuItem value="title">Title</MenuItem>
                <MenuItem value="imdb_id">IMDb ID</MenuItem>
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
                          {saveLoadingId === candidateId ? <CircularProgress size={20} color="inherit" /> : 'Save to Library'}
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

      {movieSubType === 'live_performance' && (
        <Box sx={styles.importCard}>
          <Typography variant="h5" sx={styles.importTitle}>
            Add Live Performance by Title
          </Typography>
          <Typography variant="body2" sx={styles.importSubtitle}>
            For titles with no OMDB / TMDB record, enter a title and year to create a minimal catalog entry.
          </Typography>

          {manualSaveError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {manualSaveError}
            </Alert>
          )}
          {manualSaveStatus && (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              {manualSaveStatus}
            </Alert>
          )}

          <Grid container spacing={1.5} alignItems="center">
            <Grid size={{ xs: 12, sm: 6, md: 5 }}>
              <TextField
                fullWidth
                label="Title"
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder="Example: The Rolling Stones – Shine a Light"
                onKeyDown={(event) => { if (event.key === 'Enter' && manualTitle.trim()) handleManualSave(); }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4, md: 2 }}>
              <TextField
                fullWidth
                label="Year"
                value={manualYear}
                onChange={(event) => setManualYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="2008"
                inputProps={{ maxLength: 4 }}
                onKeyDown={(event) => { if (event.key === 'Enter' && manualTitle.trim()) handleManualSave(); }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2, md: 2 }}>
              <Button
                fullWidth
                variant="contained"
                sx={{ height: '56px' }}
                onClick={handleManualSave}
                disabled={manualSaveLoading || !manualTitle.trim()}
              >
                {manualSaveLoading ? <CircularProgress size={20} color="inherit" /> : 'Add to Library'}
              </Button>
            </Grid>
          </Grid>
        </Box>
      )}

      <Box sx={styles.switcherWrap}>
        <Tabs
          value={selectedTab}
          onChange={(_, value) => setSelectedTab(value)}
          textColor="inherit"
          indicatorColor="primary"
          aria-label="switch media type"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="movie" label={`Movies (${movieCards.length})`} />
          <Tab value="series" label={`Shows (${seriesCards.length})`} />
          <Tab value="documentary" label={`Documentaries (${documentaryCards.length})`} />
          <Tab value="live_performance" label={`Live Performances (${livePerformanceCards.length})`} />
          {homeVideoCards.length > 0 && (
            <Tab value="home_video" label={`Home Videos (${homeVideoCards.length})`} />
          )}
          {needsReviewCards.length > 0 && (
            <Tab value="needs_review" label={`Needs Review (${needsReviewCards.length})`} />
          )}
          <Tab value="files" label="Destination Files" />
        </Tabs>
      </Box>

      {selectedTab !== 'files' && (
        <Box sx={styles.resultsToolbar}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              label="Search library"
              placeholder="Search by title, year, or ID"
              value={librarySearchQuery}
              onChange={(event) => setLibrarySearchQuery(event.target.value)}
            />
            <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 220 } }}>
              <InputLabel id="library-results-filter-label">Filter</InputLabel>
              <Select
                labelId="library-results-filter-label"
                label="Filter"
                value={libraryFilter}
                onChange={(event) => setLibraryFilter(event.target.value as 'all' | 'in_library' | 'not_in_library' | 'has_files' | 'no_files')}
              >
                <MenuItem value="all">All results</MenuItem>
                <MenuItem value="in_library">In Library</MenuItem>
                <MenuItem value="not_in_library">Not In Library</MenuItem>
                <MenuItem value="has_files">Has files</MenuItem>
                <MenuItem value="no_files">No files</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Typography variant="body2" sx={styles.resultsCountText}>
            Showing {filteredVisibleCards.length} of {visibleCards.length}
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load library data: {error}
        </Alert>
      )}

      {loading && selectedTab !== 'files' && (
        <Typography variant="body1" sx={styles.loadingText}>
          Loading your library...
        </Typography>
      )}

      {!loading && selectedTab !== 'files' && filteredVisibleCards.length === 0 && (
        <Alert severity="info">No {selectedTab === 'movie' ? 'movies' : selectedTab === 'series' ? 'shows' : selectedTab === 'documentary' ? 'documentaries' : selectedTab === 'live_performance' ? 'live performances' : selectedTab === 'home_video' ? 'home videos' : 'items needing review'} found in your library.</Alert>
      )}

      {selectedTab !== 'files' && (
      <Grid container spacing={2.5}>
        {filteredVisibleCards.map((item) => {
          const media = item.media;
          const posterKey = `${item.mediaType}-${item.mediaId}`;
          const localPosterUrl = `/api/backend/api/posters/${item.mediaType}/${encodeURIComponent(item.mediaId)}`;
          const posterFailed = (posterCheckCounts[posterKey] ?? 0) >= MAX_POSTER_CHECKS;
          const folderDisplayName = getFolderDisplayName(media);

          return (
            <Grid key={`${item.mediaType}-${item.mediaId}`} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <Card sx={styles.card}>
                <CardActionArea
                  component={Link}
                  href={`/dashboard/my-library/${item.mediaType}/${encodeURIComponent(item.mediaId)}`}
                >
                  {posterFailed ? (
                    <Box sx={styles.posterFallback}>
                      <Typography variant="subtitle1" sx={styles.posterFallbackTitle}>
                        {folderDisplayName}
                      </Typography>
                    </Box>
                  ) : (
                    <CardMedia
                      component="img"
                      image={localPosterUrl}
                      alt={media.title}
                      sx={styles.poster}
                      loading="lazy"
                      onError={() => {
                        markPosterChecked(posterKey);
                      }}
                    />
                  )}
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
      )}

      {selectedTab === 'files' && (
        <Box sx={styles.fileBrowserCard}>
          <Typography variant="h6" sx={{ mb: 1.5, fontWeight: 700 }}>
            Destination Folder
          </Typography>
          <DestFolderBrowser />
        </Box>
      )}

      {pendingConflict && (
        <MetadataConflictDialog
          open={Boolean(pendingConflict)}
          saveResult={pendingConflict}
          onClose={() => setPendingConflict(null)}
          onApplied={(result) => {
            setPendingConflict(null);
            setImportStatus(result.message);
          }}
        />
      )}
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
  resultsToolbar: {
    mb: 2,
    p: 1.5,
    borderRadius: 1.5,
    border: '1px solid rgba(148, 188, 214, 0.2)',
    backgroundColor: 'rgba(9, 16, 20, 0.58)'
  },
  resultsCountText: {
    mt: 1,
    color: 'rgba(226, 241, 255, 0.75)'
  },
  fileBrowserCard: {
    p: { xs: 2, md: 2.5 },
    borderRadius: 2,
    backgroundColor: 'rgba(9, 16, 20, 0.78)',
    border: '1px solid rgba(148, 188, 214, 0.25)'
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
  posterFallback: {
    height: 360,
    p: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    background: 'linear-gradient(145deg, rgba(13, 20, 24, 0.95), rgba(20, 34, 42, 0.95))',
    borderBottom: '1px solid rgba(158, 199, 226, 0.2)',
  },
  posterFallbackTitle: {
    fontWeight: 700,
    letterSpacing: 0.3,
    color: 'rgba(237, 246, 255, 0.9)',
    display: '-webkit-box',
    WebkitLineClamp: 4,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
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
