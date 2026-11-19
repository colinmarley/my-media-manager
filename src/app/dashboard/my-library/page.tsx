'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  TextField,
  Tabs,
  Typography
} from '@mui/material';
import { Add, Close, MovieFilterOutlined, Search } from '@mui/icons-material';
import useMovies from '@/hooks/catalog/useMovies';
import useSeries from '@/hooks/catalog/useSeries';
import useDiscs from '@/hooks/catalog/useDiscs';
import { CatalogMovie } from '@/types/catalog/Movie.type';
import { CatalogSeries } from '@/types/catalog/Series.type';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
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
import TitleCard, { PosterPlaceholder, TitleCardSkeleton, posterFrameSx } from './_components/TitleCard';

const MAX_POSTER_CHECKS = 1;

type LibraryFilter = 'all' | 'in_library' | 'not_in_library' | 'has_files' | 'no_files';

const TAB_NOUNS: Record<string, string> = {
  movie: 'movies',
  series: 'shows',
  documentary: 'documentaries',
  live_performance: 'live performances',
  home_video: 'home videos',
  needs_review: 'titles needing review',
};

/** Poster grid: as many ~170px columns as fit, so posters stay poster-sized on any screen. */
const gridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(132px, 1fr))', sm: 'repeat(auto-fill, minmax(168px, 1fr))' },
  columnGap: 2.5,
  rowGap: 3,
} as const;

const selectSx = { minWidth: { xs: '100%', md: 128 } } as const;

const coverSx = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;

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

const tabLabel = (label: string, count: number) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>
    {label}
    <Box component="span" sx={{ color: 'text.disabled', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
      {count}
    </Box>
  </Box>
);

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
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [addOpen, setAddOpen] = useState(false);

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

  const totalTitles = computedMedia.length;
  const inLibraryCount = computedMedia.filter((item) => item.inLibrary).length;
  const tabNoun = TAB_NOUNS[selectedTab] ?? 'titles';
  const filtersActive = Boolean(librarySearchQuery.trim()) || libraryFilter !== 'all';
  const showGrid = selectedTab !== 'files';

  return (
    <PageContainer>
      <PageHeader
        title="Titles"
        subtitle={loading
          ? 'The movies and shows in your catalog.'
          : `${totalTitles.toLocaleString()} title${totalTitles === 1 ? '' : 's'} in your catalog, ${inLibraryCount.toLocaleString()} with files in the library.`}
        actions={(
          <Button
            variant={addOpen ? 'outlined' : 'contained'}
            startIcon={addOpen ? <Close /> : <Add />}
            onClick={() => setAddOpen((open) => !open)}
            aria-expanded={addOpen}
            aria-controls="add-title-panel"
          >
            {addOpen ? 'Close' : 'Add title'}
          </Button>
        )}
      />

      <Collapse in={addOpen} unmountOnExit>
        <Paper variant="outlined" id="add-title-panel" sx={{ p: 2.5, mb: 3 }}>
          <Typography variant="h5" component="h2">Add a title</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '72ch' }}>
            Search OMDB or TMDB and save the match. Saved titles show up here and can be matched to files by ingest.
          </Typography>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
            <TextField
              label={searchMode === 'imdb_id' ? 'IMDb ID' : 'Search title'}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={searchMode === 'imdb_id' ? 'tt1234567' : 'Battlestar Galactica'}
              onKeyDown={(event) => { if (event.key === 'Enter' && searchText.trim()) handleSearch(); }}
              sx={{ flex: '1 1 260px' }}
              autoFocus
            />
            <FormControl sx={selectSx}>
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
            {searchMode === 'title' && (
              <FormControl sx={selectSx}>
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
            )}
            <FormControl sx={selectSx}>
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
            {searchType === 'movie' && (
              <FormControl sx={{ minWidth: { xs: '100%', md: 170 } }}>
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
            )}
            <Button
              variant="contained"
              onClick={handleSearch}
              disabled={searchLoading || !searchText.trim()}
              startIcon={searchLoading ? <CircularProgress size={16} color="inherit" /> : <Search />}
              sx={{ minHeight: 37, minWidth: 104 }}
            >
              Search
            </Button>
          </Stack>

          {searchError && <Alert severity="error" sx={{ mb: 1.5 }}>{searchError}</Alert>}
          {importStatus && <Alert severity="info" sx={{ mb: 1.5 }}>{importStatus}</Alert>}

          {searchResults.length > 0 && (
            <Box sx={{ ...gridSx, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              {searchResults.map((result) => {
                const candidateId = result.imdbId || result.tmdbId?.toString() || result.title;
                const poster = result.posterUrl && result.posterUrl !== 'N/A' ? result.posterUrl : null;
                const saving = saveLoadingId === candidateId;

                return (
                  <Box key={`${result.source}-${candidateId}`}>
                    <Box sx={posterFrameSx}>
                      {poster ? (
                        <Box component="img" src={poster} alt="" loading="lazy" sx={coverSx} />
                      ) : (
                        <PosterPlaceholder title={result.title} detail={result.year ? String(result.year) : undefined} />
                      )}
                    </Box>
                    <Typography variant="subtitle2" component="h3" noWrap sx={{ mt: 1 }} title={result.title}>
                      {result.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                      {[result.year || 'Year unknown', result.mediaType === 'movie' ? 'Movie' : 'Show', result.source.toUpperCase()].join(', ')}
                    </Typography>
                    <Button
                      fullWidth
                      size="small"
                      variant="outlined"
                      onClick={() => handleSaveResult(result)}
                      disabled={saving}
                      startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
                    >
                      Save to Library
                    </Button>
                  </Box>
                );
              })}
            </Box>
          )}

          {movieSubType === 'live_performance' && (
            <Box sx={{ mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="h6" component="h3">Not on OMDB or TMDB?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Enter a title and year to add a live performance by hand.
              </Typography>

              {manualSaveError && <Alert severity="error" sx={{ mb: 1.5 }}>{manualSaveError}</Alert>}
              {manualSaveStatus && <Alert severity="success" sx={{ mb: 1.5 }}>{manualSaveStatus}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  label="Title"
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                  placeholder="The Rolling Stones – Shine a Light"
                  onKeyDown={(event) => { if (event.key === 'Enter' && manualTitle.trim()) handleManualSave(); }}
                  sx={{ flex: '1 1 260px', maxWidth: { sm: 420 } }}
                />
                <TextField
                  label="Year"
                  value={manualYear}
                  onChange={(event) => setManualYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="2008"
                  slotProps={{ htmlInput: { maxLength: 4, inputMode: 'numeric' } }}
                  onKeyDown={(event) => { if (event.key === 'Enter' && manualTitle.trim()) handleManualSave(); }}
                  sx={{ width: { sm: 110 } }}
                />
                <Button
                  variant="outlined"
                  onClick={handleManualSave}
                  disabled={manualSaveLoading || !manualTitle.trim()}
                  startIcon={manualSaveLoading ? <CircularProgress size={14} color="inherit" /> : null}
                  sx={{ minHeight: 37 }}
                >
                  Add to Library
                </Button>
              </Stack>
            </Box>
          )}
        </Paper>
      </Collapse>

      <Tabs
        value={selectedTab}
        onChange={(_, value) => setSelectedTab(value)}
        aria-label="Title type"
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2 }}
      >
        <Tab value="movie" label={tabLabel('Movies', movieCards.length)} />
        <Tab value="series" label={tabLabel('Shows', seriesCards.length)} />
        <Tab value="documentary" label={tabLabel('Documentaries', documentaryCards.length)} />
        <Tab value="live_performance" label={tabLabel('Live Performances', livePerformanceCards.length)} />
        {homeVideoCards.length > 0 && (
          <Tab value="home_video" label={tabLabel('Home Videos', homeVideoCards.length)} />
        )}
        {needsReviewCards.length > 0 && (
          <Tab value="needs_review" label={tabLabel('Needs Review', needsReviewCards.length)} />
        )}
        <Tab value="files" label="Destination Files" />
      </Tabs>

      {showGrid && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2.5 }}>
          <TextField
            placeholder="Search by title, year or ID"
            value={librarySearchQuery}
            onChange={(event) => setLibrarySearchQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search library' },
            }}
            sx={{ flex: 1, maxWidth: { sm: 380 } }}
          />
          <FormControl sx={{ minWidth: { xs: '100%', sm: 170 } }}>
            <Select
              value={libraryFilter}
              onChange={(event) => setLibraryFilter(event.target.value as LibraryFilter)}
              inputProps={{ 'aria-label': 'Filter' }}
            >
              <MenuItem value="all">All titles</MenuItem>
              <MenuItem value="in_library">In library</MenuItem>
              <MenuItem value="not_in_library">Not in library</MenuItem>
              <MenuItem value="has_files">Has files</MenuItem>
              <MenuItem value="no_files">No files</MenuItem>
            </Select>
          </FormControl>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ ml: { sm: 'auto !important' }, fontVariantNumeric: 'tabular-nums' }}
          >
            Showing {filteredVisibleCards.length} of {visibleCards.length}
          </Typography>
        </Stack>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the library: {error}
        </Alert>
      )}

      {loading && showGrid && (
        <Box sx={gridSx} role="status" aria-label="Loading your library">
          {Array.from({ length: 12 }, (_, index) => <TitleCardSkeleton key={index} />)}
        </Box>
      )}

      {!loading && showGrid && filteredVisibleCards.length === 0 && (
        <Paper variant="outlined">
          {filtersActive && visibleCards.length > 0 ? (
            <EmptyState
              title={`No ${tabNoun} match that search`}
              description="Try a different title, year or ID, or clear the filter."
              action={(
                <Button variant="outlined" onClick={() => { setLibrarySearchQuery(''); setLibraryFilter('all'); }}>
                  Clear search
                </Button>
              )}
            />
          ) : (
            <EmptyState
              icon={<MovieFilterOutlined />}
              title={`No ${tabNoun} in your catalog yet`}
              description="Add a title from OMDB or TMDB, or let ingest create one when it matches a file."
              action={!addOpen ? (
                <Button variant="outlined" startIcon={<Add />} onClick={() => setAddOpen(true)}>Add title</Button>
              ) : undefined}
            />
          )}
        </Paper>
      )}

      {!loading && showGrid && filteredVisibleCards.length > 0 && (
        <Box sx={gridSx}>
          {filteredVisibleCards.map((item) => {
            const media = item.media;
            const posterKey = `${item.mediaType}-${item.mediaId}`;
            return (
              <TitleCard
                key={posterKey}
                href={`/dashboard/my-library/${item.mediaType}/${encodeURIComponent(item.mediaId)}`}
                title={media.title}
                yearLabel={getTitleYearLabel(media)}
                placeholderTitle={getFolderDisplayName(media)}
                posterUrl={`/api/backend/api/posters/${item.mediaType}/${encodeURIComponent(item.mediaId)}`}
                posterFailed={(posterCheckCounts[posterKey] ?? 0) >= MAX_POSTER_CHECKS}
                onPosterError={() => markPosterChecked(posterKey)}
                inLibrary={item.inLibrary}
                fileCount={item.fileCount}
              />
            );
          })}
        </Box>
      )}

      {selectedTab === 'files' && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 1.5 }}>
            Destination folder
          </Typography>
          <DestFolderBrowser />
        </Paper>
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
    </PageContainer>
  );
};

export default MyLibraryPage;
