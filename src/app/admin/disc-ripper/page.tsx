'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Collapse, Container, Divider,
  FormControl, FormControlLabel, FormLabel, IconButton, InputLabel, MenuItem,
  Paper, Radio, RadioGroup, Select, Stack, Step, StepButton, Stepper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StopIcon from '@mui/icons-material/Stop';
import { DiscRipperService, DiscTitle, RipJob, StartJobRequest } from '@/service/disc-ripper/DiscRipperService';
import TmdbService from '@/service/tmdb/TmdbService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TmdbResult {
  tmdbId: number;
  type: 'tv' | 'movie';
  name: string;
  year: number;
  posterPath: string | null;
}

interface TmdbSeason {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

interface TmdbEpisode {
  episodeNumber: number;
  name: string;
}

type Assignment =
  | { type: 'episode'; episodeNumber: number }
  | { type: 'special' }
  | { type: 'custom'; name: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'default', ripping: 'info', encoding: 'warning',
  delivering: 'info', done: 'success', failed: 'error', cancelled: 'default',
};

function StatusChip({ status }: { status: string }) {
  return <Chip label={status} color={STATUS_COLORS[status] ?? 'default'} size="small" />;
}

function fmtDur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function epCode(season: number, ep: number) {
  return `S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')}`;
}

function buildEpisodeMap(
  selectedIndices: number[],
  assignments: Record<number, Assignment>,
  season: number,
): Record<string, string> {
  const map: Record<string, string> = {};
  let specialN = 0;
  for (const idx of [...selectedIndices].sort((a, b) => a - b)) {
    const a = assignments[idx];
    if (!a) continue;
    if (a.type === 'episode') {
      map[String(idx)] = epCode(season, a.episodeNumber);
    } else if (a.type === 'special') {
      specialN++;
      map[String(idx)] = `SpecialFeature${String(specialN).padStart(3, '0')}`;
    } else if (a.type === 'custom' && a.name.trim()) {
      map[String(idx)] = a.name.trim();
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Step 1 — Disc Scanner
// ---------------------------------------------------------------------------

function DiscScanStep({
  titles,
  setTitles,
  scanError,
  setScanError,
  onContinue,
}: {
  titles: DiscTitle[];
  setTitles: (t: DiscTitle[]) => void;
  scanError: string;
  setScanError: (e: string) => void;
  onContinue: () => void;
}) {
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    setScanning(true);
    setScanError('');
    setTitles([]);
    try {
      const info = await DiscRipperService.getDiscInfo();
      if (info.error) {
        setScanError(info.error);
      } else {
        setTitles(info.titles);
      }
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Scan failed — is the ripper service running?');
    } finally {
      setScanning(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Insert the disc and click Scan to read its contents.
        The ripper service must be running on the ai-workstation (port 8083).
      </Typography>
      <Button
        variant="contained"
        onClick={scan}
        disabled={scanning}
        startIcon={scanning ? <CircularProgress size={16} /> : <RefreshIcon />}
      >
        {scanning ? 'Scanning…' : 'Scan Disc'}
      </Button>

      {scanError && <Alert severity="error" sx={{ mt: 2 }}>{scanError}</Alert>}

      {titles.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Found {titles.length} title(s) — select the episodes/content in the next step
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Resolution</TableCell>
                  <TableCell>Codec</TableCell>
                  <TableCell>Chapters</TableCell>
                  <TableCell>Size</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {titles.map((t) => (
                  <TableRow key={t.index} hover sx={{ opacity: t.duration_seconds < 120 ? 0.5 : 1 }}>
                    <TableCell>{t.index}</TableCell>
                    <TableCell>
                      {fmtDur(t.duration_seconds)}
                      {t.duration_seconds < 120 && (
                        <Chip label="short" size="small" sx={{ ml: 1, height: 16, fontSize: 10 }} />
                      )}
                    </TableCell>
                    <TableCell>{t.width && t.height ? `${t.width}×${t.height}` : '—'}</TableCell>
                    <TableCell>{t.codec || '—'}</TableCell>
                    <TableCell>{t.chapter_count || '—'}</TableCell>
                    <TableCell>{DiscRipperService.formatBytes(t.file_size_bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Button variant="contained" sx={{ mt: 2 }} onClick={onContinue}>
            Continue to Configure →
          </Button>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Configure
// ---------------------------------------------------------------------------

function ConfigureStep({
  titles,
  onSubmit,
}: {
  titles: DiscTitle[];
  onSubmit: (req: StartJobRequest) => void;
}) {
  // Search
  const [searchInput, setSearchInput] = useState('');
  const [searchValue, setSearchValue] = useState<TmdbResult | null>(null);
  const [searchResults, setSearchResults] = useState<TmdbResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TMDB data
  const [tmdbSeriesId, setTmdbSeriesId] = useState<number | null>(null);
  const [tmdbSeasons, setTmdbSeasons] = useState<TmdbSeason[]>([]);
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  // Form fields
  const [mediaType, setMediaType] = useState<'movie' | 'show'>('show');
  const [discType, setDiscType] = useState<'dvd' | 'bluray'>('dvd');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [imdbId, setImdbId] = useState('');
  const [season, setSeason] = useState(1);

  // Title selection + assignments
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [assignments, setAssignments] = useState<Record<number, Assignment>>({});
  const [error, setError] = useState('');

  // Auto-detect disc type from video width
  useEffect(() => {
    const first = titles.find((t) => t.width > 0);
    if (first) setDiscType(first.width > 1280 ? 'bluray' : 'dvd');
  }, [titles]);

  // Default-select all non-short titles
  useEffect(() => {
    const long = titles.filter((t) => t.duration_seconds >= 120).map((t) => t.index);
    setSelectedIndices(long);
  }, [titles]);

  // ── Search ────────────────────────────────────────────────────────────────

  const doSearch = useCallback(async (q: string, type: 'show' | 'movie') => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      let raw;
      if (type === 'show') {
        raw = await TmdbService.searchTV(q);
        const results: TmdbResult[] = (raw.results ?? []).slice(0, 8).map((r: {
          id: number; name?: string; first_air_date?: string; poster_path: string | null;
        }) => ({
          tmdbId: r.id, type: 'tv' as const,
          name: r.name ?? '',
          year: r.first_air_date ? parseInt(r.first_air_date) : 0,
          posterPath: r.poster_path,
        }));
        setSearchResults(results);
      } else {
        raw = await TmdbService.searchMovies(q);
        const results: TmdbResult[] = (raw.results ?? []).slice(0, 8).map((r: {
          id: number; title?: string; release_date?: string; poster_path: string | null;
        }) => ({
          tmdbId: r.id, type: 'movie' as const,
          name: r.title ?? '',
          year: r.release_date ? parseInt(r.release_date) : 0,
          posterPath: r.poster_path,
        }));
        setSearchResults(results);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(value, mediaType), 400);
  };

  // ── TMDB selection ────────────────────────────────────────────────────────

  const loadEpisodes = useCallback(async (seriesId: number, seasonNum: number, currentSelectedIndices: number[]) => {
    setEpisodesLoading(true);
    try {
      const data = await TmdbService.getSeasonDetails(seriesId, seasonNum);
      const eps: TmdbEpisode[] = (data.episodes ?? []).map((e: {
        episode_number: number; name: string;
      }) => ({ episodeNumber: e.episode_number, name: e.name }));
      setEpisodes(eps);
      // Auto-assign in order
      const newAssignments: Record<number, Assignment> = {};
      let epIdx = 0;
      for (const idx of [...currentSelectedIndices].sort((a, b) => a - b)) {
        newAssignments[idx] = epIdx < eps.length
          ? { type: 'episode', episodeNumber: eps[epIdx++].episodeNumber }
          : { type: 'special' };
      }
      setAssignments(newAssignments);
    } catch {
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  }, []);

  const handleSelectResult = async (result: TmdbResult | null) => {
    setSearchValue(result);
    setTmdbSeasons([]);
    setEpisodes([]);
    setAssignments({});
    if (!result) return;

    setTitle(result.name);
    setYear(result.year);
    setImdbId('');

    if (result.type === 'tv') {
      setTmdbSeriesId(result.tmdbId);
      try {
        const [details, extIds] = await Promise.all([
          TmdbService.getTVSeriesDetails(result.tmdbId),
          TmdbService.getTVSeriesExternalIds(result.tmdbId),
        ]);
        if (extIds.imdb_id) setImdbId(extIds.imdb_id);
        const seasons: TmdbSeason[] = (details.seasons ?? [])
          .filter((s: { season_number: number }) => s.season_number > 0)
          .map((s: { season_number: number; name: string; episode_count: number }) => ({
            seasonNumber: s.season_number,
            name: s.name,
            episodeCount: s.episode_count,
          }));
        setTmdbSeasons(seasons);
        if (seasons.length > 0) {
          const firstSeason = seasons[0].seasonNumber;
          setSeason(firstSeason);
          await loadEpisodes(result.tmdbId, firstSeason, selectedIndices);
        }
      } catch { /* fall through to manual entry */ }
    } else {
      setTmdbSeriesId(null);
      try {
        const details = await TmdbService.getMovieDetails(result.tmdbId);
        if (details.imdb_id) setImdbId(details.imdb_id);
      } catch { /* ignore */ }
    }
  };

  const handleSeasonChange = async (seasonNum: number) => {
    setSeason(seasonNum);
    setAssignments({});
    if (tmdbSeriesId) await loadEpisodes(tmdbSeriesId, seasonNum, selectedIndices);
  };

  const handleMediaTypeChange = (type: 'show' | 'movie') => {
    setMediaType(type);
    setSearchInput('');
    setSearchValue(null);
    setSearchResults([]);
    setTmdbSeasons([]);
    setEpisodes([]);
    setAssignments({});
    setTmdbSeriesId(null);
  };

  // ── Title selection ───────────────────────────────────────────────────────

  const toggleTitle = (idx: number) => {
    const isSelected = selectedIndices.includes(idx);
    if (isSelected) {
      setSelectedIndices((prev) => prev.filter((i) => i !== idx));
      setAssignments((prev) => { const n = { ...prev }; delete n[idx]; return n; });
    } else {
      setSelectedIndices((prev) => [...prev, idx].sort((a, b) => a - b));
      if (episodes.length) {
        const usedEps = new Set(
          Object.values(assignments)
            .filter((a): a is { type: 'episode'; episodeNumber: number } => a.type === 'episode')
            .map((a) => a.episodeNumber)
        );
        const next = episodes.find((e) => !usedEps.has(e.episodeNumber));
        setAssignments((prev) => ({
          ...prev,
          [idx]: next ? { type: 'episode', episodeNumber: next.episodeNumber } : { type: 'special' },
        }));
      }
    }
  };

  const setAssignment = (titleIdx: number, value: string) => {
    if (value === 'special') {
      setAssignments((prev) => ({ ...prev, [titleIdx]: { type: 'special' } }));
    } else if (value === 'custom') {
      setAssignments((prev) => ({ ...prev, [titleIdx]: { type: 'custom', name: '' } }));
    } else if (value.startsWith('ep:')) {
      const epNum = parseInt(value.slice(3));
      setAssignments((prev) => ({ ...prev, [titleIdx]: { type: 'episode', episodeNumber: epNum } }));
    }
  };

  const getAssignmentSelectValue = (titleIdx: number): string => {
    const a = assignments[titleIdx];
    if (!a) return '';
    if (a.type === 'episode') return `ep:${a.episodeNumber}`;
    return a.type;
  };

  const getAssignmentPreview = (titleIdx: number): string | null => {
    const a = assignments[titleIdx];
    if (!a) return null;
    if (a.type === 'episode') {
      const ep = episodes.find((e) => e.episodeNumber === a.episodeNumber);
      return `${epCode(season, a.episodeNumber)}${ep ? ` — ${ep.name}` : ''}`;
    }
    if (a.type === 'special') return 'SpecialFeature…';
    if (a.type === 'custom' && a.name) return a.name;
    return null;
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!year || year < 1888 || year > 2100) { setError('Enter a valid year'); return; }
    if (!selectedIndices.length) { setError('Select at least one title to rip'); return; }
    setError('');

    const episodeMap = mediaType === 'show'
      ? buildEpisodeMap(selectedIndices, assignments, season)
      : undefined;

    onSubmit({
      disc_type: discType,
      media_type: mediaType,
      title: title.trim(),
      year,
      imdb_id: imdbId.trim() || undefined,
      season: mediaType === 'show' ? season : undefined,
      mkv_title_indices: selectedIndices,
      episode_map: episodeMap && Object.keys(episodeMap).length ? episodeMap : undefined,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Search & Metadata ──────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
          <FormControl>
            <RadioGroup
              row
              value={mediaType}
              onChange={(e) => handleMediaTypeChange(e.target.value as 'show' | 'movie')}
            >
              <FormControlLabel value="show" control={<Radio size="small" />} label="TV Show" />
              <FormControlLabel value="movie" control={<Radio size="small" />} label="Movie" />
            </RadioGroup>
          </FormControl>
          <FormControl>
            <RadioGroup
              row
              value={discType}
              onChange={(e) => setDiscType(e.target.value as 'dvd' | 'bluray')}
            >
              <FormControlLabel
                value="dvd"
                control={<Radio size="small" />}
                label={
                  <span>DVD{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      (H.265)
                    </Typography>
                  </span>
                }
              />
              <FormControlLabel
                value="bluray"
                control={<Radio size="small" />}
                label={
                  <span>Blu-ray{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      (remux)
                    </Typography>
                  </span>
                }
              />
            </RadioGroup>
          </FormControl>
        </Stack>

        <Autocomplete
          value={searchValue}
          inputValue={searchInput}
          options={searchResults}
          loading={searchLoading}
          getOptionLabel={(opt) => `${opt.name} (${opt.year || '?'})`}
          isOptionEqualToValue={(a, b) => a.tmdbId === b.tmdbId}
          filterOptions={(x) => x}
          onInputChange={(_, value, reason) => {
            if (reason === 'input') handleSearchInput(value);
            else setSearchInput(value);
          }}
          onChange={(_, value) => handleSelectResult(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label={mediaType === 'show' ? 'Search TV show on TMDB' : 'Search movie on TMDB'}
              size="small"
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searchLoading && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: React.Key };
            return (
              <li key={key} {...rest}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 0.25 }}>
                  {option.posterPath
                    ? <Box component="img" src={`${POSTER_BASE}${option.posterPath}`} alt=""
                        sx={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }} />
                    : <Box sx={{ width: 32, height: 48, bgcolor: 'divider', borderRadius: 0.5, flexShrink: 0 }} />
                  }
                  <Box>
                    <Typography variant="body2" fontWeight={500}>{option.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.year || '—'}</Typography>
                  </Box>
                </Stack>
              </li>
            );
          }}
          sx={{ mb: 2 }}
        />

        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            size="small"
            sx={{ flex: '2 1 180px' }}
          />
          <TextField
            label="Year"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            size="small"
            sx={{ width: 100 }}
          />
          <TextField
            label="IMDb ID"
            value={imdbId}
            onChange={(e) => setImdbId(e.target.value)}
            placeholder="tt0810788"
            size="small"
            sx={{ width: 160 }}
          />
          {mediaType === 'show' && tmdbSeasons.length > 0 && (
            <FormControl size="small" sx={{ width: 200 }}>
              <InputLabel>Season</InputLabel>
              <Select
                label="Season"
                value={season}
                onChange={(e) => handleSeasonChange(Number(e.target.value))}
              >
                {tmdbSeasons.map((s) => (
                  <MenuItem key={s.seasonNumber} value={s.seasonNumber}>
                    {s.name}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                      ({s.episodeCount} ep)
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {mediaType === 'show' && tmdbSeasons.length === 0 && (
            <TextField
              label="Season"
              type="number"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              size="small"
              sx={{ width: 100 }}
            />
          )}
        </Stack>
      </Paper>

      {/* ── Title Selection ────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Titles to rip</Typography>
            {episodesLoading && <CircularProgress size={14} />}
            {episodes.length > 0 && (
              <Chip
                label={`${episodes.length} episodes loaded`}
                size="small"
                color="info"
                variant="outlined"
              />
            )}
          </Stack>
          {mediaType === 'show' && selectedIndices.length > 0 && episodes.length > 0 && (
            <Button
              size="small"
              variant="text"
              onClick={() => loadEpisodes(tmdbSeriesId!, season, selectedIndices)}
            >
              Re-assign in order
            </Button>
          )}
        </Stack>

        <Stack spacing={0.75}>
          {titles.map((t) => {
            const isSelected = selectedIndices.includes(t.index);
            const isShort = t.duration_seconds < 120;
            const a = assignments[t.index];
            const preview = getAssignmentPreview(t.index);

            return (
              <Paper
                key={t.index}
                variant="outlined"
                onClick={() => toggleTitle(t.index)}
                sx={{
                  p: 1.25,
                  cursor: 'pointer',
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  bgcolor: isSelected ? 'action.selected' : 'transparent',
                  opacity: isShort && !isSelected ? 0.5 : 1,
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight={isSelected ? 600 : 400}>
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>
                      [{t.index}]
                    </Typography>
                    {fmtDur(t.duration_seconds)}
                    {t.width > 0 && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}· {t.width}×{t.height}
                      </Typography>
                    )}
                    {t.codec && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}· {t.codec}
                      </Typography>
                    )}
                    {t.chapter_count > 0 && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}· {t.chapter_count} ch
                      </Typography>
                    )}
                    {DiscRipperService.formatBytes(t.file_size_bytes) !== '—' && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}· {DiscRipperService.formatBytes(t.file_size_bytes)}
                      </Typography>
                    )}
                    {isShort && (
                      <Chip label="short" size="small" sx={{ ml: 1, height: 16, fontSize: 10 }} />
                    )}
                  </Typography>
                  {isSelected && preview && (
                    <Chip
                      label={preview}
                      size="small"
                      color={a?.type === 'episode' ? 'primary' : 'default'}
                      variant={a?.type === 'episode' ? 'filled' : 'outlined'}
                      sx={{ maxWidth: 260, fontFamily: 'monospace', fontSize: 11 }}
                    />
                  )}
                </Stack>

                {/* Episode/feature assignment — TV shows only */}
                {isSelected && mediaType === 'show' && (
                  <Box sx={{ mt: 1 }} onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <FormControl size="small" sx={{ minWidth: 280 }}>
                        <Select
                          value={getAssignmentSelectValue(t.index)}
                          onChange={(e) => setAssignment(t.index, e.target.value)}
                          displayEmpty
                        >
                          <MenuItem value="" disabled>
                            <em>Assign as…</em>
                          </MenuItem>

                          {episodes.length > 0 && (
                            <MenuItem disabled sx={{ fontSize: 11, py: 0, minHeight: 0, color: 'text.secondary' }}>
                              Episodes
                            </MenuItem>
                          )}
                          {episodes.map((ep) => (
                            <MenuItem key={ep.episodeNumber} value={`ep:${ep.episodeNumber}`}>
                              <Typography variant="body2">
                                <Typography component="span" sx={{ fontFamily: 'monospace', mr: 1 }}>
                                  {epCode(season, ep.episodeNumber)}
                                </Typography>
                                {ep.name}
                              </Typography>
                            </MenuItem>
                          ))}

                          <Divider />
                          <MenuItem value="special">
                            <Typography variant="body2">Special Feature <Typography component="span" variant="caption" color="text.secondary">(auto-name)</Typography></Typography>
                          </MenuItem>
                          <MenuItem value="custom">
                            <Typography variant="body2">Custom name…</Typography>
                          </MenuItem>
                        </Select>
                      </FormControl>
                    </Stack>

                    {a?.type === 'custom' && (
                      <TextField
                        size="small"
                        placeholder="e.g. BehindTheScenes"
                        value={a.name}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [t.index]: { type: 'custom', name: e.target.value },
                          }))
                        }
                        onClick={(e) => e.stopPropagation()}
                        sx={{ mt: 1, width: 280 }}
                      />
                    )}
                  </Box>
                )}
              </Paper>
            );
          })}
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Button variant="contained" size="large" onClick={submit}>
        Start Rip
      </Button>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Monitor
// ---------------------------------------------------------------------------

function MonitorStep({ jobs, serviceError, onRefresh, onViewResults }: {
  jobs: RipJob[];
  serviceError: string;
  onRefresh: () => void;
  onViewResults: (jobId: string) => void;
}) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [liveLog, setLiveLog] = useState<Record<string, string[]>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const streamLog = useCallback((jobId: string) => {
    if (liveLog[jobId]) return;
    const url = `${process.env.NEXT_PUBLIC_DISC_RIPPER_URL ?? 'http://localhost:8083'}/jobs/${jobId}/log`;
    const es = new EventSource(url);
    const lines: string[] = [];
    es.onmessage = (e) => {
      if (e.data === '[EOF]') { es.close(); return; }
      lines.push(e.data);
      setLiveLog((prev) => ({ ...prev, [jobId]: [...lines] }));
    };
    es.onerror = () => es.close();
  }, [liveLog]);

  useEffect(() => {
    if (expandedLog) streamLog(expandedLog);
  }, [expandedLog, streamLog]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [liveLog]);

  const stop = async (jobId: string) => {
    try { await DiscRipperService.stopJob(jobId); } catch { /* ignore */ }
    onRefresh();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle2">{jobs.length} job(s)</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={onRefresh}>Refresh</Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Episodes</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => {
              const eps = job.episode_map ? Object.values(job.episode_map).join(', ') : '—';
              return (
                <React.Fragment key={job.id}>
                  <TableRow hover>
                    <TableCell><StatusChip status={job.status} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{job.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {job.year}
                        {job.disc_type === 'bluray' && (
                          <Chip label="BD" size="small" color="primary" variant="outlined" sx={{ ml: 0.5, height: 14, fontSize: 10 }} />
                        )}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{eps}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{new Date(job.created_at).toLocaleString()}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setExpandedLog(expandedLog === job.id ? null : job.id)}
                        >
                          {expandedLog === job.id ? 'Hide Log' : 'Log'}
                        </Button>
                        {['queued', 'ripping', 'encoding', 'delivering'].includes(job.status) && (
                          <Tooltip title="Cancel job">
                            <IconButton size="small" color="error" onClick={() => stop(job.id)}>
                              <StopIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {job.status === 'done' && job.output_paths.length > 0 && (
                          <Button size="small" variant="outlined" onClick={() => onViewResults(job.id)}>
                            Results
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>

                  {expandedLog === job.id && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ p: 0 }}>
                        <Box
                          ref={logRef}
                          sx={{
                            bgcolor: '#0d1117', color: '#c9d1d9',
                            fontFamily: 'monospace', fontSize: '0.75rem',
                            p: 1.5, maxHeight: 300, overflowY: 'auto',
                          }}
                        >
                          {(liveLog[job.id] ?? (job as unknown as { log?: string }).log?.split('\n') ?? []).map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                          {!liveLog[job.id] && (
                            <Typography variant="caption" color="text.secondary">Loading log…</Typography>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}

                  {job.error && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Alert severity="error" sx={{ py: 0 }}>{job.error}</Alert>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary">No jobs yet</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Results
// ---------------------------------------------------------------------------

function ResultsStep({
  jobs,
  selectedJobId,
  onSelectJob,
  onQueued,
}: {
  jobs: RipJob[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onQueued: (jobId: string) => void;
}) {
  const doneJobs = jobs.filter((j) => j.status === 'done' && j.output_paths.length > 0);
  const effectiveJobId = selectedJobId ?? doneJobs[0]?.id ?? null;
  const sourceJob = doneJobs.find((j) => j.id === effectiveJobId) ?? null;

  const [localPaths, setLocalPaths] = useState<string[]>([]);
  const [editNames, setEditNames] = useState<Record<number, string>>({});
  const [editEpCodes, setEditEpCodes] = useState<Record<number, string>>({});
  const [expandedVideo, setExpandedVideo] = useState<number | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult, setIngestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const basename = (p: string) => p.split('/').pop() ?? p;

  const extractEpCode = (name: string) => {
    const m = name.match(/^(S\d+E\d+)/i);
    return m ? m[1].toUpperCase() : null;
  };

  useEffect(() => {
    if (!sourceJob) return;
    const paths = [...sourceJob.output_paths];
    setLocalPaths(paths);
    const names: Record<number, string> = {};
    const codes: Record<number, string> = {};
    paths.forEach((p, i) => {
      const n = basename(p);
      names[i] = n;
      codes[i] = extractEpCode(n) ?? '';
    });
    setEditNames(names);
    setEditEpCodes(codes);
    setExpandedVideo(null);
    setSaveErrors({});
    setIngestResult(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceJob?.id]);

  const handleEpCodeChange = (i: number, code: string) => {
    const upper = code.toUpperCase();
    setEditEpCodes((prev) => ({ ...prev, [i]: upper }));
    const current = editNames[i] ?? basename(localPaths[i] ?? '');
    if (/^S\d+E\d+/i.test(current)) {
      setEditNames((prev) => ({ ...prev, [i]: current.replace(/^S\d+E\d+/i, upper) }));
    }
  };

  const saveRename = async (i: number) => {
    if (!sourceJob) return;
    setSaving((prev) => ({ ...prev, [i]: true }));
    setSaveErrors((prev) => ({ ...prev, [i]: '' }));
    try {
      const updated = await DiscRipperService.renameFile(sourceJob.id, i, editNames[i]);
      const newPaths = updated.output_paths;
      setLocalPaths(newPaths);
      const newName = basename(newPaths[i]);
      setEditNames((prev) => ({ ...prev, [i]: newName }));
      setEditEpCodes((prev) => ({ ...prev, [i]: extractEpCode(newName) ?? '' }));
    } catch (e: unknown) {
      setSaveErrors((prev) => ({ ...prev, [i]: e instanceof Error ? e.message : 'Rename failed' }));
    } finally {
      setSaving((prev) => ({ ...prev, [i]: false }));
    }
  };

  const sendToIngest = async () => {
    if (!sourceJob) return;
    setIngestLoading(true);
    setIngestResult(null);
    try {
      const res = await fetch('/api/backend/api/ingress/queue/add-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths: localPaths }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json();
      const added = data.data?.added?.length ?? 0;
      const skipped = data.data?.skipped?.length ?? 0;
      const errors = data.data?.errors ?? [];
      let msg = `${added} file(s) added to ingest queue`;
      if (skipped > 0) msg += `, ${skipped} skipped`;
      if (errors.length > 0) msg += ` — ${errors.map((e: { reason: string }) => e.reason).join('; ')}`;
      setIngestResult({ ok: errors.length === 0, msg });
      if (errors.length === 0) onQueued(sourceJob.id);
    } catch (e: unknown) {
      setIngestResult({ ok: false, msg: e instanceof Error ? e.message : 'Failed to add to ingest queue' });
    } finally {
      setIngestLoading(false);
    }
  };

  if (doneJobs.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No completed jobs yet. Complete a rip job to review its output files here.
      </Typography>
    );
  }

  return (
    <Box>
      {doneJobs.length > 1 && (
        <FormControl size="small" sx={{ mb: 3, minWidth: 320 }}>
          <InputLabel>Completed job</InputLabel>
          <Select
            label="Completed job"
            value={effectiveJobId ?? ''}
            onChange={(e) => onSelectJob(e.target.value as string)}
          >
            {doneJobs.map((j) => (
              <MenuItem key={j.id} value={j.id}>
                {j.title} ({j.year})
                {j.season != null ? ` — S${String(j.season).padStart(2, '0')}` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {sourceJob && (
        <Stack spacing={2}>
          {localPaths.map((path, i) => {
            const name = editNames[i] ?? basename(path);
            const isDirty = name !== basename(path);
            const showEpCode = sourceJob.media_type === 'show' && extractEpCode(basename(sourceJob.output_paths[i] ?? '')) !== null;
            const streamUrl = DiscRipperService.streamUrl(sourceJob.id, i);

            return (
              <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                    {showEpCode && (
                      <TextField
                        label="Episode"
                        size="small"
                        value={editEpCodes[i] ?? ''}
                        sx={{ width: 110 }}
                        slotProps={{ input: { style: { fontFamily: 'monospace' } } }}
                        onChange={(e) => handleEpCodeChange(i, e.target.value)}
                      />
                    )}
                    <TextField
                      label="Filename"
                      size="small"
                      value={name}
                      sx={{ flex: '1 1 280px' }}
                      onChange={(e) => setEditNames((prev) => ({ ...prev, [i]: e.target.value }))}
                    />
                    <Button
                      size="small"
                      variant={isDirty ? 'contained' : 'outlined'}
                      disabled={saving[i] || !name.endsWith('.mkv')}
                      onClick={() => saveRename(i)}
                      startIcon={saving[i] ? <CircularProgress size={14} /> : undefined}
                      sx={{ alignSelf: 'center' }}
                    >
                      Save
                    </Button>
                  </Stack>

                  {saveErrors[i] && (
                    <Alert severity="error" sx={{ py: 0 }}>{saveErrors[i]}</Alert>
                  )}

                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {path}
                  </Typography>

                  <Box>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setExpandedVideo(expandedVideo === i ? null : i)}
                    >
                      {expandedVideo === i ? 'Hide Preview' : '▶ Preview'}
                    </Button>
                  </Box>

                  <Collapse in={expandedVideo === i}>
                    <video
                      controls
                      src={streamUrl}
                      style={{ width: '100%', maxHeight: 480, borderRadius: 4, display: 'block' }}
                    />
                  </Collapse>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {sourceJob && (
        <Box sx={{ mt: 3 }}>
          {ingestResult && (
            <Alert severity={ingestResult.ok ? 'success' : 'error'} sx={{ mb: 1.5 }}>
              {ingestResult.msg}
            </Alert>
          )}
          <Button
            variant="contained"
            disabled={ingestLoading}
            onClick={sendToIngest}
            startIcon={ingestLoading ? <CircularProgress size={16} /> : undefined}
          >
            {ingestLoading ? 'Adding…' : 'Add to Ingest Queue'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const STEPS = ['Scan Disc', 'Configure', 'Monitor', 'Results'];

export default function DiscRipperPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [titles, setTitles] = useState<DiscTitle[]>([]);
  const [scanError, setScanError] = useState('');
  const [jobs, setJobs] = useState<RipJob[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [resultsJobId, setResultsJobId] = useState<string | null>(null);
  const [queuedJobIds, setQueuedJobIds] = useState<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    try {
      const j = await DiscRipperService.listJobs();
      setJobs(j);
      setJobsError('');
    } catch (e: unknown) {
      setJobsError(e instanceof Error ? e.message : 'Could not reach disc ripper service');
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleStart = async (req: StartJobRequest) => {
    setSubmitError('');
    try {
      await DiscRipperService.startJob(req);
      await loadJobs();
      setActiveStep(2);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to start job');
    }
  };

  const activeJobs = jobs.filter((j) =>
    ['queued', 'ripping', 'encoding', 'delivering'].includes(j.status)
  );

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>Disc Ripper</Typography>
          <Typography variant="body2" color="text.secondary">
            Rip DVDs and Blu-rays to your Jellyfin library.
            {activeJobs.length > 0 && (
              <Chip label={`${activeJobs.length} active`} size="small" color="info" sx={{ ml: 1 }} />
            )}
          </Typography>
        </Box>
      </Stack>

      {jobsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Disc ripper service unreachable: {jobsError}
        </Alert>
      )}

      <Stepper nonLinear activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label, i) => (
          <Step
            key={label}
            completed={
              (i === 0 && titles.length > 0) ||
              (i === 2 && jobs.length > 0) ||
              (i === 3 && resultsJobId != null && queuedJobIds.has(resultsJobId))
            }
          >
            <StepButton
              onClick={() => setActiveStep(i)}
              disabled={i === 1 && titles.length === 0}
            >
              {label}
              {i === 2 && activeJobs.length > 0 && (
                <Chip label={activeJobs.length} size="small" color="info" sx={{ ml: 0.5 }} />
              )}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {activeStep === 0 && (
        <DiscScanStep
          titles={titles}
          setTitles={setTitles}
          scanError={scanError}
          setScanError={setScanError}
          onContinue={() => setActiveStep(1)}
        />
      )}

      {activeStep === 1 && (
        <Box>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <ConfigureStep titles={titles} onSubmit={handleStart} />
        </Box>
      )}

      {activeStep === 2 && (
        <MonitorStep
          jobs={jobs}
          serviceError={jobsError}
          onRefresh={loadJobs}
          onViewResults={(id) => { setResultsJobId(id); setActiveStep(3); }}
        />
      )}

      {activeStep === 3 && (
        <ResultsStep
          jobs={jobs}
          selectedJobId={resultsJobId}
          onSelectJob={setResultsJobId}
          onQueued={(id) => setQueuedJobIds((prev) => new Set(prev).add(id))}
        />
      )}
    </Container>
  );
}
