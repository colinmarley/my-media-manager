'use client';
import React, { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { TvShowMetadata } from '@/types/tape-ingest/TapeIngest.type';
import { searchByText, retrieveEpisodeData } from '@/service/omdb/OmdbService';

interface Props { open: boolean; fileName: string; onClose: () => void; onAssign: (m: TvShowMetadata) => void; }

export default function TvShowSearchDialog({ open, fileName, onClose, onAssign }: Props) {
  const [query, setQuery] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [results, setResults] = useState<Array<{ imdbID: string; Title: string; Year: string; Poster: string }>>([]);
  const [selectedSeries, setSelectedSeries] = useState<{ imdbID: string; Title: string; Year: string; Poster: string } | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(''); setResults([]); setSelectedSeries(null); setEpisodeTitle('');
    try {
      const res = await searchByText(query, 'series');
      setResults((res.Search ?? []) as typeof results);
      if (!res.Search?.length) setError('No results found.');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Search failed'); }
    finally { setLoading(false); }
  };

  const loadEpisode = async () => {
    if (!selectedSeries || !season || !episode) return;
    setLoading(true); setError('');
    try {
      const data = await retrieveEpisodeData(selectedSeries.imdbID, parseInt(season), parseInt(episode));
      setEpisodeTitle(data.Title || `Episode ${episode}`);
    } catch { setEpisodeTitle(`Episode ${episode}`); }
    finally { setLoading(false); }
  };

  const confirm = () => {
    if (!selectedSeries || !season || !episode) return;
    onAssign({
      seriesImdbId: selectedSeries.imdbID,
      seriesTitle: selectedSeries.Title,
      seriesYear: parseInt(selectedSeries.Year),
      seasonNumber: parseInt(season),
      episodeNumber: parseInt(episode),
      episodeTitle: episodeTitle || `Episode ${episode}`,
      poster: selectedSeries.Poster !== 'N/A' ? selectedSeries.Poster : undefined,
    });
    setQuery(''); setResults([]); setSelectedSeries(null); setSeason(''); setEpisode(''); setEpisodeTitle('');
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Assign TV Episode — {fileName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Search series" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()} fullWidth />
            <Button variant="outlined" onClick={search} disabled={loading}>
              {loading ? <CircularProgress size={20} /> : 'Search'}
            </Button>
          </Stack>
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          <Stack spacing={1}>
            {results.map((r) => (
              <Box key={r.imdbID} onClick={() => setSelectedSeries(r)}
                sx={{ display: 'flex', gap: 1.5, p: 1, borderRadius: 1, cursor: 'pointer',
                  border: 1, borderColor: selectedSeries?.imdbID === r.imdbID ? 'primary.main' : 'divider',
                  bgcolor: selectedSeries?.imdbID === r.imdbID ? 'action.selected' : 'transparent' }}>
                {r.Poster !== 'N/A' && <Box component="img" src={r.Poster} alt="" sx={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 0.5 }} />}
                <Box><Typography variant="body2" fontWeight={500}>{r.Title}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.Year}</Typography></Box>
              </Box>
            ))}
          </Stack>
          {selectedSeries && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1}>
                <TextField size="small" label="Season" type="number" value={season} onChange={(e) => setSeason(e.target.value)} sx={{ width: 100 }} slotProps={{ htmlInput: { min: 1 } }} />
                <TextField size="small" label="Episode" type="number" value={episode} onChange={(e) => setEpisode(e.target.value)} sx={{ width: 100 }} slotProps={{ htmlInput: { min: 1 } }} />
                <Button size="small" variant="outlined" onClick={loadEpisode} disabled={!season || !episode || loading}>
                  Load Episode
                </Button>
              </Stack>
              {episodeTitle && <Typography variant="body2">Episode: <strong>{episodeTitle}</strong></Typography>}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={confirm} disabled={!selectedSeries || !season || !episode}>Assign</Button>
      </DialogActions>
    </Dialog>
  );
}
