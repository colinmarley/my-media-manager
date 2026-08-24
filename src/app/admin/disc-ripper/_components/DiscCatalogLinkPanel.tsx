'use client';

import React, { useRef, useState } from 'react';
import {
  Alert, Autocomplete, Button, Chip, CircularProgress,
  Paper, Stack, TextField, Typography,
} from '@mui/material';
import { searchDiscs, createDisc } from '@/service/catalog/DiscCatalogService';
import { CatalogDisc } from '@/types/catalog/Disc.type';

/**
 * Search for or create the physical Disc catalog record this rip belongs to.
 * The Disc table in my-media-manager's Postgres is the canonical, cross-service
 * disc entity (see backend/api/catalog.py) — disc-ripper-service has no disc
 * identity of its own, it just stores the linked catalog_disc_id on the job.
 *
 * Linking is optional: a rip can be started without a pre-logged or newly
 * created disc, in which case catalog_disc_id stays unset.
 */
export default function DiscCatalogLinkPanel({
  discTitle,
  linkedDisc,
  onLink,
  onUnlink,
}: {
  discTitle: string;
  linkedDisc: CatalogDisc | null;
  onLink: (disc: CatalogDisc) => void;
  onUnlink: () => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState<CatalogDisc[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchDiscs({ title: query }));
    } finally {
      setSearching(false);
    }
  };

  const handleInputChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 400);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const disc = await createDisc({ title: discTitle || searchInput || 'Untitled Disc' });
      onLink(disc);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create disc record');
    } finally {
      setCreating(false);
    }
  };

  if (linkedDisc) {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Linked to disc:</Typography>
            <Chip label={linkedDisc.title} size="small" color="primary" />
          </Stack>
          <Button size="small" onClick={onUnlink}>Unlink</Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Physical Disc (optional)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Link this rip to a disc in your physical media catalog, or create a new record for it.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <Autocomplete
          size="small"
          sx={{ minWidth: 260, flex: '1 1 260px' }}
          options={results}
          loading={searching}
          getOptionLabel={(opt) => opt.title}
          inputValue={searchInput}
          onInputChange={(_, value) => handleInputChange(value)}
          onChange={(_, value) => { if (value) onLink(value); }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search existing discs"
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searching && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        <Button
          variant="outlined"
          size="small"
          disabled={creating}
          startIcon={creating ? <CircularProgress size={14} /> : undefined}
          onClick={handleCreate}
          sx={{ alignSelf: 'center' }}
        >
          {creating ? 'Creating…' : 'Create New Disc Record'}
        </Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Paper>
  );
}
