'use client';

import React, { useEffect } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, MenuItem,
  Paper, Select, Stack, Typography,
} from '@mui/material';
import useExtrasReviewStore from '@/store/useExtrasReviewStore';

const CATEGORY_LABELS: Record<string, string> = {
  behind_the_scenes: 'Behind the Scenes',
  deleted_scene: 'Deleted Scene',
  interview: 'Interview',
  featurette: 'Featurette',
  trailer: 'Trailer',
  scene: 'Scene',
  sample: 'Sample',
  short: 'Short',
  clip: 'Clip',
  blooper: 'Blooper',
  other: 'Other',
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const gb = bytes / 1_073_741_824;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_048_576).toFixed(0)} MB`;
}

/**
 * Review queue for extras (deleted scenes, trailers, behind-the-scenes, etc.)
 * that were auto-classified during ingest but not yet confirmed. Confirming
 * here is what allows file_organization_service to move the file into its
 * final Jellyfin extras subfolder — see services/extras_taxonomy.py and
 * api/extras.py.
 */
export default function ExtrasReviewPanel() {
  const { items, categories, loading, error, savingIds, load, setCategory, confirm } = useExtrasReviewStore();

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Extras Review</Typography>
          <Typography variant="body2" color="text.secondary">
            Confirm or correct the extras type for files auto-classified during ingest.
            Files stay where they landed until confirmed here.
          </Typography>
        </Box>
        <Button size="small" onClick={() => load()} disabled={loading}>
          {loading ? <CircularProgress size={16} /> : 'Refresh'}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && items.length === 0 && !error && (
        <Alert severity="success">Nothing pending review.</Alert>
      )}

      <Stack spacing={1.5}>
        {items.map((item) => {
          const isSaving = savingIds.has(item.id);
          return (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={500} noWrap title={item.fileName}>
                    {item.fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                    {item.filePath}
                  </Typography>
                </Box>

                <Chip
                  label={formatBytes(item.fileSize)}
                  size="small"
                  variant="outlined"
                  sx={{ flexShrink: 0 }}
                />

                {item.source && (
                  <Chip
                    label={item.source === 'inferred' ? 'auto-suggested' : item.source}
                    size="small"
                    color={item.source === 'inferred' ? 'info' : 'default'}
                    variant="outlined"
                    sx={{ flexShrink: 0 }}
                  />
                )}

                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <Select
                    value={item.category ?? ''}
                    displayEmpty
                    onChange={(e) => setCategory(item.id, e.target.value)}
                  >
                    <MenuItem value="" disabled>
                      <em>Select a category…</em>
                    </MenuItem>
                    {categories.map((c) => (
                      <MenuItem key={c} value={c}>
                        {CATEGORY_LABELS[c] ?? c}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Button
                  variant="contained"
                  size="small"
                  disabled={!item.category || isSaving}
                  startIcon={isSaving ? <CircularProgress size={14} /> : undefined}
                  onClick={() => confirm(item.id)}
                >
                  {isSaving ? 'Saving…' : 'Confirm'}
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
