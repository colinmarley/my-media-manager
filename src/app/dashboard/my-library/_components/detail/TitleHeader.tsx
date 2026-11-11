import { Box, Chip, Skeleton, Stack } from '@mui/material';
import React, { useEffect, useState } from 'react';

import PageHeader from '@/components/ui/PageHeader';
import StatTile from '@/components/ui/StatTile';
import { PLACEHOLDER_POSTER } from '@/service/library/mediaDetailModel';
import { borders } from '@/theme/tokens';
import { MediaFileSummary } from '@/types/library/MediaFile.type';
import { formatBytes } from '@/utils/format';
import {
  getCastDisplay,
  getDirectorsDisplay,
  getTitleYearLabel,
  LibraryMedia,
} from '../libraryHelpers';

export const MEDIA_TYPE_LABELS: Record<string, string> = {
  movie: 'Movie',
  series: 'Show',
  documentary: 'Documentary',
  live_performance: 'Live performance',
  home_video: 'Home video',
  needs_review: 'Needs review',
};

interface Props {
  media: LibraryMedia | null;
  loading: boolean;
  mediaType: string | null;
  posterSrc: string | null;
  summary: MediaFileSummary;
  sourceCount: number;
  /** False on a backend without the file inventory: the file stats are unknown, not zero. */
  hasInventory: boolean;
  actions: React.ReactNode;
  /** Reserved for a later PR (titles that need attention); rendered under the header. */
  attentionBanner?: React.ReactNode;
}

const yearOf = (label: string): string | null => /\b(\d{4})\b/.exec(label)?.[1] ?? null;

const firstNames = (value: string, count: number): string | null => {
  if (!value || value === 'N/A') return null;
  const names = value.split(',').map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  return names.length > count ? `${names.slice(0, count).join(', ')} and others` : names.join(', ');
};

/** Key facts line: runtime · genres · director · cast. */
export function titleFacts(media: LibraryMedia): string[] {
  const facts: string[] = [];
  if (media.runtime && media.runtime !== 'N/A') facts.push(media.runtime);
  if (Array.isArray(media.genres) && media.genres.length > 0) facts.push(media.genres.slice(0, 3).join(', '));
  const directors = firstNames(getDirectorsDisplay(media), 2);
  if (directors) facts.push(`Directed by ${directors}`);
  const cast = firstNames(getCastDisplay(media), 3);
  if (cast) facts.push(`Starring ${cast}`);
  return facts;
}

const Poster = ({ src, title }: { src: string | null; title: string }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <Box
      component="img"
      src={!src || failed ? PLACEHOLDER_POSTER : src}
      alt={title ? `${title} poster` : 'Poster'}
      onError={() => setFailed(true)}
      sx={{
        width: { xs: 96, sm: 132 },
        aspectRatio: '2 / 3',
        objectFit: 'cover',
        borderRadius: 1,
        border: `1px solid ${borders.default}`,
        flexShrink: 0,
        display: 'block',
      }}
    />
  );
};

/** Poster, title, year, type, key facts, inventory stats and the page actions. */
const TitleHeader = ({
  media,
  loading,
  mediaType,
  posterSrc,
  summary,
  sourceCount,
  hasInventory,
  actions,
  attentionBanner,
}: Props) => {
  if (loading && !media) {
    return (
      <Stack direction="row" spacing={2} sx={{ mb: 3 }} aria-busy="true" aria-label="Loading title">
        <Skeleton variant="rounded" width={132} height={198} />
        <Box sx={{ flex: 1 }}>
          <Skeleton width="40%" height={36} />
          <Skeleton width="60%" />
          <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" width={120} height={72} />)}
          </Stack>
        </Box>
      </Stack>
    );
  }

  const title = media?.title || 'Untitled';
  const year = media ? yearOf(getTitleYearLabel(media)) : null;
  const facts = media ? titleFacts(media) : [];
  const typeLabel = mediaType ? MEDIA_TYPE_LABELS[mediaType] ?? mediaType : null;
  const unknown = hasInventory ? undefined : 'Not scanned';

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={{ xs: 2, sm: 3 }} alignItems="flex-start">
        {media && <Poster src={posterSrc} title={title} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PageHeader
            title={
              <>
                {media ? title : 'Title not found'}
                {year && (
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 1 }}>
                    ({year})
                  </Box>
                )}
              </>
            }
            subtitle={facts.length > 0 ? facts.join(' · ') : undefined}
            actions={actions}
          >
            {typeLabel && (
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Chip size="small" label={typeLabel} color="primary" variant="outlined" />
              </Stack>
            )}
            {media && (
              <Box
                sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, minmax(0, 180px))' } }}
              >
                <StatTile label="Files" value={hasInventory ? summary.fileCount : '—'} detail={unknown} />
                <StatTile label="Total size" value={hasInventory ? formatBytes(summary.totalSize, { precision: 'video' }) : '—'} />
                <StatTile label="Discs & tapes" value={sourceCount} />
                <StatTile
                  label="Missing"
                  value={hasInventory ? summary.missingCount : '—'}
                  tone={summary.missingCount > 0 ? 'error' : undefined}
                  detail={hasInventory && summary.unprobedCount > 0 ? `${summary.unprobedCount} not probed` : undefined}
                />
              </Box>
            )}
          </PageHeader>
        </Box>
      </Stack>
      {attentionBanner}
    </Box>
  );
};

export default TitleHeader;
