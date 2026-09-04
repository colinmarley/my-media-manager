'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Divider,
  FormControl, FormControlLabel, InputLabel, MenuItem,
  Paper, Radio, RadioGroup, Select, Stack,
  TextField, Typography,
} from '@mui/material';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import TmdbService from '@/service/tmdb/TmdbService';
import type {
  Assignment, DiscTitle, ExtrasCategory, StartJobRequest,
  TmdbEpisode, TmdbResult, TmdbSeason,
} from '@/types/disc-ripper/DiscRipper.type';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { epCode, POSTER_BASE, previewFilenames } from './discRipperUtils';
import ExtrasTypeSelector from './ExtrasTypeSelector';
import DiscCatalogLinkPanel from './DiscCatalogLinkPanel';

export default function ConfigureStep({
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
  // Extras taxonomy per title (independent of the show-only episode/special
  // assignment above — applies to both movie and show discs). A set entry
  // here takes priority in the backend's _build_dest_name.
  const [contentTypes, setContentTypes] = useState<Record<number, ExtrasCategory | ''>>({});
  const [linkedDisc, setLinkedDisc] = useState<CatalogDisc | null>(null);
  const [error, setError] = useState('');
  const [showUnlinkedConfirm, setShowUnlinkedConfirm] = useState(false);

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
        episode_number: number; name: string; runtime?: number;
      }) => ({ episodeNumber: e.episode_number, name: e.name, runtime: e.runtime ?? undefined }));
      setEpisodes(eps);
      // Auto-assign in order
      const newAssignments: Record<number, Assignment> = {};
      let epIdx = 0;
      for (const idx of [...currentSelectedIndices].sort((a, b) => a - b)) {
        const ep = epIdx < eps.length ? eps[epIdx++] : null;
        newAssignments[idx] = ep
          ? { type: 'episode', episodeNumber: ep.episodeNumber, episodeName: ep.name }
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
      setContentTypes((prev) => { const n = { ...prev }; delete n[idx]; return n; });
    } else {
      setSelectedIndices((prev) => [...prev, idx].sort((a, b) => a - b));
      if (episodes.length) {
        const usedEps = new Set(
          Object.values(assignments)
            .filter((a): a is Extract<Assignment, { type: 'episode' }> => a.type === 'episode')
            .map((a) => a.episodeNumber)
        );
        const next = episodes.find((e) => !usedEps.has(e.episodeNumber));
        setAssignments((prev) => ({
          ...prev,
          [idx]: next
            ? { type: 'episode', episodeNumber: next.episodeNumber, episodeName: next.name }
            : { type: 'special' },
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
      const ep = episodes.find((e) => e.episodeNumber === epNum);
      setAssignments((prev) => ({ ...prev, [titleIdx]: { type: 'episode', episodeNumber: epNum, episodeName: ep?.name ?? '' } }));
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

  const doSubmit = () => {
    const episodeMap = mediaType === 'show' ? buildEpisodeMapExcludingExtras() : undefined;

    const titleContentTypes = Object.fromEntries(
      Object.entries(contentTypes).filter(([, v]) => v !== '')
    );

    onSubmit({
      disc_type: discType,
      media_type: mediaType,
      title: title.trim(),
      year,
      imdb_id: imdbId.trim() || undefined,
      season: mediaType === 'show' ? season : undefined,
      mkv_title_indices: selectedIndices,
      episode_map: episodeMap && Object.keys(episodeMap).length ? episodeMap : undefined,
      catalog_disc_id: linkedDisc?.id,
      title_content_types: Object.keys(titleContentTypes).length ? titleContentTypes : undefined,
    });
  };

  const submit = () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!year || year < 1888 || year > 2100) { setError('Enter a valid year'); return; }
    if (!selectedIndices.length) { setError('Select at least one title to rip'); return; }
    setError('');

    if (!linkedDisc) {
      setShowUnlinkedConfirm(true);
      return;
    }
    doSubmit();
  };

  // Titles tagged with an extras content_type are routed by the backend via
  // that suffix instead of episode naming, so exclude them from episode_map
  // to avoid sending a redundant/conflicting episode code for the same title.
  function buildEpisodeMapExcludingExtras(): Record<string, string> {
    const map: Record<string, string> = {};
    let specialN = 0;
    for (const idx of [...selectedIndices].sort((a, b) => a - b)) {
      if (contentTypes[idx]) continue;
      const a = assignments[idx];
      if (!a) continue;
      if (a.type === 'episode') {
        const code = epCode(season, a.episodeNumber);
        map[String(idx)] = a.episodeName ? `${code} - ${a.episodeName}` : code;
      } else if (a.type === 'special') {
        specialN++;
        map[String(idx)] = `SpecialFeature${String(specialN).padStart(3, '0')}`;
      } else if (a.type === 'custom' && a.name.trim()) {
        map[String(idx)] = a.name.trim();
      }
    }
    return map;
  }

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

      {/* ── Physical disc catalog link ─────────────────────────────────── */}
      <DiscCatalogLinkPanel
        discTitle={title}
        linkedDisc={linkedDisc}
        onLink={setLinkedDisc}
        onUnlink={() => setLinkedDisc(null)}
      />

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
            {selectedIndices.length > 0 && (() => {
              const bytes = selectedIndices.reduce((sum, idx) => {
                const t = titles.find((t) => t.index === idx);
                return sum + (t?.file_size_bytes ?? 0);
              }, 0);
              return (
                <Typography variant="caption" color="text.secondary">
                  {selectedIndices.length} selected · ~{DiscRipperService.formatBytes(bytes)}
                </Typography>
              );
            })()}
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
            const isExtra = !!contentTypes[t.index];

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
                    {DiscRipperService.formatDuration(t.duration_seconds)}
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
                  {isSelected && !isExtra && preview && (
                    <Chip
                      label={preview}
                      size="small"
                      color={a?.type === 'episode' ? 'primary' : 'default'}
                      variant={a?.type === 'episode' ? 'filled' : 'outlined'}
                      sx={{ maxWidth: 260, fontFamily: 'monospace', fontSize: 11 }}
                    />
                  )}
                </Stack>

                {isSelected && (
                  <Box sx={{ mt: 1 }} onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                      {/* Extras taxonomy — applies to movie and show titles alike */}
                      <ExtrasTypeSelector
                        value={contentTypes[t.index] ?? ''}
                        onChange={(value) =>
                          setContentTypes((prev) => ({ ...prev, [t.index]: value }))
                        }
                      />

                      {/* Episode/feature assignment — TV shows only, and only when
                          this title isn't already tagged as an extra above */}
                      {mediaType === 'show' && !isExtra && (
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
                                  {ep.runtime && (
                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                      {ep.runtime}m
                                    </Typography>
                                  )}
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
                      )}
                    </Stack>

                    {mediaType === 'show' && !isExtra && a?.type === 'custom' && (
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

      {/* ── Episode count warning ──────────────────────────────────────── */}
      {mediaType === 'show' && episodes.length > 0 && selectedIndices.length > episodes.length && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You&apos;ve selected {selectedIndices.length} titles but Season {season} only has {episodes.length} episodes.
          Extra titles will be numbered as special features.
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Output filename preview ────────────────────────────────────── */}
      {selectedIndices.length > 0 && title.trim() && (() => {
        const names = previewFilenames(mediaType, title.trim(), year, selectedIndices, assignments, season);
        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Output file{names.length !== 1 ? 's' : ''} preview
            </Typography>
            <Stack spacing={0.5}>
              {names.map((name, i) => (
                <Typography key={i} variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}>
                  {name}
                </Typography>
              ))}
            </Stack>
          </Paper>
        );
      })()}

      <Button variant="contained" size="large" onClick={submit}>
        Start Rip
      </Button>

      <Dialog open={showUnlinkedConfirm} onClose={() => setShowUnlinkedConfirm(false)}>
        <DialogTitle>Start rip without a linked disc?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This rip isn&apos;t linked to a catalog disc — the delivered files won&apos;t be
            traceable back to a physical disc afterward. Continue anyway?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowUnlinkedConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => { setShowUnlinkedConfirm(false); doSubmit(); }}
          >
            Start Rip Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
