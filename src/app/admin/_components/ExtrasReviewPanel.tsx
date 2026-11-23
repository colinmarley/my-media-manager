'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, MenuItem,
  Paper, Select, Stack, Typography,
} from '@mui/material';
import ExtrasReviewService from '@/service/library/ExtrasReviewService';
import useExtrasReviewStore from '@/store/useExtrasReviewStore';
import { formatBytes } from '@/utils/format';

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

function formatSize(bytes: number | null): string {
  return formatBytes(bytes, { precision: 'video' });
}

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Twelve frames spread over the file, so the type can be judged without playing it. */
function ContactSheet({ id, fileName }: { id: string; fileName: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return (
    <Box>
      {state === 'loading' && (
        <Typography variant="caption" color="text.secondary">Reading frames from the file…</Typography>
      )}
      {state === 'failed' && (
        <Typography variant="caption" color="text.secondary">No frames could be read from this file.</Typography>
      )}
      {state !== 'failed' && (
        // eslint-disable-next-line @next/next/no-img-element -- made on demand by the backend, not a static asset
        <img
          src={ExtrasReviewService.contactSheetUrl(id)}
          alt={`Twelve frames from ${fileName}`}
          loading="lazy"
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
          // Kept in the layout while loading: a lazy image that is display:none is never fetched.
          style={{
            display: 'block', width: '100%', height: 'auto', borderRadius: 4,
            minHeight: state === 'ready' ? undefined : 1,
            opacity: state === 'ready' ? 1 : 0,
          }}
        />
      )}
    </Box>
  );
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
            Confirm or correct the type of each extra before it is filed. Ripped extras wait here with
            frames from the video; files stay where they landed until confirmed.
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
                  label={formatSize(item.fileSize)}
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
                  {isSaving ? 'Saving…' : item.source === 'rip' ? 'Confirm and file' : 'Confirm'}
                </Button>
              </Stack>

              {item.source === 'rip' && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1, wordBreak: 'break-word' }}>
                    {[
                      item.title ? `${item.title}${item.year ? ` (${item.year})` : ''}` : null,
                      item.discTitleIndex != null ? `disc title ${item.discTitleIndex}` : null,
                      formatDuration(item.durationMs),
                    ].filter(Boolean).join(' · ')}
                    {item.proposedPath && (
                      <>
                        <br />
                        Will be filed as <strong>{baseName(item.proposedPath)}</strong>
                      </>
                    )}
                  </Typography>
                  {item.hasContactSheet && <ContactSheet id={item.id} fileName={item.fileName} />}
                </Box>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
