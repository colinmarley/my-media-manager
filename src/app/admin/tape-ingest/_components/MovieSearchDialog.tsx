'use client';
import React, { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { MovieMetadata } from '@/types/tape-ingest/TapeIngest.type';
import { searchByText, retrieveMediaDataById } from '@/service/omdb/OmdbService';

interface Props { open: boolean; fileName: string; onClose: () => void; onAssign: (m: MovieMetadata) => void; }

export default function MovieSearchDialog({ open, fileName, onClose, onAssign }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ imdbID: string; Title: string; Year: string; Poster: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MovieMetadata | null>(null);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(''); setResults([]); setSelected(null);
    try {
      const res = await searchByText(query, 'movie');
      setResults((res.Search ?? []) as typeof results);
      if (!res.Search?.length) setError('No results found.');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Search failed'); }
    finally { setLoading(false); }
  };

  const pick = async (imdbID: string, Title: string, Year: string, Poster: string) => {
    setSelected({ imdbId: imdbID, title: Title, year: parseInt(Year), poster: Poster });
  };

  const confirm = () => { if (selected) { onAssign(selected); setQuery(''); setResults([]); setSelected(null); } };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Assign Movie — {fileName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Search by title" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()} fullWidth />
            <Button variant="outlined" onClick={search} disabled={loading}>
              {loading ? <CircularProgress size={20} /> : 'Search'}
            </Button>
          </Stack>
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          <Stack spacing={1}>
            {results.map((r) => (
              <Box key={r.imdbID} onClick={() => pick(r.imdbID, r.Title, r.Year, r.Poster)}
                sx={{ display: 'flex', gap: 1.5, p: 1, borderRadius: 1, cursor: 'pointer',
                  border: 1, borderColor: selected?.imdbId === r.imdbID ? 'primary.main' : 'divider',
                  bgcolor: selected?.imdbId === r.imdbID ? 'action.selected' : 'transparent' }}>
                {r.Poster !== 'N/A' && <Box component="img" src={r.Poster} alt="" sx={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 0.5 }} />}
                <Box>
                  <Typography variant="body2" fontWeight={500}>{r.Title}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.Year}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
          {selected && (
            <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">Destination:</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {selected.title} ({selected.year})/{selected.title} ({selected.year}).mp4
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={confirm} disabled={!selected}>Assign</Button>
      </DialogActions>
    </Dialog>
  );
}
