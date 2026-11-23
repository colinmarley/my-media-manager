'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Divider,
  FormControl, InputLabel, MenuItem,
  Paper, Select, Stack,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { DiscRipperService } from '@/service/disc-ripper/DiscRipperService';
import TmdbService from '@/service/tmdb/TmdbService';
import type {
  Assignment, DiscScanInfo, DiscTitle, ExtrasCategory, StartJobRequest,
  TmdbEpisode, TmdbResult, TmdbSeason,
} from '@/types/disc-ripper/DiscRipper.type';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import { findSeasonRips, getDisc } from '@/service/catalog/DiscCatalogService';
import { getMediaFiles } from '@/service/library/MediaFilesService';
import {
  analyzeTitles, assignedEpisodeNumbers, autoAssignEpisodes, buildStartJobRequest, DEFAULT_EXTRA_TYPE,
  defaultsToExtra, discTypeFromScan, epCode, episodeValue, formatEpisodeNumbers, heldEpisodeNumbers,
  isPreselected, POSTER_BASE, previewFilenames, rangeEnd, SHORT_CLIP_SECONDS, startJobBlocker,
  suggestedRangeEnd, titleHintLabel, titleHintNote,
} from './discRipperUtils';
import ExtrasTypeSelector from './ExtrasTypeSelector';
import DiscCatalogLinkPanel from './DiscCatalogLinkPanel';

export default function ConfigureStep({
  titles,
  scanId,
  discInfo,
  suggestedDiscId,
  onSubmit,
}: {
  titles: DiscTitle[];
  /** The stored scan these titles came from; ties the job to this exact disc. */
  scanId?: string;
  discInfo?: DiscScanInfo | null;
  /** Catalog disc an earlier rip of this same disc was linked to; preselected. */
  suggestedDiscId?: string;
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
  const [tmdbMovieId, setTmdbMovieId] = useState<number | null>(null);
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
  // Episodes of the season that already exist (library files, other discs'
  // rips): the default numbering starts after them unless the user says not to.
  const [heldEpisodes, setHeldEpisodes] = useState<Set<number>>(new Set());
  const [ignoreHeld, setIgnoreHeld] = useState(false);
  // Titles this page tagged as extras by itself (not the user).
  const autoExtras = useRef<Set<number>>(new Set());

  // A disc that was ripped before is already in the catalog: link it again.
  useEffect(() => {
    if (!suggestedDiscId) return;
    let cancelled = false;
    getDisc(suggestedDiscId).then((disc) => {
      if (!cancelled && disc) setLinkedDisc((current) => current ?? disc);
    });
    return () => { cancelled = true; };
  }, [suggestedDiscId]);

  // The disc says what it is; the video width is the fallback for older scans.
  const detectedDiscType = discTypeFromScan(discInfo?.disc_type);
  useEffect(() => {
    if (detectedDiscType) { setDiscType(detectedDiscType); return; }
    const first = titles.find((t) => t.width > 0);
    if (first) setDiscType(first.width > 1280 ? 'bluray' : 'dvd');
  }, [titles, detectedDiscType]);

  // Repeats, play-all titles and short clips are pointed out and left
  // unselected: a DVD lists each episode more than once. A title that only
  // might be a repeat is selected like any other, with a note.
  const titleHints = useMemo(() => analyzeTitles(titles), [titles]);
  const preselected = useMemo(
    () => titles.filter((t) => isPreselected(titleHints[t.index])).map((t) => t.index),
    [titles, titleHints],
  );
  useEffect(() => { setSelectedIndices(preselected); }, [preselected]);

  // On a TV disc with a play-all title, a selected title the play-all does
  // not include starts out as an extra instead of taking an episode number.
  useEffect(() => {
    const auto = autoExtras.current;
    if (mediaType === 'show') {
      const extras = preselected.filter((idx) => defaultsToExtra(idx, titles, titleHints));
      if (!extras.length) return;
      extras.forEach((idx) => auto.add(idx));
      setContentTypes((prev) => {
        const next = { ...prev };
        for (const idx of extras) if (next[idx] === undefined) next[idx] = DEFAULT_EXTRA_TYPE;
        return next;
      });
    } else if (auto.size) {
      const drop = [...auto];
      auto.clear();
      setContentTypes((prev) => {
        const next = { ...prev };
        for (const idx of drop) if (next[idx] === DEFAULT_EXTRA_TYPE) delete next[idx];
        return next;
      });
    }
  }, [mediaType, preselected, titles, titleHints]);

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

  const fingerprint = discInfo?.fingerprint ?? null;

  /** Episodes of the season already in the library or on another disc's rip; empty when unknown. */
  const loadHeldEpisodes = useCallback(async (seriesId: number, seasonNum: number, imdb: string) => {
    try {
      const [files, rips] = await Promise.all([
        imdb.trim() ? getMediaFiles('series', imdb.trim()).catch(() => null) : Promise.resolve(null),
        findSeasonRips({ tmdbId: seriesId, imdbId: imdb, season: seasonNum }),
      ]);
      return heldEpisodeNumbers({ season: seasonNum, librarySeasons: files?.seasons, rips, fingerprint });
    } catch {
      return new Set<number>();
    }
  }, [fingerprint]);

  const loadEpisodes = useCallback(async (
    seriesId: number, seasonNum: number, currentSelectedIndices: number[], imdb: string, skipHeld = true,
  ) => {
    setEpisodesLoading(true);
    try {
      const [data, held] = await Promise.all([
        TmdbService.getSeasonDetails(seriesId, seasonNum),
        loadHeldEpisodes(seriesId, seasonNum, imdb),
      ]);
      const eps: TmdbEpisode[] = (data.episodes ?? []).map((e: {
        id?: number; episode_number: number; name: string; runtime?: number;
      }) => ({
        episodeNumber: e.episode_number, name: e.name, runtime: e.runtime ?? undefined, tmdbId: e.id,
      }));
      setEpisodes(eps);
      setHeldEpisodes(held);
      // Auto-assign in order, after the episodes that already exist. A clip of
      // a few minutes is never an episode, and neither is a title tagged as an extra.
      setAssignments(autoAssignEpisodes({
        selectedIndices: currentSelectedIndices, titles, episodes: eps, contentTypes,
        held: skipHeld ? held : undefined,
      }));
    } catch {
      setEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  }, [titles, contentTypes, loadHeldEpisodes]);

  const handleSelectResult = async (result: TmdbResult | null) => {
    setSearchValue(result);
    setTmdbSeasons([]);
    setEpisodes([]);
    setAssignments({});
    setHeldEpisodes(new Set());
    setIgnoreHeld(false);
    // The ids belong to the picked result; none picked means none known.
    setTmdbSeriesId(null);
    setTmdbMovieId(null);
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
          await loadEpisodes(result.tmdbId, firstSeason, selectedIndices, extIds.imdb_id ?? '');
        }
      } catch { /* fall through to manual entry */ }
    } else {
      setTmdbMovieId(result.tmdbId);
      try {
        const details = await TmdbService.getMovieDetails(result.tmdbId);
        if (details.imdb_id) setImdbId(details.imdb_id);
      } catch { /* ignore */ }
    }
  };

  const handleSeasonChange = async (seasonNum: number) => {
    setSeason(seasonNum);
    setAssignments({});
    setHeldEpisodes(new Set());
    setIgnoreHeld(false);
    if (tmdbSeriesId) await loadEpisodes(tmdbSeriesId, seasonNum, selectedIndices, imdbId);
  };

  /** Number the selected titles from the season's first episode after all. */
  const numberFromFirstEpisode = () => {
    setIgnoreHeld(true);
    setAssignments(autoAssignEpisodes({ selectedIndices, titles, episodes, contentTypes }));
  };

  const handleMediaTypeChange = (type: 'show' | 'movie') => {
    setMediaType(type);
    setSearchInput('');
    setSearchValue(null);
    setSearchResults([]);
    setTmdbSeasons([]);
    setEpisodes([]);
    setAssignments({});
    setHeldEpisodes(new Set());
    setIgnoreHeld(false);
    setTmdbSeriesId(null);
    setTmdbMovieId(null);
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
      const length = titles.find((t) => t.index === idx)?.duration_seconds ?? 0;
      const notAnEpisode = mediaType === 'show' && defaultsToExtra(idx, titles, titleHints);
      if (length < SHORT_CLIP_SECONDS || notAnEpisode) {
        // A clip, or a title the disc's play-all leaves out, is an extra, not
        // an episode: start it off as one.
        setContentTypes((prev) => ({ ...prev, [idx]: prev[idx] || DEFAULT_EXTRA_TYPE }));
      } else if (episodes.length) {
        const usedEps = assignedEpisodeNumbers(assignments);
        const free = (e: TmdbEpisode) => !usedEps.has(e.episodeNumber);
        const next = episodes.find((e) => free(e) && (ignoreHeld || !heldEpisodes.has(e.episodeNumber)))
          ?? episodes.find(free);
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

  /** Set (or with null, clear) the last episode of a title that holds several. */
  const setRangeEnd = (titleIdx: number, end: number | null) => {
    setAssignments((prev) => {
      const current = prev[titleIdx];
      if (current?.type !== 'episode') return prev;
      const next = { ...current };
      if (end != null && end > current.episodeNumber) next.episodeEndNumber = end;
      else delete next.episodeEndNumber;
      return { ...prev, [titleIdx]: next };
    });
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
    if (a.type === 'episode') return episodeValue(season, a, episodes).replace(' - ', ' — ');
    if (a.type === 'special') return 'SpecialFeature…';
    if (a.type === 'custom' && a.name) return a.name;
    return null;
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = () => {
    const blocker = startJobBlocker({ title, year, selectedIndices, linkedDiscId: linkedDisc?.id });
    if (blocker || !linkedDisc) { setError(blocker ?? ''); return; }
    setError('');
    onSubmit(buildStartJobRequest({
      discType, mediaType, title, year, imdbId,
      tmdbId: mediaType === 'show' ? tmdbSeriesId : tmdbMovieId,
      season, selectedIndices, assignments, contentTypes, episodes,
      catalogDiscId: linkedDisc.id,
      scanId,
    }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* ── Search & Metadata ──────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={4} sx={{ mb: 2 }} alignItems="flex-start" flexWrap="wrap" useFlexGap>
          {/* Two separate questions, each with its own label and its own answer. */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              1. What is on this disc?
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={mediaType}
              aria-label="What is on this disc"
              onChange={(_, value) => { if (value) handleMediaTypeChange(value as 'show' | 'movie'); }}
            >
              <ToggleButton value="show">TV show</ToggleButton>
              <ToggleButton value="movie">Movie</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              2. Disc format{detectedDiscType ? ' (read from the disc)' : ''}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={discType}
              aria-label="Disc format"
              onChange={(_, value) => { if (value) setDiscType(value as 'dvd' | 'bluray'); }}
            >
              <ToggleButton value="dvd">DVD</ToggleButton>
              <ToggleButton value="bluray">Blu-ray</ToggleButton>
            </ToggleButtonGroup>
          </Box>
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
        discType={discType}
        mediaType={mediaType}
        year={year}
        season={season}
        volumeLabel={discInfo?.volume_label ?? discInfo?.disc_name ?? null}
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
              onClick={() => loadEpisodes(tmdbSeriesId!, season, selectedIndices, imdbId, !ignoreHeld)}
            >
              Re-assign in order
            </Button>
          )}
        </Stack>

        {preselected.length < titles.length && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {preselected.length} of {titles.length} titles start out selected. The
            rest are repeats of a selected title, a play-all title that joins several of them, or short
            clips (extras such as commentary scenes, or ads and previews). Click any of them to rip it
            as well, and say what kind of extra it is.
          </Typography>
        )}

        {mediaType === 'show' && !ignoreHeld && (() => {
          const held = episodes.filter((e) => heldEpisodes.has(e.episodeNumber)).map((e) => e.episodeNumber);
          if (!held.length) return null;
          const all = held.length === episodes.length;
          return (
            <Alert
              severity="info"
              sx={{ mb: 1, py: 0 }}
              action={all ? undefined : (
                <Button color="inherit" size="small" onClick={numberFromFirstEpisode}>
                  Number from {epCode(season, episodes[0].episodeNumber)} instead
                </Button>
              )}
            >
              {all
                ? `Every episode of season ${season} is already in your library or on another disc's rip, so the numbering here starts at the first episode.`
                : `Season ${season} episode${held.length === 1 ? '' : 's'} ${formatEpisodeNumbers(held)} ${held.length === 1 ? 'is' : 'are'} already in your library or on another disc's rip, so the numbering here starts after ${held.length === 1 ? 'it' : 'them'}.`}
            </Alert>
          );
        })()}

        <Stack spacing={0.75}>
          {titles.map((t) => {
            const isSelected = selectedIndices.includes(t.index);
            const hint = titleHints[t.index];
            const hintNote = titleHintNote(hint);
            const isShort = !isPreselected(hint);
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
                  <Typography variant="body2" component="div" fontWeight={isSelected ? 600 : 400}>
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
                    {hint && (
                      <Chip
                        label={titleHintLabel(hint)}
                        size="small"
                        color={hint.kind === 'short' ? 'default' : 'warning'}
                        variant="outlined"
                        sx={{ ml: 1, height: 18, fontSize: 11 }}
                      />
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

                {hintNote && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                    {hintNote}
                  </Typography>
                )}

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

                      {/* A two-part episode on one title: the last episode it holds */}
                      {mediaType === 'show' && !isExtra && a?.type === 'episode'
                        && episodes.some((ep) => ep.episodeNumber > a.episodeNumber) && (
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                          <Select
                            value={rangeEnd(a) != null ? String(rangeEnd(a)) : ''}
                            onChange={(e) => setRangeEnd(t.index, e.target.value ? Number(e.target.value) : null)}
                            displayEmpty
                            inputProps={{ 'aria-label': `Through episode for title ${t.index}` }}
                          >
                            <MenuItem value="">
                              <Typography variant="body2" color="text.secondary">One episode</Typography>
                            </MenuItem>
                            {episodes.filter((ep) => ep.episodeNumber > a.episodeNumber).map((ep) => (
                              <MenuItem key={ep.episodeNumber} value={String(ep.episodeNumber)}>
                                <Typography variant="body2">
                                  through{' '}
                                  <Typography component="span" sx={{ fontFamily: 'monospace', mr: 1 }}>
                                    E{String(ep.episodeNumber).padStart(2, '0')}
                                  </Typography>
                                  {ep.name}
                                </Typography>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}
                    </Stack>

                    {mediaType === 'show' && !isExtra && a?.type === 'episode' && rangeEnd(a) == null && (() => {
                      const through = suggestedRangeEnd(t.duration_seconds, a.episodeNumber, episodes);
                      if (through == null) return null;
                      return (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
                          <Typography variant="caption" color="text.secondary">
                            About twice as long as an episode of this season: a two-part episode?
                          </Typography>
                          <Button size="small" variant="text" onClick={() => setRangeEnd(t.index, through)}>
                            Make it {epCode(season, a.episodeNumber)}-E{String(through).padStart(2, '0')}
                          </Button>
                        </Stack>
                      );
                    })()}

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
      {mediaType === 'show' && episodes.length > 0
        && selectedIndices.filter((idx) => !contentTypes[idx]).length > episodes.length && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You&apos;ve selected {selectedIndices.filter((idx) => !contentTypes[idx]).length} titles that are not
          extras but Season {season} only has {episodes.length} episodes.
          Titles beyond those are numbered as special features unless you tag them as extras.
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Output filename preview ────────────────────────────────────── */}
      {selectedIndices.length > 0 && title.trim() && (() => {
        // Built from the request Start Rip would send, by the ripper's naming rule.
        const names = previewFilenames({
          discType, mediaType, title, year, imdbId,
          tmdbId: mediaType === 'show' ? tmdbSeriesId : tmdbMovieId,
          season, selectedIndices, assignments, contentTypes, episodes, scanId,
        });
        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              File{names.length !== 1 ? 's' : ''} the ripper will deliver
            </Typography>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
              These are the names in the ingest folder. The library renames
              {mediaType === 'show' ? ' episodes' : ' the film'} when it files them
              {mediaType === 'show' ? ' (“Title (Year) [imdbid-…] S01E01 Episode Name.mkv”)' : ''}, and extras
              wait in Extras Review, where their type and final name are confirmed.
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

      <Stack direction="row" spacing={2} alignItems="center">
        <Button variant="contained" size="large" onClick={submit} disabled={!linkedDisc}>
          Start Rip
        </Button>
        {!linkedDisc && (
          <Typography variant="caption" color="text.secondary">
            Link this rip to a disc in your catalog (or create one) to start.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
