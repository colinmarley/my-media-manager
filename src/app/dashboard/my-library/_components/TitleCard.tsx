'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Skeleton, Typography } from '@mui/material';
import { borders, fontFamilies, radii, status as statusColors, surfaces, text } from '@/theme/tokens';

/** A stable hue per title, so a poster-less title keeps the same placeholder colour everywhere. */
export function titleHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return hash;
}

export interface PosterPlaceholderProps {
  title: string;
  /** Small line above the title (year, source). */
  detail?: string;
}

/**
 * Stands in for a missing poster: the title set as type on a muted slate tinted
 * by the title's own hue. No network request, so it also works offline.
 */
export const PosterPlaceholder: React.FC<PosterPlaceholderProps> = ({ title, detail }) => {
  const hue = titleHue(title);
  return (
    <Box
      data-testid="poster-placeholder"
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        p: 1.5,
        background: `linear-gradient(160deg, hsl(${hue} 24% 19%) 0%, hsl(${hue} 30% 9%) 100%)`,
      }}
    >
      {detail && (
        <Typography
          component="span"
          sx={{ fontFamily: fontFamilies.mono, fontSize: '0.6875rem', color: `hsl(${hue} 30% 72%)`, mb: 0.5 }}
        >
          {detail}
        </Typography>
      )}
      <Typography
        component="span"
        sx={{
          fontSize: '1.0625rem',
          lineHeight: 1.18,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: `hsl(${hue} 35% 90%)`,
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {title}
      </Typography>
    </Box>
  );
};

/** 2:3 frame every poster (or its placeholder) sits in. */
export const posterFrameSx = {
  position: 'relative',
  aspectRatio: '2 / 3',
  overflow: 'hidden',
  borderRadius: `${radii.md}px`,
  border: `1px solid ${borders.default}`,
  bgcolor: surfaces.sunken,
} as const;

export interface TitleCardProps {
  href: string;
  title: string;
  /** Year or date line under the title. */
  yearLabel: string;
  /** Text shown on the placeholder when there is no poster (the folder name, usually). */
  placeholderTitle: string;
  posterUrl: string;
  posterFailed: boolean;
  onPosterError: () => void;
  inLibrary: boolean;
  fileCount: number;
}

const TitleCard: React.FC<TitleCardProps> = ({
  href, title, yearLabel, placeholderTitle, posterUrl, posterFailed, onPosterError, inLibrary, fileCount,
}) => {
  const tone = inLibrary ? statusColors.success : statusColors.warning;
  const stateLabel = inLibrary ? 'In library' : 'Not in library';
  const filesLabel = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  return (
    <Box
      component={Link}
      href={href}
      aria-label={`${title}, ${stateLabel}, ${filesLabel}`}
      sx={{
        display: 'block',
        color: 'inherit',
        textDecoration: 'none',
        borderRadius: `${radii.md}px`,
        outline: 'none',
        '& .poster-frame': { transition: 'border-color 120ms ease, transform 120ms ease' },
        '&:hover .poster-frame': { borderColor: text.secondary },
        '&:hover img': { filter: 'brightness(1.08)' },
        '&:focus-visible .poster-frame': { outline: '2px solid', outlineColor: 'primary.light', outlineOffset: 2 },
      }}
    >
      <Box className="poster-frame" sx={posterFrameSx}>
        {posterFailed ? (
          <PosterPlaceholder title={placeholderTitle} />
        ) : (
          <Box
            component="img"
            src={posterUrl}
            alt=""
            loading="lazy"
            onError={onPosterError}
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'filter 120ms ease' }}
          />
        )}
        {fileCount > 0 && (
          <Box
            component="span"
            sx={{
              position: 'absolute', top: 8, right: 8, px: 0.75, py: '2px', borderRadius: '4px',
              bgcolor: 'rgba(9, 10, 11, 0.78)', backdropFilter: 'blur(6px)', color: text.primary,
              fontSize: '0.6875rem', fontWeight: 500, lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
            }}
          >
            {filesLabel}
          </Box>
        )}
      </Box>
      <Box sx={{ pt: 1, px: 0.25 }}>
        <Typography
          variant="subtitle2"
          component="h3"
          data-testid="library-card-title"
          sx={{ color: 'text.primary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, minWidth: 0 }}>
          <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: tone.fg, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary" noWrap>
            {yearLabel ? `${yearLabel}, ${stateLabel.toLowerCase()}` : stateLabel}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export const TitleCardSkeleton: React.FC = () => (
  <Box aria-hidden>
    <Skeleton variant="rounded" sx={{ aspectRatio: '2 / 3', height: 'auto', borderRadius: `${radii.md}px` }} />
    <Skeleton width="70%" sx={{ mt: 1 }} />
    <Skeleton width="40%" />
  </Box>
);

export default TitleCard;
