import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Link as MuiLink, Paper, Stack, Typography } from '@mui/material';
import React from 'react';

import {
  getCastDisplay,
  getDirectorsDisplay,
  getTitleYearLabel,
  LibraryMedia,
} from '../libraryHelpers';
import styles from './mediaDetailStyles';

interface Props {
  media: LibraryMedia;
  /** 'series' links TMDB's TV pages. */
  catalogType: 'movie' | 'series' | null;
  folderPath: string | null;
  externalIds: { imdbId?: string; tmdbId?: number } | null;
  legacyImdbId?: string;
}

const NA = 'N/A';

const str = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const list = (value: unknown): string | null =>
  Array.isArray(value) && value.length > 0 ? value.filter((v) => typeof v === 'string').join(', ') || null : null;

const display = (value: string | null | undefined) => (value && value !== NA ? value : null);

/** One labelled field; `dt` / `dd` so the list reads as name–value pairs. */
const Field = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <Box sx={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
    <Typography component="dt" variant="caption" sx={styles.metaLabel}>{label}</Typography>
    <Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.25, overflowWrap: 'anywhere' }}>
      {children ?? <Box component="span" sx={{ color: 'text.disabled' }}>{NA}</Box>}
    </Typography>
  </Box>
);

const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <MuiLink href={href} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
    {children}
    <OpenInNewIcon sx={{ fontSize: 14 }} aria-hidden />
  </MuiLink>
);

/**
 * The Metadata tab's labelled fields for one catalog record: overview, dates, people, ids
 * (linked out to IMDb / TMDB) and the folder path. Missing values read "N/A".
 */
const MediaOverviewCard = ({ media, catalogType, folderPath, externalIds, legacyImdbId }: Props) => {
  const record = media as unknown as Record<string, unknown>;
  const omdb = (record.omdbData && typeof record.omdbData === 'object' ? record.omdbData : {}) as Record<string, unknown>;
  const overview = str(record, 'plot') ?? str(record, 'overview') ?? str(omdb, 'Plot');
  const imdbId = externalIds?.imdbId || legacyImdbId || str(record, 'imdbId');
  const tmdbId = externalIds?.tmdbId;
  const tvdbId = (record.externalIds as { tvdbId?: number } | undefined)?.tvdbId;
  const isShow = catalogType === 'series';
  const languages = list(record.languages);
  const rating = str(record, 'certification') ?? str(record, 'contentRating');

  return (
    <Paper sx={styles.sectionCard} component="section" aria-labelledby="metadata-heading">
      <Typography id="metadata-heading" variant="h5" component="h2" sx={{ mb: 1.5 }}>
        Details
      </Typography>

      {overview && (
        <Typography variant="body1" sx={{ mb: 2, maxWidth: '80ch', color: 'text.primary' }}>
          {overview}
        </Typography>
      )}

      <Box
        component="dl"
        sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}
      >
        <Field label={isShow ? 'Running dates' : 'Release date'}>{display(getTitleYearLabel(media))}</Field>
        <Field label="Runtime">{display(media.runtime)}</Field>
        <Field label="Country">{list(media.countryOfOrigin)}</Field>
        <Field label="Genres">{list(media.genres)}</Field>
        {languages && <Field label="Languages">{languages}</Field>}
        {rating && <Field label="Rating">{rating}</Field>}
        {isShow && str(record, 'network') && <Field label="Network">{str(record, 'network')}</Field>}
        {isShow && str(record, 'status') && <Field label="Status">{str(record, 'status')}</Field>}
        <Field label="Directors" wide>{display(getDirectorsDisplay(media))}</Field>
        <Field label="Cast" wide>{display(getCastDisplay(media))}</Field>
        <Field label="Writers" wide>{list(media.writers)}</Field>
        <Field label="External IDs" wide>
          {imdbId || tmdbId || tvdbId ? (
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" component="span">
              {imdbId && (
                <ExternalLink href={`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`}>IMDb {imdbId}</ExternalLink>
              )}
              {typeof tmdbId === 'number' && (
                <ExternalLink href={`https://www.themoviedb.org/${isShow ? 'tv' : 'movie'}/${tmdbId}`}>TMDB {tmdbId}</ExternalLink>
              )}
              {typeof tvdbId === 'number' && <span>TVDB {tvdbId}</span>}
            </Stack>
          ) : null}
        </Field>
        <Field label="Folder path" wide>
          {folderPath ? <Box component="span" sx={styles.mono}>{folderPath}</Box> : null}
        </Field>
      </Box>
    </Paper>
  );
};

export default MediaOverviewCard;
