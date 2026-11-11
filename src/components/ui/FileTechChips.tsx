'use client';

import React from 'react';
import { Chip, Stack } from '@mui/material';
import { borders, fontFamilies, status, text } from '@/theme/tokens';
import { formatChannelLayout } from '@/utils/format';

export interface FileTech {
  container?: string | null;
  videoCodec?: string | null;
  resolutionCategory?: string | null;
  hdrFormat?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | string | null;
}

/** "6" / 6 → "5.1", "2" → "Stereo"; see formatChannelLayout in utils/format. */
export const formatAudioChannels = formatChannelLayout;

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** The chips to render, in display order, with absent values dropped. */
export function fileTechLabels(tech: FileTech): Array<{ key: keyof FileTech; label: string }> {
  const audio = [clean(tech.audioCodec)?.toUpperCase(), formatAudioChannels(tech.audioChannels)].filter(Boolean).join(' ');
  const entries: Array<[keyof FileTech, string | null | undefined]> = [
    ['resolutionCategory', clean(tech.resolutionCategory)],
    ['hdrFormat', clean(tech.hdrFormat)],
    ['videoCodec', clean(tech.videoCodec)?.toUpperCase()],
    ['audioCodec', audio || null],
    ['container', clean(tech.container)?.toUpperCase()],
  ];
  return entries.filter((e): e is [keyof FileTech, string] => Boolean(e[1])).map(([key, label]) => ({ key, label }));
}

export interface FileTechChipsProps extends FileTech {
  size?: 'small' | 'medium';
}

/** Compact technical facts about a media file (resolution, HDR, codecs). */
const FileTechChips: React.FC<FileTechChipsProps> = ({ size = 'small', ...tech }) => {
  const labels = fileTechLabels(tech);
  if (labels.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" aria-label="File details">
      {labels.map(({ key, label }) => (
        <Chip
          key={key}
          label={label}
          size={size}
          variant="outlined"
          sx={{
            height: 20,
            fontFamily: fontFamilies.mono,
            fontSize: '0.6875rem',
            color: key === 'hdrFormat' ? status.warning.fg : text.secondary,
            borderColor: key === 'hdrFormat' ? status.warning.border : borders.default,
            '& .MuiChip-label': { px: 0.75 },
          }}
        />
      ))}
    </Stack>
  );
};

export default FileTechChips;
