'use client';

import React, { useEffect, useState } from 'react';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, MenuItem,
  Paper, Select, Stack, Typography,
} from '@mui/material';
import ExtrasReviewService from '@/service/library/ExtrasReviewService';
import useExtrasReviewStore from '@/store/useExtrasReviewStore';
import { formatBytes } from '@/utils/format';
import ExtraPlayer, { formatClock } from './ExtraPlayer';

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
  return ms && ms > 0 ? formatClock(Math.round(ms / 1000)) : null;
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

// Matches services/contact_sheet.py: COLUMNS x ROWS frames, one every max(duration / 12, 1) seconds.
const SHEET_COLUMNS = 4;
const SHEET_ROWS = 3;

/** Where frame `k` of the sheet was taken, in seconds. */
export function frameTime(k: number, durationSeconds: number): number {
  const step = Math.max(durationSeconds / (SHEET_COLUMNS * SHEET_ROWS), 1);
  return Math.min(k * step, Math.max(0, durationSeconds - 1));
}

/**
 * Twelve frames spread over the file, so the type can often be judged without playing it.
 * With a known length, each frame is also a button that plays the file from that point.
 */
function ContactSheet({ id, fileName, durationSeconds, onPlayFrom }: {
  id: string;
  fileName: string;
  durationSeconds: number | null;
  onPlayFrom: (seconds: number) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return (
    <Box sx={{ position: 'relative' }}>
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
      {state === 'ready' && durationSeconds ? (
        <Box
          sx={{
            position: 'absolute', inset: 0, display: 'grid',
            gridTemplateColumns: `repeat(${SHEET_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${SHEET_ROWS}, 1fr)`,
          }}
        >
          {Array.from({ length: SHEET_COLUMNS * SHEET_ROWS }, (_, k) => {
            const at = frameTime(k, durationSeconds);
            return (
              <Box
                key={k}
                component="button"
                type="button"
                aria-label={`Play from ${formatClock(at)}`}
                title={`Play from ${formatClock(at)}`}
                onClick={() => onPlayFrom(at)}
                sx={{
                  border: 0, p: 0, m: 0, background: 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'common.white', opacity: 0, transition: 'opacity 120ms',
                  '&:hover, &:focus-visible': { opacity: 1, background: 'rgba(0,0,0,0.35)' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                }}
              >
                <PlayArrowIcon fontSize="large" />
              </Box>
            );
          })}
        </Box>
      ) : null}
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
  // One player at a time: each is a live transcode on the server.
  const [playing, setPlaying] = useState<{ id: string; start: number } | null>(null);

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
            frames from the video, and can be played when the frames are not enough (click a frame to
            play from there); files stay where they landed until confirmed.
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
          const durationSeconds = item.durationMs && item.durationMs > 0 ? item.durationMs / 1000 : null;
          const playFrom = (start: number) => setPlaying({ id: item.id, start });
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
                  <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
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
                    {playing?.id !== item.id && (
                      <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => playFrom(0)} sx={{ flexShrink: 0 }}>
                        Play
                      </Button>
                    )}
                  </Stack>
                  {playing?.id === item.id && (
                    <ExtraPlayer
                      id={item.id}
                      fileName={item.fileName}
                      start={playing.start}
                      durationSeconds={durationSeconds}
                      onJump={playFrom}
                      onClose={() => setPlaying(null)}
                    />
                  )}
                  {item.hasContactSheet && (
                    <ContactSheet id={item.id} fileName={item.fileName} durationSeconds={durationSeconds} onPlayFrom={playFrom} />
                  )}
                </Box>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
