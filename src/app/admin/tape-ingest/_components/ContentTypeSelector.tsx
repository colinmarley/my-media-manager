'use client';
import React from 'react';
import { Button, ButtonGroup, Chip } from '@mui/material';
import {
  Movie as MovieIcon, Theaters as TrailerIcon, Tv as TvShowIcon,
  Campaign as CommercialIcon, VideoLibrary as HomeVideoIcon,
  Block as SkipIcon, Check as CheckIcon,
} from '@mui/icons-material';
import { ContentType } from '@/types/tape-ingest/TapeIngest.type';

const STATUS_COLOR: Record<ContentType, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  unclassified: 'default', movie: 'info', home_video: 'success',
  tv_show: 'info', trailer: 'info', commercial: 'info', skip: 'warning',
};

interface ContentTypeSelectorProps {
  selected: ContentType;
  statusLabel: string;
  onSelect: (type: ContentType) => void;
}

const BUTTONS = [
  { type: 'movie' as ContentType, icon: <MovieIcon />, label: 'Movie', color: 'primary' as const },
  { type: 'tv_show' as ContentType, icon: <TvShowIcon />, label: 'TV Show', color: 'primary' as const },
  { type: 'home_video' as ContentType, icon: <HomeVideoIcon />, label: 'Home Video', color: 'success' as const },
  { type: 'trailer' as ContentType, icon: <TrailerIcon />, label: 'Trailer', color: 'info' as const },
  { type: 'commercial' as ContentType, icon: <CommercialIcon />, label: 'Commercial', color: 'info' as const },
  { type: 'skip' as ContentType, icon: <SkipIcon />, label: 'Skip', color: 'warning' as const },
];

export default function ContentTypeSelector({ selected, statusLabel, onSelect }: ContentTypeSelectorProps) {
  return (
    <>
      <ButtonGroup size="small" variant="outlined">
        {BUTTONS.map(({ type, icon, label, color }) => (
          <Button key={type} startIcon={icon}
            color={selected === type ? color : 'inherit'}
            variant={selected === type ? 'contained' : 'outlined'}
            onClick={() => onSelect(type)}>
            {label}
          </Button>
        ))}
      </ButtonGroup>
      {selected !== 'unclassified' && (
        <Chip size="small" label={statusLabel} color={STATUS_COLOR[selected]}
          icon={selected !== 'skip' ? <CheckIcon /> : undefined} sx={{ ml: 1 }} />
      )}
    </>
  );
}
