'use client';
import React from 'react';
import { Stack, Typography } from '@mui/material';
import { TapeIngestItem } from '@/types/tape-ingest/TapeIngest.type';

interface FileMetadataChipsProps { item: TapeIngestItem; }

export default function FileMetadataChips({ item }: FileMetadataChipsProps) {
  const fields = [item.durationFormatted, item.fileSizeFormatted, item.resolution, item.videoCodec].filter(Boolean);
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
      {fields.map((f) => <Typography key={f} variant="caption" color="text.secondary">{f}</Typography>)}
    </Stack>
  );
}
