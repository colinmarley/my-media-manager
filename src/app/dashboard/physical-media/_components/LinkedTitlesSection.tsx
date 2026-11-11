'use client';

import React, { useEffect, useState } from 'react';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import { Alert, List, ListItemButton, ListItemIcon, ListItemText, Paper, Skeleton, Typography } from '@mui/material';
import Link from 'next/link';

import { getSourceTitles } from '@/service/library/MediaFilesService';
import { SourceKind, SourceTitleLink } from '@/types/library/MediaFile.type';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; titles: SourceTitleLink[] }
  | { kind: 'error'; message: string };

/** The titles a disc or tape holds (GET /discs|tapes/{id}/links), each linking to its detail page. */
export default function LinkedTitlesSection({ kind, id }: { kind: SourceKind; id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    getSourceTitles(kind, id)
      .then((titles) => !cancelled && setState({ kind: 'ready', titles }))
      .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load' }));
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  return (
    <Paper variant="outlined" component="section" aria-labelledby="linked-titles-heading" sx={{ p: 2, mb: 3 }}>
      <Typography id="linked-titles-heading" variant="subtitle2" component="h2" sx={{ mb: 1 }}>
        Titles
      </Typography>
      {state.kind === 'loading' && <Skeleton width="50%" />}
      {state.kind === 'error' && <Alert severity="error">Could not load the linked titles: {state.message}</Alert>}
      {state.kind === 'ready' && state.titles.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          This {kind} is not linked to any movie or show yet.
        </Typography>
      )}
      {state.kind === 'ready' && state.titles.length > 0 && (
        <List dense disablePadding>
          {state.titles.map((title) => (
            <ListItemButton
              key={`${title.mediaType}:${title.mediaId}`}
              component={Link}
              href={`/dashboard/my-library/${title.mediaType}/${encodeURIComponent(title.mediaId)}`}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                {title.mediaType === 'series' ? <TvIcon fontSize="small" /> : <MovieIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={title.title || title.mediaId}
                secondary={title.mediaType === 'series' ? 'Show' : 'Movie'}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </Paper>
  );
}
